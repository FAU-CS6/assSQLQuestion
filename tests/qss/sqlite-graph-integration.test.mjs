import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';
import {heuristicCertificate, shortestSqlEditPath, sqlWorkBound} from '../../lib/qss/src/graph-search.mjs';
import {SQLITE_EQUIVALENCE_STEPS} from '../../lib/qss/src/sqlite-equivalences.mjs';
import {observesSchemaMetadata} from '../../lib/qss/src/schema-observation.mjs';

const schema = {tables: [
    {name: 'sample', type: 'table', columns: [{name: 'id', pk: 1}, {name: 'label'}, {name: 'value'}]},
    {name: 'parent', type: 'table', columns: [{name: 'b', pk: 2}, {name: 'a', pk: 1}, {name: 'label'}]},
    {name: 'other', type: 'table', columns: [{name: 'code', pk: 1}, {name: 'label'}]}
]};
const ast = sql => parseGraphSql(sql, {schema}).root;
const sorted = values => [...values].sort();
const job = () => ({visited: 0, async tick() {}});
const cases = [
    ['toggleAlterAddColumnKeyword', 'ALTER TABLE sample ADD flag TEXT DEFAULT NULL CHECK(flag IS NULL OR flag<>\'\')',
        'ALTER TABLE sample ADD COLUMN flag TEXT DEFAULT NULL CHECK(flag IS NULL OR flag<>\'\')'],
    ['quoteUnboundSqliteString', 'UPDATE sample SET value=1 WHERE label BETWEEN "2000-01-01" AND \'2001-01-01\'',
        "UPDATE sample SET value=1 WHERE label BETWEEN '2000-01-01' AND '2001-01-01'"],
    ['toggleIntegerPrimaryKeyNotNull', 'CREATE TABLE fresh(id INTEGER PRIMARY KEY, value TEXT)',
        'CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL, value TEXT)'],
    ['toggleExplicitPrimaryKeyReference', 'CREATE TABLE child(x,y,FOREIGN KEY(x,y) REFERENCES parent ON DELETE CASCADE)',
        'CREATE TABLE child(x,y,FOREIGN KEY(x,y) REFERENCES parent(a,b) ON DELETE CASCADE)']
];
const samples = cases.map(([name, before, after]) => ({name, before, after})).concat([
    {name: 'combined-ddl', before: 'CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL,x TEXT DEFAULT "unset",parent_id REFERENCES sample(id))',
        after: "CREATE TABLE fresh(id INTEGER PRIMARY KEY,x TEXT DEFAULT 'unset',parent_id,FOREIGN KEY(parent_id) REFERENCES sample)"},
    {name: 'correlated-bindings', before: 'SELECT s.id AS chosen FROM sample s WHERE s.value>0 AND s.label<>"forbidden"',
        after: "SELECT q.id AS chosen FROM sample q WHERE 'forbidden'<>q.label AND q.value>0"},
    {name: 'join-predicates', before: 'SELECT DISTINCT s.label FROM sample s INNER JOIN other o ON s.label=o.label WHERE NOT(s.value=0)',
        after: 'SELECT DISTINCT s.label FROM sample s,other o WHERE s.label=o.label AND s.value<>0'},
    {name: 'nullable-dml', before: 'DELETE FROM sample WHERE value IS NULL OR (label="missing" AND NOT(value<0))',
        after: "DELETE FROM sample WHERE (NOT(value<0) AND label='missing') OR value IS NULL"}
]);

test('registered SQLite steps retain explicit costs and concrete, replayable graph vertices', () => {
    assert.deepEqual(cases.map(([id]) => id), SQLITE_EQUIVALENCE_STEPS.map(step => step.id));
    cases.forEach(([name, before, after], i) => {
        for (const [source, target] of [[before, after], [after, before]]) {
            const from = ast(source), to = ast(target), original = stableKey(from);
            for (const price of [0, i + 3]) {
                const graph = createEditGraph(to, from, schema, {[name]: price});
                const edit = graph.edits.find(edit => edit.name === name);
                assert.ok(edit, name); assert.equal(edit.cost, price);
                const change = [...edit.apply(from)].find(next => stableKey(next.root) === stableKey(to));
                assert.ok(change, name); assert.equal(change.operation.cost, price);
                assert.notEqual(stableKey(from), stableKey(to), 'The concrete ASTs must remain distinct');
                assert.notEqual(graph.key(from), graph.key(to), 'The search must not identify a paid edit for free');
                assert.equal(stableKey(replayOperation(from, change.operation)), stableKey(to));
                assert.deepEqual(sorted(symbolFacts(graph.abstractRoot(from))), sorted(symbolFacts(graph.abstractRoot(to))));
                assert.deepEqual(sorted(predicateFacts(graph.abstractRoot(from))), sorted(predicateFacts(graph.abstractRoot(to))));
                assert.equal(graph.abstractRoot(from), graph.abstractRoot(from), 'Persistent roots cache their fact view');
                assert.equal(stableKey(from), original, 'Computing bounds must never mutate the answer');
            }
        }
    });
});

test('every offered default-free edge preserves both abstract fact sets across realistic SQL roots', t => {
    let checked = 0;
    const covered = new Set();
    for (const sample of samples) {
        const reference = ast(sample.after), answer = ast(sample.before);
        const graph = createEditGraph(reference, answer, schema);
        // Also audit every one-step SQLite variant. Other free transformations
        // may interact with a new spelling or with an inline/table FK change.
        const roots = new Map([[graph.key(answer), answer], [graph.key(reference), reference]]);
        for (const root of [answer, reference]) for (const edit of graph.edits.filter(e => cases.some(([name]) => e.name === name))) {
            for (const next of edit.apply(root)) roots.set(graph.key(next.root), next.root);
        }
        for (const root of roots.values()) {
            const key = stableKey(root), symbols = sorted(symbolFacts(graph.abstractRoot(root)));
            const predicates = sorted(predicateFacts(graph.abstractRoot(root)));
            for (const edit of graph.edits.filter(e => e.cost === 0)) for (const next of edit.apply(root)) {
                const label = sample.name + ': ' + edit.name;
                assert.deepEqual(sorted(symbolFacts(graph.abstractRoot(next.root))), symbols, label + ' changed symbol facts');
                assert.deepEqual(sorted(predicateFacts(graph.abstractRoot(next.root))), predicates, label + ' changed predicate facts');
                assert.equal(stableKey(replayOperation(root, next.operation)), stableKey(next.root), label + ' does not replay');
                covered.add(edit.name); checked++;
            }
            assert.equal(stableKey(root), key, sample.name + ' mutated a concrete root');
        }
    }
    for (const [name] of cases) assert.ok(covered.has(name), 'No integration coverage for ' + name);
    assert.ok(covered.has('relocateSingleColumnForeignKey'));
    t.diagnostic(JSON.stringify({freeEdges: checked, coveredEdits: sorted(covered)}));
});

test('positive edges respect their abstract symbol-introduction bound, including FK target changes', t => {
    let checked = 0, changed = 0;
    const covered = new Set();
    for (const sample of samples) {
        const reference = ast(sample.after), answer = ast(sample.before);
        const graph = createEditGraph(reference, answer, schema);
        for (const root of [answer, reference]) {
            const have = symbolFacts(graph.abstractRoot(root));
            for (const edit of graph.edits.filter(e => e.cost > 0)) for (const next of edit.apply(root)) {
                const facts = symbolFacts(graph.abstractRoot(next.root));
                const introduced = [...facts].filter(fact => !have.has(fact));
                assert.ok(introduced.length <= edit.maxNewSymbols,
                    JSON.stringify({sample: sample.name, edit: edit.name, bound: edit.maxNewSymbols, introduced}));
                if (edit.preservesSymbolSet) assert.deepEqual(sorted(facts), sorted(have), edit.name);
                covered.add(edit.name); checked++; changed += introduced.length > 0;
            }
        }
    }
    assert.ok(checked > 100 && changed > 0);
    assert.ok([...covered].some(name => /TableSource.*Table/.test(name)), 'FK/table rename candidates must be exercised');
    t.diagnostic(JSON.stringify({positiveEdges: checked, symbolIntroducingEdges: changed, coveredEdits: covered.size}));
});

test('custom prices weaken bounds without collapsing concrete states or overriding cheaper paths', async () => {
    const answer = ast('ALTER TABLE sample ADD flag TEXT'), reference = ast('ALTER TABLE sample ADD COLUMN flag TEXT');
    for (const price of [0, 3]) {
        const graph = createEditGraph(reference, answer, schema, {toggleAlterAddColumnKeyword: price});
        for (const useHeuristic of [false, true]) {
            const result = await shortestSqlEditPath(reference, answer, graph, job(), {useHeuristic});
            // A teacher-priced equivalence still competes with the ordinary
            // one-cost attribute repair in the same declared edit graph.
            assert.equal(result.distance, price === 0 ? 0 : 1);
            assert.equal(result.edits.reduce((sum, edit) => sum + edit.cost, 0), result.distance);
            const replay = result.edits.reduce((root, edit) => replayOperation(root, edit.operation), answer);
            assert.equal(stableKey(replay), stableKey(reference));
        }
    }
    const from = ast("SELECT 'old' AS result"), to = ast("SELECT 'new' AS result");
    const paid = createEditGraph(to, from, schema), change = paid.edits.find(edit =>
        edit.cost > 0 && [...edit.apply(from)].some(next => stableKey(next.root) === stableKey(to)));
    assert.ok(change && change.maxNewSymbols > 0);
    const customized = createEditGraph(to, from, schema, {[change.name]: 0, quoteUnboundSqliteString: 4});
    assert.equal(heuristicCertificate(customized.edits).enabled, false, 'A new free symbol-introducing edge disables this bound');
    const result = await shortestSqlEditPath(to, from, customized, job());
    assert.equal(result.distance, 0);
    assert.equal(result.edits[0].cost, 0);
    const work = sqlWorkBound(to, customized, 0);
    for (const edit of customized.edits) assert.ok(work.decrease(edit) <= edit.cost,
        'Combined work bounds must fall back to a maximum when one edit pays for several effects: ' + edit.name);
});

test('metadata observations conservatively block sensitive registered edges through request requirements', () => {
    const observations = [
        {controlSql: 'PRAGMA table_info(fresh)'},
        {controlSql: 'PRAGMA foreign_key_list(child)'},
        {controlSql: 'SELECT sql FROM sqlite_schema'},
        {controlSql: "SELECT * FROM pragma_table_info('fresh')"},
        {schemaSql: 'CREATE VIEW diagnostic AS SELECT sql FROM sqlite_master'},
        {schema: {tables: [{name: 'diagnostic', type: 'view', columns: []}]}},
        // Conservatively matching metadata names inside strings is permitted;
        // a guard can withhold a free edge but must never award equivalence.
        {controlSql: "SELECT 'sqlite_schema' AS label"}
    ];
    for (const observation of observations) {
        assert.equal(observesSchemaMetadata(observation), true, JSON.stringify(observation));
        for (const [name, before, after] of cases.slice(1)) {
            const reference = ast(after), answer = ast(before);
            const graph = createEditGraph(reference, answer, schema, {}, {
                schemaMetadataObserved: observesSchemaMetadata(observation)
            });
            assert.equal([...graph.edits.find(edit => edit.name === name).apply(answer)].length, 0, name);
            assert.notEqual(graph.key(answer), graph.key(reference));
        }
    }
    assert.equal(observesSchemaMetadata({schemaSql: 'CREATE TABLE sample(id INTEGER)',
        controlSql: 'PRAGMA foreign_keys=ON; SELECT * FROM sample'}), false);
});

test('optional ADD COLUMN remains a priced graph edge under schema inspection while EXPLAIN stays protected', async () => {
    const plain = 'ALTER TABLE sample ADD flag TEXT DEFAULT NULL CHECK(flag IS NULL OR flag<>\'\')';
    const explicit = plain.replace('ADD flag', 'ADD COLUMN flag');
    const name = 'toggleAlterAddColumnKeyword';
    for (const [before, after] of [[plain, explicit], [explicit, plain]]) {
        const source = ast(before), target = ast(after);
        for (const price of [0, 1, 7]) {
            const graph = createEditGraph(target, source, schema, {[name]: price}, {schemaMetadataObserved: true});
            const edge = [...graph.edits.find(edit => edit.name === name).apply(source)]
                .find(edge => stableKey(edge.root) === stableKey(target));
            assert.ok(edge); assert.equal(edge.operation.cost, price);
            assert.equal(stableKey(replayOperation(source, edge.operation)), stableKey(target));
            if (price === 0) {
                const result = await shortestSqlEditPath(target, source, graph, job());
                assert.equal(result.distance, 0);
                assert.equal(result.edits[0].name, name);
            }
        }
    }
    const source = ast('EXPLAIN ' + explicit), target = ast('EXPLAIN ' + plain);
    const graph = createEditGraph(target, source, schema, {}, {schemaMetadataObserved: true});
    assert.equal([...graph.edits.find(edit => edit.name === name).apply(source)].length, 0);
});

// Optional real browser engine coverage runs only after the parent integration
// builds the browser bundle. SQL is never executed in Node by these tests.
test('browser engine carries control SQL into metadata-sensitive equivalence guards',
    {skip: !process.env.CHROME_CDP_URL}, async () => {
    const {chromium} = createRequire(import.meta.url)('playwright');
    const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL);
    const context = await browser.newContext(); context.setDefaultTimeout(0); context.setDefaultNavigationTimeout(0);
    try {
        const page = await context.newPage(), base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
        await page.route(base + '/__sqlite_graph_integration__', route => route.fulfill({contentType: 'text/html', body: '<!doctype html><title>Graph integration</title>'}));
        await page.goto(base + '/__sqlite_graph_integration__');
        assert.match(await page.evaluate(() => navigator.userAgent), /HeadlessChrome/);
        await page.addScriptTag({url: base + '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/lib/qss/qss.js'});
        for (const [name, before, after] of cases.slice(1)) {
            for (const observed of [false, true]) {
                const request = {reference: after, answer: before, schema, schemaSql: 'CREATE TABLE sample(id INTEGER PRIMARY KEY,label,value);',
                    controlSql: observed ? 'SELECT sql FROM sqlite_schema' : 'SELECT * FROM sample', maxPoints: 1, scale: 1};
                const result = await page.evaluate(request => QSS.evaluate(request), request);
                assert.equal(result.points, observed ? 0 : 1, name + ': ' + JSON.stringify(result));
                assert.equal(result.scoreCertifiedWithinModel, true);
                if (!observed) assert.ok(result.edits.some(edit => edit.name === name));
            }
        }
    } finally { await context.close(); await browser.close(); }
});
