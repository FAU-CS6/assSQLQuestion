/** Narrow, explicit SQLite equivalences. Concrete ASTs and graph keys retain
 * every qualifier and alias; the separate fact view below is heuristic only.
 * https://www.sqlite.org/pragma.html#pragma_full_column_names
 * https://www.sqlite.org/lang_select.html#orderby
 */
const fold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
const node = value => value && typeof value.kind === 'string' && value.attrs && value.slots;
const empty = value => value == null || Array.isArray(value) && !value.length;
function* locations(root, path = []) {
    if (!node(root)) return;
    yield {node: root, path};
    for (const [field, value] of Object.entries(root.slots)) {
        if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* locations(value[i], [...path, 'slots', field, i]);
        else yield* locations(value, [...path, 'slots', field]);
    }
}
function catalog(schema) {
    const tables = new Map();
    for (const table of schema?.tables || []) {
        if (table?.type !== 'table' || typeof table.name !== 'string' || !table.name || table.db != null || !Array.isArray(table.columns)) continue;
        const name = fold(table.name), columns = new Map();
        let valid = true;
        for (const column of table.columns) {
            if (typeof column?.name !== 'string' || !column.name || columns.has(fold(column.name))) { valid = false; break; }
            columns.set(fold(column.name), column.name);
        }
        if (tables.has(name)) tables.set(name, null);
        else tables.set(name, valid ? columns : null);
    }
    return tables;
}
function singleTable(root, tables) {
    if (root.kind !== 'Script' || root.slots.statements?.length !== 1) return null;
    const select = root.slots.statements[0], path = ['slots', 'statements', 0];
    if (select?.kind !== 'Select' || !empty(select.slots.with) || select.slots.from?.length !== 1) return null;
    if ([...locations(select)].some(({node: child}) => child !== select
        && ['Select', 'CompoundSelect', 'Subquery', 'Values', 'CommonTableExpression', 'Explain'].includes(child.kind))) return null;
    const source = select.slots.from[0];
    if (source?.kind !== 'TableSource' || typeof source.attrs.table !== 'string' || source.attrs.db != null
        || !empty(source.attrs.join) || source.attrs.natural || Object.values(source.slots).some(value => !empty(value))) return null;
    if (Object.entries(source.attrs).some(([key, value]) => !['table', 'as', 'db', 'join'].includes(key) && !empty(value))) return null;
    const columns = tables.get(fold(source.attrs.table)), binding = source.attrs.as ?? source.attrs.table;
    if (!columns || typeof binding !== 'string' || !binding) return null;
    return {select, path, source, columns, binding};
}
function boundColumn(column, scope) {
    return column?.kind === 'ColumnReference' && typeof column.attrs.column === 'string'
        && column.attrs.db == null && scope.columns.has(fold(column.attrs.column))
        && (column.attrs.table == null || fold(column.attrs.table) === fold(scope.binding));
}
function plainColumn(column) {
    return column?.kind === 'ColumnReference' && Object.values(column.slots).every(empty)
        && Object.entries(column.attrs).every(([key, value]) => ['column', 'table', 'db'].includes(key) || empty(value));
}

export function registerSingleTableEquivalences(register, schema, options = {}) {
    const tables = catalog(schema), annotations = {maxNewSymbols: 0, preservesSymbolSet: true};
    register('qualifySingleTableColumn', 'Use or omit the unambiguous single-table qualifier of a known column', 0, function* (root) {
        if (options.outputColumnNamesObserved || options.ambiguousSchemaNamespaces) return;
        const scope = singleTable(root, tables); if (!scope) return;
        const positions = [];
        if (scope.select.slots.where) positions.push({node: scope.select.slots.where, path: [...scope.path, 'slots', 'where']});
        for (let i = 0; i < (scope.select.slots.columns || []).length; i++) {
            const item = scope.select.slots.columns[i];
            // Without AS, a general expression's SQL text is its output name.
            // Changing a qualifier inside a+1 or a COLLATE ... changes that name.
            if (item?.kind !== 'SelectItem' || item.attrs.as == null && !plainColumn(item.slots.expr)) continue;
            positions.push({node: item.slots.expr, path: [...scope.path, 'slots', 'columns', i, 'slots', 'expr']});
        }
        for (const position of positions) for (const {node: column, path} of locations(position.node, position.path)) {
            if (!boundColumn(column, scope)) continue;
            yield {path, after: {...column, attrs: {...column.attrs, table: column.attrs.table == null ? scope.binding : null}}};
        }
    }, annotations);
    register('toggleRedundantProjectionAlias', 'Use or omit an alias equal to the actual single-table output column name', 0, function* (root) {
        if (options.outputColumnNamesObserved || options.ambiguousSchemaNamespaces || options.freeLabels?.length) return;
        const scope = singleTable(root, tables); if (!scope) return;
        for (let i = 0; i < (scope.select.slots.columns || []).length; i++) {
            const item = scope.select.slots.columns[i], column = item?.slots?.expr;
            if (item?.kind !== 'SelectItem' || !plainColumn(column) || !boundColumn(column, scope)) continue;
            const output = scope.columns.get(fold(column.attrs.column));
            // Compare the original output spelling, not folded identifiers:
            // SELECT x AS X and SELECT x have different SQLite result headers.
            if (item.attrs.as != null && item.attrs.as !== output) continue;
            // A second output alias with this identifier can make ORDER BY
            // select a different projection after an explicit AS is added.
            if (scope.select.slots.columns.some((other, index) => index !== i
                && typeof other?.attrs?.as === 'string' && fold(other.attrs.as) === fold(output))) continue;
            yield {path: [...scope.path, 'slots', 'columns', i],
                after: {...item, attrs: {...item.attrs, as: item.attrs.as == null ? output : null}}};
        }
    }, annotations);
}

/** A context-independent relaxation, never an AST/key normalization. Forgetting
 * all column qualifiers is necessary here: resolving only presently unambiguous
 * columns could make a paid binding edit change many supposedly invariant facts.
 */
export function createUnqualifiedColumnFactView() {
    const cache = new WeakMap();
    const view = value => {
        if (!node(value)) return value;
        if (cache.has(value)) return cache.get(value);
        let changed = false, attrs = value.attrs;
        if (value.kind === 'ColumnReference' && (Object.hasOwn(attrs, 'table') || Object.hasOwn(attrs, 'db'))) {
            attrs = {...attrs}; delete attrs.table; delete attrs.db; changed = true;
        }
        const slots = {};
        for (const [key, child] of Object.entries(value.slots)) {
            if (Array.isArray(child)) { const mapped = child.map(view); slots[key] = mapped.every((v, i) => v === child[i]) ? child : mapped; }
            else slots[key] = view(child);
            changed ||= slots[key] !== child;
        }
        const result = changed ? {...value, attrs, slots} : value;
        cache.set(value, result); return result;
    };
    return view;
}
