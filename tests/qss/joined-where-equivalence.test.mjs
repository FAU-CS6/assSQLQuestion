import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {JOINED_WHERE_STEP} from '../../lib/qss/src/joined-where-equivalence.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';

const schemaSql = 'CREATE TABLE a(id INTEGER,x INTEGER,label TEXT COLLATE NOCASE); CREATE TABLE b(ref INTEGER,y INTEGER);';
const schema = {tables: [{name: 'a', type: 'table', columns: [{name: 'id'}, {name: 'x'}, {name: 'label'}]},
    {name: 'b', type: 'table', columns: [{name: 'ref'}, {name: 'y'}]}]};
const ast = sql => parseGraphSql(sql, {schema}).root;
const context = () => ({visited: 0, async tick() {}});
const sorted = values => [...values].sort();
function graphFor(to, from, cost = 0, options = {}, tables = schema) {
    const requirements = {schemaSql, ...options};
    return createEditGraph(to, from, tables, {[JOINED_WHERE_STEP.id]: cost}, requirements);
}
const rule = graph => graph.edits.find(edit => edit.name === JOINED_WHERE_STEP.id);
const find = (graph, from, to) => [...rule(graph).apply(from)].find(edge => stableKey(edge.root) === stableKey(to));
function oracle(a, b, setup = schemaSql + "INSERT INTO a VALUES(1,4,'Alpha'),(2,8,'beta'),(3,NULL,NULL); INSERT INTO b VALUES(1,5),(9,2);") {
    const db = new DatabaseSync(':memory:');
    try { db.exec(setup); return [db.prepare(a).all(), db.prepare(b).all()]; }
    finally { db.close(); }
}

test('joined WHERE qualification is a reversible concrete edge with equal SQLite results', () => {
    for (const [a, b] of [
        ['SELECT a.id FROM a JOIN b ON b.ref=a.id WHERE x>2', 'SELECT a.id FROM a JOIN b ON b.ref=a.id WHERE a.x>2'],
        ['SELECT aa.id FROM a aa,b bb WHERE y<7', 'SELECT aa.id FROM a aa,b bb WHERE bb.y<7'],
        ['SELECT a.id FROM a LEFT JOIN b ON b.ref=a.id WHERE y IS NULL', 'SELECT a.id FROM a LEFT JOIN b ON b.ref=a.id WHERE b.y IS NULL'],
        ["SELECT a.id FROM a CROSS JOIN b WHERE label='ALPHA'", "SELECT a.id FROM a CROSS JOIN b WHERE a.label='ALPHA'"],
        ["SELECT a.id FROM a,b WHERE label COLLATE BINARY='ALPHA'", "SELECT a.id FROM a,b WHERE a.label COLLATE BINARY='ALPHA'"]
    ]) {
        const from = ast(a), to = ast(b), graph = graphFor(to, from), before = stableKey(from);
        assert.notEqual(stableKey(from), stableKey(to));
        for (const [start, finish] of [[from, to], [to, from]]) {
            const edge = find(graph, start, finish); assert.ok(edge, a + ' / ' + b);
            assert.equal(edge.operation.cost, 0);
            assert.equal(stableKey(replayOperation(start, edge.operation)), stableKey(finish));
        }
        assert.equal(stableKey(from), before);
        assert.deepEqual(...oracle(a, b));
    }
});

test('actual physical columns take precedence over SELECT aliases only in WHERE', () => {
    const a = 'SELECT y AS x FROM a,b WHERE x=4', b = 'SELECT y AS x FROM a,b WHERE a.x=4';
    assert.deepEqual(...oracle(a, b));
    assert.ok(find(graphFor(ast(b), ast(a)), ast(a), ast(b)));
    for (const sql of ['SELECT x+1 AS answer FROM a,b WHERE answer>2', 'SELECT x FROM a,b ORDER BY x',
        'SELECT x FROM a,b GROUP BY x HAVING x>2', 'SELECT x FROM a JOIN b ON x=b.y',
        'SELECT x FROM a aa,b WHERE a.x>2']) {
        const root = ast(sql); assert.equal([...rule(graphFor(root, root)).apply(root)].length, 0, sql);
    }
    assert.notDeepEqual(...oracle('SELECT y AS x FROM a,b ORDER BY x', 'SELECT y AS x FROM a,b ORDER BY a.x'));
});

test('ambiguous source occurrences nested scopes USING NATURAL and unknown catalogs block qualification', () => {
    for (const sql of [
        'SELECT a.x FROM a JOIN a second ON a.id=second.id WHERE x>2',
        'SELECT a.x FROM a JOIN b ON a.id=b.ref WHERE absent>2',
        'SELECT a.x FROM a aa JOIN b aa ON aa.id=aa.ref WHERE x>2',
        'SELECT a.x FROM main.a,b WHERE x>2',
        'SELECT a.x FROM a NATURAL JOIN b WHERE x>2',
        'SELECT a.x FROM a JOIN b USING(id) WHERE x>2',
        'SELECT a.x FROM a,(SELECT y FROM b) bb WHERE x>2',
        'WITH c AS (SELECT y FROM b) SELECT a.x FROM a,c WHERE x>2',
        'SELECT a.x FROM a,b WHERE x>2 AND EXISTS(SELECT 1 FROM b)',
        'SELECT x FROM a WHERE x>2',
        'SELECT x FROM a,b WHERE x>2; SELECT 1'
    ]) {
        const root = ast(sql); assert.equal([...rule(graphFor(root, root)).apply(root)].length, 0, sql);
    }
    const root = ast('SELECT a.x FROM a,b WHERE x>2');
    for (const tables of [{}, {tables: schema.tables.slice(0, 1)}, {tables: [...schema.tables, schema.tables[0]]},
        {tables: [schema.tables[0], {...schema.tables[1], type: 'view'}]},
        {tables: [schema.tables[0], {...schema.tables[1], columns: [...schema.tables[1].columns, {name: 'x'}]}]}]) {
        assert.equal([...rule(graphFor(root, root, 0, {}, tables)).apply(root)].length, 0);
    }
});

test('ordinary schema provenance excludes virtual hidden columns and namespace uncertainty', () => {
    const root = ast('SELECT a.x FROM a,b WHERE x>2');
    for (const options of [{schemaSql: undefined}, {schemaSql: ''}, {schemaSql: 'CREATE TABLE a(x);'},
        {schemaSql: schemaSql + 'CREATE VIRTUAL TABLE f USING fts4(content);'},
        {schemaSql: schemaSql + 'CREATE TEMP TABLE t(x);'},
        {schemaSql: schemaSql + "ATTACH ':memory:' AS other;"},
        {schemaSql: schemaSql + "DETACH other;"}, {schemaSql: schemaSql + "'unfinished"},
        {ambiguousSchemaNamespaces: true}]) {
        assert.equal([...rule(graphFor(root, root, 0, options)).apply(root)].length, 0, JSON.stringify(options));
    }
    assert.ok([...rule(graphFor(root, root, 0, {schemaSql: schemaSql + " -- CREATE VIRTUAL TABLE ignored\nINSERT INTO a(x) VALUES('ATTACH');"})).apply(root)].length);
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('CREATE TABLE aa(docid INTEGER); CREATE VIRTUAL TABLE bb USING fts4(content); INSERT INTO aa VALUES(1); INSERT INTO bb VALUES(1);');
        assert.equal(db.prepare('PRAGMA table_info(bb)').all().length, 1);
        assert.throws(() => db.prepare('SELECT aa.docid FROM aa,bb WHERE docid=1').all(), /ambiguous/);
        assert.equal(db.prepare('SELECT aa.docid FROM aa,bb WHERE aa.docid=1').all().length, 1);
    } finally { db.close(); }
});

test('identifier folding is ASCII only and hidden row aliases are conservatively excluded', () => {
    const a = ast('SELECT a.id FROM a,b WHERE X>2'), b = ast('SELECT a.id FROM a,b WHERE A.X>2');
    assert.ok(find(graphFor(b, a), a, b));
    const tables = {tables: [{name: 'a', type: 'table', columns: [{name: 'Ä'}, {name: 'rowid'}, {name: 'oid'}, {name: '_rowid_'}]}, schema.tables[1]]};
    const sql = 'CREATE TABLE a("Ä",rowid,oid,_rowid_); CREATE TABLE b(ref,y);';
    for (const name of ['ä', 'rowid', 'oid', '_rowid_']) {
        const root = parseGraphSql('SELECT 1 FROM a,b WHERE [' + name + ']=1', {schema: tables}).root;
        assert.equal([...rule(graphFor(root, root, 0, {schemaSql: sql}, tables)).apply(root)].length, 0, name);
    }
    const from = parseGraphSql('SELECT 1 FROM a,b WHERE [Ä]=1', {schema: tables}).root;
    const to = parseGraphSql('SELECT 1 FROM a,b WHERE a.[Ä]=1', {schema: tables}).root;
    assert.ok(find(graphFor(to, from, 0, {schemaSql: sql}, tables), from, to));
});

test('WHERE qualification preserves output headers including custom name flags', () => {
    const a = 'SELECT a.x+1 FROM a,b WHERE y=5', b = 'SELECT a.x+1 FROM a,b WHERE b.y=5';
    for (const flags of ['PRAGMA short_column_names=OFF;PRAGMA full_column_names=ON;', 'PRAGMA short_column_names=OFF;PRAGMA full_column_names=OFF;']) {
        assert.deepEqual(...oracle(a, b, schemaSql + 'INSERT INTO a(x) VALUES(4);INSERT INTO b(y) VALUES(5);' + flags));
        assert.ok(find(graphFor(ast(b), ast(a), 0, {outputColumnNamesObserved: true}), ast(a), ast(b)));
    }
});

test('coarse fact roots and all bound facts stay identical despite aliases labels and custom costs', () => {
    for (const sql of ['SELECT x AS x FROM a,b WHERE x>2 AND y<7',
        "SELECT CASE WHEN x>0 THEN 'yes' ELSE 'no' END AS label FROM a,b WHERE x>2 GROUP BY label"]) {
        const root = ast(sql);
        for (const cost of [0, 1, 7]) for (const freeLabels of [[], ['label']]) {
            const graph = graphFor(root, root, cost, {freeLabels}), before = graph.abstractRoot(root);
            for (const edge of rule(graph).apply(root)) {
                assert.equal(stableKey(before), stableKey(graph.abstractRoot(edge.root)));
                for (const facts of [symbolFacts, predicateFacts]) assert.deepEqual(sorted(facts(before)), sorted(facts(graph.abstractRoot(edge.root))));
                assert.equal(rule(graph).maxNewSymbols, 0); assert.equal(rule(graph).maxNewPredicates, 0);
            }
        }
    }
});

test('independent finite Dijkstra confirms every qualifier state and configurable zero one seven costs', async () => {
    const start = ast('SELECT a.id FROM a,b WHERE x>2 AND y<7');
    for (const cost of [0, 1, 7]) {
        const full = graphFor(start, start, cost), graph = {...full, edits: [rule(full)]};
        const states = new Map([[graph.key(start), start]]), queue = [start];
        for (let i = 0; i < queue.length; i++) for (const edge of rule(graph).apply(queue[i])) {
            const key = graph.key(edge.root); if (!states.has(key)) { states.set(key, edge.root); queue.push(edge.root); }
        }
        assert.equal(states.size, 4);
        for (const from of states.values()) {
            const distances = new Map([[graph.key(from), 0]]), pending = [{root: from, cost: 0}];
            while (pending.length) {
                pending.sort((a, b) => a.cost - b.cost); const current = pending.shift();
                if (current.cost !== distances.get(graph.key(current.root))) continue;
                for (const edge of rule(graph).apply(current.root)) {
                    const distance = current.cost + cost, key = graph.key(edge.root);
                    if (distance < (distances.get(key) ?? Infinity)) { distances.set(key, distance); pending.push({root: edge.root, cost: distance}); }
                }
            }
            for (const to of states.values()) {
                const result = await shortestSqlEditPath(to, from, graph, context());
                assert.equal(result.distance, distances.get(graph.key(to))); assert.equal(result.capped, false);
                let actual = from; for (const step of result.edits) actual = replayOperation(actual, step.operation);
                assert.equal(stableKey(actual), stableKey(to));
            }
        }
    }
});

test('joined aliases and qualifiers do not forgive a genuine numeric predicate error', async () => {
    const from = ast('SELECT aa.x FROM a aa JOIN b bb ON bb.ref=aa.id WHERE bb.y=1');
    const to = ast('SELECT aa.x FROM a aa JOIN b second ON second.ref=aa.id WHERE y=2');
    const graph = graphFor(to, from), result = await shortestSqlEditPath(to, from, graph, context(), {cutoff: 5});
    assert.equal(result.distance, 1); assert.equal(result.capped, false);
    let actual = from; for (const step of result.edits) actual = replayOperation(actual, step.operation);
    assert.equal(stableKey(actual), stableKey(to));
});
