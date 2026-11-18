const fold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, char => char.toLowerCase()) : value;
const node = value => value && typeof value.kind === 'string' && value.attrs && value.slots;
const empty = value => value == null || Array.isArray(value) && !value.length;
const clean = (values, allowed) => Object.entries(values).every(([key, value]) => allowed.includes(key) || empty(value));

export const SQLITE_TABLE_ALIAS_STEP = Object.freeze({id: 'toggleIdenticalTableAlias',
    label: 'Use or omit a table alias identical to its unambiguous base table name', defaultCost: 0});

function* nodes(root) {
    if (!node(root)) return;
    yield root;
    for (const value of Object.values(root.slots)) {
        if (Array.isArray(value)) for (const child of value) yield* nodes(child);
        else yield* nodes(value);
    }
}

/** A deliberately narrow identity binding: the only source is a known base
 * table and the optional alias has exactly that table's identifier. Explicit
 * output aliases avoid PRAGMA full_column_names and identifier-case headers.
 * No name resolution, expression or column qualifier is silently rewritten. */
export function registerSQLiteTableAliasEquivalence(register, schema = {}, {schemaMetadataObserved = false, outputColumnNamesObserved = false} = {}) {
    const tables = new Map(), cache = new WeakMap();
    for (const table of schema?.tables || []) {
        const name = fold(table?.name);
        if (typeof name !== 'string') continue;
        if (tables.has(name)) tables.set(name, null);
        else tables.set(name, fold(table.type) === 'table' && Array.isArray(table.columns) && table.columns.length ? table : null);
    }
    const candidates = root => {
        if (cache.has(root)) return cache.get(root);
        const result = [];
        if (!schemaMetadataObserved && !outputColumnNamesObserved && root?.kind === 'Script'
            && root.slots.statements?.length && root.slots.statements.every(query => query?.kind === 'Select')) {
            root.slots.statements.forEach((query, index) => {
                if (!empty(query.slots.with) || query.slots.from?.length !== 1) return;
                const source = query.slots.from[0], name = fold(source?.attrs?.table), table = tables.get(name);
                if (!table || source.kind !== 'TableSource' || source.attrs.db != null
                    || !clean(source.attrs, ['table', 'as']) || !clean(source.slots, [])
                    || source.attrs.as != null && fold(source.attrs.as) !== name) return;
                // Output names are part of an SQLite result. The raw spelling
                // of an alias may differ from the catalog table's spelling.
                if (!query.slots.columns?.length || query.slots.columns.some(item => item.kind !== 'SelectItem'
                    || typeof item.attrs.as !== 'string' || !item.attrs.as || item.slots.expr?.kind === 'Asterisk'
                    || item.slots.expr?.kind === 'ColumnReference' && item.slots.expr.attrs.column === '*')) return;
                for (const child of nodes(query)) {
                    if (child !== query && ['Select', 'Subquery', 'CompoundSelect', 'CommonTableExpression', 'Explain'].includes(child.kind)) return;
                    if (child.kind === 'TableSource' && child !== source) return;
                    if (child.kind === 'ColumnReference' && (child.attrs.db != null
                        || child.attrs.table != null && fold(child.attrs.table) !== name)) return;
                }
                result.push({path: ['slots', 'statements', index, 'slots', 'from', 0], source, name});
            });
        }
        cache.set(root, result); return result;
    };
    register(SQLITE_TABLE_ALIAS_STEP.id, SQLITE_TABLE_ALIAS_STEP.label, SQLITE_TABLE_ALIAS_STEP.defaultCost, function* (root) {
        for (const {path, source, name} of candidates(root)) {
            yield {path, after: {...source, attrs: {...source.attrs, as: source.attrs.as == null ? name : null}}};
        }
    }, {maxNewSymbols: 0, preservesSymbolSet: true});
}

/** Heuristic facts only: forget every source alias, not only guarded identity
 * aliases. Context-independent forgetting stays admissible after paid changes.
 * Concrete graph vertices, graph keys and operation replays remain unchanged. */
export function createSQLiteTableAliasFactView() {
    const cache = new WeakMap();
    const view = current => {
        if (!node(current)) return current;
        if (cache.has(current)) return cache.get(current);
        let changed = false;
        const slots = {};
        for (const [field, value] of Object.entries(current.slots)) {
            if (Array.isArray(value)) {
                const mapped = value.map(view);
                slots[field] = mapped.every((child, index) => child === value[index]) ? value : mapped;
            } else slots[field] = view(value);
            changed ||= slots[field] !== value;
        }
        const attrs = current.kind === 'TableSource' && current.attrs.as != null ? {...current.attrs, as: null} : current.attrs;
        const result = changed || attrs !== current.attrs ? {...current, attrs, slots} : current;
        cache.set(current, result); return result;
    };
    return view;
}
