/** Raw concrete-AST operator groups. This is a binary search certificate,
 * never an equivalence normalization, a graph key, or a grading rule.
 * A NOT wrapper retains its child's group: replacing NOT(x<=y) with x>y
 * requires an actual directed edit whose configurable price is respected.
 */
export function orderedComparisonMask(root) {
    let mask = 0;
    const visit = node => {
        if (!node || typeof node.kind !== 'string') return;
        if (node.kind === 'BinaryExpression') {
            const operator = node.attrs?.operator;
            if (operator === '<' || operator === '>' || operator === 'NOT BETWEEN') mask |= 1;
            if (operator === '<=' || operator === '>=' || operator === 'BETWEEN') mask |= 2;
        }
        // Do not skip CASE alternatives, incomplete operands, or subqueries.
        // A guardless atom/slot edit may pass through these intermediate ASTs.
        for (const value of Object.values(node.slots || {})) {
            if (Array.isArray(value)) for (const child of value) visit(child);
            else visit(value);
        }
    };
    visit(root); return mask;
}

/** maxOrderedComparisonChange is an explicit 0/1 effect declaration. A
 * missing/unknown declaration disables this entire certificate. Any custom
 * free mask-changing family also disables it; zero-cost preserving families
 * remain useful. The minimum change price proves only ONE necessary edit,
 * irrespective of how many groups/statements/operands differ.
 */
export function createOrderedComparisonBound(reference, edits) {
    const destination = orderedComparisonMask(reference);
    const valid = Array.isArray(edits) && edits.every(edit =>
        (edit.maxOrderedComparisonChange === 0 || edit.maxOrderedComparisonChange === 1)
        && Number.isSafeInteger(edit.cost) && edit.cost >= 0);
    const changing = valid ? edits.filter(edit => edit.maxOrderedComparisonChange === 1) : [];
    const unit = changing.length ? Math.min(...changing.map(edit => edit.cost)) : 0;
    return {
        enabled: unit > 0,
        unit,
        measure: root => unit && orderedComparisonMask(root) !== destination ? unit : 0,
        decrease: edit => edit?.maxOrderedComparisonChange === 0 ? 0 : unit,
        remaining: (bound, edit) => edit?.maxOrderedComparisonChange === 0 ? bound : 0
    };
}
