/**
 * Exact structural interning of graph-model.serializeKey's
 * equality classes; no SQL execution, normalization rule or graph edit changes.
 * IDs are local to one graph; never compare them across interner instances.
 * ASTs must be immutable, just as for graphKey. Public stableKey stays unchanged.
 */
export function internGraphKey() {
    const byObject = new WeakMap();
    const byAttributes = new WeakMap(), bySlots = new WeakMap(), byPrimitive = new Map();
    const signatures = new Map();
    let serial = 0;
    let signatureCharacters = 0;
    const internSignature = signature => {
        const prior = signatures.get(signature);
        if (prior !== undefined) return prior;
        const id = ++serial;
        if (!Number.isSafeInteger(id)) throw new RangeError('Structural interning ID exceeds exact integer precision.');
        signatures.set(signature, id);
        signatureCharacters += signature.length;
        return id;
    };
    // serializeKey(undefined), functions and symbols are undefined. In array
    // joins that means an empty element; object concatenation spells undefined.
    const undefinedId = internSignature('U');
    // JSON.stringify may serialize a function's custom toJSON result as an
    // object/array. Its property order and raw JSON shape must be preserved,
    // without applying semantic-node filtering a second time.
    const literalKey = value => {
        if (value === null || typeof value !== 'object') return internSignature('P' + JSON.stringify(value));
        if (Array.isArray(value)) return internSignature(JSON.stringify(['A', value.map(literalKey)]));
        return internSignature(JSON.stringify(['O', Object.keys(value).map(name => [name, literalKey(value[name])])]));
    };
    const key = value => {
        if (value === null || typeof value !== 'object') {
            const reusable = value === null || ['string', 'number', 'boolean', 'undefined'].includes(typeof value);
            if (reusable && byPrimitive.has(value)) return byPrimitive.get(value);
            const serialized = JSON.stringify(value); // preserves BigInt rejection
            if (serialized === undefined) return undefinedId;
            if (serialized[0] === '[' || serialized[0] === '{') return literalKey(JSON.parse(serialized));
            const id = internSignature('P' + serialized);
            if (reusable) byPrimitive.set(value, id);
            return id;
        }
        const known = byObject.get(value);
        if (known !== undefined) return known;
        const original = value;
        let signature;
        if (Array.isArray(value)) {
            // map(...).join(',') treats a hole like an undefined child, and []
            // equals [undefined]/[hole] under the old serialized equality.
            const ids = new Array(value.length);
            for (let i = 0; i < value.length; ++i) ids[i] = i in value ? key(value[i]) : undefinedId;
            if (ids.length === 1 && ids[0] === undefinedId) ids.length = 0;
            signature = JSON.stringify(['A', ids]);
        } else {
            if (typeof value.kind === 'string' && value.attrs && value.slots) {
                // Persistent replacements share their immutable attribute and
                // slot maps. Cache their filtered signatures directly instead
                // of allocating fresh filtered objects for every ancestor.
                signature = JSON.stringify(['O', [['attrs', filtered(value.attrs, byAttributes, true)],
                    ['kind', key(value.kind)], ['slots', filtered(value.slots, bySlots, false)]]]);
            } else signature = JSON.stringify(['O', Object.keys(value).sort().map(name => [name, key(value[name])])]);
        }
        const id = internSignature(signature);
        byObject.set(original, id);
        return id;
    };
    const filtered = (value, cache, attributes) => {
        const known = cache.get(value);
        if (known !== undefined) return known;
        const entries = Object.keys(value).sort().filter(name => value[name] != null
            && !(attributes ? name === 'distinct' && value[name] === false : Array.isArray(value[name]) && !value[name].length));
        const semantic = entries.includes('kind') && entries.includes('attrs') && entries.includes('slots')
            && typeof value.kind === 'string' && value.attrs && value.slots;
        const id = semantic ? key(Object.fromEntries(entries.map(name => [name, value[name]])))
            : internSignature(JSON.stringify(['O', entries.map(name => [name, key(value[name])])]));
        if (typeof value === 'object' && value !== null || typeof value === 'function') cache.set(value, id);
        return id;
    };
    key.stats = () => ({internedSignatures: signatures.size, signatureCharacters});
    return key;
}
