import {lex, parserSql} from './syntax.mjs';
import {parseGraphSql} from './graph-model.mjs';

export const fold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
export const isNode = value => value && typeof value.kind === 'string' && value.attrs && value.slots;
export const empty = value => value == null || Array.isArray(value) && !value.length;
export const clean = (values, allowed) => Object.entries(values).every(([key, value]) => allowed.includes(key) || empty(value));
export const hiddenNames = new Set(['rowid', 'oid', '_rowid_']);
export function* locations(root, path = []) {
    if (!isNode(root)) return;
    yield {node: root, path};
    for (const [field, value] of Object.entries(root.slots)) {
        if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* locations(value[i], [...path, 'slots', field, i]);
        else yield* locations(value, [...path, 'slots', field]);
    }
}
export const plainColumn = value => value?.kind === 'ColumnReference' && typeof value.attrs.column === 'string'
    && value.attrs.column !== '*' && value.attrs.db == null && !hiddenNames.has(fold(value.attrs.column))
    && clean(value.attrs, ['column', 'table', 'db']) && Object.values(value.slots).every(empty);

/** One catalog for the narrow join rules. Actual column metadata is required;
 * CREATE TABLE provenance excludes virtual hidden columns and shadow namespaces.
 * Declared UNIQUE constraints supplement actual PRAGMA primary-key ordinals.
 */
export function ordinaryCatalog(schema, sql) {
    const result = new Map(), declarations = new Map();
    if (!Array.isArray(schema?.tables) || typeof sql !== 'string' || !sql.trim()) return result;
    let tokens;
    try { tokens = lex(sql); } catch { return result; }
    const word = i => tokens[i]?.kind === 'Word' ? fold(tokens[i].value) : '';
    const altered = tokens.some(t => t.kind === 'Word' && fold(t.value) === 'alter');
    for (let i = 0; i < tokens.length; i++) {
        if (['attach', 'detach'].includes(word(i)) || fold(tokens[i]?.value) === 'writable_schema') return result;
        if (word(i) !== 'create') continue;
        if (['temp', 'temporary', 'virtual'].includes(word(i + 1))) return result;
        // CREATE VIEW temp.t is legal without a TEMP keyword. table_info(t)
        // can then describe that view while sqlite_master still reports the
        // main table. Do not borrow main-table collation/uniqueness provenance.
        if (word(i + 1) === 'view') {
            let name = i + 2;
            if (word(name) === 'if' && word(name + 1) === 'not' && word(name + 2) === 'exists') name += 3;
            if (tokens[name + 1]?.text === '.') return result;
        }
        if (word(i + 1) !== 'table') continue;
        let j = i + 2;
        if (word(j) === 'if' && word(j + 1) === 'not' && word(j + 2) === 'exists') j += 3;
        const token = tokens[j];
        if (!token || !['Word', 'Identifier', 'String'].includes(token.kind) || tokens[j + 1]?.text === '.') return result;
        const name = fold(token.value);
        let end = i; while (end < tokens.length && tokens[end].text !== ';') end++;
        if (declarations.has(name)) { declarations.set(name, null); continue; }
        const part = tokens.slice(i, end);
        const binary = !part.some((t, at) => t.kind === 'Word' && fold(t.value) === 'collate' && fold(part[at + 1]?.value) !== 'binary');
        let root = null;
        try { root = parseGraphSql(parserSql(part), {allowPartial: false}).root.slots.statements[0]; } catch { /* Catalog still supports name-only alias guards. */ }
        declarations.set(name, {root, binary});
    }
    for (const table of schema.tables) {
        const name = fold(table?.name), declaration = declarations.get(name);
        if (typeof name !== 'string' || !name) continue;
        if (result.has(name)) { result.set(name, null); continue; }
        let valid = table.type === 'table' && table.db == null && declaration && Array.isArray(table.columns) && table.columns.length;
        const columns = new Map();
        for (const column of Array.isArray(table.columns) ? table.columns : []) {
            const key = fold(column?.name);
            if (typeof key !== 'string' || !key || columns.has(key)) valid = false;
            columns.set(key, column);
        }
        if (!valid) { result.set(name, null); continue; }
        const keys = [];
        const pk = table.columns.filter(c => Number.isInteger(c.pk) && c.pk > 0).sort((a, b) => a.pk - b.pk);
        if (pk.length && pk.every((c, i) => c.pk === i + 1)) keys.push(pk.map(c => fold(c.name)));
        for (const definition of declaration.root?.slots?.create_definitions || []) {
            if (definition.kind !== 'Definition') continue;
            if (definition.attrs.resource === 'COLUMN' && fold(definition.attrs.unique) === 'unique' && plainColumn(definition.slots.column)) {
                keys.push([fold(definition.slots.column.attrs.column)]);
            } else if (definition.attrs.resource === 'CONSTRAINT' && definition.attrs.constraint_type === 'UNIQUE'
                && Array.isArray(definition.slots.definition) && definition.slots.definition.length && definition.slots.definition.every(plainColumn)) {
                keys.push(definition.slots.definition.map(c => fold(c.attrs.column)));
            }
        }
        result.set(name, {name: table.name, columns,
            binary: Boolean(declaration.binary && !altered && declaration.root?.slots?.create_definitions?.length),
            keys: keys.filter(key => new Set(key).size === key.length && key.every(c => columns.has(c)))});
    }
    return result;
}

export function sourceScope(select, catalog, {min = 1, max = Infinity, allowLeft = false} = {}) {
    const from = select?.slots?.from;
    if (select?.kind !== 'Select' || !empty(select.slots.with) || !Array.isArray(from) || from.length < min || from.length > max) return null;
    const bindings = new Map(), sources = [];
    for (const source of from) {
        const join = source?.attrs?.join;
        if (source?.kind !== 'TableSource' || typeof source.attrs.table !== 'string' || source.attrs.db != null
            || !clean(source.attrs, ['table', 'as', 'db', 'join']) || !clean(source.slots, ['on'])
            || !empty(join) && !['JOIN', 'INNER JOIN', 'CROSS JOIN', ...(allowLeft ? ['LEFT JOIN', 'LEFT OUTER JOIN'] : [])].includes(join)) return null;
        const table = catalog.get(fold(source.attrs.table)), binding = source.attrs.as ?? source.attrs.table;
        if (!table || typeof binding !== 'string' || !binding || bindings.has(fold(binding))) return null;
        const entry = {source, table, binding}; bindings.set(fold(binding), entry); sources.push(entry);
    }
    const owner = column => {
        if (!plainColumn(column)) return null;
        const name = fold(column.attrs.column);
        if (column.attrs.table != null) {
            const entry = bindings.get(fold(column.attrs.table));
            return entry?.table.columns.has(name) ? entry : null;
        }
        const matches = sources.filter(entry => entry.table.columns.has(name));
        return matches.length === 1 ? matches[0] : null;
    };
    return {select, sources, bindings, owner};
}

export function flatSelect(root) {
    if (root?.kind !== 'Script' || root.slots.statements?.length !== 1) return null;
    const select = root.slots.statements[0];
    if (select?.kind !== 'Select' || !empty(select.slots.with)) return null;
    for (const {node} of locations(select)) if (node !== select
        && ['Select', 'CompoundSelect', 'Subquery', 'Values', 'CommonTableExpression', 'Explain', 'TableGroup'].includes(node.kind)) return null;
    return select;
}
