import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {expandedLiteralIn, literalInEquivalent} from '../../lib/qss/src/sql-equivalences.mjs';

const id = 'rewriteLiteralInList';
const schema = {tables: [{name: 'sample', type: 'table', columns: [{name: 'x'}, {name: 'y'}]}]};
const ast = sql => parseGraphSql(sql, {schema}).root;
const expr = sql => ast('SELECT ' + sql + ' AS result FROM sample').slots.statements[0].slots.columns[0].slots.expr;
const set = values => [...values].sort();
const forms = [
    ["x IN ('ja','nein')", "x='ja' OR x='nein'"],
    ['x NOT IN (1,2,NULL)', 'x<>1 AND x<>2 AND x<>NULL'],
    ['x IN (1,NULL,1)', 'x=1 OR x=NULL OR x=1'],
    ['x IN (1)', 'x=1'],
    ['x NOT IN (NULL)', 'x<>NULL'],
    ["CAST(x AS TEXT) IN ('1','2')", "CAST(x AS TEXT)='1' OR CAST(x AS TEXT)='2'"],
    ["x COLLATE NOCASE IN ('a','B')", "x COLLATE NOCASE='a' OR x COLLATE NOCASE='B'"],
    ["x IN (x'00FF',x'')", "x=x'00FF' OR x=x''"],
    ['(x+1) IN (1,2.5)', '(x+1)=1 OR (x+1)=2.5']
];

test('literal membership equivalences are named, individually priced and replayable in both directions', () => {
    for (const [list, comparisons] of forms) for (const [before, after] of [[list, comparisons], [comparisons, list]]) {
        const source = ast('SELECT x FROM sample WHERE ' + before), target = ast('SELECT x FROM sample WHERE ' + after);
        for (const cost of [0, 5]) {
            const graph = createEditGraph(target, source, schema, {[id]: cost}), edit = graph.edits.find(e => e.name === id);
            const next = [...edit.apply(source)].find(next => stableKey(next.root) === stableKey(target));
            assert.ok(next, before + ' => ' + after); assert.equal(edit.cost, cost); assert.equal(next.operation.cost, cost);
            assert.equal(edit.maxNewSymbols, 0); assert.equal(edit.preservesSymbolSet, true);
            assert.notEqual(graph.key(source), graph.key(target));
            assert.equal(stableKey(replayOperation(source, next.operation)), stableKey(target));
        }
    }
});

test('RHS affinity, RHS collation, volatile provenance, empty sets and implicit names block the shortcut', () => {
    for (const sql of [
        'SELECT x IN (1,2) FROM sample', 'SELECT (x IN (1,2))+1 FROM sample',
        'SELECT x FROM sample WHERE x IN (y,1)', 'SELECT x FROM sample WHERE x IN (CAST(1 AS INTEGER),2)',
        "SELECT x FROM sample WHERE x IN ('a' COLLATE NOCASE,'b')",
        'SELECT x FROM sample WHERE x IN ("unbound",2)', 'SELECT x FROM sample WHERE x IN (SELECT y FROM sample)',
        'SELECT x FROM sample WHERE random() IN (0,1)',
        'SELECT random() AS noisy FROM sample WHERE noisy IN (0,1)',
        'SELECT x FROM (SELECT random() AS x) q WHERE x IN (0,1)',
        'WITH q AS(SELECT random() AS x) SELECT x FROM q WHERE x IN (0,1)',
        'SELECT x FROM sample WHERE x=1 OR y=2',
        'SELECT x FROM sample WHERE x=1 AND x=2',
        'SELECT x FROM sample WHERE x<>1 OR x<>2'
    ]) {
        const root = ast(sql), graph = createEditGraph(root, root, schema);
        // A comparison inside a rejected connective can legitimately fold to
        // a singleton IN-list; the whole expression must never fold wrongly.
        const target = root.slots.statements[0].slots.where;
        if (sql.includes('x=1 OR y=2') || sql.includes('x=1 AND x=2') || sql.includes('x<>1 OR x<>2')) {
            assert.equal(literalInEquivalent(target), null, sql);
        } else assert.equal([...graph.edits.find(e => e.name === id).apply(root)].length, 0, sql);
    }
    const root = ast('SELECT x FROM sample WHERE x IN (1,2)'), view = {tables: [{name: 'sample', type: 'view', columns: [{name: 'x'}]}]};
    assert.equal([...createEditGraph(root, root, view).edits.find(e => e.name === id).apply(root)].length, 0);
    const extra = expr('x IN (1,2)'); extra.attrs.separator = 'OR'; assert.equal(expandedLiteralIn(extra), null);
    for (const operator of ['IN', 'NOT IN']) {
        const empty = expr('x IN (1)'); empty.attrs.operator = operator; empty.slots.right.slots.value = [];
        assert.equal(expandedLiteralIn(empty), null);
    }
    const window = expr('x IN (1,2)'); window.slots.left.slots.over = {kind: 'Window', attrs: {}, slots: {}};
    assert.equal(expandedLiteralIn(window), null);
    assert.equal(expandedLiteralIn(expr('(x,y) IN (1,2)')), null);
});

test('schema-text observation blocks new DDL rewrites while ordinary SELECT comparisons remain available', () => {
    for (const [name, expression, alternate] of [[id,"x IN ('ja','nein')","x='ja' OR x='nein'"],
        ['rewriteBetweenRange','x BETWEEN 1 AND 3','x>=1 AND x<=3']]) {
        for (const statement of [value=>'ALTER TABLE sample ADD flag TEXT CHECK('+value+')',
            value=>'CREATE TABLE fresh(x TEXT CHECK('+value+'))']) {
            const root=ast(statement(expression)),target=ast(statement(alternate));
            const plain=createEditGraph(target,root,schema),guarded=createEditGraph(target,root,schema,{}, {schemaMetadataObserved:true});
            assert.ok([...plain.edits.find(edit=>edit.name===name).apply(root)].length>0);
            assert.equal([...guarded.edits.find(edit=>edit.name===name).apply(root)].length,0,statement(expression));
        }
        const root=ast('SELECT x FROM sample WHERE '+expression),target=ast('SELECT x FROM sample WHERE '+alternate);
        const graph=createEditGraph(target,root,schema,{}, {schemaMetadataObserved:true});
        assert.ok([...graph.edits.find(edit=>edit.name===name).apply(root)].length>0);
    }
});

test('all offered default-free edges preserve both fact sets around literal IN and NOT IN', t => {
    const contexts = [value => 'SELECT ' + value + ' AS result FROM sample',
        value => 'SELECT x FROM sample WHERE NOT(' + value + ')',
        value => 'ALTER TABLE sample ADD flag TEXT CHECK(' + value + ')',
        value => 'UPDATE sample SET x=1 WHERE ' + value,
        value => 'SELECT CASE WHEN ' + value + ' THEN 1 WHEN NOT(' + value + ') THEN 0 ELSE NULL END AS result FROM sample'];
    let checked = 0;
    for (const [list, comparisons] of forms) for (const context of contexts) {
        const answer = ast(context(list)), reference = ast(context(comparisons)), graph = createEditGraph(reference, answer, schema);
        for (const root of [answer, reference]) {
            const symbols = set(symbolFacts(graph.abstractRoot(root))), predicates = set(predicateFacts(graph.abstractRoot(root)));
            for (const edit of graph.edits.filter(e => e.cost === 0)) for (const next of edit.apply(root)) {
                assert.deepEqual(set(symbolFacts(graph.abstractRoot(next.root))), symbols, context(list) + ': ' + edit.name);
                assert.deepEqual(set(predicateFacts(graph.abstractRoot(next.root))), predicates, context(list) + ': ' + edit.name);
                checked++;
            }
        }
    }
    assert.ok(checked > 100); t.diagnostic(checked + ' actual free edges preserve both abstract fact sets');
});

test('membership paths are explicit zero-cost witnesses with and without heuristic guidance', async () => {
    for (const [list, comparisons] of forms.slice(0, 3)) {
        const answer = ast('ALTER TABLE sample ADD flag TEXT CHECK(' + list + ')');
        const reference = ast('ALTER TABLE sample ADD flag TEXT CHECK(' + comparisons + ')'), graph = createEditGraph(reference, answer, schema);
        for (const useHeuristic of [true, false]) {
            const result = await shortestSqlEditPath(reference, answer, graph, {visited: 0, async tick() {}}, {useHeuristic});
            assert.equal(result.distance, 0); assert.equal(result.edits.length, 1); assert.equal(result.edits[0].name, id);
            assert.equal(stableKey(replayOperation(answer, result.edits[0].operation)), stableKey(reference));
        }
    }
});

// SQL is executed only inside installed Headless Chrome using the unchanged
// SQLite 3.22 distribution. The volatile witness registers a test-only scalar
// function in that browser SQLite instance to make evaluation counts exact.
test('SQLite 3.22 browser oracle preserves NULL/affinity/collation and exposes excluded counterexamples',
    {skip: !process.env.CHROME_CDP_URL}, async t => {
    const {chromium} = createRequire(import.meta.url)('playwright');
    const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL), context = await browser.newContext();
    context.setDefaultTimeout(0); context.setDefaultNavigationTimeout(0);
    try {
        const page = await context.newPage(), base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
        await page.route(base + '/__in_list_oracle__', r => r.fulfill({contentType: 'text/html', body: '<!doctype html><title>Literal IN oracle</title>'}));
        await page.goto(base + '/__in_list_oracle__'); assert.match(await page.evaluate(() => navigator.userAgent), /HeadlessChrome/);
        await page.addScriptTag({url: base + '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/lib/sql.js/sql.js'});
        const observed = await page.evaluate(() => {
            const db = new SQL.Database();
            try {
                const version = db.exec('SELECT sqlite_version() AS version')[0].values[0][0], pairs = [], wrong = [];
                for (const [name, definition] of [['untyped',''], ['text','TEXT'], ['numeric','NUMERIC'], ['blob','BLOB'], ['nocase','TEXT COLLATE NOCASE']]) {
                    db.exec('CREATE TABLE ' + name + '(x ' + definition + ");INSERT INTO " + name + " VALUES(NULL),(0),(1),(2),(1.5),('1'),('ja'),('JA'),('nein'),('other'),(x'00FF'),(x'');");
                    for (const [left, right] of [
                        ["x IN ('ja','nein')", "x='ja' OR x='nein'"],
                        ['x NOT IN (1,2,NULL)', 'x<>1 AND x<>2 AND x<>NULL'],
                        ['x IN (1,NULL,1)', 'x=1 OR x=NULL OR x=1'],
                        ['x IN (1)', 'x=1'], ['x NOT IN(NULL)', 'x<>NULL'],
                        ["CAST(x AS TEXT) IN ('1','2')", "CAST(x AS TEXT)='1' OR CAST(x AS TEXT)='2'"],
                        ["x COLLATE NOCASE IN ('ja','nein')", "x COLLATE NOCASE='ja' OR x COLLATE NOCASE='nein'"],
                        ["x IN (x'00FF',x'')", "x=x'00FF' OR x=x''"]
                    ]) pairs.push({name,left,right,a:db.exec('SELECT '+left+' AS result FROM '+name+' ORDER BY rowid'),b:db.exec('SELECT '+right+' AS result FROM '+name+' ORDER BY rowid')});
                }
                db.exec("CREATE TABLE affinity(x,a NUMERIC);INSERT INTO affinity VALUES('2',2);");
                for (const [left,right,from] of [
                    ['x IN(a)','x=a','affinity'],
                    ['x IN(CAST(2 AS INTEGER))','x=CAST(2 AS INTEGER)','affinity'],
                    ["x IN('ja' COLLATE NOCASE,'nein')", "x='ja' COLLATE NOCASE OR x='nein'", 'text'],
                    ["x COLLATE NOCASE IN('ja','nein')", "x='ja' OR x='nein'", 'text'],
                    ['x NOT IN(1,NULL)','x<>1','untyped'],
                    ['x IN()','x=NULL','untyped']
                ]) wrong.push({left,right,a:db.exec('SELECT '+left+' AS result FROM '+from+' ORDER BY rowid'),b:db.exec('SELECT '+right+' AS result FROM '+from+' ORDER BY rowid')});
                for (const [left,right] of [["x IN ('ja','nein')","x='ja' OR x='nein'"],['x BETWEEN 1 AND 3','x>=1 AND x<=3']]) {
                    const schemaText = condition => {
                        db.exec('CREATE TABLE metadata_probe(x CHECK('+condition+'))');
                        const result=db.exec("SELECT sql FROM sqlite_master WHERE name='metadata_probe'");
                        db.exec('DROP TABLE metadata_probe');return result;
                    };
                    wrong.push({left,right,a:schemaText(left),b:schemaText(right)});
                }
                let calls = 0; db.create_function('probe_tick', () => ++calls);
                const volatile = [];
                for (const [left,right] of [['probe_tick() IN(0,2)','probe_tick()=0 OR probe_tick()=2'],['probe_tick() NOT IN(0,2)','probe_tick()<>0 AND probe_tick()<>2']]) {
                    calls=0;const a=db.exec('SELECT '+left+' AS result'),leftCalls=calls;calls=0;const b=db.exec('SELECT '+right+' AS result');volatile.push({a,b,leftCalls,rightCalls:calls});
                }
                return {version,pairs,wrong,volatile};
            } finally {db.close();}
        });
        assert.equal(observed.version,'3.22.0');
        for (const pair of observed.pairs) assert.deepEqual(pair.a,pair.b,pair.name+': '+pair.left);
        for (const pair of observed.wrong) assert.notDeepEqual(pair.a,pair.b,pair.left+' != '+pair.right);
        for (const pair of observed.volatile) {assert.notDeepEqual(pair.a,pair.b);assert.equal(pair.leftCalls,1);assert.equal(pair.rightCalls,2);}
        assert.equal(observed.pairs.length,40);assert.equal(observed.wrong.length,8);assert.equal(observed.volatile.length,2);
        t.diagnostic('SQLite 3.22.0: 40 equivalences across five affinities/collations; 8 semantic/schema and 2 deterministic volatile counterexamples');
    } finally {await context.close();await browser.close();}
});
