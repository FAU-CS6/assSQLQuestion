import assert from 'node:assert/strict';
import test from 'node:test';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {replayOperation} from '../../lib/qss/src/graph-edits.mjs';

const state = (value, tag = '') => ({kind: 'NumberLiteral', attrs: {value: String(value), tag}, slots: {}});
const context = () => ({visited: 0, async tick() {}});
const edges = (states, definitions, calls = () => {}) => definitions.map(([name, cost, pairs]) => ({
    name, description: name, cost, maxNewSymbols: 1,
    *apply(root) {
        const from = states.findIndex(s => JSON.stringify(s) === JSON.stringify(root));
        calls(name, from);
        for (const [a, b] of pairs) if (a === from) yield {root: states[b], operation: {path: [], before: root, after: states[b]}};
    }
}));
function dijkstra(from, to, definitions) {
    const best = new Map([[from, 0]]), pending = new Set([from]);
    while (pending.size) {
        const at = [...pending].sort((a, b) => best.get(a) - best.get(b))[0];
        pending.delete(at);
        if (at === to) return best.get(at);
        for (const [, cost, pairs] of definitions) for (const [a, b] of pairs) if (a === at) {
            const next = best.get(at) + cost;
            if (next < (best.get(b) ?? Infinity)) { best.set(b, next); pending.add(b); }
        }
    }
    return Infinity;
}
function replay(result, from, to) {
    let current = from;
    for (const edge of result.edits) current = replayOperation(current, edge.operation);
    assert.deepEqual(current, to);
    assert.equal(result.edits.reduce((sum, edge) => sum + edge.cost, 0), result.distance);
}

test('a monotone two-step witness above the lower bound prunes only provably non-improving families', async () => {
    const states = [state('wrong', 'wrong'), state('target', 'wrong'), state('target', 'target')];
    const definitions = [['changeValue', 1, [[0, 1]]], ['changeTag', 1, [[1, 2]]], ['expensive', 2, [[0, 2]]]];
    const ctx = context(); let expensiveDuringSearch = 0;
    const graph = {edits: edges(states, definitions, name => {if (ctx.visited && name === 'expensive') expensiveDuringSearch++;})};
    const result = await shortestSqlEditPath(states[2], states[0], graph, ctx, {cutoff: 4});
    assert.equal(result.distance, 2);
    assert.equal(result.capped, false);
    assert.ok(result.visited > 0, 'A witness costing more than the start bound is not an immediate certificate.');
    assert.equal(expensiveDuringSearch, 0);
    replay(result, states[0], states[2]);
});

test('an expensive monotone witness never hides a cheaper non-monotone directed detour', async () => {
    const states = [state('start'), state('detour'), state('other'), state('goal')];
    const definitions = [['direct', 7, [[0, 3]]], ['detour', 1, [[0, 1], [1, 2], [2, 3]]]];
    const result = await shortestSqlEditPath(states[3], states[0], {edits: edges(states, definitions)}, context());
    assert.equal(result.distance, dijkstra(0, 3, definitions));
    assert.equal(result.distance, 3);
    assert.equal(result.edits.length, 3);
    replay(result, states[0], states[3]);
});

test('a later lazy family can improve an incumbent even after an earlier family found a goal', async () => {
    const states = [state('start'), state('detour'), state('goal')];
    const definitions = [['changeValue', 4, [[0, 2]]], ['removeLater', 1, [[0, 1], [1, 2]]]];
    const result = await shortestSqlEditPath(states[2], states[0], {edits: edges(states, definitions)}, context(), {useHeuristic: false});
    assert.equal(result.distance, 2);
    replay(result, states[0], states[2]);
});

test('an admissible inconsistent heuristic still reopens a state reached more cheaply', async () => {
    const states = [state('start'), state('a'), state('b'), state('goal')];
    const definitions = [['direct', 8, [[0, 3]]], ['expensiveA', 3, [[0, 1]]], ['viaB', 1, [[0, 2], [2, 1]]], ['finish', 3, [[1, 3]]]];
    const complete = {kind: 'Script', attrs: {}, slots: {statements: [state('fact1'), state('fact2')]}}, empty = {kind: 'Script', attrs: {}, slots: {statements: []}};
    // h(start)=h(a)=h(goal)=0, h(b)=2. Each h is admissible; b->a drops
    // two units at cost one. Ties first expand a at g=3, then reopen at g=2.
    const graph = {edits: edges(states, definitions), abstractRoot: root => root.attrs.value === 'b' ? empty : complete};
    const result = await shortestSqlEditPath(states[3], states[0], graph, context());
    assert.equal(result.distance, dijkstra(0, 3, definitions));
    assert.equal(result.distance, 5);
    assert.ok(result.visited >= 4);
    replay(result, states[0], states[3]);
});

test('failure to find a monotone witness falls back to the complete graph', async () => {
    const states = [state('start'), state('away'), state('goal')];
    const definitions = [['only-route', 1, [[0, 1], [1, 2]]]];
    const result = await shortestSqlEditPath(states[2], states[0], {edits: edges(states, definitions)}, context());
    assert.equal(result.distance, 2);
    assert.ok(result.visited > 0);
    replay(result, states[0], states[2]);
});

test('custom free detours and free cycles can improve a paid incumbent to zero', async () => {
    const states = [state('start'), state('away'), state('goal')];
    const definitions = [['paid-direct', 4, [[0, 2]]], ['free', 0, [[0, 1], [1, 0], [1, 2]]]];
    const result = await shortestSqlEditPath(states[2], states[0], {edits: edges(states, definitions)}, context());
    assert.equal(result.distance, 0);
    assert.equal(result.edits.length, 2);
    replay(result, states[0], states[2]);
});

test('witness paths at or above cutoff never invent an exact score or trace', async () => {
    const states = [state('wrong', 'wrong'), state('goal', 'wrong'), state('goal', 'goal')];
    const definitions = [['step', 1, [[0, 1], [1, 2]]]];
    for (const cutoff of [1, 2]) {
        const result = await shortestSqlEditPath(states[2], states[0], {edits: edges(states, definitions)}, context(), {cutoff});
        assert.equal(result.capped, true);
        assert.equal(result.distance, cutoff);
        assert.deepEqual(result.edits, []);
    }
});

test('monotone guide work observes manual cancellation at tick boundaries', async () => {
    const states = [state('wrong', 'wrong'), state('goal', 'wrong'), state('goal', 'goal')];
    const definitions = [['step', 1, [[0, 1], [1, 2]]]];
    let calls = 0;
    const ctx = {async tick() { if (++calls === 2) throw new Error('manual cancellation'); }};
    await assert.rejects(shortestSqlEditPath(states[2], states[0], {edits: edges(states, definitions)}, ctx, {useHeuristic: false}), /manual cancellation/);
});

test('incumbent search matches independent directed Dijkstra across weights cutoffs and structural guides', async () => {
    let seed = 90217;
    const random = n => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
    const states = [state('a', 'a'), state('a', 'b'), state('b', 'a'), state('b', 'b'), state('c', 'a'), state('c', 'b')];
    for (let sample = 0; sample < 8; sample++) {
        const definitions = [['cycle', 1, states.map((_, i) => [i, (i + 1) % states.length])]];
        for (let i = 0; i < 12; i++) definitions.push(['edge-' + i, random(5), [[random(6), random(6)]]]);
        const graph = {edits: edges(states, definitions)};
        for (let from = 0; from < states.length; from++) for (let to = 0; to < states.length; to++) {
            const expected = dijkstra(from, to, definitions);
            for (const cutoff of [1, 2, 4, Infinity]) for (const useHeuristic of [false, true]) {
                const result = await shortestSqlEditPath(states[to], states[from], graph, context(), {cutoff, useHeuristic});
                assert.equal(result.distance, Math.min(expected, cutoff));
                assert.equal(result.capped, expected >= cutoff);
                if (!result.capped) replay(result, states[from], states[to]);
                else assert.deepEqual(result.edits, []);
            }
        }
    }
});
