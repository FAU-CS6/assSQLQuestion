import {fold, clean, empty, plainColumn, ordinaryCatalog, sourceScope} from './sqlite-join-scope.mjs';

export const SQLITE_SEMIJOIN_STEP = Object.freeze({id: 'rewriteUniqueFilteredSemijoin',
    label: 'Exchange a positive IN subquery and an inner join with a proved unique filtered key', defaultCost: 0});

/** Fixed-graph impossibility certificate, never a per-state rewrite guard.
 * Every concrete semijoin edge requires two distinct BINARY ordinary tables
 * and an inner UNIQUE/PK key. Without this fixed provenance no intermediate
 * AST can use the edge, so search facts may retain Boolean clause structure.
 */
export function semijoinProvenancePossible(catalog, options = {}) {
    if (options.ambiguousSchemaNamespaces || options.outputColumnNamesObserved || options.freeLabels?.length) return false;
    const tables = [...catalog.values()].filter(table => table?.binary);
    return tables.length >= 2 && tables.some(table => table.keys.length > 0);
}

const node = (kind, attrs, slots) => ({kind, attrs, slots});
const binary = (operator, left, right) => node('BinaryExpression', {operator}, {left, right});
const qualify = (column, table) => ({...column, attrs: {...column.attrs, table}});
const simpleSelect = select => select?.kind === 'Select' && !select.attrs.distinct
    && clean(select.attrs, ['distinct']) && clean(select.slots, ['columns', 'from', 'where']);
const equality = value => value?.kind === 'BinaryExpression' && value.attrs.operator === '='
    && clean(value.attrs, ['operator']) && clean(value.slots, ['left', 'right']);
const literal = value => value && ['NumberLiteral', 'StringLiteral', 'BlobLiteral', 'BooleanLiteral'].includes(value.kind)
    && value.attrs.value != null && clean(value.attrs, ['value', 'storageClass']) && Object.values(value.slots).every(empty);
const affinity = column => {
    if (typeof column?.type !== 'string') return null;
    const name = column.type.toUpperCase();
    if (name.includes('INT')) return 'INTEGER';
    if (/CHAR|CLOB|TEXT/.test(name)) return 'TEXT';
    if (!name || name.includes('BLOB')) return 'BLOB';
    if (/REAL|FLOA|DOUB/.test(name)) return 'REAL';
    return 'NUMERIC';
};
const tableSource = source => ({...source, attrs: {...source.attrs, as: null, join: null}, slots: {...source.slots, on: null}});

// Only conjunctions of local physical-column = non-NULL literal predicates.
// Each fixed component therefore admits at most one equality class of its
// BINARY UNIQUE/PK key. NULL key components cannot create a matching join row.
function fixedFilter(value, owner, scope) {
    if (value == null) return {columns: new Set(), rewrite: () => null};
    if (value.kind === 'BinaryExpression' && value.attrs.operator === 'AND'
        && clean(value.attrs, ['operator']) && clean(value.slots, ['left', 'right'])) {
        const left = fixedFilter(value.slots.left, owner, scope), right = fixedFilter(value.slots.right, owner, scope);
        if (!left || !right) return null;
        return {columns: new Set([...left.columns, ...right.columns]), rewrite: table => ({...value,
            slots: {...value.slots, left: left.rewrite(table), right: right.rewrite(table)}})};
    }
    if (!equality(value)) return null;
    let key = 'left', other = 'right';
    if (!plainColumn(value.slots[key])) [key, other] = [other, key];
    const column = value.slots[key];
    if (scope.owner(column) !== owner || !literal(value.slots[other])) return null;
    return {columns: new Set([fold(column.attrs.column)]), rewrite: table => ({...value,
        slots: {...value.slots, [key]: qualify(column, table)}})};
}

function outerProjection(select, owner, scope) {
    const columns = select.slots.columns;
    if (!Array.isArray(columns) || !columns.length || columns.some(item => item?.kind !== 'SelectItem'
        || !clean(item.attrs, ['as']) || !clean(item.slots, ['expr']) || scope.owner(item.slots.expr) !== owner)) return null;
    return table => columns.map(item => ({...item, slots: {...item.slots, expr: qualify(item.slots.expr, table)}}));
}

function uniqueMatch(outer, outerColumn, inner, innerColumn, filter) {
    if (!outer.table.binary || !inner.table.binary || outer.table === inner.table) return false;
    const a = affinity(outer.table.columns.get(fold(outerColumn.attrs.column))),
        b = affinity(inner.table.columns.get(fold(innerColumn.attrs.column)));
    // Different affinities can coerce two distinct UNIQUE values (e.g. TEXT
    // '1' and '01') to the same join value. Declared non-BINARY collations can
    // do the same. Both cases are deliberately excluded.
    return a != null && a === b && inner.table.keys.some(key => key.every(name =>
        name === fold(innerColumn.attrs.column) || filter.columns.has(name)));
}

/** This is a concrete, directed AST rewrite, never graph-key canonicalization.
 * The caller's heuristic must use the semijoin-invariant fact relaxation:
 * scope/role-free symbols and scalar comparisons excluding column=column
 * links and the removed inner projection. Source/relation/DISTINCT counts
 * remain unchanged; SelectItem count does not.
 */
export function registerSQLiteSemijoinEquivalence(register, schema, options = {}) {
    const catalog = options.preparedOrdinaryCatalog ?? ordinaryCatalog(schema, options.schemaSql), step = SQLITE_SEMIJOIN_STEP;
    register(step.id, step.label, step.defaultCost, function* (root) {
        if (options.ambiguousSchemaNamespaces || options.outputColumnNamesObserved || options.freeLabels?.length
            || root?.kind !== 'Script' || root.slots.statements?.length !== 1) return;
        const select = root.slots.statements[0];
        if (!simpleSelect(select)) return;
        const scope = sourceScope(select, catalog, {max: 2});
        if (!scope || !empty(scope.sources[0].source.attrs.join) || !empty(scope.sources[0].source.slots.on)) return;
        const outer = scope.sources[0], projection = outerProjection(select, outer, scope);
        if (!projection) return;
        const path = ['slots', 'statements', 0];
        if (scope.sources.length === 1) {
            const test = select.slots.where, list = test?.slots?.right, subquery = list?.slots?.value?.[0], innerSelect = subquery?.slots?.ast;
            if (test?.kind !== 'BinaryExpression' || test.attrs.operator !== 'IN' || !clean(test.attrs, ['operator'])
                || !clean(test.slots, ['left', 'right']) || scope.owner(test.slots.left) !== outer
                || list?.kind !== 'ExpressionList' || !clean(list.attrs, []) || !clean(list.slots, ['value'])
                || list.slots.value.length !== 1 || subquery?.kind !== 'Subquery' || !clean(subquery.attrs, [])
                || !clean(subquery.slots, ['ast']) || !simpleSelect(innerSelect)) return;
            const innerScope = sourceScope(innerSelect, catalog, {max: 1}), item = innerSelect.slots.columns?.[0];
            if (!innerScope || innerSelect.slots.columns.length !== 1 || item?.kind !== 'SelectItem' || !empty(item.attrs.as)
                || !clean(item.attrs, ['as']) || !clean(item.slots, ['expr'])) return;
            const inner = innerScope.sources[0], innerColumn = item.slots.expr, outerColumn = test.slots.left;
            if (!empty(inner.source.attrs.join) || !empty(inner.source.slots.on) || innerScope.owner(innerColumn) !== inner
                || fold(inner.binding) === fold(outer.binding)) return;
            const filter = fixedFilter(innerSelect.slots.where, inner, innerScope);
            if (!filter || !uniqueMatch(outer, outerColumn, inner, innerColumn, filter)) return;
            const left = qualify(outerColumn, outer.binding), right = qualify(innerColumn, inner.binding);
            for (const [a, b] of [[left, right], [right, left]]) {
                const joined = {...inner.source, attrs: {...inner.source.attrs, join: 'INNER JOIN'},
                    slots: {...inner.source.slots, on: binary('=', a, b)}};
                yield {path, after: {...select, slots: {...select.slots, columns: projection(outer.binding),
                    from: [outer.source, joined], where: filter.rewrite(inner.binding)}}};
            }
        } else {
            const inner = scope.sources[1], on = inner.source.slots.on;
            if (!['JOIN', 'INNER JOIN'].includes(inner.source.attrs.join) || !equality(on)) return;
            let outerColumn = on.slots.left, innerColumn = on.slots.right;
            if (scope.owner(outerColumn) !== outer) [outerColumn, innerColumn] = [innerColumn, outerColumn];
            if (scope.owner(outerColumn) !== outer || scope.owner(innerColumn) !== inner) return;
            const filter = fixedFilter(select.slots.where, inner, scope);
            if (!filter || !uniqueMatch(outer, outerColumn, inner, innerColumn, filter)) return;
            const innerSelect = node('Select', {distinct: false}, {with: [], options: [], columns: [node('SelectItem', {as: null},
                {expr: qualify(innerColumn, null)})], from: [tableSource(inner.source)], where: filter.rewrite(null),
                groupby: null, having: null, orderby: [], limit: null, for_update: null});
            const test = binary('IN', qualify(outerColumn, null), node('ExpressionList', {},
                {value: [node('Subquery', {}, {ast: innerSelect})]}));
            yield {path, after: {...select, slots: {...select.slots, columns: projection(null), from: [tableSource(outer.source)], where: test}}};
        }
    }, {maxNewSymbols: 0, preservesSymbolSet: true, componentWorkBounded: false});
}
