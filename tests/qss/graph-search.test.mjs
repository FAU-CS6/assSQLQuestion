import assert from 'node:assert/strict';
import test from 'node:test';
import {shortestSqlEditPath, symbolFacts, heuristicCertificate, sqlWorkBound} from '../../lib/qss/src/graph-search.mjs';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';

const node = value => ({kind: 'NumberLiteral', attrs: {value: String(value)}, slots: {}});
const context = () => ({visited: 0, async tick() {}});
const edit = (name, cost, pairs, bound = 1) => ({name, description: name, cost, maxNewSymbols: bound,
    *apply(root) {
        for (const [from, to] of pairs) if (root.attrs.value === String(from)) {
            const next = node(to);
            yield {root: next, operation: {path: [], before: root, after: next}};
        }
    }});
function dijkstra(source, target, edits) {
    const distance = new Map([[String(source), 0]]), pending = new Set([String(source)]);
    while (pending.size) {
        const at = [...pending].sort((a, b) => distance.get(a) - distance.get(b))[0];
        pending.delete(at);
        if (at === String(target)) return distance.get(at);
        for (const edge of edits) for (const next of edge.apply(node(at))) {
            const value = next.root.attrs.value, candidate = distance.get(at) + edge.cost;
            if (candidate < (distance.get(value) ?? Infinity)) { distance.set(value, candidate); pending.add(value); }
        }
    }
    return Infinity;
}

test('lazy search agrees with independent exhaustive Dijkstra for every directed pair', async () => {
    const edits = [edit('forward', 1, [[0, 1], [1, 2], [2, 3], [3, 4]]),
        edit('backward', 2, [[4, 3], [3, 2], [2, 1], [1, 0]]),
        edit('expensive-shortcut', 4, [[0, 4], [4, 0]]), edit('detour', 1, [[1, 3]])];
    for (let from = 0; from <= 4; ++from) for (let to = 0; to <= 4; ++to) {
        const expected = dijkstra(from, to, edits);
        for (const useHeuristic of [false, true]) {
            const actual = await shortestSqlEditPath(node(to), node(from), {edits, limits: {}}, context(), {useHeuristic});
            assert.equal(actual.distance, expected, `${from} → ${to}, heuristic=${useHeuristic}`);
            assert.equal(actual.edits.reduce((sum, edge) => sum + edge.cost, 0), expected);
        }
    }
});

test('a cheap detour beats an expensive direct edit; neighbours are not greedily target-filtered', async () => {
    const edits = [edit('direct', 5, [[0, 2]]), edit('away-then-back', 1, [[0, 3], [3, 1], [1, 2]])];
    const result = await shortestSqlEditPath(node(2), node(0), {edits}, context());
    assert.equal(result.distance, 3);
    assert.equal(result.edits.length, 3);
});

test('a witnessed direct path matching the global start lower bound is certified without expanding the graph', async () => {
    const edits = [edit('direct', 1, [[0, 2]]), edit('other', 2, [[0, 1], [1, 2]])];
    const result = await shortestSqlEditPath(node(2), node(0), {edits}, context());
    assert.equal(result.distance, dijkstra(0, 2, edits));
    assert.equal(result.distance, 1);
    assert.equal(result.search, 'exact-direct-bound-certificate');
    assert.equal(result.visited, 0);
    assert.equal(result.frontier, 0);
    assert.equal(result.finalKey, result.destinationKey);
    assert.equal(result.edits.length, 1);
    assert.deepEqual(result.edits[0].operation.before, node(0));
    assert.deepEqual(result.edits[0].operation.after, node(2));
});

test('the direct-path certificate handles custom integer costs using the actual certified bound', async () => {
    const edits = [edit('custom-direct', 3, [[0, 2]]), edit('custom-detour', 4, [[0, 1], [1, 2]])];
    const result = await shortestSqlEditPath(node(2), node(0), {edits}, context());
    assert.equal(result.distance, dijkstra(0, 2, edits));
    assert.equal(result.distance, 3);
    assert.equal(result.search, 'exact-direct-bound-certificate');
    assert.equal(result.edits[0].cost, 3);
});

test('a costlier direct path never replaces a cheaper indirect path when free custom edits disable guidance', async () => {
    const edits = [edit('tempting-direct', 1, [[0, 2]]), edit('free-detour', 0, [[0, 1], [1, 2]])];
    assert.equal(heuristicCertificate(edits).enabled, false);
    const result = await shortestSqlEditPath(node(2), node(0), {edits}, context());
    assert.equal(result.distance, dijkstra(0, 2, edits));
    assert.equal(result.distance, 0);
    assert.equal(result.edits.length, 2);
    assert.notEqual(result.search, 'exact-direct-bound-certificate');
});

test('a direct zero-cost path matches the universal nonnegative bound even without a heuristic', async () => {
    const edits = [edit('free-direct', 0, [[0, 2]])];
    const result = await shortestSqlEditPath(node(2), node(0), {edits}, context(), {useHeuristic: false});
    assert.equal(result.distance, 0);
    assert.equal(result.search, 'exact-direct-bound-certificate');
    assert.equal(result.edits.length, 1);
    assert.equal(result.edits[0].cost, 0);
});

test('positive direct paths cannot use the trivial zero bound when heuristics are disabled', async () => {
    const edits = [edit('direct', 1, [[0, 2]])];
    const result = await shortestSqlEditPath(node(2), node(0), {edits}, context(), {useHeuristic: false});
    assert.equal(result.distance, 1);
    assert.equal(result.search, 'exact-lazy-uniform-cost');
});

test('a merely lower fractional bound is not rounded into a direct-path equality certificate', async () => {
    const edits = [edit('direct', 1, [[0, 2]], 2)];
    assert.equal(heuristicCertificate(edits).unit, 0.5);
    const result = await shortestSqlEditPath(node(2), node(0), {edits}, context());
    assert.equal(result.distance, dijkstra(0, 2, edits));
    assert.equal(result.distance, 1);
    assert.notEqual(result.search, 'exact-direct-bound-certificate');
});

test('identity keeps its ordinary empty path and does not generate direct neighbours', async () => {
    const edits = [{cost: 0, maxNewSymbols: 0, *apply() {throw new Error('Identity must not scan edits.');}}];
    const result = await shortestSqlEditPath(node(1), node(1), {edits}, context());
    assert.equal(result.distance, 0);
    assert.deepEqual(result.edits, []);
    assert.notEqual(result.search, 'exact-direct-bound-certificate');
});

test('a zero-point lower-bound certificate avoids an unnecessary direct-path scan', async () => {
    const edits = [{cost: 1, maxNewSymbols: 1, *apply() {throw new Error('The score cutoff already proves zero.');}}];
    const result = await shortestSqlEditPath(node(2), node(0), {edits}, context(), {cutoff: 1});
    assert.equal(result.capped, true);
    assert.equal(result.distance, 1);
    assert.deepEqual(result.edits, []);
});

test('direct-certificate scanning propagates manual cancellation through context tick boundaries', async () => {
    let called = 0;
    const edits = [{cost: 1, maxNewSymbols: 1, *apply() {++called; yield {root: node(2)};}}];
    await assert.rejects(shortestSqlEditPath(node(2), node(0), {edits}, {async tick() {throw new Error('manual cancellation');}}), /manual cancellation/);
    assert.equal(called, 0);
});

test('the shortcut uses an active SQL-work bound when custom free symbol edits disable symbol guidance', async () => {
    const reference = parseGraphSql('SELECT DISTINCT 1').root, answer = parseGraphSql('SELECT 1').root;
    const graph = createEditGraph(reference, answer, {}, {changeLiteral: 0});
    assert.equal(heuristicCertificate(graph.edits).enabled, false);
    const result = await shortestSqlEditPath(reference, answer, graph, context());
    assert.equal(result.distance, 2);
    assert.equal(result.search, 'exact-direct-bound-certificate');
    let replay = answer;
    for (const edge of result.edits) replay = replayOperation(replay, edge.operation);
    assert.equal(stableKey(replay), stableKey(reference));
});

test('custom free symbol edits do not mislabel an active SQL-work zero-point certificate as a zero heuristic', async () => {
    const reference = parseGraphSql('SELECT DISTINCT 1').root, answer = parseGraphSql('SELECT 1').root;
    const graph = createEditGraph(reference, answer, {}, {changeLiteral: 0});
    assert.equal(heuristicCertificate(graph.edits).enabled, false);
    const result = await shortestSqlEditPath(reference, answer, graph, context(), {cutoff: 1});
    assert.equal(result.capped, true);
    assert.equal(result.distance, 1);
    assert.deepEqual(result.edits, []);
    assert.equal(result.search, 'exact-lazy-a-star');
    assert.match(result.heuristic, /sql-work/);
});

test('a single projected-operation repair is certified and its actual SQL edit replays', async () => {
    const reference = parseGraphSql('SELECT value FROM item').root;
    const answer = parseGraphSql('SELECT value+1 FROM item').root;
    const graph = createEditGraph(reference, answer);
    const result = await shortestSqlEditPath(reference, answer, graph, context());
    assert.equal(result.distance, 1);
    assert.equal(result.search, 'exact-direct-bound-certificate');
    assert.equal(result.edits.length, 1);
    assert.equal(result.edits[0].name, 'removeExtraneousBinaryTerm');
    assert.equal(stableKey(replayOperation(answer, result.edits[0].operation)), stableKey(reference));
});

test('custom free symbol creation disables the missing-symbol heuristic', async () => {
    const edits = [edit('free', 0, [[0, 1], [1, 2]]), edit('back', 1, [[2, 0]])];
    assert.equal(heuristicCertificate(edits).enabled, false);
    const result = await shortestSqlEditPath(node(2), node(0), {edits}, context());
    assert.equal(result.distance, 0);
    assert.equal(result.search, 'exact-lazy-uniform-cost');
});

test('mathematical score cutoff has a lower-bound certificate and no invented exact trace', async () => {
    const edits = [edit('step', 1, [[0, 1], [1, 2], [2, 3]])];
    const result = await shortestSqlEditPath(node(3), node(0), {edits}, context(), {cutoff: 2});
    assert.equal(result.capped, true);
    assert.equal(result.distance, 2);
    assert.deepEqual(result.edits, []);
});

test('symbol heuristic uses presence only: copying does not introduce another fact', () => {
    const root = {kind: 'Script', attrs: {}, slots: {statements: [node(1), node(1)]}};
    assert.equal(symbolFacts(root).size, 1);
});

test('disjoint SQL work adds column and DISTINCT costs and respects every actual neighbour', () => {
    const reference = parseGraphSql('SELECT DISTINCT age FROM students').root;
    const answer = parseGraphSql('SELECT id FROM students').root;
    const graph = createEditGraph(reference, answer);
    const unit = heuristicCertificate(graph.edits).unit, bound = sqlWorkBound(reference, graph, unit);
    const target = symbolFacts(reference);
    const measure = root => {
        const have = symbolFacts(root);
        return bound.measure(root, [...target].filter(value => !have.has(value)).length * unit);
    };
    assert.equal(measure(answer), 3);
    assert.equal(measure(reference), 0);
    for (const edit of graph.edits) for (const next of edit.apply(answer)) {
        assert.ok(measure(answer) <= edit.cost + measure(next.root), edit.name);
        assert.ok(measure(answer) - measure(next.root) <= bound.decrease(edit), edit.name);
    }
});

test('SQL work does not double-charge overlapping custom edit effects', () => {
    const answer = {kind: 'Select', attrs: {}, slots: {columns: [node(1)]}};
    const reference = {kind: 'Select', attrs: {distinct: true}, slots: {columns: [node(2)]}};
    const graph = {edits: [{cost: 1, maxNewSymbols: 1, maxNewDistinct: 1, statementOperation: null}]};
    const bound = sqlWorkBound(reference, graph, 1);
    assert.equal(bound.measure(answer, 1), 1);
});
