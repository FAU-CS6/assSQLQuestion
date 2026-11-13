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

/** Restore one missing atomic null filter, the inverse of removing that WHERE
 * or HAVING component. Both inputs supply a finite constructor domain. Every
 * compatible empty clause is considered, regardless of the target position.
 * This is a paid semantic repair, never an SQL equivalence or normalization.
 */
export function registerNullPredicateRepair(register, reference, answer, key, {freeLabels = [], maxNodes} = {}) {
    const predicates = new Map();
    for (const root of [reference, answer]) for (const {node: n} of locations(root)) {
        const column = n.slots.left, value = n.slots.right;
        if (n.kind !== 'BinaryExpression' || !['IS', 'IS NOT'].includes(n.attrs.operator)
            || Object.entries(n.attrs).some(([name, value]) => name !== 'operator' && !empty(value))
            || Object.entries(n.slots).some(([name, value]) => !['left', 'right'].includes(name) && !empty(value))
            || column?.kind !== 'ColumnReference' || typeof column.attrs.column !== 'string' || column.attrs.column === '*'
            || Object.keys(column.attrs).some(name => !['column', 'table', 'db'].includes(name))
            || Object.values(column.slots).some(value => !empty(value))
            || value?.kind !== 'NullLiteral' || Object.values(value.slots).some(value => !empty(value))) continue;
        predicates.set(key(n), n);
    }
    if (!predicates.size) return;
    register('restoreMissingNullPredicate', 'Restore one missing atomic IS NULL or IS NOT NULL filter', 1, function* (root) {
        for (const {node: n, path} of locations(root)) {
            const fields = n.kind === 'Select' ? ['where', 'having'] : ['Update', 'Delete'].includes(n.kind) ? ['where'] : [];
            for (const field of fields) if (empty(n.slots[field])) for (const predicate of predicates.values()) {
                yield {path: [...path, 'slots', field], after: predicate};
            }
        }
    }, {
        // Filtering by a task-permitted group label makes its old label values
        // observable. The contextual fact view can expose those symbols in
        // addition to the new predicate column. Use the whole bounded AST as
        // the conservative effect ceiling, or disable this certificate when
        // the caller has not supplied a proven structural bound.
        maxNewSymbols: freeLabels.length ? Number.isSafeInteger(maxNodes) && maxNodes > 0 ? maxNodes : Infinity : 1
    });
}
