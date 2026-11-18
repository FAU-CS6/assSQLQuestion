/** Exact lower bounds on a graph whose edge costs are nonnegative integers. */
const maximum = BigInt(Number.MAX_SAFE_INTEGER);

export function ceilRatio(numerator, denominator) {
    if (numerator < 0n || denominator <= 0n) throw new RangeError('Invalid nonnegative bound.');
    const value = (numerator + denominator - 1n) / denominator;
    // Clamping down remains admissible even outside the supported path precision.
    return Number(value > maximum ? maximum : value);
}

export function minimumEffectRatio(edits, field) {
    const zero = {numerator: 0n, denominator: 1n};
    if (edits.some(edit => !Number.isSafeInteger(edit[field]) || edit[field] < 0
        || !Number.isSafeInteger(edit.cost) || edit.cost < 0)) return zero;
    let ratio = null;
    for (const edit of edits) if (edit[field] > 0) {
        const numerator = BigInt(edit.cost), denominator = BigInt(edit[field]);
        if (ratio === null || numerator * ratio.denominator < ratio.numerator * denominator) {
            ratio = {numerator, denominator};
        }
    }
    return ratio || zero;
}

export function ceilEffect(ratio, count) {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid effect count.');
    return ceilRatio(ratio.numerator * BigInt(count), ratio.denominator);
}
