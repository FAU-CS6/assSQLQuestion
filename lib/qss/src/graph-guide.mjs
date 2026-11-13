/** Memoize the existing structural scheduling guide for immutable graph ASTs.
 * This is neither an admissible bound nor an equivalence/grade calculation.
 * Each search owns its caches; weak keys retain no discarded search states.
 */
export function createStructuralGuide() {
    const sizes = new WeakMap(), weightedPairs = new WeakMap(), flatPairs = new WeakMap();
    const size = value => {
        if (value == null) return 0;
        if (typeof value !== 'object') return 1;
        if (sizes.has(value)) return sizes.get(value);
        const result = Array.isArray(value)
            ? value.reduce((sum, child) => sum + size(child), 0)
            : 1 + Object.values(value).reduce((sum, child) => sum + size(child), 0);
        sizes.set(value, result); return result;
    };
    const distance = (a, b, weighted = true) => {
        if (a === b) return 0;
        if (a == null || b == null) return weighted ? size(a == null ? b : a) : 1;
        if (Array.isArray(a) !== Array.isArray(b)) return 1;
        if (typeof a !== 'object' || typeof b !== 'object') return 1;
        const pairs = weighted ? weightedPairs : flatPairs;
        let previous = pairs.get(a);
        if (previous?.has(b)) return previous.get(b);
        let result = 0;
        if (Array.isArray(a)) {
            for (let i = 0; i < Math.max(a.length, b.length); i++) result += distance(a[i], b[i], weighted);
        } else {
            for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) result += distance(a[key], b[key], weighted);
        }
        if (!previous) { previous = new WeakMap(); pairs.set(a, previous); }
        previous.set(b, result); return result;
    };
    return distance;
}
