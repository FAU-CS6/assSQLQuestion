/** SQLite applies TEXT affinity to the other, no-affinity comparison operand.
 * Restricting integers to canonical nonnegative int32 spellings avoids numeric
 * formatting, precision and overflow questions. This is an explicit graph
 * operation, never a parser coercion.
 * https://www.sqlite.org/datatype3.html#type_conversions_prior_to_comparison */
const fold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
const node = value => value && typeof value.kind === 'string' && value.attrs && value.slots;
const empty = value => value == null || Array.isArray(value) && !value.length;
const clean = (values, allowed) => Object.entries(values).every(([key, value]) => allowed.includes(key) || empty(value));
const canonical = value => typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/.test(value)
    && value.length <= 10 && Number(value) <= 2147483647;
function* locations(root, path = []) {
    if (!node(root)) return;
    yield {node: root, path};
    for (const [field, value] of Object.entries(root.slots)) {
        if (Array.isArray(value)) for (let i = 0; i < value.length; i++) yield* locations(value[i], [...path, 'slots', field, i]);
        else yield* locations(value, [...path, 'slots', field]);
    }
}
export const SQLITE_TEXT_AFFINITY_STEP = Object.freeze({id: 'toggleCanonicalIntegerTextComparison',
    label: 'Use an integer or its canonical string under proven TEXT comparison affinity', defaultCost: 0});

/** Requires the companion fact view to be composed after SQLite's DQS view. */
export function registerSQLiteTextAffinityEquivalence(register, schema = {}, options = {}) {
    const tables = new Map(), cache = new WeakMap();
    for (const table of schema?.tables || []) {
        if (typeof table?.name !== 'string') continue;
        const name = fold(table.name);
        if (tables.has(name)) { tables.set(name, null); continue; }
        const columns = new Map();
        let valid = table.type === 'table' && table.db == null && Array.isArray(table.columns);
        for (const column of table.columns || []) {
            if (typeof column?.name !== 'string' || columns.has(fold(column.name))) { valid = false; break; }
            columns.set(fold(column.name), String(column.type || '').toUpperCase());
        }
        tables.set(name, valid ? columns : null);
    }
    // SQLRun reads names/types from main and resolves PRAGMA table_info without
    // a schema qualifier. A TEMP view could shadow a main table's declared type.
    // Withhold this new affinity proof whenever such provenance is possible.
    const opaqueSetup = /\b(?:TEMP|TEMPORARY|ATTACH)\b/i.test(options.schemaSql || '');
    const candidates = root => {
        if (cache.has(root)) return cache.get(root);
        const result = [];
        if (!opaqueSetup && root?.kind === 'Script' && root.slots.statements?.length === 1) {
            const statement = root.slots.statements[0];
            if (['Select', 'Update', 'Delete'].includes(statement?.kind) && statement.slots.where
                && empty(statement.slots.with) && ![...locations(statement)].some(({node: child}) => child !== statement
                    && ['Select', 'Subquery', 'CompoundSelect', 'Values', 'CommonTableExpression', 'Explain'].includes(child.kind))) {
                const sources = statement.kind === 'Update' ? statement.slots.table : statement.slots.from;
                const source = sources?.length === 1 ? sources[0] : null;
                const columns = source && tables.get(fold(source.attrs.table)), binding = source?.attrs.as ?? source?.attrs.table;
                const extraSources = statement.kind === 'Update' ? statement.slots.from : null;
                const deleteTargets = statement.kind === 'Delete' ? statement.slots.table : null;
                const targetMatches = !deleteTargets || deleteTargets.length === 1
                    && deleteTargets[0]?.attrs.db == null && fold(deleteTargets[0]?.attrs.table) === fold(source?.attrs.table);
                if (source?.kind === 'TableSource' && columns && typeof binding === 'string' && binding
                    && source.attrs.db == null && clean(source.attrs, ['table', 'as']) && clean(source.slots, [])
                    && empty(extraSources) && targetMatches) {
                    for (const {node: expression, path} of locations(statement.slots.where, ['slots', 'statements', 0, 'slots', 'where'])) {
                        if (expression.kind !== 'BinaryExpression' || !['=', '!=', '<>'].includes(expression.attrs.operator)
                            || !clean(expression.attrs, ['operator']) || !clean(expression.slots, ['left', 'right'])) continue;
                        const column = expression.slots.left, literal = expression.slots.right;
                        if (column?.kind !== 'ColumnReference' || !clean(column.attrs, ['table', 'column']) || !clean(column.slots, [])
                            || column.attrs.table != null && fold(column.attrs.table) !== fold(binding)
                            || columns.get(fold(column.attrs.column)) !== 'TEXT') continue;
                        if (!literal || !canonical(literal.attrs.value) || !clean(literal.slots, [])) continue;
                        if (literal.kind === 'NumberLiteral' && literal.attrs.storageClass === 'integer'
                            && clean(literal.attrs, ['value', 'storageClass'])) {
                            result.push({path: [...path, 'slots', 'right'], after: {kind: 'StringLiteral', attrs: {value: literal.attrs.value}, slots: {}}});
                        } else if (literal.kind === 'StringLiteral' && clean(literal.attrs, ['value'])) {
                            result.push({path: [...path, 'slots', 'right'], after: {kind: 'NumberLiteral', attrs: {value: literal.attrs.value, storageClass: 'integer'}, slots: {}}});
                        }
                    }
                }
            }
        }
        cache.set(root, result); return result;
    };
    register(SQLITE_TEXT_AFFINITY_STEP.id, SQLITE_TEXT_AFFINITY_STEP.label, SQLITE_TEXT_AFFINITY_STEP.defaultCost,
        function* (root) { yield* candidates(root); }, {maxNewSymbols: 0, preservesSymbolSet: true});
}

/** Context-independent heuristic relaxation. A canonical numeric string loses
 * its symbol fact just like its integer counterpart. A paid schema/binding
 * change cannot introduce multiple symbols through a context-sensitive lookup.
 * Preserve literal metadata and every concrete graph key/replay unchanged. */
export function createSQLiteTextAffinityFactView() {
    const cache = new WeakMap();
    const view = value => {
        if (!node(value)) return value;
        if (cache.has(value)) return cache.get(value);
        let changed = false;
        const numeric = value.kind === 'StringLiteral' && canonical(value.attrs.value);
        const attrs = numeric ? {...value.attrs, storageClass: 'integer'} : value.attrs, slots = {};
        for (const [field, child] of Object.entries(value.slots)) {
            if (Array.isArray(child)) { const mapped = child.map(view); slots[field] = mapped.every((x, i) => x === child[i]) ? child : mapped; }
            else slots[field] = view(child);
            changed ||= slots[field] !== child;
        }
        const result = changed || numeric ? {...value, kind: numeric ? 'NumberLiteral' : value.kind, attrs, slots} : value;
        cache.set(value, result); return result;
    };
    return view;
}
