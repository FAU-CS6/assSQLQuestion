import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';

const ast = sql => parseGraphSql(sql).root;
const source = ast('SELECT * FROM buch');
const target = ast('SELECT titel FROM buch WHERE jahr >= 2020 ORDER BY titel');
const context = () => ({visited: 0, async tick() {}});
const certificate = 'exact-select-clause-certificate';

test('missing projection, numeric filter and sort have a replayable shortest path without expanding the frontier', async () => {
    for (const [from, to, cost] of [
        [source, target, 4],
        [ast('SELECT titel FROM buch'), target, 3],
        [ast('SELECT titel FROM buch ORDER BY titel'), target, 2],
        [ast('SELECT code FROM inventory'), ast('SELECT price FROM inventory WHERE 40 < qty ORDER BY price DESC'), 4]
    ]) {
        const graph = createEditGraph(to, from);
        const result = await shortestSqlEditPath(to, from, graph, context());
        assert.equal(result.search, certificate);
        assert.equal(result.visited, 0);
        assert.equal(result.distance, cost);
        assert.equal(result.edits.reduce((sum, e) => sum + e.cost, 0), cost);
        assert.equal(stableKey(result.edits.reduce((n, e) => replayOperation(n, e.operation), from)), stableKey(to));
        const capped = await shortestSqlEditPath(to, from, graph, context(), {cutoff: cost});
        assert.equal(capped.capped, true);
        assert.equal(capped.edits.length, 0);
    }
});

test('one-clause proof agrees with uniform-cost search including the cheaper-cutoff boundary', async () => {
    const from = ast('SELECT x FROM t'), to = ast('SELECT x FROM t WHERE y = 1');
    const graph = createEditGraph(to, from);
    for (const cutoff of [1, 2, 3]) {
        const actual = await shortestSqlEditPath(to, from, graph, context(), {cutoff});
        const oracle = await shortestSqlEditPath(to, from, graph, context(), {cutoff, useHeuristic: false});
        assert.equal(actual.capped, oracle.capped);
        assert.equal(actual.distance, oracle.distance);
    }
});

test('custom discounts, unknown shortcuts, and broader SQL shapes cannot inherit the default four-step proof', async () => {
    for (const overrides of [{baseAddStructural: 1}, {restoreMissingBinaryTerm: 0}, {restoreMissingOrderByColumn: 3}]) {
        const graph = createEditGraph(target, source, {}, overrides);
        assert.equal(await graph.simpleSelectRepair.witness(graph.edits, context()), null);
    }
    const graph = createEditGraph(target, source);
    const extra = {name: 'other-shortcut', cost: 1};
    assert.equal(await graph.simpleSelectRepair.witness([...graph.edits, extra], context()), null);
    for (const sql of ['SELECT DISTINCT titel FROM buch WHERE jahr >= 2020',
        'SELECT titel AS x FROM buch WHERE jahr >= 2020', 'SELECT titel FROM buch WHERE jahr IS NULL',
        'SELECT titel FROM buch JOIN other ON buch.id=other.id WHERE jahr >= 2020']) {
        assert.equal(createEditGraph(ast(sql), source).simpleSelectRepair, null);
    }
});
