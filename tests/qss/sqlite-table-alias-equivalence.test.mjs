import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';
import {registerSQLiteTableAliasEquivalence, SQLITE_TABLE_ALIAS_STEP, createSQLiteTableAliasFactView} from '../../lib/qss/src/sqlite-table-alias-equivalence.mjs';

const schema = {tables: [{name: 'sample', type: 'table', columns: [{name: 'id'}, {name: 'value'}]}]};
const ast = sql => parseGraphSql(sql, {schema, allowPartial: false}).root;
const set = values => [...values].sort();
function edits(root, suppliedSchema = schema, options = {}, cost = 0) {
    let result;
    registerSQLiteTableAliasEquivalence((name, description, defaultCost, generate, annotations) => {
        result = [...generate(root)].map(change => {
            const operation = {type: 'sql-edit', name, cost, path: change.path,
                before: change.path.reduce((node, field) => node[field], root), after: change.after};
            return {root: replayOperation(root, operation), operation, annotations, defaultCost};
        });
    }, suppliedSchema, options);
    return result;
}

test('identical base-table aliases have explicit reversible and individually priced edges', () => {
    const a = ast('SELECT sample.id AS id,value AS value FROM sample WHERE sample.value>0 ORDER BY id');
    const b = ast('SELECT sample.id AS id,value AS value FROM sample AS sample WHERE sample.value>0 ORDER BY id');
    for (const [source, target] of [[a, b], [b, a]]) for (const cost of [0, 4]) {
        const choices = edits(source, schema, {}, cost);
        assert.equal(choices.length, 1); assert.equal(choices[0].operation.name, SQLITE_TABLE_ALIAS_STEP.id);
        assert.equal(choices[0].operation.cost, cost); assert.equal(choices[0].defaultCost, 0);
        assert.equal(stableKey(choices[0].root), stableKey(target));
        assert.notEqual(stableKey(source), stableKey(target));
        assert.equal(choices[0].annotations.maxNewSymbols, 0);
    }
});

test('scope captures unknown sources schema qualifiers and implicit result names block alias changes', () => {
    for (const sql of [
        'SELECT id FROM sample', 'SELECT * FROM sample', 'SELECT sample.* FROM sample',
        'SELECT s.id AS id FROM sample AS s', 'SELECT id AS id FROM unknown',
        'SELECT sample.id AS id FROM main.sample',
        'SELECT sample.id AS id FROM sample JOIN other ON sample.id=other.id',
        'WITH sample AS(SELECT 1 AS id) SELECT id AS id FROM sample',
        'SELECT sample.id AS id FROM sample WHERE EXISTS(SELECT 1 FROM other)',
        'SELECT sample.id AS id FROM (SELECT id FROM sample) AS sample',
        'SELECT id AS id FROM sample UNION SELECT id AS id FROM sample',
        'CREATE VIEW v AS SELECT id AS id FROM sample',
        'EXPLAIN SELECT id AS id FROM sample',
        'PRAGMA full_column_names=ON;SELECT id AS id FROM sample'
    ]) assert.equal(edits(ast(sql)).length, 0, sql);
    const root = ast('SELECT id AS id FROM sample');
    assert.equal(edits(root, {tables: []}).length, 0);
    assert.equal(edits(root, {tables: [{...schema.tables[0], type: 'view'}]}).length, 0);
    assert.equal(edits(root, {tables: [schema.tables[0], {...schema.tables[0], name: 'SAMPLE'}]}).length, 0);
    assert.equal(edits(root, schema, {schemaMetadataObserved: true}).length, 0);
    assert.equal(edits(root, schema, {outputColumnNamesObserved: true}).length, 0);
    const qualified = ast('SELECT sample.id AS id FROM sample');
    qualified.slots.statements[0].slots.columns[0].slots.expr.attrs.db = 'main';
    assert.equal(edits(qualified).length, 0);
});

test('alias heuristic view forgets aliases without altering concrete graphs and preserves free-edge facts', () => {
    const view = createSQLiteTableAliasFactView();
    for (const sql of ['SELECT sample.id AS id FROM sample WHERE sample.value>0',
        'SELECT count(*) AS n FROM sample AS sample',
        'SELECT value AS other FROM sample AS sample ORDER BY other']) {
        const source = ast(sql), key = stableKey(source), sourceView = view(source);
        assert.equal(view(source), sourceView);
        for (const next of edits(source)) {
            assert.deepEqual(set(symbolFacts(source)), set(symbolFacts(next.root)));
            assert.deepEqual(set(predicateFacts(source)), set(predicateFacts(next.root)));
            assert.deepEqual(set(symbolFacts(sourceView)), set(symbolFacts(view(next.root))));
            assert.deepEqual(set(predicateFacts(sourceView)), set(predicateFacts(view(next.root))));
        }
        assert.equal(stableKey(source), key);
    }
    const root = ast('SELECT s.id AS id FROM sample AS s');
    assert.equal(root.slots.statements[0].slots.from[0].attrs.as, 's');
    assert.equal(view(root).slots.statements[0].slots.from[0].attrs.as, null);
});

test('SQLite 3.22 browser oracle covers identity aliases and output-name/capture counterexamples',
    {skip: !process.env.CHROME_CDP_URL}, async t => {
    const {chromium} = createRequire(import.meta.url)('playwright');
    const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL), context = await browser.newContext();
    context.setDefaultTimeout(0); context.setDefaultNavigationTimeout(0);
    try {
        const page = await context.newPage(), base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
        await page.route(base + '/__table_alias_oracle__', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Table alias oracle</title>'}));
        await page.goto(base + '/__table_alias_oracle__'); assert.match(await page.evaluate(() => navigator.userAgent), /HeadlessChrome/);
        await page.addScriptTag({url: base + '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/lib/sql.js/sql.js'});
        const result = await page.evaluate(() => {
            const db = new SQL.Database();
            try {
                const version = db.exec('SELECT sqlite_version()')[0].values[0][0];
                db.exec('CREATE TABLE sample(id INTEGER,value TEXT);INSERT INTO sample VALUES(1,\'a\'),(2,\'b\'),(3,NULL);CREATE TABLE other(id);INSERT INTO other VALUES(7);');
                const pairs = [], counterexamples = [];
                for (const short of [0, 1]) for (const full of [0, 1]) {
                    db.exec('PRAGMA short_column_names=' + short + ';PRAGMA full_column_names=' + full);
                    for (const [a, b] of [
                        ['SELECT sample.id AS id,value AS value FROM sample ORDER BY id', 'SELECT sample.id AS id,value AS value FROM sample AS sample ORDER BY id'],
                        ['SELECT count(*) AS n FROM sample', 'SELECT count(*) AS n FROM sample AS sample'],
                        ['SELECT value AS other FROM sample WHERE id>1 ORDER BY other', 'SELECT value AS other FROM sample AS sample WHERE id>1 ORDER BY other']
                    ]) pairs.push({short, full, a: db.exec(a), b: db.exec(b)});
                }
                db.exec('PRAGMA short_column_names=OFF;PRAGMA full_column_names=ON');
                pairs.push({a: db.exec('SELECT id FROM sample'), b: db.exec('SELECT id FROM sample AS SAMPLE')});
                counterexamples.push({a: db.exec('SELECT id FROM sample'), b: db.exec('SELECT id AS result FROM sample')});
                counterexamples.push({a: db.exec('SELECT sample.id AS id FROM sample'), b: db.exec('SELECT sample.id AS id FROM other AS sample')});
                db.exec('PRAGMA short_column_names=OFF;PRAGMA full_column_names=OFF');
                counterexamples.push({a: db.exec('SELECT id FROM sample'), b: db.exec('SELECT sample.id FROM sample')});
                counterexamples.push({a: db.exec('SELECT sample.id FROM sample'), b: db.exec('SELECT sample.id AS id FROM sample')});
                return {version, pairs, counterexamples};
            } finally {db.close();}
        });
        assert.equal(result.version, '3.22.0'); assert.equal(result.pairs.length, 13);
        for (const pair of result.pairs) assert.deepEqual(pair.a, pair.b);
        for (const pair of result.counterexamples) assert.notDeepEqual(pair.a, pair.b);
        t.diagnostic('SQLite 3.22.0: 13 identity-alias cases across all output-name flags; four header/capture counterexamples');
    } finally {await context.close(); await browser.close();}
});
