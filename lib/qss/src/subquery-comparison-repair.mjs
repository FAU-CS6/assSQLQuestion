import {clean, locations} from './sqlite-join-scope.mjs';

export const SUBQUERY_COMPARISON_STEP = Object.freeze({id: 'changeSubqueryComparison',
    label: 'Change between a membership test and a scalar-subquery comparison', defaultCost: 1});
const scalarOperators = ['=', '!=', '<>', '<', '<=', '>', '>=', 'IS', 'IS NOT'];
const membershipOperators = ['IN', 'NOT IN'];
const singleColumnSubquery = value => value?.kind === 'Subquery' && clean(value.attrs, []) && clean(value.slots, ['ast'])
    && value.slots.ast?.kind === 'Select' && value.slots.ast.slots.columns?.length === 1
    && value.slots.ast.slots.columns[0]?.kind === 'SelectItem' && value.slots.ast.slots.columns[0].slots.expr
    && value.slots.ast.slots.columns[0]?.slots?.expr?.kind !== 'Asterisk'
    && value.slots.ast.slots.columns[0]?.slots?.expr?.attrs?.column !== '*';

export function registerSubqueryComparisonRepair(register) {
    const step = SUBQUERY_COMPARISON_STEP;
    register(step.id, step.label, step.defaultCost, function* (root) {
        for (const {node, path} of locations(root)) {
            if (node.kind !== 'BinaryExpression' || !clean(node.attrs, ['operator']) || !clean(node.slots, ['left', 'right'])
                || !node.slots.left || node.slots.left.kind === 'ExpressionList') continue;
            const right = node.slots.right, operator = node.attrs.operator;
            if (membershipOperators.includes(operator) && right?.kind === 'ExpressionList'
                && clean(right.attrs, []) && clean(right.slots, ['value']) && right.slots.value?.length === 1
                && singleColumnSubquery(right.slots.value[0])) {
                for (const replacement of scalarOperators) yield {path, after: {...node, attrs: {...node.attrs, operator: replacement},
                    slots: {...node.slots, right: right.slots.value[0]}}};
            } else if (scalarOperators.includes(operator) && singleColumnSubquery(right)) {
                for (const replacement of membershipOperators) yield {path, after: {...node, attrs: {...node.attrs, operator: replacement},
                    slots: {...node.slots, right: {kind: 'ExpressionList', attrs: {}, slots: {value: [right]}}}}};
            }
        }
    }, {maxNewSymbols: 0, preservesSymbolSet: true});
}
