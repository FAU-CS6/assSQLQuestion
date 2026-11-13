import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {registerSQLiteEquivalences, SQLITE_EQUIVALENCE_STEPS, sqliteStringQuoteCandidates,
    sqliteForeignKeyColumnCandidates, sqliteEquivalenceFactView} from '../../lib/qss/src/sqlite-equivalences.mjs';

const schema = {tables: [
    {name: 'sample', type: 'table', columns: [{name: 'id', pk: 1}, {name: 'label'}, {name: 'value'}]},
    {name: 'parent', type: 'table', columns: [{name: 'b', pk: 2}, {name: 'a', pk: 1}, {name: 'unique_other', pk: 0}]}
]};
const ast = (sql, context = schema) => parseGraphSql(sql, {schema: context}).root;
const get = (value, path) => path.reduce((v, key) => v?.[key], value);
function edits(context = schema, overrides = {}, options = {}) {
    const result = new Map();
    registerSQLiteEquivalences((name, description, defaultCost, generate, annotations) => {
        result.set(name, {name, description, defaultCost, annotations, *apply(root) {
            for (const change of generate(root)) {
                const operation = {type: 'sql-edit', name, cost: overrides[name] ?? defaultCost,
                    path: change.path, before: get(root, change.path), after: change.after};
                yield {root: replayOperation(root, operation), operation};
            }
        }});
    }, context, options);
    return result;
}
const names = SQLITE_EQUIVALENCE_STEPS.map(s => s.id);
function edge(before, after, id, context = schema, options = {}) {
    const from = ast(before, context), target = stableKey(ast(after, context));
    return [...edits(context, {}, options).get(id).apply(from)].find(e => stableKey(e.root) === target);
}

test('optional ALTER ADD COLUMN is an explicit reversible, individually priced edit', () => {
    const a = 'ALTER TABLE sample ADD flag TEXT DEFAULT NULL CHECK(flag IS NULL OR flag<>\'\')';
    const b = a.replace('ADD flag', 'ADD COLUMN flag');
    assert.ok(edge(a, b, names[0])); assert.ok(edge(b, a, names[0]));
    const changed = [...edits(schema, {[names[0]]: 7}).get(names[0]).apply(ast(a))];
    assert.equal(changed[0].operation.cost, 7);
    assert.equal(stableKey(replayOperation(ast(a), changed[0].operation)), stableKey(ast(b)));
    assert.equal([...edits().get(names[0]).apply(ast('ALTER TABLE sample RENAME TO renamed'))].length, 0);
});

test('DQS string spelling has a guarded reversible edge in DML, defaults, CHECKs and aliased outputs', () => {
    const pairs = [
        ['UPDATE sample SET value=1 WHERE label BETWEEN "2000-01-01" AND \'2001-01-01\'',
            "UPDATE sample SET value=1 WHERE label BETWEEN '2000-01-01' AND '2001-01-01'"],
        ['SELECT "unbound" AS answer FROM sample', "SELECT 'unbound' AS answer FROM sample"],
        ['SELECT "unbound" COLLATE NOCASE AS answer', "SELECT 'unbound' COLLATE NOCASE AS answer"],
        ['CREATE TABLE fresh(x TEXT DEFAULT "x")', "CREATE TABLE fresh(x TEXT DEFAULT 'x')"],
        ['CREATE TABLE fresh(x TEXT CHECK(x<>"forbidden"))', "CREATE TABLE fresh(x TEXT CHECK(x<>'forbidden'))"],
        ['ALTER TABLE sample ADD y TEXT CHECK(y<>"forbidden")', "ALTER TABLE sample ADD y TEXT CHECK(y<>'forbidden')"],
        ['WITH q AS (SELECT id FROM sample) SELECT "unbound" AS answer FROM q',
            "WITH q AS (SELECT id FROM sample) SELECT 'unbound' AS answer FROM q"]
    ];
    for (const [a, b] of pairs) {
        assert.ok(edge(a, b, names[1]), a); assert.ok(edge(b, a, names[1]), b);
    }
    assert.equal([...edits(schema, {}, {doubleQuotedStrings: false}).get(names[1]).apply(ast('SELECT "unbound" AS v'))].length, 0);
    assert.equal([...edits(schema, {}, {schemaMetadataObserved: true}).get(names[1]).apply(ast('CREATE TABLE fresh(x TEXT DEFAULT "x")'))].length, 0);
});

test('DQS guards retain name resolution, implicit output names, unknown schemas and newly introduced bindings', () => {
    const blocked = [
        "SELECT 'label' AS answer FROM sample", "SELECT 'rowid' AS answer FROM sample",
        "SELECT 'id' AS answer FROM (SELECT * FROM sample) q",
        "WITH q(renamed) AS (SELECT id FROM sample) SELECT 'renamed' AS answer FROM q",
        "SELECT id AS renamed FROM sample WHERE 'renamed'='renamed'",
        "SELECT (SELECT 'label' AS inner_result) AS outer_result FROM sample",
        "SELECT 'unbound'", "SELECT length('unbound') FROM sample",
        "SELECT 'unbound' AS answer FROM unknown_table",
        "SELECT 'unbound' AS answer FROM (SELECT length(label) FROM sample) q",
        "CREATE TABLE fresh(x TEXT CHECK(x<>'x'))",
        "ALTER TABLE sample ADD y TEXT CHECK(y<>'y')"
    ];
    for (const sql of blocked) assert.equal(sqliteStringQuoteCandidates(ast(sql), schema).length, 0, sql);
    const root = ast('SELECT "new_name" AS answer FROM sample');
    assert.equal(sqliteStringQuoteCandidates(root, schema).length, 1);
    const changed = structuredClone(schema); changed.tables[0].columns.push({name: 'new_name'});
    // This is deliberately the same AST, not reparsed, as in intermediate graph states.
    assert.equal(sqliteStringQuoteCandidates(root, changed).length, 0);
    const sql = 'CREATE TABLE fresh(x TEXT); ALTER TABLE fresh ADD y TEXT; SELECT "y" AS answer FROM fresh';
    assert.equal(sqliteStringQuoteCandidates(ast(sql), schema).length, 0);
    const maybeExisting = 'CREATE TABLE IF NOT EXISTS fresh(x); SELECT "old" AS answer FROM fresh';
    assert.equal(sqliteStringQuoteCandidates(ast(maybeExisting, {}), {}).length, 0);
    assert.equal(sqliteStringQuoteCandidates(ast(maybeExisting), schema).length, 1,
        'A complete schema can prove that IF NOT EXISTS will create the new table');
    const renamed = 'ALTER TABLE sample RENAME TO fresh; ' + maybeExisting;
    assert.equal(sqliteStringQuoteCandidates(ast(renamed), schema).length, 0,
        'An unmodelled rename invalidates proof of an absent table');
});

test('INTEGER rowid PK NOT NULL toggle is narrow, reversible and blocked by metadata observation', () => {
    for (const suffix of ['', ' AUTOINCREMENT']) {
        const a = `CREATE TABLE fresh(id INTEGER PRIMARY KEY${suffix}, value TEXT)`;
        const b = `CREATE TABLE fresh(id INTEGER PRIMARY KEY${suffix} NOT NULL, value TEXT)`;
        assert.ok(edge(a, b, names[2])); assert.ok(edge(b, a, names[2]));
        assert.equal([...edits(schema, {}, {schemaMetadataObserved: true}).get(names[2]).apply(ast(a))].length, 0);
    }
    for (const sql of ['CREATE TABLE fresh(id INT PRIMARY KEY)', 'CREATE TABLE fresh(id TEXT PRIMARY KEY NOT NULL)',
        'CREATE TABLE fresh(a INTEGER,b INTEGER,PRIMARY KEY(a,b))',
        'CREATE TABLE fresh(id INTEGER PRIMARY KEY) WITHOUT ROWID',
        'CREATE TABLE fresh(id INTEGER PRIMARY KEY) STRICT']) {
        assert.equal([...edits().get(names[2]).apply(ast(sql))].length, 0, sql);
    }
    // The adapter currently rejects inline DESC; also protect future AST support.
    const desc = ast('CREATE TABLE fresh(id INTEGER PRIMARY KEY)');
    desc.slots.statements[0].slots.create_definitions[0].attrs.primary_key = 'PRIMARY KEY DESC';
    assert.equal([...edits().get(names[2]).apply(desc)].length, 0);
    const metadata = ast('CREATE TABLE fresh(id INTEGER PRIMARY KEY)');
    metadata.slots.statements.push({kind: 'Pragma', attrs: {name: 'table_info'}, slots: {}});
    assert.equal([...edits().get(names[2]).apply(metadata)].length, 0);
});

test('implicit FK lists expand only exact ordered schema primary keys, preserving actions and arity', () => {
    const a = 'CREATE TABLE child(x,y,FOREIGN KEY(x,y) REFERENCES parent ON DELETE CASCADE)';
    const b = 'CREATE TABLE child(x,y,FOREIGN KEY(x,y) REFERENCES parent(a,b) ON DELETE CASCADE)';
    assert.ok(edge(a, b, names[3])); assert.ok(edge(b, a, names[3]));
    const singleA = 'CREATE TABLE child(x REFERENCES sample)', singleB = 'CREATE TABLE child(x REFERENCES sample(id))';
    assert.ok(edge(singleA, singleB, names[3])); assert.ok(edge(singleB, singleA, names[3]));
    for (const sql of ['CREATE TABLE child(x REFERENCES parent)',
        'CREATE TABLE child(x,y,FOREIGN KEY(x,y) REFERENCES parent(b,a))',
        'CREATE TABLE child(x REFERENCES parent(unique_other))',
        'CREATE TABLE child(x REFERENCES unknown_table)']) {
        assert.equal(sqliteForeignKeyColumnCandidates(ast(sql), schema).length, 0, sql);
    }
    const booleanPk = {tables: [{name: 'sample', columns: [{name: 'id', pk: true}]}]};
    assert.equal(sqliteForeignKeyColumnCandidates(ast(singleA), booleanPk).length, 0);
    const gapPk = {tables: [{name: 'sample', columns: [{name: 'id', pk: 2}]}]};
    assert.equal(sqliteForeignKeyColumnCandidates(ast(singleA), gapPk).length, 0);
    assert.equal([...edits(schema, {}, {schemaMetadataObserved: true}).get(names[3]).apply(ast(a))].length, 0);
});

test('FK parent keys can come from a preceding CREATE or proven self-reference, never a later declaration', () => {
    const a = 'CREATE TABLE fresh(a,b,PRIMARY KEY(b,a)); CREATE TABLE child(x,y,FOREIGN KEY(x,y) REFERENCES fresh)';
    const b = a.replace('REFERENCES fresh)', 'REFERENCES fresh(b,a))');
    assert.ok(edge(a, b, names[3])); assert.ok(edge(b, a, names[3]));
    const selfA = 'CREATE TABLE fresh(a,b,PRIMARY KEY(b,a),FOREIGN KEY(a,b) REFERENCES fresh)';
    assert.ok(edge(selfA, selfA.replace('REFERENCES fresh)', 'REFERENCES fresh(b,a))'), names[3]));
    assert.equal(sqliteForeignKeyColumnCandidates(ast('CREATE TABLE child(x REFERENCES fresh);CREATE TABLE fresh(id INTEGER PRIMARY KEY)'), schema).length, 0);
    const existingWithoutPk = {tables: [{name: 'fresh', columns: [{name: 'id', pk: 0}]}]};
    const ignoredCreate = 'CREATE TABLE IF NOT EXISTS fresh(id INTEGER PRIMARY KEY);CREATE TABLE child(x REFERENCES fresh)';
    assert.equal(sqliteForeignKeyColumnCandidates(ast(ignoredCreate), existingWithoutPk).length, 0);
    assert.equal(sqliteForeignKeyColumnCandidates(ast(ignoredCreate), {}).length, 0);
});

test('all four edges retain named cost overrides and replayable concrete operations', () => {
    const inputs = ['ALTER TABLE sample ADD flag TEXT', 'SELECT "unbound" AS answer',
        'CREATE TABLE fresh(id INTEGER PRIMARY KEY)', 'CREATE TABLE child(x REFERENCES sample)'];
    const configured = edits(schema, Object.fromEntries(names.map((name, i) => [name, i + 2])));
    names.forEach((name, i) => {
        const root = ast(inputs[i]), [change] = [...configured.get(name).apply(root)];
        assert.ok(change, name); assert.equal(change.operation.name, name); assert.equal(change.operation.cost, i + 2);
        assert.equal(stableKey(replayOperation(root, change.operation)), stableKey(change.root));
    });
});

test('heuristic-only fact views merge every offered free edge without modifying graph vertices', () => {
    for (const sql of ['ALTER TABLE sample ADD COLUMN flag TEXT',
        'UPDATE sample SET value=1 WHERE label BETWEEN "2000-01-01" AND "2001-01-01"',
        'CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL,x TEXT DEFAULT "x")',
        'CREATE TABLE child(x,y,FOREIGN KEY(x,y) REFERENCES parent)']) {
        const root = ast(sql), key = stableKey(root), abstract = stableKey(sqliteEquivalenceFactView(root, schema));
        for (const edit of edits().values()) for (const next of edit.apply(root)) {
            assert.equal(stableKey(sqliteEquivalenceFactView(next.root, schema)), abstract, edit.name);
        }
        assert.equal(stableKey(root), key, 'Original graph vertex was mutated');
    }
    const a = ast('CREATE TABLE fresh(id INTEGER PRIMARY KEY)'), b = ast('CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL)');
    // A weaker bound is allowed even when metadata observation blocks the edit.
    assert.equal(stableKey(sqliteEquivalenceFactView(a, schema, {schemaMetadataObserved: true})),
        stableKey(sqliteEquivalenceFactView(b, schema, {schemaMetadataObserved: true})));
});

// All executed SQL stays in the plugin's actual SQLite worker in isolated
// installed Headless Chrome. The unit tests above parse ASTs only; no Node SQL.
test('installed Headless Chrome SQLite validates values, NULLs, bindings and counterexamples',
    {skip: !process.env.CHROME_CDP_URL}, async t => {
    const {chromium} = createRequire(import.meta.url)('playwright');
    const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL);
    const context = await browser.newContext(); context.setDefaultTimeout(0); context.setDefaultNavigationTimeout(0);
    try {
        const page = await context.newPage(), base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
        await page.route(base + '/__sqlite_equivalence_oracle__', r => r.fulfill({contentType: 'text/html', body: '<!doctype html><title>SQLite equivalence oracle</title>'}));
        await page.goto(base + '/__sqlite_equivalence_oracle__');
        assert.match(await page.evaluate(() => navigator.userAgent), /HeadlessChrome/);
        const workerPath = process.env.QSS_SQL_ORACLE_WORKER || '/lib/sql.js/worker.sql.js';
        const observations = await page.evaluate(async workerPath => {
            const run = async statements => {
                const worker = new Worker('/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion' + workerPath);
                let serial = 0;
                const call = data => new Promise(resolve => {
                    const id = ++serial;
                    worker.onmessage = e => { if (e.data.id === id) resolve(e.data.error ? {error: true} : e.data.results || []); };
                    worker.onerror = e => { e.preventDefault(); resolve({error: true}); };
                    worker.postMessage({...data, id});
                });
                try {
                    await call({action: 'open'}); const results = [];
                    for (const sql of statements) results.push(await call({action: 'exec', sql}));
                    return results;
                } finally { worker.terminate(); }
            };
            const pairs = [];
            const pair = async (left, right) => pairs.push([await run(left), await run(right)]);
            for (const extra of ['', ' AUTOINCREMENT']) {
                const statements = sql => [sql, 'INSERT INTO t VALUES(NULL,\'first\');INSERT INTO t VALUES(7,\'seven\')',
                    'INSERT INTO t VALUES(NULL,\'automatic\')', 'INSERT INTO t VALUES(7,\'duplicate\')',
                    'UPDATE t SET id=NULL WHERE id=7', "INSERT INTO t VALUES('bad','bad')",
                    'SELECT id,value,typeof(id) AS kind FROM t ORDER BY id'];
                await pair(statements(`CREATE TABLE t(id INTEGER PRIMARY KEY${extra},value TEXT)`),
                    statements(`CREATE TABLE t(id INTEGER PRIMARY KEY${extra} NOT NULL,value TEXT)`));
            }
            await pair(['CREATE TABLE t(id)', 'ALTER TABLE t ADD x TEXT DEFAULT NULL', 'INSERT INTO t(id) VALUES(1)', 'SELECT * FROM t'],
                ['CREATE TABLE t(id)', 'ALTER TABLE t ADD COLUMN x TEXT DEFAULT NULL', 'INSERT INTO t(id) VALUES(1)', 'SELECT * FROM t']);
            await pair(['CREATE TABLE t(id)', "ALTER TABLE t ADD flag TEXT DEFAULT NULL CHECK(flag IS NULL OR flag<>'')",
                'SELECT sql FROM sqlite_master ORDER BY name', 'PRAGMA table_info(t)', 'PRAGMA foreign_key_list(t)'],
                ['CREATE TABLE t(id)', "ALTER TABLE t ADD COLUMN flag TEXT DEFAULT NULL CHECK(flag IS NULL OR flag<>'')",
                    'SELECT sql FROM sqlite_master ORDER BY name', 'PRAGMA table_info(t)', 'PRAGMA foreign_key_list(t)']);
            await pair(["CREATE TABLE t(label);INSERT INTO t VALUES(NULL),('2000-01-01'),('2000-12-31'),('2002-01-01')",
                'SELECT label FROM t WHERE label BETWEEN "2000-01-01" AND "2001-01-01" ORDER BY label'],
                ["CREATE TABLE t(label);INSERT INTO t VALUES(NULL),('2000-01-01'),('2000-12-31'),('2002-01-01')",
                "SELECT label FROM t WHERE label BETWEEN '2000-01-01' AND '2001-01-01' ORDER BY label"]);
            await pair(['CREATE TABLE t(x TEXT DEFAULT "x" CHECK(x<>"forbidden"))',
                'INSERT INTO t DEFAULT VALUES', 'INSERT INTO t VALUES(NULL)', "INSERT INTO t VALUES('forbidden')", 'SELECT x FROM t ORDER BY x'],
                ["CREATE TABLE t(x TEXT DEFAULT 'x' CHECK(x<>'forbidden'))",
                'INSERT INTO t DEFAULT VALUES', 'INSERT INTO t VALUES(NULL)', "INSERT INTO t VALUES('forbidden')", 'SELECT x FROM t ORDER BY x']);
            const fk = explicit => ['PRAGMA foreign_keys=ON;CREATE TABLE p(a,b,PRIMARY KEY(b,a));INSERT INTO p VALUES(1,2)',
                'CREATE TABLE c(x,y,FOREIGN KEY(x,y) REFERENCES p' + explicit + ' ON DELETE CASCADE)',
                'INSERT INTO c VALUES(2,1),(NULL,9)', 'INSERT INTO c VALUES(1,2)',
                'SELECT * FROM c ORDER BY x', 'DELETE FROM p', 'SELECT * FROM c'];
            await pair(fk(''), fk('(b,a)'));
            const witnesses = [];
            witnesses.push([await run(['CREATE TABLE t(id INTEGER PRIMARY KEY)', 'INSERT INTO t VALUES(NULL)', 'SELECT count(*) AS n FROM t']),
                await run(['CREATE TABLE t(id INTEGER PRIMARY KEY) WITHOUT ROWID', 'INSERT INTO t VALUES(NULL)', 'SELECT count(*) AS n FROM t'])]);
            witnesses.push([await run(['CREATE TABLE t(id INTEGER PRIMARY KEY DESC)', 'INSERT INTO t VALUES(NULL)', 'SELECT id FROM t']),
                await run(['CREATE TABLE t(id INTEGER PRIMARY KEY DESC NOT NULL)', 'INSERT INTO t VALUES(NULL)', 'SELECT id FROM t'])]);
            witnesses.push([await run(['CREATE TABLE t(label);INSERT INTO t VALUES(42)', 'SELECT "label" AS v FROM t']),
                await run(['CREATE TABLE t(label);INSERT INTO t VALUES(42)', "SELECT 'label' AS v FROM t"])]);
            witnesses.push([await run(['CREATE TABLE t(id INTEGER PRIMARY KEY)', 'PRAGMA table_info(t)']),
                await run(['CREATE TABLE t(id INTEGER PRIMARY KEY NOT NULL)', 'PRAGMA table_info(t)'])]);
            witnesses.push([await run(['SELECT "unbound"']), await run(["SELECT 'unbound'"])]);
            witnesses.push([await run(fk('(a,b)')), await run(fk('(b,a)'))]);
            witnesses.push([await run(['CREATE TABLE t(label);INSERT INTO t VALUES(42)', 'SELECT (SELECT "label") AS v FROM t']),
                await run(['CREATE TABLE t(label);INSERT INTO t VALUES(42)', "SELECT (SELECT 'label') AS v FROM t"])]);
            witnesses.push([await run(['CREATE TABLE t(label);INSERT INTO t VALUES(1)', 'SELECT label AS named FROM t WHERE "named"=1']),
                await run(['CREATE TABLE t(label);INSERT INTO t VALUES(1)', "SELECT label AS named FROM t WHERE 'named'=1"])]);
            witnesses.push([await run(['CREATE TABLE t(label);INSERT INTO t VALUES(42)', 'SELECT "rowid" AS v FROM t']),
                await run(['CREATE TABLE t(label);INSERT INTO t VALUES(42)', "SELECT 'rowid' AS v FROM t"])]);
            witnesses.push([await run(['WITH q(renamed) AS (SELECT 42) SELECT "renamed" AS v FROM q']),
                await run(["WITH q(renamed) AS (SELECT 42) SELECT 'renamed' AS v FROM q"])]);
            witnesses.push([await run(['CREATE TABLE fresh(old);INSERT INTO fresh VALUES(42)',
                'CREATE TABLE IF NOT EXISTS fresh(x);SELECT "old" AS v FROM fresh']),
                await run(['CREATE TABLE fresh(old);INSERT INTO fresh VALUES(42)',
                "CREATE TABLE IF NOT EXISTS fresh(x);SELECT 'old' AS v FROM fresh"])]);
            const version = (await run(['SELECT sqlite_version() AS version']))[0][0].values[0][0];
            const strictSupported = !(await run(['CREATE TABLE t(id INTEGER PRIMARY KEY) STRICT']))[0].error;
            if (strictSupported) witnesses.push([await run(['CREATE TABLE t(id INTEGER PRIMARY KEY,value INTEGER)', "INSERT INTO t VALUES(NULL,'text')", 'SELECT * FROM t']),
                await run(['CREATE TABLE t(id INTEGER PRIMARY KEY,value INTEGER) STRICT', "INSERT INTO t VALUES(NULL,'text')", 'SELECT * FROM t'])]);
            return {pairs, witnesses, version, strictSupported};
        }, workerPath);
        for (const [left, right] of observations.pairs) assert.deepEqual(left, right);
        for (const [left, right] of observations.witnesses) assert.notDeepEqual(left, right);
        assert.equal(observations.pairs.length, 7); assert.equal(observations.witnesses.length, 11 + Number(observations.strictSupported));
        if (workerPath.includes('/qss-')) assert.equal(observations.strictSupported, true);
        t.diagnostic(`SQLite ${observations.version}; ${observations.pairs.length} equivalent scenarios; ${observations.witnesses.length} counterexamples; worker ${workerPath}`);
    } finally { await context.close(); await browser.close(); }
});
