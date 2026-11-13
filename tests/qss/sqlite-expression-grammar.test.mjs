import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {lex} from '../../lib/qss/src/syntax.mjs';
import {parseGraphSql, stableKey, walkNodes} from '../../lib/qss/src/graph-model.mjs';
const ast = sql => parseGraphSql(sql, {allowPartial: false}).root;
const nodes = (root, kind) => [...walkNodes(root)].map(x => x.node).filter(n => n.kind === kind);

test('SQLite parameter spellings remain structured and preserve their case and identity', () => {
    for (const value of ['?', '?1', '?02', ':value', ':Value', '@value', '$value', '$ns::value(tag)',
        '$x::', ':x::y', '@x::y', ':x::', '@x::', '$::x', '$x::a::', ':x(a)', '@x(a)']) {
        const sql = 'SELECT ' + value + ' AS result', root = ast(sql), parameters = nodes(root, 'ParameterExpression');
        assert.equal(parameters.length, 1); assert.equal(parameters[0].attrs.value, value);
        const db = new DatabaseSync(':memory:');
        try { assert.deepEqual(db.prepare(sql).get(), {result: null}); } finally { db.close(); }
    }
    const root = ast('SELECT :x AS a,:x AS b,? AS c,? AS d');
    assert.deepEqual(nodes(root, 'ParameterExpression').map(n => n.attrs.value), [':x', ':x', '?', '?']);
    assert.notEqual(stableKey(ast('SELECT :x')), stableKey(ast('SELECT :X')));
    assert.notEqual(stableKey(ast('SELECT ?1')), stableKey(ast('SELECT ?2')));
    assert.equal(lex("SELECT ':value', '?', '$x'").filter(t => t.kind === 'Parameter').length, 0);
    for (const sql of ['SELECT :', 'SELECT @', 'SELECT $', 'SELECT $x(unclosed']) assert.throws(() => ast(sql));
});

test('numeric CAST and grouped postfix collations retain their exact operand', () => {
    for (const [sql, operandKind] of [
        ['SELECT 123 COLLATE NOCASE AS result', 'NumberLiteral'],
        ['SELECT CAST(1 AS TEXT) COLLATE NOCASE AS result', 'CastExpression'],
        ['SELECT (1+2) COLLATE NOCASE AS result', 'BinaryExpression'],
        ['SELECT -1 COLLATE NOCASE AS result', 'UnaryExpression'],
        ['SELECT ? COLLATE NOCASE AS result', 'ParameterExpression'],
        ["SELECT CASE WHEN 1 THEN 'a' END COLLATE NOCASE AS result", 'CaseExpression']
    ]) {
        const root = ast(sql), collations = nodes(root, 'CollateExpression');
        assert.equal(collations.length, 1, sql); assert.equal(collations[0].slots.expr.kind, operandKind, sql);
        assert.ok(nodes(root, 'Collate').some(n => n.attrs.name === 'nocase'));
        const db = new DatabaseSync(':memory:');
        try { assert.doesNotThrow(() => db.prepare(sql).get()); } finally { db.close(); }
    }
    const addition = ast('SELECT 4+1 COLLATE NOCASE AS result').slots.statements[0].slots.columns[0].slots.expr;
    assert.equal(addition.kind, 'BinaryExpression'); assert.equal(addition.attrs.operator, '+');
    assert.equal(addition.slots.right.kind, 'CollateExpression');
    const comparison = ast('SELECT 3=1 COLLATE NOCASE AS result').slots.statements[0].slots.columns[0].slots.expr;
    assert.equal(comparison.kind, 'BinaryExpression'); assert.equal(comparison.slots.right.kind, 'CollateExpression');
    assert.notEqual(stableKey(ast('SELECT 1 COLLATE NOCASE')), stableKey(ast('SELECT 1 COLLATE BINARY')));
    const blob = ast("SELECT x'41' COLLATE NOCASE AS result");
    assert.equal(nodes(blob, 'SQL:hex_string')[0].attrs.value, '41');
    assert.equal(nodes(blob, 'Collate').length, 1);
    for (const sql of ["SELECT 'a' COLLATE NOCASE COLLATE BINARY AS result", 'SELECT x COLLATE NOCASE COLLATE BINARY FROM t']) {
        const root = ast(sql);
        assert.equal(nodes(root, 'Collate').length, 2, sql);
    }
    for (const [a, b] of [
        ['SELECT 1 BETWEEN -1 COLLATE BINARY AND 2', 'SELECT 1 BETWEEN (-1) COLLATE BINARY AND 2'],
        ['SELECT 1 IS -1 COLLATE BINARY', 'SELECT 1 IS (-1) COLLATE BINARY'],
        ["SELECT 'A' LIKE +('a') COLLATE NOCASE", "SELECT 'A' LIKE (+('a')) COLLATE NOCASE"]
    ]) assert.equal(stableKey(ast(a)), stableKey(ast(b)), a);
});

test('column declaration COLLATE is not reinterpreted as a type/default expression operator', () => {
    for (const sql of [
        'CREATE TABLE t(x VARCHAR(20) COLLATE NOCASE)',
        'CREATE TABLE t(x TEXT DEFAULT (1+2) COLLATE RTRIM)',
        'CREATE TABLE t(x INT CHECK(x=1 COLLATE NOCASE))',
        'CREATE TABLE t(x);ALTER TABLE t ADD y VARCHAR(20) COLLATE NOCASE'
    ]) {
        assert.doesNotThrow(() => ast(sql), sql);
        const db = new DatabaseSync(':memory:');
        try { assert.doesNotThrow(() => db.exec(sql)); } finally { db.close(); }
    }
    const root = ast('CREATE TABLE t(x VARCHAR(20) COLLATE NOCASE)');
    assert.equal(nodes(root, 'CollateExpression').length, 0);
    assert.equal(nodes(root, 'DataType')[0].attrs.dataType, 'VARCHAR');
});

test('single quoted relation names retain names while expression strings remain literals', () => {
    const sql = "CREATE TABLE 'single quoted'(x);INSERT INTO 'single quoted' VALUES('single quoted');SELECT x FROM 'single quoted'";
    const root = ast(sql);
    assert.ok(nodes(root, 'TableSource').some(n => n.attrs.table === 'single quoted'));
    assert.ok(nodes(root, 'StringLiteral').some(n => n.attrs.value === 'single quoted'));
    const db = new DatabaseSync(':memory:');
    try {
        db.exec("CREATE TABLE 'single quoted'(x);INSERT INTO 'single quoted' VALUES('single quoted')");
        assert.deepEqual(db.prepare("SELECT x FROM 'single quoted'").get(), {x: 'single quoted'});
        db.exec("ATTACH ':memory:' AS 'aux';CREATE TABLE aux.z(x)");
    } finally { db.close(); }
    assert.doesNotThrow(() => ast("ATTACH ':memory:' AS 'aux';CREATE TABLE aux.z(x);SELECT * FROM aux.z"));
    assert.equal(nodes(ast("SELECT 'table' AS x"), 'StringLiteral')[0].attrs.value, 'table');
});

test('parenthesized table sources preserve effective aliases and nested joins', () => {
    assert.equal(stableKey(ast('SELECT a.x FROM (t) AS a')), stableKey(ast('SELECT a.x FROM t AS a')));
    assert.equal(stableKey(ast('SELECT b.x FROM (t AS a) AS b')), stableKey(ast('SELECT b.x FROM t AS b')));
    const db = new DatabaseSync(':memory:');
    try {
        db.exec("CREATE TABLE t(x);INSERT INTO t VALUES('a');CREATE TABLE u(x);INSERT INTO u VALUES('a')");
        assert.deepEqual(db.prepare('SELECT b.x FROM (t AS a) AS b').all(), [{x: 'a'}]);
        assert.throws(() => db.prepare('SELECT a.x FROM (t AS a) AS b').all());
        const sql = 'SELECT t.x FROM (t LEFT JOIN u ON t.x=u.x) WHERE t.x IS NOT NULL';
        assert.doesNotThrow(() => db.prepare(sql).all());
        const root = ast(sql);
        assert.equal(nodes(root, 'TableGroup').length, 1);
        assert.ok(nodes(root, 'TableSource').some(n => n.attrs.join === 'LEFT JOIN'));
        const ctas = "CREATE TABLE copy AS SELECT CAST(x AS TEXT) COLLATE NOCASE AS result FROM t";
        assert.doesNotThrow(() => db.exec(ctas));
        assert.equal(nodes(ast(ctas), 'CollateExpression').length, 1);
        const values = ast('CREATE TABLE copy AS VALUES(7,8)').slots.statements[0];
        assert.equal(values.slots.query_expr.kind, 'Values');
        assert.equal(nodes(values, 'Select').length, 0, 'No parser-shell SELECT remains in CTAS VALUES.');
    } finally { db.close(); }
});
