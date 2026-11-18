import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {expandedBetween, betweenRangeEquivalent} from '../../lib/qss/src/sql-equivalences.mjs';

const id = 'rewriteBetweenRange';
const schema = {tables: [{name: 'sample', type: 'table', columns: [{name: 'x'}, {name: 'a'}, {name: 'b'}]}]};
const ast = sql => parseGraphSql(sql, {schema}).root;
const expr = sql => ast('SELECT ' + sql + ' AS answer FROM sample').slots.statements[0].slots.columns[0].slots.expr;
const sorted = set => [...set].sort();
const edge = (from, to, costs = {}, context = schema) => {
    const graph = createEditGraph(to, from, context, costs), edit = graph.edits.find(edit => edit.name === id);
    return {graph, edit, next: [...edit.apply(from)].find(next => stableKey(next.root) === stableKey(to))};
};
const forms = [
    ['x BETWEEN a AND b', 'x>=a AND x<=b'],
    ['x NOT BETWEEN a AND b', 'x<a OR x>b'],
    ['(x+1) BETWEEN 0 AND 5', '(x+1)>=0 AND (x+1)<=5'],
    ['CAST(x AS TEXT) BETWEEN a AND b', 'CAST(x AS TEXT)>=a AND CAST(x AS TEXT)<=b'],
    ['x COLLATE NOCASE BETWEEN a AND b', 'x COLLATE NOCASE>=a AND x COLLATE NOCASE<=b'],
    ['x BETWEEN NULL AND 3', 'x>=NULL AND x<=3'],
    ["x BETWEEN 'a' COLLATE NOCASE AND 'c' COLLATE BINARY", "x>='a' COLLATE NOCASE AND x<='c' COLLATE BINARY"]
];

test('BETWEEN and NOT BETWEEN have named reversible edges with explicit configurable costs', () => {
    for (const [short, long] of forms) for (const [from, to] of [[short, long], [long, short]]) {
        const answer = ast('SELECT x FROM sample WHERE ' + from), reference = ast('SELECT x FROM sample WHERE ' + to);
        for (const cost of [0, 4]) {
            const {graph, edit, next} = edge(answer, reference, {[id]: cost});
            assert.equal(edit.cost, cost); assert.ok(next, from + ' -> ' + to);
            assert.equal(next.operation.name, id); assert.equal(next.operation.cost, cost);
            assert.equal(edit.maxNewSymbols, 0); assert.equal(edit.preservesSymbolSet, true);
            assert.notEqual(graph.key(answer), graph.key(reference));
            assert.equal(stableKey(replayOperation(answer, next.operation)), stableKey(reference));
        }
    }
    const a = ast('SELECT x FROM sample WHERE x BETWEEN 1 AND 3'), b = ast('SELECT x FROM sample WHERE x>=1 AND x<=3');
    for (const invalid of [-1, 0.5, NaN]) assert.throws(() => createEditGraph(b, a, schema, {[id]: invalid}), /nonnegative safe integers/);
});

test('range expansion rejects volatile provenance, changed operands, extra syntax and implicit projection names', () => {
    for (const sql of [
        'SELECT x BETWEEN a AND b FROM sample',
        'SELECT (x BETWEEN a AND b)+1 FROM sample',
        'SELECT x FROM sample WHERE random() BETWEEN 0 AND 5',
        'SELECT x FROM sample WHERE x BETWEEN random() AND 5',
        'SELECT random() AS noisy FROM sample WHERE noisy BETWEEN 0 AND 5',
        'SELECT x FROM(SELECT random() AS x) derived WHERE x BETWEEN 0 AND 5',
        'WITH q AS(SELECT random() AS x) SELECT x FROM q WHERE x BETWEEN 0 AND 5',
        'SELECT x FROM sample WHERE x>=a AND a<=b',
        'SELECT x FROM sample WHERE x>a AND x<=b',
        'SELECT x FROM sample WHERE x<a AND x>b',
        'SELECT x FROM sample WHERE x BETWEEN a OR b'
    ]) {
        const root = ast(sql), graph = createEditGraph(root, root, schema);
        assert.equal([...graph.edits.find(edit => edit.name === id).apply(root)].length, 0, sql);
    }
    const root = ast('SELECT x FROM sample WHERE x BETWEEN a AND b');
    const viewSchema = {tables: [{name: 'sample', type: 'view', columns: [{name: 'x'}, {name: 'a'}, {name: 'b'}]}]};
    assert.equal([...createEditGraph(root, root, viewSchema).edits.find(edit => edit.name === id).apply(root)].length, 0);
    const broken = expr('x BETWEEN a OR b');
    assert.equal(broken.attrs.separator, 'OR'); assert.equal(expandedBetween(broken), null);
    assert.equal(betweenRangeEquivalent(broken), null);
    for (const field of ['filter', 'over']) {
        const altered = expr('x BETWEEN a AND b'); altered.slots.left.slots[field] = {kind: 'Window', attrs: {}, slots: {}};
        assert.equal(expandedBetween(altered), null, field);
    }
});

test('all offered free edges retain symbol and predicate facts after BETWEEN enters Boolean expressions', t => {
    let edges = 0;
    const contexts = [
        value => 'SELECT ' + value + ' AS answer FROM sample',
        value => 'SELECT x FROM sample WHERE NOT(' + value + ')',
        value => 'UPDATE sample SET x=1 WHERE ' + value,
        value => 'CREATE TABLE fresh(x,a,b,CHECK(' + value + '))',
        value => 'SELECT CASE WHEN ' + value + ' THEN 1 WHEN NOT(' + value + ') THEN 0 ELSE NULL END AS answer FROM sample'
    ];
    for (const [short, long] of forms) for (const context of contexts) {
        const reference = ast(context(short)), answer = ast(context(long)), graph = createEditGraph(reference, answer, schema);
        for (const root of [reference, answer]) {
            const symbols = sorted(symbolFacts(graph.abstractRoot(root))), predicates = sorted(predicateFacts(graph.abstractRoot(root)));
            for (const edit of graph.edits.filter(e => e.cost === 0)) for (const next of edit.apply(root)) {
                assert.deepEqual(sorted(symbolFacts(graph.abstractRoot(next.root))), symbols, context(short) + ': ' + edit.name);
                assert.deepEqual(sorted(predicateFacts(graph.abstractRoot(next.root))), predicates, context(short) + ': ' + edit.name);
                edges++;
            }
        }
    }
    assert.ok(edges > 100); t.diagnostic(edges + ' offered free edges preserve both fact sets');
});

test('the shortest path uses the explicit zero edge and replays concrete SQL states', async () => {
    for (const [short, long] of forms.slice(0, 2)) {
        const answer = ast('SELECT x FROM sample WHERE ' + short), reference = ast('SELECT x FROM sample WHERE ' + long);
        const graph = createEditGraph(reference, answer, schema);
        for (const useHeuristic of [true, false]) {
            const result = await shortestSqlEditPath(reference, answer, graph, {visited: 0, async tick() {}}, {useHeuristic});
            assert.equal(result.distance, 0); assert.equal(result.edits.length, 1); assert.equal(result.edits[0].name, id);
            assert.equal(stableKey(replayOperation(answer, result.edits[0].operation)), stableKey(reference));
        }
    }
});

// Parse-only checks above never execute SQL. All SQL below runs exclusively
// in the unchanged plugin SQLite 3.22 worker in installed Headless Chrome.
test('SQLite 3.22 browser oracle verifies NULL, affinity and collation while distinguishing incorrect rewrites',
    {skip: !process.env.CHROME_CDP_URL}, async t => {
    const {chromium} = createRequire(import.meta.url)('playwright');
    const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL);
    const context = await browser.newContext(); context.setDefaultTimeout(0); context.setDefaultNavigationTimeout(0);
    try {
        const page = await context.newPage(), base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
        await page.route(base + '/__between_oracle__', r => r.fulfill({contentType: 'text/html', body: '<!doctype html><title>BETWEEN oracle</title>'}));
        await page.goto(base + '/__between_oracle__'); assert.match(await page.evaluate(() => navigator.userAgent), /HeadlessChrome/);
        const evidence = await page.evaluate(async () => {
            const worker = new Worker('/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/lib/sql.js/worker.sql.js');
            let serial = 0;
            const call = data => new Promise((resolve, reject) => {
                const id = ++serial;
                worker.onmessage = e => {if (e.data.id === id) e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.results || []);};
                worker.onerror = e => {e.preventDefault(); reject(new Error(e.message));};
                worker.postMessage({...data, id});
            });
            try {
                await call({action: 'open'});
                const version = (await call({action: 'exec', sql: 'SELECT sqlite_version() AS version'}))[0].values[0][0];
                await call({action: 'exec', sql: "CREATE TABLE vals(v);INSERT INTO vals VALUES(NULL),(-1),(0),(1),(2),(3),(1.5),('2'),('20'),('a'),(x'01');CREATE TABLE sample(x,a,b);INSERT INTO sample SELECT x.v,a.v,b.v FROM vals x,vals a,vals b;CREATE TABLE text_values(x TEXT COLLATE BINARY);INSERT INTO text_values VALUES('2'),('B'),(NULL);CREATE TABLE collated(x TEXT COLLATE NOCASE,a TEXT COLLATE BINARY,b TEXT COLLATE RTRIM);INSERT INTO collated VALUES('B','a','c'),('z','a','z '),(NULL,'a','c');"});
                const pairs = [];
                for (const [left, right, table] of [
                    ['x BETWEEN a AND b', 'x>=a AND x<=b', 'sample'],
                    ['x NOT BETWEEN a AND b', 'x<a OR x>b', 'sample'],
                    ['NOT(x BETWEEN a AND b)', 'x<a OR x>b', 'sample'],
                    ['CAST(x AS TEXT) BETWEEN a AND b', 'CAST(x AS TEXT)>=a AND CAST(x AS TEXT)<=b', 'sample'],
                    ['x BETWEEN a AND b', 'x>=a AND x<=b', 'collated'],
                    ['x NOT BETWEEN a AND b', 'x<a OR x>b', 'collated'],
                    ["x COLLATE NOCASE BETWEEN 'a' AND 'c'", "x COLLATE NOCASE>='a' AND x COLLATE NOCASE<='c'", 'text_values'],
                    ["x BETWEEN 'a' COLLATE NOCASE AND 'c' COLLATE BINARY", "x>='a' COLLATE NOCASE AND x<='c' COLLATE BINARY", 'text_values']
                ]) {
                    const run = expression => call({action: 'exec', sql: 'SELECT (' + expression + ') AS result FROM ' + table + ' ORDER BY rowid'});
                    pairs.push({left, right, table, a: await run(left), b: await run(right)});
                }
                const wrong = [];
                for (const [left, right, table] of [
                    ['x BETWEEN a AND b', 'x>a AND x<b', 'sample'],
                    ['x NOT BETWEEN a AND b', 'x<a AND x>b', 'sample'],
                    ['x BETWEEN a AND b', 'x BETWEEN b AND a', 'sample'],
                    ['x BETWEEN 1 AND 9', '+x>=1 AND +x<=9', 'text_values'],
                    ["x COLLATE NOCASE BETWEEN 'a' AND 'c'", "x>='a' AND x<='c'", 'text_values'],
                    ['x BETWEEN a AND b', 'a<=x AND b>=x', 'collated']
                ]) {
                    const run = expression => call({action: 'exec', sql: 'SELECT (' + expression + ') AS result FROM ' + table + ' ORDER BY rowid'});
                    wrong.push({left, right, a: await run(left), b: await run(right)});
                }
                return {version, pairs, wrong};
            } finally {worker.terminate();}
        });
        assert.equal(evidence.version, '3.22.0');
        for (const pair of evidence.pairs) assert.deepEqual(pair.a, pair.b, pair.left + ' => ' + pair.right);
        for (const pair of evidence.wrong) assert.notDeepEqual(pair.a, pair.b, pair.left + ' != ' + pair.right);
        assert.equal(evidence.pairs[0].a[0].values.length, 1331);
        t.diagnostic('SQLite ' + evidence.version + ': 1,331 mixed/NULL tuples, 8 equivalences and 6 incorrect-rewrite counterexamples');
    } finally {await context.close(); await browser.close();}
});
