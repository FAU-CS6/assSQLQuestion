import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import vm from 'node:vm';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {replayOperation} from '../../lib/qss/src/graph-edits.mjs';

// Anonymous, local-only semantic counterexamples. Production SQL still runs only
// in the browser; no ILIAS/StudOn connection or private question data is used here.
// The bundled browser SQLite accepts legacy DQS strings; explicitly mirror that
// connection option because modern Node SQLite defaults to rejecting them.
const db = new DatabaseSync(':memory:', {enableDoubleQuotedStringLiterals: true});
db.exec(`CREATE TABLE sample(id INTEGER, text_nocase TEXT COLLATE NOCASE, text_binary TEXT COLLATE BINARY, numeric_value NUMERIC, raw_value TEXT, nullable INTEGER);
INSERT INTO sample VALUES(1,'a','B',10,'010',NULL),(2,'B','a',2,'2',0),(3,'Ä','ä',-3,'-3',1),(4,NULL,'A',NULL,NULL,NULL);
CREATE TABLE detail(id INTEGER, item_id INTEGER);
INSERT INTO detail VALUES(1,2),(2,3);
CREATE TABLE unicode_names("Ä" INTEGER,"ä" INTEGER);
INSERT INTO unicode_names VALUES(1,2);`);
let calls = 0;
db.function('probe', {deterministic: false}, expected => Number(++calls === expected));
db.exec('CREATE VIEW volatile_aliases AS SELECT id,probe(1) AS a,probe(2) AS b FROM sample;');
const schema = {tables: ['sample', 'detail', 'unicode_names', 'volatile_aliases'].map(name => ({name,
    type: name === 'volatile_aliases' ? 'view' : 'table',
    columns: db.prepare('PRAGMA table_info("' + name + '")').all()}))};
const context = {setTimeout, clearTimeout, AbortController};
vm.createContext(context);
vm.runInContext(readFileSync(new URL('../../lib/qss/qss.js', import.meta.url), 'utf8'), context);
const rows = sql => {
    calls = 0;
    return db.prepare(sql).all().map(row => JSON.stringify(Object.values(row))).sort();
};
const compare = (reference, answer) => context.QSS.evaluate({reference, answer, schema, maxPoints: 5, referenceExecutionValid: true, answerExecutionValid: true});

const equivalent = [
    ['ASCII names', 'SELECT id FROM sample WHERE numeric_value>2', 'SELECT ID FROM SAMPLE WHERE NUMERIC_VALUE>2'],
    ['bound aliases', 'SELECT a.id FROM sample a WHERE a.numeric_value>2', 'SELECT b.id FROM sample b WHERE b.numeric_value>2'],
    ['NUMERIC affinity mirror', "SELECT id FROM sample WHERE numeric_value>'2'", "SELECT id FROM sample WHERE '2'<numeric_value"],
    ['TEXT affinity mirror', 'SELECT id FROM sample WHERE raw_value>2', 'SELECT id FROM sample WHERE 2<raw_value'],
    ['declared NOCASE column/literal mirror', "SELECT id FROM sample WHERE text_nocase>'B'", "SELECT id FROM sample WHERE 'B'<text_nocase"],
    ['NULL mirror', 'SELECT id FROM sample WHERE nullable>NULL', 'SELECT id FROM sample WHERE NULL<nullable'],
    ['NULL not-equal', 'SELECT id FROM sample WHERE nullable<>0', 'SELECT id FROM sample WHERE NOT(nullable=0)'],
    ['AND with NULL', 'SELECT id FROM sample WHERE nullable=1 AND numeric_value<0', 'SELECT id FROM sample WHERE numeric_value<0 AND nullable=1'],
    ['INNER JOIN', 'SELECT s.id FROM sample s INNER JOIN detail d ON s.id=d.item_id', 'SELECT s.id FROM sample s,detail d WHERE s.id=d.item_id'],
    ['correlated alias scopes', 'SELECT s.id FROM sample s WHERE EXISTS(SELECT 1 FROM detail d WHERE d.item_id=s.id)', 'SELECT t.id FROM sample t WHERE EXISTS(SELECT 1 FROM detail e WHERE e.item_id=t.id)'],
    ['unrelated volatile projection with pure base predicates',
        'SELECT id,probe(99) AS marker FROM sample WHERE nullable=1 AND numeric_value<0',
        'SELECT id,probe(99) AS marker FROM sample WHERE numeric_value<0 AND nullable=1']
];
for (const [name, reference, answer] of equivalent) test('SQLite-confirmed zero-cost edit path: ' + name, async () => {
    assert.deepEqual(rows(reference), rows(answer));
    const result = await compare(reference, answer);
    assert.equal(result.status, 'exact');
    assert.equal(result.distance, 0);
    assert.equal(result.points, 5);
    assert.equal(result.engine, 'graph-qss-sqlite-v2');
    assert.equal(result.rubric, 'paper-linear-v1');
    const target = parseGraphSql(reference, {schema}).root;
    let replayed = parseGraphSql(answer, {schema}).root;
    if (stableKey(target) !== stableKey(replayed)) {
        assert.ok(result.edits.length > 0, 'The equivalent SQL states are connected by edits, not erased by precanonicalization.');
    }
    for (const edit of result.edits) {
        assert.equal(edit.cost, 0); assert.ok(edit.name);
        replayed = replayOperation(replayed, JSON.parse(JSON.stringify(edit.operation)));
    }
    assert.equal(stableKey(replayed), stableKey(target));
});

const different = [
    ['explicit collation priority', "SELECT id FROM sample WHERE text_nocase COLLATE NOCASE>'B' COLLATE BINARY", "SELECT id FROM sample WHERE 'B' COLLATE BINARY<text_nocase COLLATE NOCASE"],
    ['implicit column collation priority', 'SELECT id FROM sample WHERE text_nocase>text_binary', 'SELECT id FROM sample WHERE text_binary<text_nocase'],
    ['CAST retains declared column collation', 'SELECT id FROM sample WHERE CAST(text_nocase AS TEXT)>text_binary', 'SELECT id FROM sample WHERE text_binary<CAST(text_nocase AS TEXT)'],
    ['CAST NUMERIC versus TEXT', 'SELECT id FROM sample WHERE CAST(raw_value AS NUMERIC)=10', 'SELECT id FROM sample WHERE CAST(raw_value AS TEXT)=10'],
    ['single-quoted string case', "SELECT 'X' AS value", "SELECT 'x' AS value"],
    ['double-quoted string fallback case', 'SELECT "X" AS value', 'SELECT "x" AS value'],
    ['Unicode names are not ASCII-folded', 'SELECT Ä FROM unicode_names', 'SELECT ä FROM unicode_names'],
    ['three-valued IS versus equality', 'SELECT id FROM sample WHERE nullable IS NULL', 'SELECT id FROM sample WHERE nullable=NULL'],
    ['numeric storage class', 'SELECT typeof(1.0) AS value', 'SELECT typeof(1) AS value'],
    ['AND of nondeterministic calls', 'SELECT id FROM sample WHERE probe(1) AND probe(2)', 'SELECT id FROM sample WHERE probe(2) AND probe(1)'],
    ['AND of aliases bound to nondeterministic SELECT expressions',
        'SELECT probe(1) AS a,probe(2) AS b FROM sample WHERE a AND b',
        'SELECT probe(1) AS a,probe(2) AS b FROM sample WHERE b AND a'],
    ['AND of nondeterministic derived-table columns',
        'SELECT d.id,d.a,d.b FROM (SELECT id,probe(1) AS a,probe(2) AS b FROM sample) d WHERE d.a AND d.b',
        'SELECT d.id,d.a,d.b FROM (SELECT id,probe(1) AS a,probe(2) AS b FROM sample) d WHERE d.b AND d.a'],
    ['AND of nondeterministic view columns',
        'SELECT id,a,b FROM volatile_aliases WHERE a AND b',
        'SELECT id,a,b FROM volatile_aliases WHERE b AND a'],
    ['AND of nondeterministic CTE columns',
        'WITH named AS (SELECT id,probe(1) AS a,probe(2) AS b FROM sample) SELECT id,a,b FROM named WHERE a AND b',
        'WITH named AS (SELECT id,probe(1) AS a,probe(2) AS b FROM sample) SELECT id,a,b FROM named WHERE b AND a'],
    ['outer join is not INNER JOIN', 'SELECT s.id FROM sample s LEFT JOIN detail d ON s.id=d.item_id', 'SELECT s.id FROM sample s,detail d WHERE s.id=d.item_id'],
    ['correlated reference is not an inner reference', 'SELECT s.id FROM sample s WHERE EXISTS(SELECT 1 FROM detail d WHERE d.item_id=s.id)', 'SELECT s.id FROM sample s WHERE EXISTS(SELECT 1 FROM detail d WHERE d.item_id=d.id)'],
    ['SQL equality is not associative', 'SELECT ((2=1)=0) AS value', 'SELECT (2=(1=0)) AS value']
];
for (const [name, reference, answer] of different) test('SQLite-confirmed counterexample remains distinct: ' + name, async () => {
    assert.notDeepEqual(rows(reference), rows(answer));
    const result = await compare(reference, answer);
    assert.ok(['exact', 'score-zero-certified'].includes(result.status), JSON.stringify(result));
    assert.ok(Number.isFinite(result.points) && result.points < 5);
    if (result.status === 'exact') {
        assert.ok(result.distance > 0);
        assert.equal(result.edits.reduce((sum, edit) => sum + edit.cost, 0), result.distance);
        assert.equal(result.points, Math.max(5 - result.distance * result.scale, 0));
    } else {
        assert.equal(result.distance, null); assert.equal(result.points, 0);
        assert.ok(result.lowerBound >= 5 / result.scale);
        assert.equal(result.scoreCertifiedWithinModel, true);
    }
});

test('explicit literal COLLATE is conservatively retained even when the mirror is equivalent', async () => {
    const reference = "SELECT id FROM sample WHERE text_nocase>'B' COLLATE BINARY";
    const answer = "SELECT id FROM sample WHERE 'B' COLLATE BINARY<text_nocase";
    assert.deepEqual(rows(reference), rows(answer));
    const result = await compare(reference, answer);
    assert.ok(['exact', 'score-zero-certified'].includes(result.status));
    assert.ok(Number.isFinite(result.points) && result.points < 5, 'The unproved equivalence is intentionally absent from the edit catalogue.');
    if (result.status === 'exact') assert.ok(result.distance > 0);
    else assert.ok(result.lowerBound >= 5 / result.scale);
});

test.after(() => db.close());
