import test from 'node:test';
import assert from 'node:assert/strict';
import {createStructuralGuide} from '../../lib/qss/src/graph-guide.mjs';
import {parseGraphSql} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';

// Frozen pre-cache algorithm, independent of the optimized implementation.
function oldSize(value) {
    if (value == null) return 0;
    if (Array.isArray(value)) return value.reduce((n, v) => n + oldSize(v), 0);
    if (typeof value === 'object') return 1 + Object.values(value).reduce((n, v) => n + oldSize(v), 0);
    return 1;
}
function oldDistance(a, b, weighted = true) {
    if (a === b) return 0;
    if (a == null || b == null) return weighted ? oldSize(a == null ? b : a) : 1;
    if (Array.isArray(a) || Array.isArray(b)) {
        if (!Array.isArray(a) || !Array.isArray(b)) return 1;
        let n = 0;
        for (let i = 0; i < Math.max(a.length, b.length); i++) n += oldDistance(a[i], b[i], weighted);
        return n;
    }
    if (typeof a !== 'object' || typeof b !== 'object') return a === b ? 0 : 1;
    let n = 0;
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) n += oldDistance(a[key], b[key], weighted);
    return n;
}

test('cached scheduling guide preserves all primitive and structural comparisons', () => {
    const values = [null, undefined, false, true, 0, -0, NaN, Infinity, '', 'x', [], [null], [undefined],
        new Array(2), {}, {a: undefined}, {a: null}, {a: [1, 2], b: {c: false}}, {b: 2, a: 1}, {a: 1, b: 2}];
    let seed = 271828;
    const next = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
    const random = depth => !depth ? values[next() % 10] : next() % 2
        ? Array.from({length: next() % 4}, () => random(depth - 1))
        : {a: random(depth - 1), b: random(depth - 1)};
    for (let i = 0; i < 150; i++) values.push(random(3));
    const cached = createStructuralGuide();
    for (const weighted of [true, false]) for (const a of values) for (const b of values) {
        const expected = oldDistance(a, b, weighted);
        assert.equal(cached(a, b, weighted), expected);
        assert.equal(cached(a, b, weighted), expected);
    }
});

test('persistent SQL neighbours preserve scheduling values for both guide passes', () => {
    const schema = {tables: [{name: 't', type: 'table', columns: [{name: 'x'}, {name: 'y'}]}]};
    const reference = parseGraphSql('SELECT x AS answer FROM t WHERE y>3 AND x=2', {schema}).root;
    const answer = parseGraphSql('SELECT y AS answer FROM t WHERE x=1', {schema}).root;
    const graph = createEditGraph(reference, answer, schema), cached = createStructuralGuide();
    let count = 0;
    for (const edit of graph.edits) for (const edge of edit.apply(answer)) {
        for (const weighted of [true, false]) assert.equal(cached(edge.root, reference, weighted), oldDistance(edge.root, reference, weighted));
        count++;
    }
    assert.ok(count > 100);
});
