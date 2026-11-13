import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey, walkNodes} from '../../lib/qss/src/graph-model.mjs';

const parse = sql => parseGraphSql(sql, {allowPartial: false}).root;
const nodes = (root, kind) => [...walkNodes(root)].filter(entry => entry.node.kind === kind).map(entry => entry.node);
const setup = "CREATE TABLE t(id INTEGER PRIMARY KEY,value INTEGER DEFAULT 10,label TEXT DEFAULT 'unset');INSERT INTO t VALUES(1,2,'alpha'),(2,3,'a_x'),(3,NULL,NULL);";
const cases = [
    'WITH RECURSIVE n(x) AS(VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<3) SELECT x FROM n',
    'VALUES(1,2),(3,4);SELECT 1 AS ready',
    'INSERT INTO t DEFAULT VALUES;SELECT * FROM t',
    'UPDATE OR IGNORE t SET id=1 WHERE id=2;SELECT * FROM t',
    'CREATE TABLE parent(a,b,PRIMARY KEY(b,a));CREATE TABLE child(x,y,FOREIGN KEY(x,y) REFERENCES parent(b,a) DEFERRABLE INITIALLY DEFERRED);SELECT * FROM child',
    "CREATE TABLE log(v);CREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO log VALUES(NEW.id); END;INSERT INTO t VALUES(4,5,'four');SELECT * FROM log",
    'BEGIN;UPDATE t SET value=8 WHERE id=1;COMMIT;SELECT * FROM t',
    'SAVEPOINT s;UPDATE t SET value=8 WHERE id=1;ROLLBACK TO s;RELEASE s;SELECT * FROM t',
    'PRAGMA user_version=7;SELECT * FROM t',
    "ANALYZE;SELECT name FROM sqlite_master WHERE name='sqlite_stat1'",
    "ATTACH DATABASE ':memory:' AS aux;CREATE TABLE aux.z(id);DETACH DATABASE aux;SELECT * FROM t",
    'CREATE INDEX ix ON t(label);REINDEX ix;SELECT * FROM t',
    'VACUUM;SELECT * FROM t'
];

test('native SQLite 3.22 statement inventory has structured ASTs and executes in the existing runtime', () => {
    for (const sql of cases) {
        const root = parse(sql);
        assert.ok(root.slots.statements.length > 0);
        assert.ok([...walkNodes(root)].every(({node}) => node.kind && node.attrs && node.slots));
        assert.ok([...walkNodes(root)].every(({node}) => !Object.hasOwn(node.attrs, 'sql')), 'No opaque SQL fragments.');
        const db = new DatabaseSync(':memory:');
        try { db.exec(setup); db.exec(sql); } finally { db.close(); }
    }
});

test('VALUES retains each row, expression, numeric storage class and precision', () => {
    const root = parse("VALUES(9007199254740993,1.0,'a'),(2,3.0,'b')");
    assert.equal(root.slots.statements[0].kind, 'Values');
    assert.equal(root.slots.statements[0].slots.values.length, 2);
    assert.deepEqual(nodes(root, 'NumberLiteral').map(node => [node.attrs.value, node.attrs.storageClass]),
        [['9007199254740993', 'integer'], ['1.0', 'real'], ['2', 'integer'], ['3.0', 'real']]);
    assert.notEqual(stableKey(root), stableKey(parse("VALUES(9007199254740992,1.0,'a'),(2,3.0,'b')")));
    const recursive = parse(cases[0]);
    assert.equal(nodes(recursive, 'Values').length, 1);
    assert.equal(nodes(recursive, 'CompoundSelect').length, 1);
    assert.equal(nodes(recursive, 'CommonTableExpression')[0].attrs.recursive, true);
});

test('VALUES supplies real output names in derived queries CTEs and views', () => {
    for (const sql of ['WITH n AS(VALUES(1)) SELECT "column1" FROM n',
        'SELECT "column1" FROM (VALUES(1))', 'CREATE VIEW v AS VALUES(1);SELECT "column1" FROM v']) {
        assert.equal(nodes(parse(sql), 'DoubleQuotedLiteral').length, 0);
        assert.ok(nodes(parse(sql), 'ColumnReference').some(node => node.attrs.column === 'column1'));
        const db = new DatabaseSync(':memory:');
        try { db.exec(sql); } finally { db.close(); }
    }
    const root = parse('WITH n AS(VALUES(1)) VALUES((SELECT "column1" FROM n))');
    assert.equal(root.slots.statements[0].kind, 'Values');
    assert.equal(root.slots.statements[0].slots.with.length, 1);
    assert.equal(nodes(root, 'DoubleQuotedLiteral').length, 0);
});

test('DEFAULT VALUES and UPDATE conflict policies are explicit operations', () => {
    assert.equal(nodes(parse('INSERT INTO t DEFAULT VALUES'), 'DefaultValues').length, 1);
    assert.notEqual(stableKey(parse('INSERT INTO t DEFAULT VALUES')), stableKey(parse('INSERT INTO t VALUES(NULL)')));
    for (const policy of ['ROLLBACK', 'ABORT', 'REPLACE', 'FAIL', 'IGNORE']) {
        assert.equal(parse('UPDATE OR ' + policy + ' t SET value=1').slots.statements[0].attrs.conflict, policy);
    }
    assert.notEqual(stableKey(parse('UPDATE OR IGNORE t SET id=1')), stableKey(parse('UPDATE OR REPLACE t SET id=1')));
    assert.notEqual(stableKey(parse('UPDATE OR IGNORE t SET id=1')), stableKey(parse('UPDATE t SET id=1')));
});

test('PRAGMA preserves schema, name, assignment/call/read and its actual argument', () => {
    const root = parse('PRAGMA main.user_version=7;PRAGMA table_info("t");PRAGMA foreign_keys=ON;PRAGMA cache_size=-123;PRAGMA user_version');
    assert.equal(nodes(root, 'Pragma').length, 5);
    assert.equal(root.slots.statements[0].slots.pragma.attrs.db, 'main');
    assert.equal(root.slots.statements[0].slots.pragma.attrs.name, 'user_version');
    assert.equal(root.slots.statements[1].attrs.form, 'CALL');
    assert.equal(root.slots.statements[2].slots.value.attrs.name, 'on');
    assert.equal(root.slots.statements[4].attrs.form, 'READ');
    for (const [a, b] of [['PRAGMA user_version=7', 'PRAGMA user_version=8'], ['PRAGMA foreign_keys=ON', 'PRAGMA foreign_keys=OFF'], ['PRAGMA main.user_version', 'PRAGMA temp.user_version']]) {
        assert.notEqual(stableKey(parse(a)), stableKey(parse(b)));
    }
    assert.deepEqual(parse('pragma MAIN.user_version=7'), parse('PRAGMA main.USER_VERSION = 7'));
});

test('transaction savepoint and maintenance names remain distinct structured targets', () => {
    const root = parse('BEGIN IMMEDIATE TRANSACTION;SAVEPOINT step;ROLLBACK TRANSACTION TO SAVEPOINT step;RELEASE SAVEPOINT step;END TRANSACTION;ANALYZE main.t;REINDEX ix;VACUUM main;DETACH DATABASE aux');
    assert.deepEqual(root.slots.statements.map(node => node.kind), ['Transaction', 'Transaction', 'Transaction', 'Transaction', 'Transaction', 'Analyze', 'Reindex', 'Vacuum', 'Detach']);
    assert.equal(root.slots.statements[0].attrs.mode, 'IMMEDIATE');
    assert.equal(root.slots.statements[2].attrs.to, true);
    assert.equal(root.slots.statements[2].slots.target.attrs.name, 'step');
    assert.equal(root.slots.statements[5].slots.target.attrs.db, 'main');
    for (const [a, b] of [['BEGIN IMMEDIATE', 'BEGIN DEFERRED'], ['ROLLBACK TO a', 'ROLLBACK TO b'], ['REINDEX ix', 'REINDEX iy'], ['ANALYZE', 'ANALYZE main'], ['DETACH aux', 'DETACH other']]) {
        assert.notEqual(stableKey(parse(a)), stableKey(parse(b)));
    }
});

test('trigger bodies retain statement boundaries, CASE END and following script statements', () => {
    const sql = "CREATE TRIGGER tr AFTER INSERT ON t BEGIN INSERT INTO log VALUES(CASE WHEN NEW.id>0 THEN 1 ELSE 0 END);UPDATE t SET label='BEGIN;END' WHERE id=NEW.id; END;SELECT 2";
    const root = parse(sql), trigger = root.slots.statements[0];
    assert.equal(root.slots.statements.length, 2);
    assert.equal(trigger.attrs.keyword, 'TRIGGER');
    assert.equal(trigger.slots.execute.kind, 'TriggerBody');
    assert.equal(trigger.slots.execute.slots.statements.length, 2);
    assert.equal(nodes(trigger, 'CaseExpression').length, 1);
    assert.equal(nodes(trigger, 'StringLiteral')[0].attrs.value, 'BEGIN;END');
    assert.notEqual(stableKey(root), stableKey(parse(sql.replace('THEN 1', 'THEN 2'))));
    assert.notEqual(stableKey(root), stableKey(parse(sql.replace('AFTER INSERT', 'BEFORE INSERT'))));
});

test('new statement adapters reject incomplete clauses rather than dropping tokens', () => {
    for (const sql of ['VALUES()', 'VALUES(1) RETURNING 2', 'VALUES(1) ORDER BY 1', 'INSERT INTO t DEFAULT VALUES 1', 'UPDATE OR MAYBE t SET value=1',
        'UPDATE OR IGNORE OR REPLACE t SET value=1', 'PRAGMA', 'PRAGMA user_version=', 'PRAGMA user_version(1,2)',
        'PRAGMA user_version=1+2', 'PRAGMA user_version=(7)', 'BEGIN IMMEDIATE GARBAGE',
        'COMMIT extra', 'ROLLBACK TO', 'SAVEPOINT', 'RELEASE', 'VACUUM main.t', 'VACUUM INTO destination',
        'REINDEX a b', 'ANALYZE a.b.c', 'DETACH DATABASE', 'CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1;']) {
        assert.throws(() => parse(sql), undefined, sql);
    }
});
