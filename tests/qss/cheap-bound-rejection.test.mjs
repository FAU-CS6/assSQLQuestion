import assert from 'node:assert/strict';
import test from 'node:test';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {stableKey} from '../../lib/qss/src/graph-model.mjs';

const node = (id, operator = '<=') => ({kind: 'BinaryExpression', attrs: {operator, id}, slots: {
    left: {kind: 'ColumnReference', attrs: {column: 'x'}, slots: {}},
    right: {kind: 'NumberLiteral', attrs: {value: '1', storageClass: 'integer'}, slots: {}}
}});
const context = () => ({visited: 0, async tick() {}});
const edge = (name, cost, from, to) => ({name, description: name, cost,
    maxNewSymbols: 0, preservesSymbolSet: true, maxNewPredicates: 1,
    maxOrderedComparisonChange: 1,
    *apply(root) {
        if (root.attrs.id === from.attrs.id) yield {root: to,
            operation: {path: [], before: root, after: to}};
    }
});

test('a cheap certified rejection avoids expression facts without changing the witnessed optimum', async () => {
    const start = node(0), rejected = node(1), target = node(2, '>'), calls = new Map();
    const graph = {edits: [edge('direct', 2, start, target), edge('dead-end', 1, start, rejected)],
        symbolFacts: () => new Set(), predicateFacts: root => {
            calls.set(root.attrs.id, (calls.get(root.attrs.id) || 0) + 1);
            return new Set([String(root.attrs.id)]);
        }};
    const result = await shortestSqlEditPath(target, start, graph, context());
    assert.equal(result.distance, 2);
    assert.equal(result.visited, 1);
    assert.equal(result.finalKey, stableKey(target));
    assert.equal(result.edits.length, 1);
    assert.equal(result.edits[0].name, 'direct');
    assert.equal(calls.get(rejected.attrs.id) || 0, 0,
        'distance 1 + already certified ordered bound 1 reaches the witnessed ceiling 2');
    assert.ok(calls.get(start.attrs.id)); assert.ok(calls.get(target.attrs.id));
});

test('cheap rejection and cached partial bounds retain directed Dijkstra distances with zero overrides and reopening', async () => {
    let seed = 57027;
    const random = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    for (let example = 0; example < 24; ++example) {
        const states = Array.from({length: 6}, (_, id) => node(id, random() % 2 ? '<=' : '>'));
        const edges = [];
        for (let from = 0; from < states.length; ++from) for (let to = 0; to < states.length; ++to) {
            if (from !== to && (to === (from + 1) % states.length || random() % 3 === 0)) {
                const cost = example % 3 === 0 ? random() % 4 : 1 + random() % 7;
                edges.push(edge('edge-' + from + '-' + to, cost, states[from], states[to]));
            }
        }
        for (let source = 0; source < states.length; ++source) {
            const distance = new Map([[source, 0]]), pending = new Set([source]);
            while (pending.size) {
                const at = [...pending].sort((a, b) => distance.get(a) - distance.get(b))[0]; pending.delete(at);
                for (const edit of edges) for (const next of edit.apply(states[at])) {
                    const id = next.root.attrs.id, candidate = distance.get(at) + edit.cost;
                    if (candidate < (distance.get(id) ?? Infinity)) { distance.set(id, candidate); pending.add(id); }
                }
            }
            for (let target = 0; target < states.length; ++target) for (const useHeuristic of [false, true]) {
                const graph = {edits: edges, symbolFacts: () => new Set(),
                    predicateFacts: root => new Set([String(root.attrs.id)])};
                const actual = await shortestSqlEditPath(states[target], states[source], graph, context(), {useHeuristic});
                assert.equal(actual.distance, distance.get(target), `${example}: ${source}->${target}, ${useHeuristic}`);
                assert.equal(actual.edits.reduce((sum, edit) => sum + edit.cost, 0), actual.distance);
                let replay = states[source];
                for (const edit of actual.edits) {
                    assert.equal(stableKey(replay), stableKey(edit.operation.before));
                    replay = edit.operation.after;
                }
                assert.equal(stableKey(replay), stableKey(states[target]));
            }
        }
    }
});
