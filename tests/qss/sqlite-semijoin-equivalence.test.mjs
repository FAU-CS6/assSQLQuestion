import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {registerSQLiteSemijoinEquivalence, SQLITE_SEMIJOIN_STEP} from '../../lib/qss/src/sqlite-semijoin-equivalence.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {ordinaryCatalog} from '../../lib/qss/src/sqlite-join-scope.mjs';
import {locations} from '../../lib/qss/src/sqlite-join-scope.mjs';

const schemaSql = 'CREATE TABLE parent(id INTEGER PRIMARY KEY,label TEXT);CREATE TABLE child(parent_id INTEGER,flag INTEGER,PRIMARY KEY(parent_id,flag));';
const fromSql = 'SELECT label FROM parent WHERE id IN (SELECT parent_id FROM child WHERE flag=2)';
const toSql = 'SELECT parent.label FROM parent INNER JOIN child ON parent.id=child.parent_id WHERE child.flag=2';
const seed = "INSERT INTO parent VALUES(1,'one'),(2,'two'),(3,NULL);INSERT INTO child VALUES(1,2),(1,3),(2,1),(NULL,2),(NULL,2),(9,2);";
function database(sql = schemaSql, data = seed) { const db = new DatabaseSync(':memory:'); db.exec(sql + data); return db; }
function schemaOf(sql = schemaSql) {
    const db = database(sql, '');
    try { return {tables: db.prepare("SELECT name,type FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()
        .map(table => ({...table, columns: db.prepare('PRAGMA table_info("' + table.name.replaceAll('"', '""') + '")').all()}))}; }
    finally { db.close(); }
}
const ast = sql => parseGraphSql(sql).root;
function graphFor(to, from, {sql = schemaSql, schema = schemaOf(sql), cost = 0, ...options} = {}) {
    const costs = {[SQLITE_SEMIJOIN_STEP.id]: cost}, settings = {schemaSql: sql, ...options};
    let graph = createEditGraph(to, from, schema, {}, settings);
    if (graph.edits.some(edit => edit.name === SQLITE_SEMIJOIN_STEP.id)) return createEditGraph(to, from, schema, costs, settings);
    registerSQLiteSemijoinEquivalence((name, description, defaultCost, generate, annotations) => {
        graph.edits.push({name, description, cost, maxNewPredicates: 0, maxNewDistinct: 0, maxNewSources: 0, maxNewRelations: 0,
            statementOperation: null, statementKind: null, introducedComponent: null, ...annotations,
            *apply(root) { for (const change of generate(root)) {
                const operation = {type: 'sql-edit', name, cost, path: change.path,
                    before: change.path.reduce((node, part) => node[part], root), after: change.after};
                const next = replayOperation(root, operation);
                if (graph.bounded(next) && graph.key(next) !== graph.key(root)) yield {root: next, operation};
            }}});
    }, schema, settings);
    return graph;
}
const rule = graph => graph.edits.find(edit => edit.name === SQLITE_SEMIJOIN_STEP.id);
const edges = (graph, root) => [...rule(graph).apply(root)];
const rows = (db, sql) => db.prepare(sql).all().map(row => JSON.stringify(row)).sort();

test('unique filtered composite keys admit replayable IN and inner-join edges including nullable key rows', () => {
    const from = ast(fromSql), to = ast(toSql), graph = graphFor(to, from), db = database();
    try { assert.deepEqual(rows(db, fromSql), rows(db, toSql)); } finally { db.close(); }
    for (const [start, finish] of [[from, to], [to, from]]) {
        const edge = edges(graph, start).find(edge => stableKey(edge.root) === stableKey(finish));
        assert.ok(edge); assert.equal(edge.operation.cost, 0);
        assert.equal(stableKey(replayOperation(start, edge.operation)), stableKey(finish));
    }
    assert.equal(rule(graph).componentWorkBounded, false);
    for (const start of [from, to]) for (const edit of graph.edits.filter(edit => edit.cost === 0)) {
        for (const edge of edit.apply(start)) {
            assert.deepEqual(graph.symbolFacts(graph.abstractRoot(start)), graph.symbolFacts(graph.abstractRoot(edge.root)), edit.name);
            assert.deepEqual(graph.predicateFacts(graph.abstractRoot(start)), graph.predicateFacts(graph.abstractRoot(edge.root)), edit.name);
        }
    }
});

test('declared UNIQUE single/composite keys and reversed constant predicates retain their actual restrictions', () => {
    for (const declaration of ['parent_id INTEGER UNIQUE,flag INTEGER', 'parent_id INTEGER,flag INTEGER,UNIQUE(parent_id,flag)']) {
        const sql = schemaSql.replace('parent_id INTEGER,flag INTEGER,PRIMARY KEY(parent_id,flag)', declaration);
        const from = ast(fromSql.replace('flag=2', '2=flag')), to = ast(toSql.replace('child.flag=2', '2=child.flag'));
        const graph = graphFor(to, from, {sql});
        assert.ok(edges(graph, from).some(edge => stableKey(edge.root) === stableKey(to)));
        assert.ok(ordinaryCatalog(schemaOf(sql), sql).get('child').keys.length);
    }
});

test('duplicate bags mixed affinities and collation equality classes are genuine counterexamples', () => {
    for (const [sql, data] of [
        ['CREATE TABLE parent(id INTEGER,label TEXT);CREATE TABLE child(parent_id INTEGER,flag INTEGER);', "INSERT INTO parent VALUES(1,'one');INSERT INTO child VALUES(1,2),(1,2);"],
        ['CREATE TABLE parent(id INTEGER,label TEXT);CREATE TABLE child(parent_id TEXT UNIQUE,flag INTEGER);', "INSERT INTO parent VALUES(1,'one');INSERT INTO child VALUES('1',2),('01',2);"],
        ['CREATE TABLE parent(id TEXT COLLATE NOCASE,label TEXT);CREATE TABLE child(parent_id TEXT UNIQUE,flag INTEGER);', "INSERT INTO parent VALUES('a','one');INSERT INTO child VALUES('a',2),('A',2);"]
    ]) {
        const db = database(sql, data); try { assert.notDeepEqual(rows(db, fromSql), rows(db, toSql)); } finally { db.close(); }
        const from = ast(fromSql), to = ast(toSql), graph = graphFor(to, from, {sql});
        assert.equal(edges(graph, from).length, 0); assert.equal(edges(graph, to).length, 0);
    }
});

test('qualified temp-view shadowing cannot borrow main-table BINARY provenance', () => {
    const sql = 'CREATE TABLE parent(id TEXT,label TEXT);CREATE TABLE child(parent_id TEXT PRIMARY KEY,flag INTEGER);'
        + 'CREATE TABLE other(id TEXT COLLATE NOCASE,label TEXT);CREATE VIEW temp.parent AS SELECT id,label FROM other;';
    const db = database(sql, "INSERT INTO other VALUES('a','one');INSERT INTO child VALUES('a',2),('A',2);");
    try { assert.notDeepEqual(rows(db, fromSql), rows(db, toSql)); } finally { db.close(); }
    // Match the actual browser schema collector: sqlite_master supplies the
    // main table kind, while unqualified table_info resolves the TEMP view.
    const schema = schemaOf(sql); assert.equal(schema.tables.find(table => table.name === 'parent').type, 'table');
    const from = ast(fromSql), to = ast(toSql), graph = graphFor(to, from, {sql, schema});
    assert.equal(edges(graph, from).length, 0); assert.equal(edges(graph, to).length, 0);
});

test('semijoin excludes nullable fixed keys nonlocal filters aggregation ordering aliases and unsafe namespaces', () => {
    const blocked = [
        fromSql.replace('flag=2', 'flag IS NULL'), fromSql.replace('flag=2', 'flag>1'),
        fromSql.replace('flag=2', 'flag=2 OR flag=3'), fromSql.replace('flag=2', 'flag=parent.id'),
        fromSql.replace('flag=2', 'flag=random()'), fromSql.replace('SELECT parent_id', 'SELECT DISTINCT parent_id'),
        fromSql.replace('SELECT parent_id', 'SELECT MAX(parent_id)'), fromSql.replace('flag=2)', 'flag=2 LIMIT 1)'),
        fromSql.replace('flag=2)', 'flag=2 ORDER BY parent_id)'), fromSql.replace('flag=2)', 'flag=2 GROUP BY parent_id)'),
        fromSql.replace('SELECT label', 'SELECT DISTINCT label'), fromSql.replace('SELECT label', 'SELECT random()'),
        fromSql + ' ORDER BY label', fromSql.replace(' IN ', ' NOT IN '),
        fromSql.replace('SELECT parent_id FROM child', 'SELECT parent_id AS changed FROM child'),
        fromSql.replace('FROM child', 'FROM main.child'), toSql.replace('INNER JOIN', 'LEFT JOIN'),
        toSql.replace('INNER JOIN child ON parent.id=child.parent_id', 'NATURAL JOIN child'),
        'WITH q AS (SELECT 1) ' + fromSql,
        fromSql.replace('SELECT parent_id FROM child', 'SELECT parent_id FROM (SELECT * FROM child) c'),
        toSql.replace('parent.label', 'child.flag'), toSql.replace('parent.label', 'parent.*')
    ];
    for (const sql of blocked) { const root = ast(sql); assert.equal(edges(graphFor(root, root), root).length, 0, sql); }
    const from = ast(fromSql), to = ast(toSql);
    for (const options of [{outputColumnNamesObserved: true}, {ambiguousSchemaNamespaces: true}, {freeLabels: ['label']},
        {sql: schemaSql + 'ALTER TABLE parent ADD extra TEXT COLLATE NOCASE;'},
        {sql: schemaSql + 'CREATE VIRTUAL TABLE hidden USING fts4(content);'},
        {sql: schemaSql + 'CREATE TEMP TABLE shadow(x);'}, {sql: schemaSql + "ATTACH ':memory:' AS other;"}]) {
        const graph = graphFor(to, from, options); assert.equal(edges(graph, from).length, 0);
    }
});

test('integrated semijoin facts and source relation distinct counts are invariant for every concrete edge', () => {
    const from = ast(fromSql), to = ast(toSql), graph = graphFor(to, from);
    assert.ok(graph.symbolFacts && graph.predicateFacts, 'central semijoin fact relaxation is required');
    for (const root of [from, to]) for (const edge of edges(graph, root)) {
        for (const facts of [graph.symbolFacts, graph.predicateFacts]) assert.deepEqual(
            [...facts(graph.abstractRoot(root))].sort(), [...facts(graph.abstractRoot(edge.root))].sort());
        const counts = value => [...locations(value)].reduce((out, {node}) => {
            if (node.kind === 'TableSource') { out.sources++; out.relations.push(node.attrs.table); }
            if (node.attrs.distinct) out.distinct++;
            return out;
        }, {sources: 0, distinct: 0, relations: []});
        const a = counts(root), b = counts(edge.root); a.relations.sort(); b.relations.sort(); assert.deepEqual(a, b);
    }
});

// Independent finite Dijkstra over the two directed equality orientations and
// canonical IN states, both with and without the integrated lower bound.
test('semijoin zero one seven costs equal independent directed Dijkstra and replay each concrete step', async () => {
    for (const cost of [0, 1, 7]) {
        const from = ast(fromSql), to = ast(toSql), full = graphFor(to, from, {cost}), graph = {...full, edits: [rule(full)]};
        const states = new Map([[stableKey(from), from]]), pending = [from];
        while (pending.length) for (const edge of edges(graph, pending.shift())) {
            const key = stableKey(edge.root); if (!states.has(key)) { states.set(key, edge.root); pending.push(edge.root); }
        }
        assert.ok(states.size >= 3 && states.size <= 5);
        for (const start of states.values()) {
            const best = new Map([[stableKey(start), 0]]), queue = [{root: start, distance: 0}];
            while (queue.length) {
                queue.sort((a, b) => a.distance - b.distance); const current = queue.shift();
                if (best.get(stableKey(current.root)) !== current.distance) continue;
                for (const edge of edges(graph, current.root)) {
                    const key = stableKey(edge.root), next = current.distance + cost;
                    if (next < (best.get(key) ?? Infinity)) { best.set(key, next); queue.push({root: edge.root, distance: next}); }
                }
            }
            for (const finish of states.values()) for (const useHeuristic of [false, true]) {
                const expected = best.get(stableKey(finish));
                const result = await shortestSqlEditPath(finish, start, graph, {async tick() {}}, {cutoff: 2 * cost + 1, useHeuristic});
                assert.equal(result.distance, expected); assert.equal(result.capped, false);
                let actual = start; for (const edge of result.edits) actual = replayOperation(actual, edge.operation);
                assert.equal(stableKey(actual), stableKey(finish));
            }
        }
    }
});
