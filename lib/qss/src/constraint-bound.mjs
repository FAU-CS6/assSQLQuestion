/** Counts used only for an admissible DDL edit-distance lower bound. */
import {ceilRatio, minimumEffectRatio} from './integer-bound.mjs';

export const CONSTRAINT_FEATURES = Object.freeze([
    'notNull', 'reference', 'primaryKey', 'unique', 'autoIncrement', 'check', 'default'
]);
const node = value => value && typeof value.kind === 'string' && value.attrs && value.slots;
const declaration = value => ['Definition', 'Alter', 'ColumnConstraint'].includes(value?.kind);
const upper = value => typeof value === 'string' ? value.toUpperCase() : value;
const emptyInventory = () => Object.fromEntries(CONSTRAINT_FEATURES.map(name => [name, 0]));

/**
 * Count occurrences, including shared AST objects at distinct positions.
 *
 * Ignore direct NOT NULL whenever the owning declaration has an inline PK,
 * irrespective of type/resource/rowid guards. A free INTEGER-rowid-PK edge
 * then preserves the count, and a paid type/resource edit cannot uncover many
 * suppressed facts. Removing the inline PK can uncover at most one NOT NULL.
 *
 * `Default` also names function identifiers in the parser (e.g. LENGTH).
 * Therefore DEFAULT and NOT NULL are counted only in their declaration slots.
 * Boolean duplication of expressions/CASTs cannot multiply these facts.
 * ReferenceDefinition/Check themselves have no scalar-expression meaning.
 */
export function createConstraintInventory() {
    const cache = new WeakMap();
    const inventory = root => {
        if (!node(root)) return emptyInventory();
        if (cache.has(root)) return cache.get(root);
        const counts = emptyInventory();
        if (root.kind === 'ReferenceDefinition') counts.reference++;
        if (root.kind === 'Check') counts.check++;
        if (declaration(root)) {
            const inlinePrimary = upper(root.attrs.primary_key) === 'PRIMARY KEY';
            if (inlinePrimary || upper(root.attrs.constraint_type) === 'PRIMARY KEY') counts.primaryKey++;
            if (upper(root.attrs.unique) === 'UNIQUE' || upper(root.attrs.constraint_type) === 'UNIQUE') counts.unique++;
            if (upper(root.attrs.auto_increment) === 'AUTOINCREMENT') counts.autoIncrement++;
            if (upper(root.attrs.constraint_type) === 'CHECK') counts.check++;
            if (!inlinePrimary && root.slots.nullable?.kind === 'NotNull') counts.notNull++;
            if (root.slots.default_val?.kind === 'Default') counts.default++;
        }
        for (const value of Object.values(root.slots)) for (const child of Array.isArray(value) ? value : [value]) {
            if (!node(child)) continue;
            const part = inventory(child);
            for (const feature of CONSTRAINT_FEATURES) counts[feature] += part[feature];
        }
        const result = Object.freeze(counts);
        cache.set(root, result);
        return result;
    };
    return inventory;
}

export function missingConstraints(target, current) {
    return CONSTRAINT_FEATURES.reduce((sum, feature) => sum + Math.max(0, target[feature] - current[feature]), 0);
}

/** Positive increases, not the signed total: replacing UNIQUE by PK can
 * discharge a missing PK even though the total number of constraints stays 1. */
export function constraintIncrease(before, after) {
    return missingConstraints(after, before);
}

/**
 * Each edit must explicitly certify maxNewConstraints: the maximum sum of
 * positive feature-count increases across EVERY state it can generate.
 * Unknown/invalid annotations disable this bound; so does a zero-cost edge
 * with a positive certified effect. Never infer preservation from cost zero.
 * The finite AST inventory is a heuristic only, never an equivalence test.
 */
export function createConstraintBound(target, edits) {
    const inventory = createConstraintInventory(), wanted = inventory(target);
    const ratio = minimumEffectRatio(edits, 'maxNewConstraints');
    const exactMeasure = root => {
        const missing = missingConstraints(wanted, inventory(root));
        const numerator = BigInt(missing) * ratio.numerator;
        return {missing, numerator, denominator: ratio.denominator, bound: ceilRatio(numerator, ratio.denominator)};
    };
    return {
        inventory, target: wanted, ratio, exactMeasure,
        measure: root => exactMeasure(root).bound,
        // Lazy edge-family bounds subtract the exact fractional effect before
        // rounding, matching the integer edge-cost shortest-path proof.
        exactRemaining(numerator, edit) {
            const effect = edit.maxNewConstraints;
            if (!Number.isSafeInteger(effect) || effect < 0) return 0;
            const remaining = numerator - BigInt(effect) * ratio.numerator;
            return ceilRatio(remaining > 0n ? remaining : 0n, ratio.denominator);
        }
    };
}
