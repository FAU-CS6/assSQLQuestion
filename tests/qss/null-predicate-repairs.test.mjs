import test from 'node:test';
import assert from 'node:assert/strict';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {shortestSqlEditPath, heuristicCertificate} from '../../lib/qss/src/graph-search.mjs';
import {symbolFacts} from '../../lib/qss/src/graph-features.mjs';
import {registerNullPredicateRepair} from '../../lib/qss/src/null-predicate-repairs.mjs';
const schema = {tables: [{name: 't', type: 'table', columns: [{name: 'x'}, {name: 'y'}]}]};
const ast = sql => parseGraphSql(sql, {schema}).root;
const context = () => ({visited: 0, async tick() {}});

test('a missing null filter has a concrete paid repair and exact replay', async () => {
    for (const [reference, answer] of [
        ['SELECT x,COUNT(*) AS n FROM t WHERE x IS NOT NULL GROUP BY x', 'SELECT x,COUNT(*) AS n FROM t GROUP BY x'],
        ['SELECT x FROM t WHERE x IS NULL', 'SELECT x FROM t'],
        ['DELETE FROM t WHERE x IS NULL', 'DELETE FROM t'],
        ['UPDATE t SET y=1 WHERE x IS NOT NULL', 'UPDATE t SET y=1']
    ]) {
        const r = ast(reference), a = ast(answer), graph = createEditGraph(r, a, schema);
        const result = await shortestSqlEditPath(r, a, graph, context());
        assert.equal(result.distance, 1);
        assert.ok(result.edits.some(e => e.name === 'restoreMissingNullPredicate'));
        let replay = a;
        for (const edit of result.edits) replay = replayOperation(replay, edit.operation);
        assert.equal(stableKey(replay), stableKey(r));
    }
});

test('null-filter constructor domains apply at all compatible empty clauses', () => {
    const r = ast('SELECT x FROM t WHERE x IS NULL; SELECT y FROM t'), a = ast('SELECT x FROM t; SELECT y FROM t');
    const graph = createEditGraph(r, a, schema), edit = graph.edits.find(e => e.name === 'restoreMissingNullPredicate');
    const edges = [...edit.apply(a)];
    assert.equal(edges.length, 4); // WHERE and HAVING in both SELECT statements.
    const before = symbolFacts(graph.abstractRoot(a));
    for (const edge of edges) {
        const added = [...symbolFacts(graph.abstractRoot(edge.root))].filter(fact => !before.has(fact));
        assert.ok(added.length <= edit.maxNewSymbols);
    }
    const occupied = ast('SELECT x FROM t WHERE y=1');
    assert.ok([...edit.apply(occupied)].every(edge => edge.operation.path.at(-1) === 'having'));
});

test('free author pricing disables the symbol bound and query-containing predicates are excluded', async () => {
    const r = ast('SELECT x FROM t WHERE x IS NULL'), a = ast('SELECT x FROM t');
    const graph = createEditGraph(r, a, schema, {restoreMissingNullPredicate: 0});
    assert.equal(heuristicCertificate(graph.edits).enabled, false);
    assert.equal((await shortestSqlEditPath(r, a, graph, context())).distance, 0);
    const complex = ast('SELECT x FROM t WHERE (SELECT MAX(y) FROM t) IS NULL');
    assert.ok(!createEditGraph(complex, a, schema).edits.some(e => e.name === 'restoreMissingNullPredicate'));
});

test('null filters on free group labels conservatively count exposed label symbols', async () => {
    const projection = "SELECT CASE WHEN x>0 THEN 'positive' WHEN NOT(x>0) THEN 'negative' ELSE NULL END AS label FROM t";
    const a = ast(projection + ' GROUP BY label'), requirements = {freeLabels: ['label']};
    for (const clause of ['WHERE', 'HAVING']) {
        const r = ast(projection + (clause === 'WHERE' ? ' WHERE label IS NOT NULL GROUP BY label' : ' GROUP BY label HAVING label IS NOT NULL'));
        for (const cost of [0, 1, 7]) {
            const full = createEditGraph(r, a, schema, {restoreMissingNullPredicate: cost}, requirements);
            const edit = full.edits.find(e => e.name === 'restoreMissingNullPredicate');
            const edge = [...edit.apply(a)].find(e => stableKey(e.root) === stableKey(r)); assert.ok(edge);
            const before = symbolFacts(full.abstractRoot(a));
            const added = [...symbolFacts(full.abstractRoot(edge.root))].filter(fact => !before.has(fact));
            assert.ok(added.length > 1, 'Filtering exposes old labels as well as the new predicate column.');
            assert.equal(edit.maxNewSymbols, full.limits.maxNodes);
            assert.ok(added.length <= edit.maxNewSymbols);
            // This one-edge subgraph has independent shortest distance equal
            // to its edge cost. A unit-effect annotation would overestimate it.
            const graph = {...full, edits: [edit]};
            const result = await shortestSqlEditPath(r, a, graph, context(), {cutoff: cost + 1});
            assert.equal(result.distance, cost); assert.equal(result.capped, false);
            assert.equal(stableKey(replayOperation(a, result.edits[0].operation)), stableKey(r));
        }
        let annotations;
        registerNullPredicateRepair((name, description, cost, generate, declared) => { annotations = declared; }, r, a, stableKey, requirements);
        assert.equal(heuristicCertificate([{cost: 1, ...annotations}]).enabled, false);
    }
});
