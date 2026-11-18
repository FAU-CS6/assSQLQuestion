import {lex} from './syntax.mjs';

const fold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, char => char.toLowerCase()) : value;
const node = value => value && typeof value.kind === 'string' && value.attrs && value.slots;
const empty = value => value == null || Array.isArray(value) && !value.length;
const hiddenRowNames = new Set(['rowid', '_rowid_', 'oid']);
const joins = new Set(['JOIN', 'INNER JOIN', 'LEFT JOIN', 'LEFT OUTER JOIN', 'CROSS JOIN']);

export const JOINED_WHERE_STEP = Object.freeze({id: 'qualifyUnambiguousJoinedWhereColumn',
    label: 'Use or omit the unique base-table qualifier of a WHERE column in a join', defaultCost: 0});

function* locations(root, path = []) {
    if (!node(root)) return;
    yield {node: root, path};
    for (const [field, value] of Object.entries(root.slots)) {
        if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* locations(value[i], [...path, 'slots', field, i]);
        else yield* locations(value, [...path, 'slots', field]);
    }
}

/** table_info omits virtual-table hidden columns. Require ordinary CREATE
 * TABLE provenance and reject namespace changes rather than mistaking an
 * apparently unique catalog column for a unique SQLite name resolution. */
function ordinaryTables(sql) {
    if (typeof sql !== 'string' || !sql.trim()) return null;
    let tokens;
    try { tokens = lex(sql); } catch { return null; }
    const word = (index, value) => tokens[index]?.kind === 'Word' && fold(tokens[index].value) === value;
    const names = new Set();
    for (let i = 0; i < tokens.length; i++) {
        if (word(i, 'attach') || word(i, 'detach')) return null;
        if (!word(i, 'create')) continue;
        if (word(i + 1, 'temp') || word(i + 1, 'temporary') || word(i + 1, 'virtual')) return null;
        if (!word(i + 1, 'table')) continue;
        let j = i + 2;
        if (word(j, 'if') && word(j + 1, 'not') && word(j + 2, 'exists')) j += 3;
        const name = tokens[j];
        if (!name || !['Word', 'Identifier', 'String'].includes(name.kind) || tokens[j + 1]?.text === '.') return null;
        names.add(fold(name.value));
    }
    return names;
}

function catalog(schema, sql) {
    const ordinary = ordinaryTables(sql), tables = new Map();
    if (!ordinary || !Array.isArray(schema?.tables)) return tables;
    for (const table of schema.tables) {
        const name = fold(table?.name);
        if (typeof name !== 'string' || !name) continue;
        if (tables.has(name)) { tables.set(name, null); continue; }
        const columns = new Set();
        let valid = table.type === 'table' && table.db == null && ordinary.has(name)
            && Array.isArray(table.columns) && table.columns.length > 0;
        for (const column of Array.isArray(table.columns) ? table.columns : []) {
            const key = fold(column?.name);
            if (typeof key !== 'string' || !key || columns.has(key)) valid = false;
            columns.add(key);
        }
        tables.set(name, valid ? columns : null);
    }
    return tables;
}

function scopeFor(root, tables) {
    if (root?.kind !== 'Script' || root.slots.statements?.length !== 1) return null;
    const select = root.slots.statements[0], sources = select?.slots?.from;
    if (select?.kind !== 'Select' || !empty(select.slots.with) || !Array.isArray(sources) || sources.length < 2) return null;
    const bindings = new Set(), owners = new Map();
    for (const source of sources) {
        if (source?.kind !== 'TableSource' || typeof source.attrs.table !== 'string' || source.attrs.db != null
            || source.attrs.natural || !empty(source.attrs.join) && !joins.has(source.attrs.join)
            || Object.entries(source.attrs).some(([key, value]) => !['table', 'as', 'db', 'join'].includes(key) && !empty(value))
            || Object.entries(source.slots).some(([key, value]) => key !== 'on' && !empty(value))) return null;
        const columns = tables.get(fold(source.attrs.table)), binding = source.attrs.as ?? source.attrs.table;
        // The upstream SQLite parser also represents an unrecognized NATURAL
        // JOIN prefix as a source alias. Withhold this spelling until the AST
        // carries that join's merging semantics explicitly.
        if (!columns || typeof binding !== 'string' || !binding || fold(source.attrs.as) === 'natural' || bindings.has(fold(binding))) return null;
        bindings.add(fold(binding));
        // Count source occurrences, including self joins, not just table names.
        for (const column of columns) owners.set(column, owners.has(column) ? null : binding);
    }
    for (const {node: child} of locations(select)) {
        if (child !== select && ['Select', 'CompoundSelect', 'Subquery', 'Values', 'CommonTableExpression', 'Explain', 'TableGroup'].includes(child.kind)) return null;
        if (child.kind === 'TableSource' && !sources.includes(child)) return null;
    }
    return {select, owners};
}

/** SQLite resolves a WHERE column against the FROM sources before considering
 * SELECT aliases. With exactly one known physical owner, adding/removing that
 * owner's actual binding preserves the same cell, affinity, collation and NULL
 * extension. Projection/GROUP/ORDER/HAVING and nested scopes are not rewritten.
 * The existing context-independent unqualified fact view makes both abstract
 * roots identical; concrete ASTs/keys still require this priced, replayable edge.
 */
export function registerJoinedWhereEquivalence(register, schema, requirements = {}) {
    const tables = catalog(schema, requirements.schemaSql), cache = new WeakMap();
    register(JOINED_WHERE_STEP.id, JOINED_WHERE_STEP.label, JOINED_WHERE_STEP.defaultCost, function* (root) {
        if (requirements.ambiguousSchemaNamespaces) return;
        if (!cache.has(root)) cache.set(root, scopeFor(root, tables));
        const scope = cache.get(root); if (!scope) return;
        for (const {node: column, path} of locations(scope.select.slots.where, ['slots', 'statements', 0, 'slots', 'where'])) {
            if (column.kind !== 'ColumnReference' || typeof column.attrs.column !== 'string' || column.attrs.db != null) continue;
            const name = fold(column.attrs.column), owner = scope.owners.get(name);
            // Conservative: ordinary hidden row aliases are not represented by
            // table_info, even though some explicit-column cases are resolvable.
            if (!owner || hiddenRowNames.has(name) || column.attrs.table != null && fold(column.attrs.table) !== fold(owner)) continue;
            yield {path, after: {...column, attrs: {...column.attrs, table: column.attrs.table == null ? owner : null}}};
        }
    }, {maxNewSymbols: 0, preservesSymbolSet: true});
}
