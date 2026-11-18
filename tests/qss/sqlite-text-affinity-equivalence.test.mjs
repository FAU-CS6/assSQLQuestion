import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';
import {createSQLiteEquivalenceFactView} from '../../lib/qss/src/sqlite-equivalences.mjs';
import {registerSQLiteTextAffinityEquivalence, createSQLiteTextAffinityFactView, SQLITE_TEXT_AFFINITY_STEP} from '../../lib/qss/src/sqlite-text-affinity-equivalence.mjs';

const schema = {tables: [{name: 'sample', type: 'table', columns: [{name: 'id', type: 'TEXT'}, {name: 'value', type: 'TEXT'}, {name: 'n', type: 'INTEGER'}, {name: 'b', type: 'BLOB'}]}]};
const ast = sql => parseGraphSql(sql, {schema, allowPartial: false}).root;
const set = values => [...values].sort();
function candidates(root, suppliedSchema = schema, options = {}, cost = 0) {
    let result;
    registerSQLiteTextAffinityEquivalence((name, label, defaultCost, generate, annotations) => {
        result = [...generate(root)].map(change => {
            const operation = {type: 'sql-edit', name, cost, path: change.path,
                before: change.path.reduce((node, key) => node[key], root), after: change.after};
            return {root: replayOperation(root, operation), operation, defaultCost, annotations};
        });
    }, suppliedSchema, options);
    return result;
}

test('TEXT affinity adds explicit reversible integer/string edits in SELECT UPDATE and DELETE WHERE', () => {
    for (const prefix of ['SELECT value FROM sample', "UPDATE sample SET value='new'", 'DELETE FROM sample']) {
        for (const op of ['=', '!=', '<>']) for (const value of ['0', '18564346', '2147483647']) {
            const a = ast(prefix + ' WHERE id' + op + value), b = ast(prefix + " WHERE id" + op + "'" + value + "'");
            for (const [from, to] of [[a,b],[b,a]]) for (const cost of [0,4]) {
                const found = candidates(from, schema, {}, cost);
                assert.equal(found.length, 1); assert.equal(found[0].operation.name, SQLITE_TEXT_AFFINITY_STEP.id);
                assert.equal(found[0].operation.cost, cost); assert.equal(found[0].defaultCost, 0);
                assert.equal(stableKey(found[0].root), stableKey(to)); assert.notEqual(stableKey(from), stableKey(to));
                assert.equal(found[0].annotations.maxNewSymbols, 0);
            }
        }
    }
});

test('unproved affinities scopes literal spellings and non-WHERE outputs receive no free edge', () => {
    for (const sql of [
        'SELECT value FROM sample WHERE n=123', 'SELECT value FROM sample WHERE b=123',
        'SELECT value FROM sample WHERE +id=123', 'SELECT value FROM sample WHERE CAST(id AS TEXT)=123',
        "SELECT value FROM sample WHERE id='00123'", "SELECT value FROM sample WHERE id='+123'",
        "SELECT value FROM sample WHERE id='123.0'", "SELECT value FROM sample WHERE id='1e2'",
        'SELECT value FROM sample WHERE id=123.0', 'SELECT value FROM sample WHERE id=2147483648',
        'SELECT value FROM sample WHERE id=0x7b', 'SELECT value FROM sample WHERE id=-123',
        'SELECT value FROM sample WHERE id=0123', 'SELECT value FROM sample WHERE id=NULL',
        'SELECT value FROM sample WHERE id COLLATE NOCASE=123',
        'SELECT value FROM sample WHERE id>123', 'SELECT id=123 FROM sample',
        'SELECT value FROM main.sample WHERE id=123', 'SELECT s.value FROM sample s JOIN other o ON s.id=o.id WHERE s.id=123',
        'WITH s AS(SELECT * FROM sample) SELECT value FROM s WHERE id=123',
        'SELECT value FROM sample WHERE id=123 AND EXISTS(SELECT 1)',
        'EXPLAIN SELECT value FROM sample WHERE id=123',
        'CREATE VIEW v AS SELECT value FROM sample WHERE id=123',
        'UPDATE sample SET value=(SELECT value FROM sample) WHERE id=123'
    ]) {
        let root;
        try { root = ast(sql); } catch (error) { throw new Error(sql + ': ' + error.message); }
        assert.equal(candidates(root).length, 0, sql);
    }
    const root = ast('SELECT value FROM sample WHERE id=123');
    assert.equal(candidates(root, {tables: []}).length, 0);
    assert.equal(candidates(root, {tables: [{...schema.tables[0], type: 'view'}]}).length, 0);
    assert.equal(candidates(root, {tables: [schema.tables[0], schema.tables[0]]}).length, 0);
    const collatedLiteral = ast('SELECT value FROM sample WHERE id=123');
    collatedLiteral.slots.statements[0].slots.where.slots.right.slots.collate = {kind:'Collate',attrs:{name:'NOCASE'},slots:{}};
    assert.equal(candidates(collatedLiteral).length, 0);
    for (const schemaSql of ['CREATE TEMP VIEW sample AS SELECT 1 AS id', "ATTACH ':memory:' AS aux", 'CREATE TEMPORARY TABLE sample(id TEXT)']) {
        assert.equal(candidates(root, schema, {schemaSql}).length, 0);
    }
});

test('affinity fact view is context independent, follows DQS normalization and never changes graph vertices', () => {
    const sqlite = createSQLiteEquivalenceFactView(), affinity = createSQLiteTextAffinityFactView(), view = root => affinity(sqlite(root));
    for (const sql of ['SELECT value FROM sample WHERE id=123', "UPDATE sample SET value='new' WHERE id<>'18564346'", "DELETE FROM sample WHERE id='0'"]) {
        const root = ast(sql), original = stableKey(root), normalized = view(root);
        assert.equal(view(root), normalized);
        for (const next of candidates(root)) {
            assert.deepEqual(set(symbolFacts(normalized)), set(symbolFacts(view(next.root))));
            assert.deepEqual(set(predicateFacts(normalized)), set(predicateFacts(view(next.root))));
        }
        assert.equal(stableKey(root), original);
    }
    assert.deepEqual(view(ast('SELECT "123" AS result')), view(ast("SELECT '123' AS result")));
    assert.deepEqual(view(ast("SELECT '123' AS result")), view(ast('SELECT 123 AS result')));
    assert.notEqual(stableKey(ast("SELECT '123' AS result")), stableKey(ast('SELECT 123 AS result')));
    assert.notDeepEqual(view(ast("SELECT '0123' AS result")), view(ast('SELECT 123 AS result')));
});

test('all existing free edges preserve affinity facts and positive edges retain symbol bounds', t => {
    const sqlite = createSQLiteEquivalenceFactView(), affinity = createSQLiteTextAffinityFactView();
    let free = 0, positive = 0;
    for (const [before, after] of [
        ['SELECT id AS id FROM sample WHERE id="123" AND value<>\'456\'', "SELECT sample.id AS id FROM sample WHERE value<>'456' AND id=123"],
        ["UPDATE sample SET value='123' WHERE id='18564346'", "UPDATE sample SET value='other' WHERE id=18564346"],
        ["CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL,value TEXT DEFAULT '123' CHECK(value IN('0','1')))", "CREATE TABLE fresh(id INTEGER PRIMARY KEY,value TEXT DEFAULT 'other' CHECK(value='0' OR value='1'))"],
        ["SELECT CASE WHEN id='123' THEN '0' ELSE '1' END AS result FROM sample", "SELECT CASE WHEN id=123 THEN 0 ELSE 1 END AS result FROM sample"]
    ]) {
        const source = ast(before), target = ast(after), graph = createEditGraph(target, source, schema);
        const view = root => affinity(sqlite(graph.abstractRoot(root)));
        for (const root of [source,target]) {
            const symbols = symbolFacts(view(root)), predicates = predicateFacts(view(root));
            for (const edit of graph.edits) for (const next of edit.apply(root)) {
                const nextSymbols = symbolFacts(view(next.root));
                if (edit.cost === 0) {
                    assert.deepEqual(set(nextSymbols), set(symbols), edit.name);
                    assert.deepEqual(set(predicateFacts(view(next.root))), set(predicates), edit.name);
                    free++;
                } else {
                    assert.ok([...nextSymbols].filter(fact => !symbols.has(fact)).length <= edit.maxNewSymbols, edit.name);
                    if (edit.preservesSymbolSet) assert.deepEqual(set(nextSymbols), set(symbols), edit.name);
                    positive++;
                }
            }
        }
    }
    assert.ok(free > 30); assert.ok(positive > 500);
    t.diagnostic(JSON.stringify({free,positive}));
});

test('SQLite 3.22 oracle confirms TEXT comparisons and excluded affinity counterexamples',
    {skip: !process.env.CHROME_CDP_URL}, async t => {
    const {chromium} = createRequire(import.meta.url)('playwright');
    const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL), context = await browser.newContext();
    context.setDefaultTimeout(0); context.setDefaultNavigationTimeout(0);
    try {
        const page = await context.newPage(), base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
        await page.route(base+'/__text_affinity_oracle__', route => route.fulfill({contentType:'text/html',body:'<!doctype html><title>TEXT affinity oracle</title>'}));
        await page.goto(base+'/__text_affinity_oracle__'); assert.match(await page.evaluate(()=>navigator.userAgent), /HeadlessChrome/);
        await page.addScriptTag({url:base+'/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/lib/sql.js/sql.js'});
        const observed = await page.evaluate(() => {
            const run = (setup, sql) => {const db=new SQL.Database();try{db.exec(setup);return db.exec(sql)}finally{db.close()}};
            const values="VALUES(NULL),('0'),('00'),('123'),('0123'),('123.0'),('+123'),('18564346'),('2147483647'),(123),(123.0),(x'313233'),('other')";
            const pairs=[],wrong=[];
            for(const collation of ['', ' COLLATE NOCASE', ' COLLATE RTRIM']) {
                const setup='CREATE TABLE sample(id TEXT'+collation+');INSERT INTO sample '+values;
                for(const op of ['=','!=','<>'])for(const value of ['0','123','18564346','2147483647']) {
                    pairs.push({a:run(setup,'SELECT rowid FROM sample WHERE id'+op+value+' ORDER BY rowid'),b:run(setup,"SELECT rowid FROM sample WHERE id"+op+"'"+value+"' ORDER BY rowid")});
                }
            }
            for(const type of ['BLOB',''])wrong.push({a:run('CREATE TABLE sample(id '+type+');INSERT INTO sample '+values,'SELECT rowid FROM sample WHERE id=123'),b:run('CREATE TABLE sample(id '+type+');INSERT INTO sample '+values,"SELECT rowid FROM sample WHERE id='123'")});
            const setup='CREATE TABLE sample(id TEXT);INSERT INTO sample '+values;
            for(const [a,b]of[["+id=123","+id='123'"],["id=123","id='0123'"],["id=123","id='123.0'"],["id=123","id='+123'"]])wrong.push({a:run(setup,'SELECT rowid FROM sample WHERE '+a),b:run(setup,'SELECT rowid FROM sample WHERE '+b)});
            return {version:run('', 'SELECT sqlite_version()')[0].values[0][0],pairs,wrong};
        });
        assert.equal(observed.version,'3.22.0');assert.equal(observed.pairs.length,36);assert.equal(observed.wrong.length,6);
        for(const pair of observed.pairs)assert.deepEqual(pair.a,pair.b);
        for(const pair of observed.wrong)assert.notDeepEqual(pair.a,pair.b);
        t.diagnostic('SQLite3.22:36 TEXT/collation equivalences and6 excluded affinity/spelling counterexamples');
    } finally {await context.close();await browser.close();}
});
