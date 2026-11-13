import assert from 'node:assert/strict';
import test from 'node:test';
import {findReverseZeroWitness} from '../../lib/qss/src/graph-reverse-witness.mjs';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';

const node = value => ({kind: 'NumberLiteral', attrs: {value: String(value)}, slots: {}});
const context = () => ({visited: 0, async tick() {}});
const guide = (root, target) => Math.abs(Number(root.attrs.value) - Number(target.attrs.value));
const edit = (name, cost, pairs) => ({name, description: name, cost, maxNewSymbols: 1,
    *apply(root) {
        for (const [from, to] of pairs) if (root.attrs.value === String(from)) {
            const next = node(to);
            yield {root: next, operation: {path: [], before: root, after: next, cost}};
        }
    }});
const witness = (graph, from = 0, to = 2, options = {guide}) =>
    findReverseZeroWitness(node(to), node(from), graph, context(), options);
function replay(edges, from, to) {
    let current = from;
    for (const edge of edges) {
        assert.equal(edge.cost, 0);
        current = replayOperation(current, edge.operation);
        assert.equal(stableKey(current), stableKey(edge.root));
    }
    assert.equal(stableKey(current), stableKey(to));
}
function dijkstra(from, to, edits) {
    const best = new Map([[String(from), 0]]), pending = new Set([String(from)]);
    while (pending.size) {
        const at = [...pending].sort((a, b) => best.get(a) - best.get(b))[0]; pending.delete(at);
        if (at === String(to)) return best.get(at);
        for (const family of edits) for (const edge of family.apply(node(at))) {
            const next = edge.root.attrs.value, distance = best.get(at) + family.cost;
            if (distance < (best.get(next) ?? Infinity)) { best.set(next, distance); pending.add(next); }
        }
    }
    return Infinity;
}

test('a backward guide certifies only individually replayed forward zero edges', async () => {
    const graph = {edits: [edit('backward', 0, [[2, 1], [1, 0]]), edit('forward', 0, [[0, 1], [1, 2]])]};
    const result = await witness(graph);
    assert.ok(result.edges); replay(result.edges, node(0), node(2));
    assert.ok(result.edges.every(edge => edge.name === 'forward'));
    assert.equal(dijkstra(0, 2, graph.edits), 0);
});

test('an outgoing zero edge from the real start can bridge a stalled backward walk', async () => {
    const graph = {edits: [edit('backward', 0, [[2, 1]]), edit('bridge', 0, [[0, 1]]), edit('forward', 0, [[1, 2]])]};
    const result = await witness(graph);
    assert.deepEqual(result.edges.map(edge => edge.name), ['bridge', 'forward']);
    replay(result.edges, node(0), node(2));
});

test('irreversible edges and custom positive forward prices never create a zero certificate', async () => {
    for (const cost of [1, 7]) {
        const graph = {edits: [edit('backward', 0, [[2, 1], [1, 0]]), edit('forward', cost, [[0, 1], [1, 2]])]};
        assert.equal((await witness(graph)).edges, null);
        const fallback = await shortestSqlEditPath(node(2), node(0), graph, context());
        assert.equal(fallback.distance, dijkstra(0, 2, graph.edits));
        assert.equal(fallback.distance, 2 * cost);
    }
    const freeOverride = {edits: [edit('backward', 0, [[2, 1], [1, 0]]), edit('forward', 0, [[0, 1], [1, 2]])]};
    replay((await witness(freeOverride)).edges, node(0), node(2));
    assert.equal((await witness({edits: [edit('irreversible', 0, [[2, 1], [1, 0]])]})).edges, null);
});

test('failed replay, inconsistent operation costs and invalid guide values fail closed', async () => {
    for (const badOperation of [
        {path: [], before: node(0), after: node(3), cost: 0},
        {path: [], before: node(3), after: node(2), cost: 0},
        {path: [], before: node(0), after: node(2), cost: 7}
    ]) {
        const graph = {edits: [{name: 'malformed', cost: 0, *apply(root) {
            if (root.attrs.value === '0') yield {root: node(2), operation: badOperation};
        }}]};
        assert.equal((await witness(graph)).edges, null);
    }
    const graph = {edits: [edit('free', 0, [[2, 1], [1, 0], [0, 1], [1, 2]])]};
    for (const value of [NaN, Infinity, -1, 0.5]) assert.equal((await witness(graph, 0, 2, {guide: () => value})).edges, null);
    assert.equal((await witness({edits: [edit('negative', -1, [[0, 2]])]})).edges, null);
});

test('context cancellation propagates rather than returning an approximate certificate', async () => {
    const graph = {edits: [edit('free', 0, [[2, 1], [1, 0]])]};
    await assert.rejects(findReverseZeroWitness(node(2), node(0), graph,
        {async tick() { throw new Error('cancelled'); }}, {guide}), /cancelled/);
});

test('certificates and complete fallback agree with independent Dijkstra for every directed pair', async () => {
    let seed = 0x51455353, certified = 0, fallback = 0;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    for (let sample = 0; sample < 64; sample++) {
        const edits = [edit('connected-ring', 7, [[0, 1], [1, 2], [2, 3], [3, 0]])];
        for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) if (from !== to && random() % 3 !== 0) {
            edits.push(edit('edge-' + from + '-' + to, [0, 1, 7][random() % 3], [[from, to]]));
        }
        const graph = {edits};
        for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) {
            const expected = dijkstra(from, to, edits), result = await witness(graph, from, to);
            if (result.edges) {
                certified++; assert.equal(expected, 0); replay(result.edges, node(from), node(to));
            } else {
                fallback++;
                const full = await shortestSqlEditPath(node(to), node(from), graph, context());
                assert.equal(full.distance, expected);
            }
        }
    }
    assert.ok(certified > 0); assert.ok(fallback > 0);
});

test('NOT IN spellings require real inverse edges and alternative monotone tie choices', async () => {
    const schema = {tables: [{name: 'items', type: 'table', columns: [{name: 'value'}, {name: 'place'}]}]};
    const ast = sql => parseGraphSql(sql, {schema}).root;
    const reference = ast("SELECT * FROM items AS i WHERE i.value>2 AND NOT i.place='A' AND NOT i.place='B'");
    const answer = ast("SELECT * FROM items WHERE value>2 AND place NOT IN ('A','B')");
    const graph = createEditGraph(reference, answer, schema);
    const result = await findReverseZeroWitness(reference, answer, graph, context());
    assert.ok(result.edges); replay(result.edges, answer, reference);
    assert.ok(result.edges.some(edge => edge.name === 'rewriteLiteralInList'));
    const integrated = await shortestSqlEditPath(reference, answer, graph, context());
    assert.equal(integrated.distance, 0);
    assert.equal(integrated.search, 'exact-directed-zero-witness-certificate');
    let reached = answer;
    for (const edge of integrated.edits) reached = replayOperation(reached, edge.operation);
    assert.equal(stableKey(reached), stableKey(reference));
    const unequal = ast("SELECT * FROM items WHERE place!='A' AND place!='B'");
    const inList = ast("SELECT * FROM items WHERE place NOT IN ('A','B')");
    const directed = createEditGraph(unequal, inList, schema).edits.find(edit => edit.name === 'rewriteLiteralInList');
    assert.ok([...directed.apply(unequal)].some(edge => stableKey(edge.root) === stableKey(inList)));
    assert.ok(![...directed.apply(inList)].some(edge => stableKey(edge.root) === stableKey(unequal)), 'Expansion uses <>; != is not a direct inverse.');
    const priced = createEditGraph(reference, answer, schema, {rewriteLiteralInList: 7});
    assert.equal((await findReverseZeroWitness(reference, answer, priced, context())).edges, null);
});
