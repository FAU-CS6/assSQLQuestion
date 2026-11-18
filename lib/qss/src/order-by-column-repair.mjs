import {stableKey} from './graph-model.mjs';

export const ORDER_BY_COLUMN_REPAIR = Object.freeze({id: 'restoreMissingOrderByColumn', defaultCost: 1,
    description: 'Restore one missing ORDER BY column and its observed sort direction'});

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
function bareOrderByColumn(item) {
    if (item?.kind !== 'OrderByItem' || !['ASC', 'DESC'].includes(item.attrs.type)
        || Object.entries(item.attrs).some(([key, value]) => key !== 'type' && !empty(value))
        || Object.entries(item.slots).some(([key, value]) => key !== 'expr' && !empty(value))) return false;
    const column = item.slots.expr;
    return column?.kind === 'ColumnReference' && typeof column.attrs.column === 'string' && column.attrs.column !== '*'
        && Object.values(column.slots).every(empty)
        && Object.entries(column.attrs).every(([key, value]) => ['column', 'table', 'db'].includes(key) || empty(value));
}

/** A paid inverse of removing an ORDER BY item. The entire supplied expression
 * is one bare column, never a query or a completed arbitrary target subtree.
 * Apply at all list positions; reference positions do not guide applicability.
 */
export function registerOrderByColumnRepair(register, reference, answer, {freeLabels = [], maxNodes} = {}) {
    const templates = new Map();
    for (const root of [reference, answer]) for (const {node: item} of locations(root)) {
        if (bareOrderByColumn(item)) templates.set(stableKey(item), item);
    }
    register(ORDER_BY_COLUMN_REPAIR.id, ORDER_BY_COLUMN_REPAIR.description, ORDER_BY_COLUMN_REPAIR.defaultCost, function* (root) {
        for (const {node: query, path} of locations(root)) {
            if (!['Select', 'CompoundSelect'].includes(query.kind)
                || query.slots.orderby != null && !Array.isArray(query.slots.orderby)) continue;
            const list = query.slots.orderby || [];
            for (const item of templates.values()) for (let index = 0; index <= list.length; index++) {
                yield {path: [...path, 'slots', 'orderby'], after: [...list.slice(0, index), item, ...list.slice(index)]};
            }
        }
    }, {
        // Ordering by an otherwise arbitrary group label makes that label
        // observable. The contextual fact view can consequently expose old
        // label/diagnostic symbols as well as the one newly inserted column.
        // Every abstract symbol belongs to one concrete AST node; the graph's
        // structural bound is therefore conservative. A missing bound disables
        // the symbol certificate instead of assuming a unit effect.
        maxNewSymbols: freeLabels.length ? Number.isSafeInteger(maxNodes) && maxNodes > 0 ? maxNodes : Infinity : 1,
        introducedComponent: 'OrderByItem', componentWorkBounded: true,
        maxNewDistinct: 0, maxNewRelations: 0, maxNewSources: 0});
}
