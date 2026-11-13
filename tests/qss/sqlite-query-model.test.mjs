import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey, walkNodes} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';

const schema = {tables: [{name: 't', columns: [{name: 'id'}, {name: 'value'}, {name: 'label'}]}]};
const parse = sql => parseGraphSql(sql, {schema, allowPartial: false}).root;
const nodes = (root, kind) => [...walkNodes(root)].filter(entry => entry.node.kind === kind).map(entry => entry.node);
const setup = "CREATE TABLE t(id INTEGER PRIMARY KEY,value INTEGER,label TEXT);INSERT INTO t VALUES(1,2,'alpha'),(2,3,'beta'),(3,NULL,NULL);";
const cases = [
    'EXPLAIN SELECT id FROM t WHERE value>1',
    'EXPLAIN QUERY PLAN SELECT id FROM t WHERE value>1',
    'CREATE INDEX ix ON t(value);SELECT id FROM t INDEXED BY ix WHERE value>1',
    'SELECT id FROM t NOT INDEXED WHERE value>1',
    'CREATE INDEX ix ON t(value);UPDATE t INDEXED BY ix SET value=9 WHERE value>1;SELECT * FROM t',
    'CREATE INDEX ix ON t(value);DELETE FROM t INDEXED BY ix WHERE value>1;SELECT * FROM t',
    "UPDATE t SET (value,label)=(SELECT 9,'nine') WHERE id=1;SELECT * FROM t",
    'WITH n AS(VALUES(7,8)) INSERT INTO t(id,value) SELECT * FROM n;SELECT * FROM t',
    'WITH n(v) AS(VALUES(9)) UPDATE t SET value=(SELECT v FROM n) WHERE id=1;SELECT * FROM t',
    'WITH n(v) AS(VALUES(1)) DELETE FROM t WHERE id IN(SELECT v FROM n);SELECT * FROM t',
    'SELECT a.id,b.id FROM t a CROSS JOIN t b WHERE a.id<b.id',
    "SELECT id FROM t WHERE label NOT GLOB 'a*'",
    'CREATE TABLE copy AS VALUES(1,2);SELECT * FROM copy',
    'SELECT id FROM t WHERE value ISNULL OR value NOTNULL OR value NOT NULL',
    'SELECT NULL IN (),NULL NOT IN (),value IN () FROM t'
];

test('extended query productions execute in the existing SQLite runtime and retain structured operations', () => {
    for (const sql of cases) {
        const root = parse(sql);
        assert.ok(root.slots.statements.length);
        for (const {node} of walkNodes(root)) {
            assert.ok(node.kind && node.attrs && node.slots);
            assert.ok(!Object.hasOwn(node.attrs, 'sql'), 'No opaque SQL-string distance.');
        }
        const db = new DatabaseSync(':memory:');
        try { db.exec(setup); db.exec(sql); } finally { db.close(); }
    }
});

test('EXPLAIN, query-plan output and the underlying query are distinct operations', () => {
    const ordinary = parse('SELECT value FROM t'), explain = parse('EXPLAIN SELECT value FROM t');
    const plan = parse('EXPLAIN QUERY PLAN SELECT value FROM t');
    assert.notEqual(stableKey(ordinary), stableKey(explain));
    assert.notEqual(stableKey(explain), stableKey(plan));
    assert.equal(explain.slots.statements[0].kind, 'Explain');
    assert.equal(explain.slots.statements[0].attrs.query_plan, false);
    assert.equal(plan.slots.statements[0].attrs.query_plan, true);
    assert.equal(explain.slots.statements[0].slots.statement.kind, 'Select');
});

test('CROSS JOIN preserves its actual source alias and planning operation', () => {
    for (const source of ['t', 't b', 't AS b', '(SELECT id FROM t)', '(SELECT id FROM t) b']) {
        const root = parse('SELECT a.id FROM t a CROSS JOIN ' + source);
        const joined = root.slots.statements[0].slots.from[1];
        assert.equal(joined.attrs.join, 'CROSS JOIN');
        assert.equal(joined.attrs.as, source.endsWith('b') ? 'b' : null);
        assert.ok(!stableKey(root).includes('__qss_ast_marker_'));
    }
    assert.notEqual(stableKey(parse('SELECT * FROM t CROSS JOIN t b')),
        stableKey(parse('SELECT * FROM t INNER JOIN t b')));
});

test('access hints belong to their SELECT UPDATE and DELETE source and retain the named index', () => {
    for (const sql of ['SELECT * FROM t INDEXED BY ix', 'UPDATE t INDEXED BY ix SET value=1',
        'DELETE FROM t INDEXED BY ix']) {
        const root = parse(sql), hints = nodes(root, 'IndexHint');
        assert.ok(hints.length > 0);
        assert.ok(hints.every(hint => hint.attrs.mode === 'INDEXED BY' && hint.attrs.index === 'ix'));
        assert.notEqual(stableKey(root), stableKey(parse(sql.replace('INDEXED BY ix', 'NOT INDEXED'))));
        assert.notEqual(stableKey(root), stableKey(parse(sql.replace('ix', 'iy'))));
    }
    const source = parse('SELECT a.id FROM t AS a INDEXED BY ix').slots.statements[0].slots.from[0];
    assert.equal(source.attrs.table, 't'); assert.equal(source.attrs.as, 'a');
});

test('row assignments retain every target column and the real scalar-query child', () => {
    const assignment = parse("UPDATE t SET (value,label)=(SELECT 9,'nine') WHERE id=1").slots.statements[0].slots.set[0];
    assert.deepEqual(assignment.slots.columns.map(column => column.attrs.column), ['value', 'label']);
    assert.equal(nodes(assignment, 'Select').length, 1);
    assert.notEqual(stableKey(parse('UPDATE t SET (id,value)=(1,2)')),
        stableKey(parse('UPDATE t SET (value,id)=(1,2)')));
});

test('WITH resolves quoted CTE outputs in INSERT UPDATE and DELETE rather than DQS strings', () => {
    for (const body of ['INSERT INTO t(value) SELECT "v" FROM n',
        'UPDATE t SET value=(SELECT "v" FROM n)', 'DELETE FROM t WHERE id IN(SELECT "v" FROM n)']) {
        const root = parse('WITH n(v) AS(VALUES(1)) ' + body);
        assert.equal(root.slots.statements[0].slots.with.length, 1);
        assert.equal(nodes(root, 'DoubleQuotedLiteral').length, 0);
        assert.ok(nodes(root, 'ColumnReference').some(node => node.attrs.column === 'v'));
    }
});

test('NOT GLOB retains its operator, RHS precedence, nested expressions and neighbouring LIKE', () => {
    for (const rhs of ["'a*'", 'label', 't.label', "lower(label)", "('a'||'*')", "CASE WHEN id=1 THEN 'a*' ELSE 'b*' END",
        "'a*' COLLATE NOCASE", '-value+2', '(SELECT label FROM t LIMIT 1)']) {
        const sql = 'SELECT id FROM t WHERE label NOT GLOB ' + rhs + " OR label NOT LIKE 'b%'";
        const root = parse(sql), expressions = nodes(root, 'BinaryExpression');
        assert.equal(expressions.filter(node => node.attrs.operator === 'NOT GLOB').length, 1, rhs);
        assert.equal(expressions.filter(node => node.attrs.operator === 'NOT LIKE').length, 1, rhs);
        assert.ok(!stableKey(root).includes('__qss_ast_marker_'));
        const expected = parse(sql.replace('NOT GLOB', 'GLOB'));
        nodes(expected, 'BinaryExpression').find(node => node.attrs.operator === 'GLOB').attrs.operator = 'NOT GLOB';
        assert.equal(stableKey(root), stableKey(expected), 'Only the operator changes; all RHS structure survives: ' + rhs);
        if (rhs.includes('COLLATE')) assert.equal(nodes(root, 'Collate').length, 1);
        const db = new DatabaseSync(':memory:');
        try { db.exec(setup); db.exec(sql); } finally { db.close(); }
    }
});

test('postfix null spellings use their real operator and empty membership lists remain explicit', () => {
    assert.equal(stableKey(parse('SELECT id FROM t WHERE value ISNULL')), stableKey(parse('SELECT id FROM t WHERE value IS NULL')));
    assert.equal(stableKey(parse('SELECT id FROM t WHERE value NOTNULL')), stableKey(parse('SELECT id FROM t WHERE value IS NOT NULL')));
    for (const operator of ['IN', 'NOT IN']) {
        const node = nodes(parse('SELECT value ' + operator + ' () AS flag FROM t'), 'BinaryExpression')[0];
        assert.equal(node.attrs.operator, operator);
        assert.equal(node.slots.right.kind, 'ExpressionList');
        assert.equal(node.slots.right.slots.value.length, 0);
    }
});

test('extended productions reject missing clauses and never silently drop suffixes', () => {
    for (const sql of ['EXPLAIN', 'EXPLAIN QUERY', 'EXPLAIN QUERY PLAN', 'SELECT * FROM t INDEXED BY',
        'SELECT * FROM t NOT INDEXED BY ix', 'SELECT * FROM t CROSS JOIN', 'SELECT * FROM t CROSS JOIN t AS',
        'UPDATE t SET ()=(1)', 'UPDATE t SET (value,label)=', 'UPDATE t SET (1,label)=(1,2)',
        'SELECT value NOT GLOB', 'WITH n AS(VALUES(1)) UPDATE']) assert.throws(() => parse(sql), undefined, sql);
});

test('free expression edits cannot change observable EXPLAIN output or stored DDL', () => {
    for (const [before, after, requirements] of [
        ['EXPLAIN SELECT 1+2 AS result', 'EXPLAIN SELECT 3 AS result', {}],
        ['CREATE TABLE fresh(x CHECK(x>0))', 'CREATE TABLE fresh(x CHECK(NOT(x<=0)))', {schemaMetadataObserved: true}]
    ]) {
        const source = parse(before), target = parse(after), graph = createEditGraph(target, source, schema, {}, requirements);
        for (const edit of graph.edits.filter(edit => edit.cost === 0)) {
            assert.equal([...edit.apply(source)].length, 0, edit.name);
        }
        assert.notEqual(stableKey(source), stableKey(target));
    }
    const source = parse('CREATE TABLE fresh(x CHECK(x>0))'), target = parse('CREATE TABLE fresh(x CHECK(NOT(x<=0)))');
    const graph = createEditGraph(target, source, schema, {}, {schemaMetadataObserved: false});
    const edge = graph.edits.flatMap(edit => edit.cost === 0 ? [...edit.apply(source)] : []).find(edge => stableKey(edge.root) === stableKey(target));
    assert.ok(edge); assert.equal(stableKey(replayOperation(source, edge.operation)), stableKey(target));
    const db = new DatabaseSync(':memory:');
    try { assert.notDeepEqual(db.prepare('EXPLAIN SELECT 1+2 AS result').all(), db.prepare('EXPLAIN SELECT 3 AS result').all()); }
    finally { db.close(); }
});
