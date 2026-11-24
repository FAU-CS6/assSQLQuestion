import {clean, empty} from './sqlite-join-scope.mjs';

// Reviewed non-primitive edits for the shape below. A future whole-query
// shortcut is an escape edge until its effects on these clauses are known.
const scopedEdits = new Set([
    'renameBoundTableAlias', 'qualifySingleTableColumn', 'toggleRedundantProjectionAlias',
    'toggleIdenticalTableAlias', 'toggleCanonicalIntegerTextComparison',
    'insertProjectedExpression', 'restoreMissingOrderByColumn',
    'relocateInnerJoinPredicate', 'relocateOuterJoinPredicate', 'commuteInnerJoinSources',
    'qualifyUnambiguousJoinedWhereColumn', 'toggleJoinedProjectionAlias', 'toggleJoinedIdenticalTableAlias',
    'rewriteUniqueFilteredSemijoin', 'qualifyLocalSubqueryColumn', 'toggleLocalSubqueryTableAlias',
    'changeSubqueryComparison', 'toggleAlterAddColumnKeyword', 'quoteUnboundSqliteString',
    'toggleIntegerPrimaryKeyNotNull', 'toggleExplicitPrimaryKeyReference', 'repairDeclaredColumnBinding',
    'relocateSingleColumnForeignKey'
]);
const expressionEdits = new Set([
    'rewriteExactIntegerConstant', 'negateComplementaryComparison', 'deMorganBoolean', 'booleanCaseEncoding',
    'countStarOne', 'commuteBooleanOperands', 'associateBooleanOperands', 'duplicateBooleanPredicate',
    'collapseDuplicateBooleanPredicate', 'rewriteNotEqual', 'mirrorColumnLiteralComparison',
    'rewriteBetweenRange', 'rewriteLiteralInList', 'changeLiteral', 'changeColumnReference', 'changeAggregateType',
    'mirrorComparisonOperands', 'swapBinaryOperands', 'reassociateBinaryOperands', 'wrapUnaryExpression',
    'unwrapUnaryExpression', 'wrapBinaryExpression', 'unwrapIncompleteBinaryExpression', 'removeExtraneousBinaryTerm',
    'restoreMissingBinaryTerm', 'wrapAggregateExpression', 'unwrapAggregateExpression'
]);

const column = n => n?.kind === 'ColumnReference' && typeof n.attrs.column === 'string'
    && clean(n.attrs, ['column', 'table']) && Object.values(n.slots).every(empty);

function simpleSelect(root) {
    if (root.kind !== 'Script' || root.slots.statements?.length !== 1) return null;
    const q = root.slots.statements[0];
    if (q.kind !== 'Select' || q.attrs.distinct || !clean(q.attrs, ['distinct'])
        || !clean(q.slots, ['columns', 'from', 'where', 'orderby'])
        || q.slots.columns?.length !== 1 || q.slots.from?.length !== 1) return null;
    const [p] = q.slots.columns, [source] = q.slots.from;
    if (p.kind !== 'SelectItem' || !clean(p.attrs, []) || !clean(p.slots, ['expr']) || !column(p.slots.expr)
        || source.kind !== 'TableSource' || !clean(source.attrs, ['table']) || typeof source.attrs.table !== 'string'
        || !clean(source.slots, [])) return null;
    const order = q.slots.orderby || [];
    if (!Array.isArray(order) || order.length > 1 || order.some(o => o.kind !== 'OrderByItem'
        || !clean(o.attrs, ['type']) || !clean(o.slots, ['expr']) || !column(o.slots.expr))) return null;
    return q;
}

/** An optimality certificate for building a flat SELECT from a missing filter.
 * Below the cheapest source/statement constructor or unreviewed edge, edits
 * cannot introduce a second source/statement. Neither endpoint supplies any
 * subquery, DDL, aliased projection template or complete null-filter template.
 * In this domain a change of projected column name, introduction of an ORDER
 * BY list and construction of a WHERE each require separate paid edits.
 *
 * The first edit into an empty WHERE inserts a shallow constructor. A column
 * leaf has no comparison, and a constant or empty operator has no column.
 * The reviewed free expression rewrites cannot turn any of those seeds into
 * a comparison between a named column and a literal. Thus WHERE needs at
 * least two paid edits. Raising free prices preserves this lower bound;
 * making a normally paid local edit free conservatively disables it.
 */
export function planSimpleSelectRepair(reference, answer, key, requirements) {
    const src = simpleSelect(answer), dst = simpleSelect(reference);
    if (!src || !dst || src.slots.where || requirements.freeLabels?.length || requirements.freeDiagnostics
        || key(src.slots.from) !== key(dst.slots.from)) return null;
    const predicate = dst.slots.where;
    if (predicate?.kind !== 'BinaryExpression' || !['=', '<', '>', '<=', '>=', '<>', '!='].includes(predicate.attrs.operator)
        || !clean(predicate.attrs, ['operator']) || !clean(predicate.slots, ['left', 'right'])) return null;
    const operands = [predicate.slots.left, predicate.slots.right];
    const name = operands.find(column), literal = operands.find(n => n?.kind === 'NumberLiteral');
    if (!name || name.attrs.column === '*' || !literal || !clean(literal.attrs, ['value', 'storageClass'])
        || !clean(literal.slots, []) || literal.attrs.storageClass !== 'integer') return null;

    const stages = [];
    const stage = (field, value, edits) => stages.push({field, value, edits});
    if (key(src.slots.columns) !== key(dst.slots.columns)) {
        // Qualification and AS alone can change for free.
        if (src.slots.columns[0].slots.expr.attrs.column === dst.slots.columns[0].slots.expr.attrs.column) return null;
        stage('columns', dst.slots.columns, ['changeColumnReferenceColumn', 'changeColumnReference']);
    }
    if (key(src.slots.orderby) !== key(dst.slots.orderby)) {
        if (src.slots.orderby?.length || !dst.slots.orderby?.length) return null;
        stage('orderby', dst.slots.orderby, ['restoreMissingOrderByColumn']);
    }
    stage('where', name, ['addSelectWhereColumnReference']);
    stage('where', predicate, ['restoreMissingBinaryTerm']);

    const local = new WeakMap();
    return {
        classify(edit, {defaultCost, costGroup, expressionEdit}) {
            if (!edit.statementOperation && !edit.maxNewSources && (costGroup || scopedEdits.has(edit.name)
                || expressionEdit && expressionEdits.has(edit.name))) local.set(edit, defaultCost);
        },
        async witness(edits, context) {
            let unit = Infinity, escape = Infinity;
            for (const edit of edits) {
                if (!local.has(edit)) escape = Math.min(escape, edit.cost);
                else if (local.get(edit) > 0) unit = Math.min(unit, edit.cost);
            }
            const bound = Math.min(escape, stages.length * unit);
            if (!(bound > 0 && Number.isSafeInteger(bound))) return null;
            const trace = [];
            let current = answer, select = src, cost = 0, generated = 1;
            for (const stage of stages) {
                select = {...select, slots: {...select.slots, [stage.field]: stage.value}};
                const target = key({...answer, slots: {...answer.slots, statements: [select]}});
                let chosen = null;
                for (const edit of edits) {
                    if (!stage.edits.includes(edit.name) || chosen && edit.cost >= chosen.cost) continue;
                    for (const edge of edit.apply(current)) {
                        ++generated;
                        await context.tick();
                        if (key(edge.root) !== target) continue;
                        chosen = {root: edge.root, cost: edit.cost, step: {type: 'sql-edit', name: edit.name,
                            description: edit.description, cost: edit.cost, path: edge.operation.path, operation: edge.operation}};
                        break;
                    }
                }
                if (!chosen) return null;
                current = chosen.root;
                trace.push(chosen.step);
                cost += chosen.cost;
                if (cost > bound) return null;
            }
            return cost === bound && key(current) === key(reference) ? {distance: cost, edits: trace, generated} : null;
        }
    };
}
