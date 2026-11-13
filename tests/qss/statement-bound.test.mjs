import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {createStatementBound} from '../../lib/qss/src/statement-bound.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';

const parse = sql => parseGraphSql(sql).root;
const context = () => ({async tick() {}});

test('separate repeated DML mistakes need separate paid edits and attain their lower bound', async () => {
    const make = op => ['a', 'b', 'c', 'd'].map(table => `DELETE FROM ${table} WHERE amount${op}8`).join(';');
    const target = parse(make('>')), source = parse(make('>=')), graph = createEditGraph(target, source);
    const bound = createStatementBound(target, graph);
    assert.equal(bound.measure(source), 4);
    const result = await shortestSqlEditPath(target, source, graph, context(), {cutoff: 5});
    assert.equal(result.distance, 4); assert.equal(result.capped, false);
    assert.equal(result.visited, 0);
    let replay = source;
    for (const edge of result.edits) replay = replayOperation(replay, edge.operation);
    assert.equal(stableKey(replay), stableKey(target));
    for (const edit of graph.edits) for (const edge of edit.apply(source)) {
        assert.ok(bound.measure(source) <= edit.cost + bound.measure(edge.root), edit.name);
        assert.ok(bound.measure(source) - bound.measure(edge.root) <= bound.decrease(edit), edit.name);
    }
});

test('statement alignment accounts for cheap insertions and custom free local repairs', () => {
    const target = parse('DELETE FROM a WHERE x>1; DELETE FROM b WHERE x>1; DELETE FROM c WHERE x>1');
    const source = parse('DELETE FROM a WHERE x>=1; DELETE FROM b WHERE x>=1; DELETE FROM c WHERE x>=1');
    for (const costs of [{baseChangeComponent: 0}, {baseAddStructural: 1, baseRemoveStructural: 1},
        {baseAddStructural: 0}, {baseRemoveStructural: 0}]) {
        const graph = createEditGraph(target, source, {}, costs), bound = createStatementBound(target, graph);
        assert.equal(bound.measure(target), 0);
        if (costs.baseChangeComponent === 0) assert.equal(bound.measure(source), 0);
        for (const edit of graph.edits) for (const edge of edit.apply(source)) {
            assert.ok(bound.measure(source) <= edit.cost + bound.measure(edge.root), edit.name);
            assert.ok(bound.measure(source) - bound.measure(edge.root) <= bound.decrease(edit), edit.name);
        }
    }
    assert.equal(createStatementBound(target, {edits: []}).measure(source), 0);
});

test('reordered statements retain their independently priced data sources', async () => {
    const target = parse('DELETE FROM a WHERE x>1; DELETE FROM b WHERE x>1; DELETE FROM c WHERE x>1');
    const source = parse('DELETE FROM c WHERE x>=1; DELETE FROM b WHERE x>=1; DELETE FROM a WHERE x>=1');
    const graph = createEditGraph(target, source), bound = createStatementBound(target, graph);
    assert.ok(bound.measure(source) >= 5);
    const result = await shortestSqlEditPath(target, source, graph, context(), {cutoff: 5});
    assert.equal(result.capped, true); assert.equal(result.visited, 0);
    for (const edit of graph.edits) for (const edge of edit.apply(source)) {
        assert.ok(bound.measure(source) <= edit.cost + bound.measure(edge.root), edit.name);
        assert.ok(bound.measure(source) - bound.measure(edge.root) <= bound.decrease(edit), edit.name);
    }
});

test('UPDATE assignment and WHERE mistakes require independent local edits', async () => {
    const target = parse('UPDATE t SET amount=4 WHERE id=(SELECT id FROM u WHERE name=\'Ada\')');
    const source = parse('UPDATE t SET amount=5 WHERE id IN (SELECT id FROM u WHERE name=\'Ada\')');
    const graph = createEditGraph(target, source), bound = createStatementBound(target, graph);
    assert.equal(bound.measure(source), 2);
    const result = await shortestSqlEditPath(target, source, graph, context(), {cutoff: 5});
    assert.equal(result.distance, 2); assert.equal(result.visited, 0);
    for (const edit of graph.edits) for (const edge of edit.apply(source)) {
        assert.ok(bound.measure(source) <= edit.cost + bound.measure(edge.root), edit.name);
        assert.ok(bound.measure(source) - bound.measure(edge.root) <= bound.decrease(edit), edit.name);
    }
});

test('root DISTINCT removal and a changed WHERE comparison have disjoint edit prices', async () => {
    const target = parse('SELECT a FROM t WHERE a<8'), source = parse('SELECT DISTINCT a FROM t WHERE a<=8');
    const graph = createEditGraph(target, source), bound = createStatementBound(target, graph);
    assert.equal(bound.measure(source), 3);
    const result = await shortestSqlEditPath(target, source, graph, context(), {cutoff: 5});
    assert.equal(result.distance, 3); assert.equal(result.visited, 0);
    for (const edit of graph.edits) for (const edge of edit.apply(source)) {
        assert.ok(bound.measure(source) <= edit.cost + bound.measure(edge.root), edit.name);
        assert.ok(bound.measure(source) - bound.measure(edge.root) <= bound.decrease(edit), edit.name);
    }
    const custom = createEditGraph(target, source, {}, {baseChangeDistinct: 0});
    assert.equal(createStatementBound(target, custom).measure(source), 1);
});

test('unrelated projection labels filter values and DISTINCT retain their separate prices', async () => {
    const target = parse('SELECT t.code FROM t JOIN u ON t.id=u.id WHERE u.n<8');
    const source = parse('SELECT DISTINCT t.code AS CODE FROM t JOIN u ON t.id=u.id WHERE u.n<=8');
    const schema = {tables: [{name: 't', type: 'table', columns: [{name: 'id'}, {name: 'code'}]},
        {name: 'u', type: 'table', columns: [{name: 'id'}, {name: 'n'}]}]};
    const graph = createEditGraph(target, source, schema, {}, {schemaSql: 'CREATE TABLE t(id,code);CREATE TABLE u(id,n)'});
    const bound = createStatementBound(target, graph);
    assert.equal(graph.independentProjectionLabels, true);
    assert.equal(bound.measure(source), 4);
    const result = await shortestSqlEditPath(target, source, graph, context(), {cutoff: 5});
    assert.equal(result.distance, 4); assert.equal(result.visited, 0);
    for (const root of [source, target]) for (const edit of graph.edits) for (const edge of edit.apply(root)) {
        assert.ok(bound.measure(root) <= edit.cost + bound.measure(edge.root), edit.name);
        assert.ok(bound.measure(root) - bound.measure(edge.root) <= bound.decrease(edit), edit.name);
    }
    const bindingSource = parse('SELECT code AS label FROM t WHERE code=\'label\'');
    assert.equal(createEditGraph(target, bindingSource, schema).independentProjectionLabels, false);
    for (const costs of [{baseChangeComponent: 0}, {baseRemoveStructural: 1}, {baseAddStructural: 1}]) {
        const custom = createEditGraph(target, source, schema, costs), customBound = createStatementBound(target, custom);
        for (const edit of custom.edits) for (const edge of edit.apply(source))
            assert.ok(customBound.measure(source) <= edit.cost + customBound.measure(edge.root), edit.name);
    }
});

test('priced comparison complementation is visible while every free edge preserves its fact view', () => {
    const target = parse('SELECT value FROM sample WHERE id>1 ORDER BY id');
    const source = parse('SELECT value FROM sample WHERE NOT(id<=1) ORDER BY id');
    const graph = createEditGraph(target, source, {}, {negateComplementaryComparison: 2});
    const facts = root => graph.predicateFacts(graph.abstractRoot(root));
    assert.notDeepEqual(facts(target), facts(source));
    for (const root of [source, target, parse('SELECT value FROM sample WHERE NOT(id<=1 AND value>0)')]) {
        for (const edit of graph.edits.filter(edit => edit.cost === 0)) for (const edge of edit.apply(root)) {
            assert.deepEqual(facts(root), facts(edge.root), edit.name);
        }
    }
    assert.equal(createStatementBound(target, graph).measure(source), 1);
});
