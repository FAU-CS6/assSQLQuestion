import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {registerInnerJoinCommutation, INNER_JOIN_COMMUTATION_STEP} from '../../lib/qss/src/inner-join-commutation.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';

const sql = 'CREATE TABLE a(id INTEGER,name TEXT COLLATE NOCASE);CREATE TABLE b(link INTEGER,label TEXT);';
const schema = {tables: [{name: 'a', type: 'table', columns: [{name: 'id'}, {name: 'name'}]},
    {name: 'b', type: 'table', columns: [{name: 'link'}, {name: 'label'}]}]};
const ast = text => parseGraphSql(text).root;
const aSql = 'SELECT a.name,b.label FROM a INNER JOIN b ON a.id=b.link WHERE b.link>0';
const bSql = 'SELECT a.name,b.label FROM b INNER JOIN a ON a.id=b.link WHERE b.link>0';
function graphFor(to, from, cost = 0, options = {}) {
    const settings = {schemaSql: sql, ...options}; let graph = createEditGraph(to, from, schema, {}, settings);
    if (graph.edits.some(edit => edit.name === INNER_JOIN_COMMUTATION_STEP.id)) return createEditGraph(to, from, schema, {[INNER_JOIN_COMMUTATION_STEP.id]: cost}, settings);
    registerInnerJoinCommutation((name, description, defaultCost, generate, annotations) => graph.edits.push({name, description, cost,
        maxNewPredicates: 0, maxNewSources: 0, maxNewRelations: 0, maxNewDistinct: 0, introducedComponent: null, componentWorkBounded: true,
        statementOperation: null, statementKind: null, ...annotations, *apply(root) {
            for (const change of generate(root)) {
                const operation = {type: 'sql-edit', name, cost, path: change.path, before: root.slots.statements[0], after: change.after};
                const next = replayOperation(root, operation); if (graph.bounded(next)) yield {root: next, operation};
            }
        }}), schema, settings);
    return graph;
}
const edit = graph => graph.edits.find(edit => edit.name === INNER_JOIN_COMMUTATION_STEP.id);
function oracle(a, b) {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(sql + "INSERT INTO a VALUES(1,'Alpha'),(1,'ALPHA'),(2,NULL),(NULL,'Null-key'),(9,'missing');INSERT INTO b VALUES(1,'alpha'),(1,NULL),(2,'two'),(NULL,'null-key');");
        const rows = text => db.prepare(text).all().map(JSON.stringify).sort();
        return [rows(a), rows(b)];
    } finally { db.close(); }
}

test('two-source inner-join commutation preserves bag multiplicity NULL and comparison operand collation', () => {
    for (const [a, b] of [[aSql, bSql], [aSql.replace('SELECT ', 'SELECT DISTINCT '), bSql.replace('SELECT ', 'SELECT DISTINCT ')],
        ['SELECT a.name,b.label FROM a JOIN b ON a.name=b.label', 'SELECT a.name,b.label FROM b JOIN a ON a.name=b.label']]) {
        assert.deepEqual(...oracle(a, b)); const from = ast(a), to = ast(b), graph = graphFor(to, from);
        const edge = [...edit(graph).apply(from)].find(edge => stableKey(edge.root) === stableKey(to));
        assert.ok(edge); assert.equal(edge.operation.cost, 0);
        assert.equal(edge.operation.after.slots.from[1].slots.on, edge.operation.before.slots.from[1].slots.on);
        assert.equal(stableKey(replayOperation(from, edge.operation)), stableKey(to));
        assert.equal(stableKey([...edit(graph).apply(edge.root)][0].root), stableKey(from));
        for (const facts of [graph.symbolFacts, graph.predicateFacts]) assert.deepEqual(
            [...facts(graph.abstractRoot(from))].sort(), [...facts(graph.abstractRoot(to))].sort());
    }
    assert.notDeepEqual(...oracle('SELECT a.name,b.label FROM a JOIN b ON a.name=b.label',
        'SELECT a.name,b.label FROM b JOIN a ON b.label=a.name')); // NOCASE left versus BINARY left
});

test('commutation guards protect wildcard headers outer joins nondeterministic aggregation limits and scopes', () => {
    for (const text of [aSql.replace('a.name,b.label', '*'), aSql.replace('a.name,b.label', 'a.*'),
        aSql.replace('INNER JOIN', 'LEFT JOIN'), aSql.replace('INNER JOIN b ON a.id=b.link', 'NATURAL JOIN b'),
        aSql.replace('INNER JOIN b ON a.id=b.link', 'JOIN b USING(id)'),
        aSql.replace('a.name,b.label', 'GROUP_CONCAT(a.name)'), aSql.replace('a.name,b.label', 'a.name,MAX(b.link)'),
        aSql + ' GROUP BY a.id', aSql + ' ORDER BY a.id', aSql + ' LIMIT 1',
        aSql.replace('a.id=b.link', 'random()>0'), aSql.replace('b.link>0', 'random()>0'),
        aSql.replace('a.name,b.label', 'a.name,random()'), aSql.replace('b.link>0', 'unknown>0'),
        aSql.replace('a.name,b.label', 'a.name COLLATE BINARY,b.label'),
        aSql.replace('FROM a', 'FROM main.a'), aSql.replace('FROM a', 'FROM (SELECT * FROM a) a'),
        'WITH a AS (SELECT 1) ' + aSql, aSql + ' AND EXISTS(SELECT 1 FROM a)']) {
        const root = ast(text); assert.equal([...edit(graphFor(root, root)).apply(root)].length, 0, text);
    }
    const root = ast(aSql);
    for (const options of [{outputColumnNamesObserved: true}, {ambiguousSchemaNamespaces: true}, {freeLabels: ['name']},
        {schemaSql: sql + 'CREATE VIRTUAL TABLE v USING fts4(x);'}]) assert.equal([...edit(graphFor(root, root, 0, options)).apply(root)].length, 0);
    assert.notDeepEqual(...oracle('SELECT a.name,b.label FROM a LEFT JOIN b ON a.id=b.link', 'SELECT a.name,b.label FROM b LEFT JOIN a ON a.id=b.link'));
    // SQLite * column order is changed by source permutation even though the
    // explicit projection above preserves it. Inspect object-key order here.
    const db = new DatabaseSync(':memory:'); try {
        db.exec(sql + "INSERT INTO a VALUES(1,'x');INSERT INTO b VALUES(1,'y');");
        assert.notEqual(JSON.stringify(db.prepare('SELECT * FROM a JOIN b ON a.id=b.link').get()),
            JSON.stringify(db.prepare('SELECT * FROM b JOIN a ON a.id=b.link').get()));
    } finally { db.close(); }
});

test('commuting sources has exactly its configured zero one seven directed cost and replay', async () => {
    const from = ast(aSql), to = ast(bSql);
    for (const cost of [0, 1, 7]) {
        const full = graphFor(to, from, cost), graph = {...full, edits: [edit(full)]};
        for (const [start, finish] of [[from, to], [to, from]]) {
            const result = await shortestSqlEditPath(finish, start, graph, {async tick() {}}, {cutoff: cost + 1});
            // Independent Dijkstra on the proved two-node involution has one
            // edge of this cost (zero cycles cannot yield a negative distance).
            assert.equal(result.distance, cost); assert.equal(result.capped, false);
            let actual = start; for (const edge of result.edits) actual = replayOperation(actual, edge.operation);
            assert.equal(stableKey(actual), stableKey(finish));
        }
    }
});
