import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {createUnqualifiedColumnFactView} from '../../lib/qss/src/single-table-equivalences.mjs';

const schema = {tables: [{name: 'sample', type: 'table', columns: [{name: 'x'}, {name: 'y'}, {name: 'label'}]}]};
const ast = sql => parseGraphSql(sql, {schema}).root;
const edit = (graph, name) => graph.edits.find(e => e.name === name);
const find = (graph, name, from, to) => [...edit(graph, name).apply(from)].find(e => stableKey(e.root) === stableKey(to));
const context = () => ({visited: 0, async tick() {}});
const sorted = values => [...values].sort();
function oracle(a, b, setup = '') {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec("CREATE TABLE sample(x,y,label); INSERT INTO sample VALUES(1,9,'A'),(2,4,'b'),(NULL,3,NULL);" + setup);
        return [db.prepare(a).all(), db.prepare(b).all()];
    } finally { db.close(); }
}

test('single-table qualifiers are reversible concrete edges for columns and WHERE', () => {
    for (const [a, b] of [
        ['SELECT x FROM sample', 'SELECT sample.x FROM sample'],
        ['SELECT x FROM sample AS s', 'SELECT s.x FROM sample AS s'],
        ['SELECT x FROM sample WHERE y>3', 'SELECT x FROM sample WHERE sample.y>3'],
        ['SELECT x+1 AS answer FROM sample', 'SELECT sample.x+1 AS answer FROM sample'],
        ['SELECT x FROM sample WHERE y COLLATE BINARY>3', 'SELECT x FROM sample WHERE sample.y COLLATE BINARY>3']
    ]) {
        const from = ast(a), to = ast(b), graph = createEditGraph(to, from, schema), before = stableKey(from);
        for (const [start, finish] of [[from, to], [to, from]]) {
            const edge = find(graph, 'qualifySingleTableColumn', start, finish); assert.ok(edge, a + ' / ' + b);
            assert.equal(edge.operation.cost, 0); assert.equal(stableKey(replayOperation(start, edge.operation)), stableKey(finish));
        }
        assert.equal(stableKey(from), before); assert.notEqual(stableKey(from), stableKey(to));
        const [x, y] = oracle(a, b); assert.deepEqual(x, y);
    }
});

test('qualifier guards withhold ambiguous sources scopes names and implicit expression headers', () => {
    for (const sql of [
        'SELECT x FROM sample s JOIN sample t ON s.x=t.x',
        'SELECT x FROM (SELECT x FROM sample) s',
        'WITH s AS (SELECT x FROM sample) SELECT x FROM s',
        'SELECT x FROM sample WHERE EXISTS(SELECT x FROM sample)',
        'SELECT x FROM main.sample',
        'SELECT absent FROM sample',
        'SELECT wrong.x FROM sample',
        'SELECT sample.x FROM sample AS s',
        'SELECT x+1 FROM sample',
        'SELECT x COLLATE NOCASE FROM sample'
    ]) {
        const from = ast(sql), graph = createEditGraph(from, from, schema);
        assert.equal([...edit(graph, 'qualifySingleTableColumn').apply(from)].length, 0, sql);
    }
    const source = ast('SELECT x FROM sample');
    for (const unknown of [{}, {tables: []}, {tables: [{name: 'sample', type: 'view', columns: [{name: 'x'}]}]}]) {
        const graph = createEditGraph(source, source, unknown);
        assert.equal([...edit(graph, 'qualifySingleTableColumn').apply(source)].length, 0);
    }
});

test('ORDER BY alias capture and unaliased expression result headers remain observable', () => {
    const [aliasOrder, baseOrder] = oracle('SELECT y AS x FROM sample ORDER BY x', 'SELECT y AS x FROM sample ORDER BY sample.x');
    assert.notDeepEqual(aliasOrder, baseOrder);
    const from = ast('SELECT y AS x FROM sample ORDER BY x'), to = ast('SELECT y AS x FROM sample ORDER BY sample.x');
    assert.ok(!find(createEditGraph(to, from, schema), 'qualifySingleTableColumn', from, to));
    for (const [a, b] of [['SELECT x+1 FROM sample', 'SELECT sample.x+1 FROM sample'],
        ['SELECT x COLLATE NOCASE FROM sample', 'SELECT sample.x COLLATE NOCASE FROM sample']]) {
        const [x, y] = oracle(a, b); assert.notDeepEqual(x, y, 'Headers are part of the observed relation.');
    }
});

test('redundant projection AS uses the actual schema spelling and does not canonicalize keys', () => {
    for (const [a, b] of [['SELECT x FROM sample', 'SELECT x AS x FROM sample'],
        ['SELECT s.x FROM sample AS s', 'SELECT s.x AS x FROM sample AS s']]) {
        const from = ast(a), to = ast(b), graph = createEditGraph(to, from, schema);
        assert.notEqual(stableKey(from), stableKey(to));
        assert.ok(find(graph, 'toggleRedundantProjectionAlias', from, to));
        assert.ok(find(graph, 'toggleRedundantProjectionAlias', to, from));
        assert.deepEqual(...oracle(a, b));
    }
    for (const sql of ['SELECT x AS other FROM sample', 'SELECT x AS X FROM sample', 'SELECT x+1 AS x FROM sample', 'SELECT x COLLATE NOCASE AS x FROM sample']) {
        const root = ast(sql), graph = createEditGraph(root, root, schema);
        assert.equal([...edit(graph, 'toggleRedundantProjectionAlias').apply(root)].length, 0, sql);
    }
    assert.notDeepEqual(...oracle('SELECT x FROM sample', 'SELECT x AS X FROM sample'));
});

test('output naming flags and free-label contexts withhold the affected new edges', () => {
    const from = ast('SELECT x FROM sample'), to = ast('SELECT sample.x AS x FROM sample');
    const graph = createEditGraph(to, from, schema, {}, {outputColumnNamesObserved: true});
    for (const name of ['qualifySingleTableColumn', 'toggleRedundantProjectionAlias']) assert.equal([...edit(graph, name).apply(from)].length, 0);
    const labels = createEditGraph(to, from, schema, {}, {freeLabels: ['x']});
    assert.equal([...edit(labels, 'toggleRedundantProjectionAlias').apply(from)].length, 0);
    assert.notDeepEqual(...oracle('SELECT x FROM sample', 'SELECT sample.x FROM sample', 'PRAGMA short_column_names=OFF; PRAGMA full_column_names=OFF;'));
    assert.notDeepEqual(...oracle('SELECT x FROM sample', 'SELECT x AS x FROM sample', 'PRAGMA short_column_names=OFF; PRAGMA full_column_names=ON;'));
});

test('a redundant-looking projection AS cannot capture another output alias in ORDER BY', () => {
    const a = 'SELECT x,y AS x FROM sample ORDER BY x', b = 'SELECT x AS x,y AS x FROM sample ORDER BY x';
    assert.notDeepEqual(...oracle(a, b));
    const from = ast(a), to = ast(b), graph = createEditGraph(to, from, schema);
    assert.ok(!find(graph, 'toggleRedundantProjectionAlias', from, to));
    assert.ok(!find(graph, 'toggleRedundantProjectionAlias', to, from));
});

test('new free edges preserve both abstract fact sets while arbitrary qualifiers remain in concrete ASTs', () => {
    const pairs = [
        ['SELECT x FROM sample WHERE y>1', 'SELECT sample.x FROM sample WHERE sample.y>1'],
        ['SELECT x AS x FROM sample WHERE y>1', 'SELECT x FROM sample WHERE sample.y>1']
    ];
    for (const [a, b] of pairs) {
        const from = ast(a), to = ast(b), graph = createEditGraph(to, from, schema);
        for (const root of [from, to]) for (const name of ['qualifySingleTableColumn', 'toggleRedundantProjectionAlias', 'renameBoundTableAlias']) {
            for (const edge of edit(graph, name).apply(root)) for (const facts of [symbolFacts, predicateFacts]) {
                assert.deepEqual(sorted(facts(graph.abstractRoot(root))), sorted(facts(graph.abstractRoot(edge.root))), name);
            }
        }
    }
    const from = ast('SELECT nonexistent.x FROM sample'), to = ast('SELECT x FROM sample'), view = createUnqualifiedColumnFactView();
    assert.notEqual(stableKey(from), stableKey(to));
    assert.equal(stableKey(view(from)), stableKey(view(to)), 'The fact view is deliberately coarser even for invalid qualifiers.');
    assert.notEqual(stableKey(from), stableKey(view(from)), 'Concrete input is untouched.');
});

test('qualification and redundant aliases are configurable steps with exact replayable paths', async () => {
    for (const [a, b, name] of [['SELECT x FROM sample', 'SELECT sample.x FROM sample', 'qualifySingleTableColumn'],
        ['SELECT x FROM sample', 'SELECT x AS x FROM sample', 'toggleRedundantProjectionAlias']]) {
        const from = ast(a), to = ast(b);
        for (const cost of [0, 2, 7]) {
            const full = createEditGraph(to, from, schema, {[name]: cost}), graph = {...full, edits: [edit(full, name)]};
            const result = await shortestSqlEditPath(to, from, graph, context(), {cutoff: cost + 1});
            assert.equal(result.distance, cost); assert.equal(result.capped, false);
            let actual = from; for (const edge of result.edits) actual = replayOperation(actual, edge.operation);
            assert.equal(stableKey(actual), stableKey(to));
        }
    }
});

test('combined harmless variants plus one inequality error retain the one-edit lower bound', async () => {
    const from = ast('SELECT x AS x FROM sample WHERE x<2'), to = ast('SELECT x FROM sample WHERE sample.x<=2');
    const graph = createEditGraph(to, from, schema), result = await shortestSqlEditPath(to, from, graph, context(), {cutoff: 5});
    assert.equal(result.distance, 1); assert.equal(result.capped, false);
    let actual = from; for (const edge of result.edits) actual = replayOperation(actual, edge.operation);
    assert.equal(stableKey(actual), stableKey(to));
});
