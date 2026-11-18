import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';
import {createStatementBound} from '../../lib/qss/src/statement-bound.mjs';

const schemaSql = 'CREATE TABLE t(id INTEGER PRIMARY KEY,code TEXT,n INTEGER);CREATE TABLE u(id INTEGER PRIMARY KEY,n INTEGER);';
const schema = {tables: [{name: 't', type: 'table', columns: [{name: 'id', type: 'INTEGER', pk: 1}, {name: 'code', type: 'TEXT', pk: 0}, {name: 'n', type: 'INTEGER', pk: 0}]},
    {name: 'u', type: 'table', columns: [{name: 'id', type: 'INTEGER', pk: 1}, {name: 'n', type: 'INTEGER', pk: 0}]}]};
const parse = sql => parseGraphSql(sql, {schema}).root;

test('projection insertion that binds DQS changes both labels and filters but pays only one logical edit', () => {
    const source = parse('SELECT t.code FROM t WHERE "label">0');
    const target = parse('SELECT t.code,t.n AS label FROM t WHERE label>0');
    const graph = createEditGraph(target, source, schema, {}, {schemaSql});
    assert.equal(graph.independentProjectionLabels, false);
    const edge = [...graph.edits.find(edit => edit.name === 'insertProjectedExpression').apply(source)]
        .find(edge => stableKey(edge.root) === stableKey(target));
    assert.ok(edge); assert.equal(edge.operation.cost, 1);
    const bound = createStatementBound(target, graph);
    assert.ok(bound.measure(source) <= 1); assert.equal(bound.measure(target), 0);
    const numeric = createEditGraph(parse('SELECT code AS "2" FROM t WHERE code=2'),
        parse('SELECT code FROM t WHERE code=\'2\''), schema, {}, {schemaSql});
    assert.equal(numeric.independentProjectionLabels, false);
});

test('schema label spelling free joins unknown scopes and structural custom costs retain consistent statement bounds', () => {
    const pairs = [
        ['SELECT DISTINCT t.code AS CODE FROM t JOIN u ON t.id=u.id WHERE u.n<=8', 'SELECT t.code FROM t JOIN u ON t.id=u.id WHERE u.n<8'],
        ['SELECT code FROM t WHERE id IN (SELECT id FROM u WHERE n=2)', 'SELECT t.code FROM t JOIN u ON t.id=u.id WHERE u.n=2'],
        ['SELECT t.code AS code FROM t AS t JOIN u AS u ON t.id=u.id WHERE u.n=2', 'SELECT t.code FROM u JOIN t ON t.id=u.id WHERE u.n=2'],
        ['SELECT t.code AS CODE FROM t WHERE t.n<=8', 'SELECT t.code FROM t WHERE t.n<8'],
        ['SELECT code AS label FROM missing WHERE n<=8', 'SELECT code FROM missing WHERE n<8']
    ];
    for (const [a, b] of pairs) for (const costs of [{}, {baseAddStructural: 0}, {baseAddStructural: 1}, {baseAddStructural: 2},
        {baseRemoveStructural: 0}, {baseRemoveStructural: 1}, {baseRemoveStructural: 2}, {baseChangeStructural: 1}]) {
        const source = parse(a), target = parse(b), graph = createEditGraph(target, source, schema, costs, {schemaSql});
        const bound = createStatementBound(target, graph);
        assert.equal(bound.measure(target), 0);
        for (const root of [source, target]) for (const edit of graph.edits) for (const edge of edit.apply(root)) {
            const before = bound.measure(root), after = bound.measure(edge.root);
            assert.ok(before <= edit.cost + after, edit.name + ' ' + a + ' ' + JSON.stringify(costs));
            assert.ok(before - after <= bound.decrease(edit), edit.name + ' lazy ' + JSON.stringify(costs));
        }
    }
    const upper = {tables: [{name: 't', type: 'table', columns: [{name: 'Code', type: 'TEXT'}]}]};
    const from = parse('SELECT code FROM t'), to = parse('SELECT code AS Code FROM t');
    const graph = createEditGraph(to, from, upper, {}, {schemaSql: 'CREATE TABLE t(Code TEXT)'});
    assert.equal(graph.projectionLabels(from.slots.statements[0]), '["Code"]');
    assert.equal(graph.projectionLabels(to.slots.statements[0]), '["Code"]');
    assert.equal(createStatementBound(to, graph).measure(from), 0);
});
