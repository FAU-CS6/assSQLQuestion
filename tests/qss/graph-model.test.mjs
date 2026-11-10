import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey, graphKey, clone, walkNodes} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';

const parse = sql => parseGraphSql(sql).root;
const nodes = (root, kind) => [...walkNodes(root)].filter(entry => entry.node.kind === kind).map(entry => entry.node);
const statement = root => root.slots.statements[0];

test('graph states are semantic SQL ASTs with stable nullable slots', () => {
    const root = parse('SELECT DISTINCT x.id, AVG(x.value) AS mean FROM sample x WHERE x.value>2 GROUP BY x.id HAVING COUNT(*)>1 ORDER BY x.id DESC');
    const select = statement(root);
    assert.equal(select.kind, 'Select');
    assert.equal(select.attrs.distinct, true);
    assert.equal(select.slots.from[0].kind, 'TableSource');
    assert.equal(select.slots.from[0].attrs.as, 'x');
    assert.equal(select.slots.columns[0].kind, 'SelectItem');
    assert.equal(select.slots.columns[1].slots.expr.kind, 'AggregateExpression');
    assert.equal(select.slots.columns[1].slots.expr.attrs.name, 'AVG');
    assert.equal(select.slots.where.kind, 'BinaryExpression');
    assert.equal(select.slots.where.attrs.operator, '>');
    assert.equal(select.slots.groupby.kind, 'GroupBy');
    assert.equal(select.slots.orderby[0].attrs.type, 'DESC');
    assert.equal(select.slots.limit, null);
    assert.deepEqual(select.slots.with, []);
    assert.equal(nodes(root, 'Keyword').length, 0);
});

test('whitespace, comments, keywords and SQLite ASCII identifier case are lexical differences', () => {
    assert.deepEqual(parse('SELECT X.ID FROM SAMPLE X WHERE NOT(X.ID=2) AND EXISTS(SELECT 1 FROM DETAIL D WHERE D.ID=X.ID)'),
        parse(' /* harmless */ select x.id from sample x where not(x.id=2) and exists(select 1 from detail d where d.id=x.id); -- end'));
    assert.equal(stableKey(parse("SELECT CAST(id AS TEXT),ABS(id) FROM sample WHERE label COLLATE NOCASE='A'")),
        stableKey(parse("select cast(id as text),abs(id) from sample where label collate nocase='A'")));
});

test('semantic equivalences are not silently folded into graph node equality', () => {
    for (const [a, b] of [
        ['SELECT a.id FROM item a', 'SELECT b.id FROM item b'],
        ['SELECT id FROM item WHERE id>2 AND value<3', 'SELECT id FROM item WHERE value<3 AND id>2'],
        ['SELECT id FROM item WHERE id>2', 'SELECT id FROM item WHERE 2<id'],
        ['SELECT a.id FROM item a JOIN detail d ON a.id=d.id', 'SELECT a.id FROM item a,detail d WHERE a.id=d.id']
    ]) assert.notEqual(stableKey(parse(a)), stableKey(parse(b)));
});

test('numeric literals retain SQLite storage class, original precision and occurrence positions', () => {
    const root = parse('SELECT typeof(1), typeof(1.0), 9007199254740993, 9007199254740992, -1.0, 0xff, .5, 1e3 LIMIT 5');
    const values = nodes(root, 'NumberLiteral').map(node => node.attrs);
    assert.deepEqual(values.map(value => value.value), ['1', '1.0', '9007199254740993', '9007199254740992', '1.0', '0xff', '.5', '1e3', '5']);
    assert.deepEqual(values.map(value => value.storageClass), ['integer', 'real', 'integer', 'integer', 'real', 'integer', 'real', 'real', 'integer']);
    assert.notEqual(stableKey(parse('SELECT typeof(1)')), stableKey(parse('SELECT typeof(1.0)')));
    assert.notEqual(stableKey(parse('SELECT 9007199254740993')), stableKey(parse('SELECT 9007199254740992')));
    assert.equal(nodes(parse('SELECT FLOAT(1.0)'), 'NumberLiteral')[0].attrs.storageClass, 'real');
    assert.equal(nodes(parse('SELECT 9223372036854775808'), 'NumberLiteral')[0].attrs.storageClass, 'real');
});

test('user literals cannot collide with internal parser marker spellings', () => {
    const root = parse("SELECT '__qss_ast_marker_0__', 1, '__qss_ast_marker_1__', 2");
    assert.deepEqual(nodes(root, 'StringLiteral').map(node => node.attrs.value), ['__qss_ast_marker_0__', '__qss_ast_marker_1__']);
    assert.deepEqual(nodes(root, 'NumberLiteral').map(node => node.attrs.value), ['1', '2']);
});

test('SQLite literal contents retain backslashes and SQL quote escaping exactly', () => {
    const escaped = parse(String.raw`SELECT 'a\nb', 'a''b'`);
    const newline = parse("SELECT 'a\nb', 'a''b'");
    assert.deepEqual(nodes(escaped, 'StringLiteral').map(node => node.attrs.value), [String.raw`a\nb`, "a'b"]);
    assert.notEqual(stableKey(escaped), stableKey(newline));
    const quoted = parse(String.raw`SELECT "a\nb", [odd name], ` + '`other name`');
    assert.equal(nodes(quoted, 'DoubleQuotedLiteral')[0].attrs.value, String.raw`a\nb`);
    assert.deepEqual(nodes(quoted, 'ColumnReference').map(node => node.attrs.column), ['odd name', 'other name']);
    assert.equal(nodes(parse('SELECT __missing_column__ FROM item'), 'ColumnReference')[0].attrs.column, '__missing_column__');
});

test('strings, DQS fallback, non-ASCII identifiers, CAST and COLLATE remain distinct', () => {
    for (const [a, b] of [
        ["SELECT 'X'", "SELECT 'x'"], ['SELECT "X"', 'SELECT "x"'],
        ['SELECT Ä FROM names', 'SELECT ä FROM names'],
        ['SELECT CAST(id AS TEXT) FROM item', 'SELECT CAST(id AS NUMERIC) FROM item'],
        ["SELECT id FROM item WHERE label COLLATE NOCASE='x'", "SELECT id FROM item WHERE label COLLATE BINARY='x'"]
    ]) assert.notEqual(stableKey(parse(a)), stableKey(parse(b)));
});

test('SQLite DQS resolves only known in-scope column names using the actual schema', () => {
    const schema = {tables: [{name: 'spieler', columns: [{name: 'käufer'}, {name: 'id'}]},
        {name: 'detail', columns: [{name: 'parent'}]}, {name: 'unrelated', columns: [{name: 'X'}]}]};
    const model = sql => parseGraphSql(sql, {schema}).root;
    assert.equal(stableKey(model('SELECT käufer FROM spieler')), stableKey(model('SELECT "käufer" FROM spieler')));
    assert.equal(nodes(model('SELECT "X" FROM spieler'), 'DoubleQuotedLiteral')[0].attrs.value, 'X');
    assert.notEqual(stableKey(model('SELECT "X" FROM spieler')), stableKey(model('SELECT "x" FROM spieler')));
    assert.equal(nodes(model("SELECT 'käufer' FROM spieler"), 'StringLiteral')[0].attrs.value, 'käufer');
    const correlated = model('SELECT id FROM spieler WHERE EXISTS(SELECT "käufer" FROM detail)');
    assert.ok(nodes(correlated, 'ColumnReference').some(node => node.attrs.column === 'käufer'));
    assert.equal(nodes(correlated, 'DoubleQuotedLiteral').length, 0);
    assert.equal(nodes(model('SELECT "käufer" FROM spieler a,spieler b'), 'DoubleQuotedLiteral').length, 0, 'Ambiguity remains a non-executable column AST.');
    const emptyAlias = model('SELECT "käufer" FROM spieler AS ""');
    assert.equal(nodes(emptyAlias, 'TableSource')[0].attrs.as, '');
    assert.equal(nodes(emptyAlias, 'ColumnReference')[0].attrs.column, 'käufer');
});

test('DQS binding preserves COLLATE and resolves known derived/CTE outputs conservatively', () => {
    const schema = {tables: [{name: 'item', columns: [{name: 'label'}, {name: 'id'}]},
        {name: 'chosen', columns: [{name: 'unrelated'}]}]};
    const model = sql => parseGraphSql(sql, {schema}).root;
    assert.equal(stableKey(model('SELECT "label" COLLATE NOCASE FROM item')), stableKey(model('SELECT label COLLATE NOCASE FROM item')));
    assert.equal(nodes(model('SELECT "label" FROM (SELECT label FROM item) AS derived'), 'DoubleQuotedLiteral').length, 0);
    assert.equal(nodes(model('WITH chosen(id) AS (SELECT id FROM item) SELECT "id" FROM chosen'), 'DoubleQuotedLiteral').length, 0);
    assert.equal(nodes(model('WITH chosen(id) AS (SELECT id FROM item) SELECT "unrelated" FROM chosen'), 'DoubleQuotedLiteral')[0].attrs.value, 'unrelated');
    assert.equal(nodes(model('SELECT "unrelated" FROM (SELECT id FROM item) AS chosen'), 'DoubleQuotedLiteral')[0].attrs.value, 'unrelated');
});

test('incomplete AVG expression and nonexistent names remain representable graph states', () => {
    const partial = parseGraphSql('SELECT AVG() FROM missing_table');
    assert.equal(partial.validation, 'partial-sql-ast');
    const avg = nodes(partial.root, 'AggregateExpression')[0];
    assert.equal(avg.attrs.name, 'AVG');
    assert.equal(avg.slots.args.slots.expr, null);
    assert.equal(nodes(partial.root, 'TableSource')[0].attrs.table, 'missing_table');
    assert.equal(nodes(parse('SELECT absent_column FROM absent_table'), 'ColumnReference')[0].attrs.column, 'absent_column');
});

test('implicit REFERENCES target columns have a semantic reference AST without a fabricated column', () => {
    const result = parseGraphSql('CREATE TABLE child(id INTEGER PRIMARY KEY, parent_id INTEGER DEFAULT 0, FOREIGN KEY(parent_id) REFERENCES parent); ALTER TABLE child ADD label TEXT REFERENCES category');
    assert.equal(result.validation, 'sqlite-dialect-ast');
    const refs = nodes(result.root, 'ReferenceDefinition');
    assert.equal(refs.length, 2);
    for (const ref of refs) { assert.equal(ref.attrs.implicit_columns, true); assert.equal(ref.slots.definition, null); }
    assert.equal(refs[0].slots.table[0].attrs.table, 'parent');
    assert.equal(refs[1].slots.table[0].attrs.table, 'category');
    assert.equal(nodes(result.root, 'NumberLiteral')[0].attrs.value, '0');
    assert.doesNotMatch(JSON.stringify(result.root), /__qss_ast_marker_/);
});

test('native IN-table shorthand retains its own semantic node', () => {
    const root = parse('DELETE FROM child WHERE parent_id IN selected_parent; DELETE FROM child WHERE parent_id NOT IN main.other_parent');
    const membership = nodes(root, 'TableMembership');
    assert.deepEqual(membership.map(node => node.attrs), [{db: null, table: 'selected_parent'}, {db: 'main', table: 'other_parent'}]);
    assert.deepEqual(nodes(root, 'BinaryExpression').map(node => node.attrs.operator), ['IN', 'NOT IN']);
    assert.doesNotMatch(JSON.stringify(root), /__qss_ast_marker_/);
});

test('arithmetic projections in nested DML queries retain the actual child SQL AST', () => {
    const result = parseGraphSql('DELETE FROM child WHERE parent_id NOT IN(SELECT (parent_id)+1 FROM parent p WHERE p.id=child.id)');
    assert.equal(result.validation, 'sqlite-dialect-ast');
    assert.ok(result.adapters.includes('nested-query-ast'));
    assert.equal(statement(result.root).kind, 'Delete');
    assert.equal(statement(result.root).slots.where.attrs.operator, 'NOT IN');
    assert.equal(statement(result.root).slots.where.slots.left.attrs.column, 'parent_id');
    const select = nodes(result.root, 'Select')[0];
    const expression = select.slots.columns[0].slots.expr;
    assert.equal(expression.kind, 'BinaryExpression');
    assert.equal(expression.attrs.operator, '+');
    assert.equal(expression.slots.left.attrs.column, 'parent_id');
    assert.equal(expression.slots.right.attrs.value, '1');
    assert.equal(select.slots.where.slots.right.attrs.table, 'child', 'Correlated references survive extraction.');
    assert.doesNotMatch(JSON.stringify(result.root), /__qss_ast_marker_/);
    const multiple = parse('DELETE FROM child WHERE parent_id IN(SELECT (id)+1 FROM parent) AND id NOT IN(SELECT (id)+2 FROM rejected)');
    assert.equal(nodes(multiple, 'Select').length, 2);
    assert.deepEqual(nodes(multiple, 'NumberLiteral').map(node => node.attrs.value), ['1', '2']);
});

test('scalar-subquery renderer parentheses do not add a spurious second SQL edit', () => {
    const reference = parse('UPDATE item SET value=(SELECT value FROM category c JOIN item x ON c.id=x.category WHERE c.label="first") WHERE category=(SELECT id FROM category WHERE label="second")');
    const answer = parse('UPDATE item SET value=(SELECT (value)+1 FROM category c JOIN item x ON c.id=x.category WHERE c.label="first") WHERE category=(SELECT id FROM category WHERE label="second")');
    const graph = createEditGraph(reference, answer);
    const remove = graph.edits.find(edit => edit.name === 'removeExtraneousBinaryTerm');
    assert.equal(remove.cost, 1);
    assert.ok([...remove.apply(answer)].some(edge => stableKey(edge.root) === stableKey(reference)),
        'Removing the added arithmetic term must restore the reference in one actual graph edge.');
    assert.equal(nodes(answer, 'Select').some(node => Object.hasOwn(node.attrs, 'parentheses_symbol')), false);
    // A flag in another context is not globally erased by the adapter.
    assert.equal(statement(parse('(SELECT id FROM item)')).attrs.parentheses_symbol, true);
});

test('query enclosure keeps compound precedence and local ORDER BY/LIMIT scopes', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('CREATE TABLE a(id INTEGER); CREATE TABLE b(id INTEGER); CREATE TABLE c(id INTEGER); INSERT INTO a VALUES(1),(2); INSERT INTO b VALUES(3); INSERT INTO c VALUES(1);');
        const left = 'SELECT id FROM(SELECT id FROM a UNION SELECT id FROM b) EXCEPT SELECT id FROM c';
        const right = 'SELECT id FROM a UNION SELECT id FROM(SELECT id FROM b EXCEPT SELECT id FROM c)';
        assert.notDeepEqual(db.prepare(left).all(), db.prepare(right).all());
        assert.notEqual(stableKey(parse(left)), stableKey(parse(right)), 'Subquery and CompoundSelect nodes retain grouping.');
        const localLimit = 'SELECT id FROM(SELECT id FROM a ORDER BY id LIMIT 1) UNION SELECT id FROM b';
        const globalLimit = 'SELECT id FROM a UNION SELECT id FROM b ORDER BY id LIMIT 1';
        assert.notDeepEqual(db.prepare(localLimit).all(), db.prepare(globalLimit).all());
        assert.notEqual(stableKey(parse(localLimit)), stableKey(parse(globalLimit)), 'A local LIMIT must never become a compound-wide LIMIT.');
        const local = parse(localLimit), global = parse(globalLimit);
        assert.ok(nodes(local, 'Select').some(node => node.slots.limit !== null));
        assert.equal(statement(global).kind, 'CompoundSelect');
        assert.ok(statement(global).slots.limit);
    } finally { db.close(); }
});

test('mixed comma JOIN sources preserve order, aliases, conditions and nested subqueries', () => {
    const root = parse('SELECT a.id FROM item a JOIN detail d ON a.id=d.item_id, (SELECT item_id FROM detail GROUP BY item_id) AS x JOIN item b ON b.id=x.item_id WHERE a.id<b.id');
    const select = statement(root);
    assert.equal(select.slots.from.length, 4);
    assert.deepEqual(select.slots.from.map(node => node.attrs.as), ['a', 'd', 'x', 'b']);
    assert.equal(select.slots.from[1].attrs.join, 'INNER JOIN');
    assert.equal(select.slots.from[3].slots.on.attrs.operator, '=');
    assert.equal(select.slots.from[2].slots.expr.kind, 'Subquery');
    assert.equal(select.slots.from[2].slots.expr.slots.ast.kind, 'Select');
    assert.equal(select.slots.where.attrs.operator, '<');
});

test('EXCEPT and UNION construct left-associative SQL compounds with global ordering', () => {
    const root = parse('SELECT id FROM first UNION ALL SELECT id FROM second EXCEPT SELECT id FROM third ORDER BY id DESC LIMIT 5');
    const compound = statement(root);
    assert.equal(compound.kind, 'CompoundSelect');
    assert.equal(compound.attrs.operator, 'EXCEPT');
    assert.equal(compound.slots.left.kind, 'CompoundSelect');
    assert.equal(compound.slots.left.attrs.operator, 'UNION ALL');
    assert.equal(compound.slots.right.kind, 'Select');
    assert.equal(compound.slots.orderby[0].attrs.type, 'DESC');
    assert.equal(compound.slots.right.slots.orderby.length, 0);
    assert.equal(nodes(compound.slots.limit, 'NumberLiteral')[0].attrs.value, '5');
});

test('CREATE VIEW adapters preserve declaration and the full query child', () => {
    const root = parse('CREATE VIEW chosen(id) AS SELECT a.id FROM item a JOIN detail d ON a.id=d.item_id, item b WHERE a.id<b.id; SELECT id FROM chosen EXCEPT SELECT id FROM rejected');
    const create = statement(root);
    assert.equal(create.kind, 'Create');
    assert.equal(create.attrs.keyword, 'VIEW');
    assert.equal(create.slots.view.attrs.view, 'chosen');
    assert.equal(create.slots.columns.length, 1);
    assert.equal(create.slots.select.kind, 'Select');
    assert.equal(create.slots.select.slots.from.length, 3);
    assert.equal(root.slots.statements[1].kind, 'CompoundSelect');
});

test('postfix NOT NULL grammar produces an IS NOT NULL expression', () => {
    const root = parse('SELECT id FROM item WHERE label NOT NULL');
    assert.equal(statement(root).slots.where.attrs.operator, 'IS NOT');
    assert.equal(statement(root).slots.where.slots.right.kind, 'NullLiteral');
});

test('clone, stable keys and walk paths are deterministic independent of object property order', () => {
    const root = parse('SELECT id FROM item WHERE id>2');
    assert.equal(stableKey(root), stableKey(clone(root)));
    const entry = [...walkNodes(root)].find(({node}) => node.kind === 'NumberLiteral');
    let node = root;
    for (const part of entry.path) node = typeof part === 'number' ? node[part] : node.slots[part];
    assert.equal(node, entry.node);
    assert.equal(stableKey({b: 2, a: 1}), stableKey({a: 1, b: 2}));
    assert.equal(stableKey({kind: 'Select', attrs: {}, slots: {}}),
        stableKey({kind: 'Select', attrs: {distinct: false, as: null}, slots: {where: null, from: []}}));
    assert.notEqual(stableKey({kind: 'BooleanLiteral', attrs: {value: false}, slots: {}}),
        stableKey({kind: 'BooleanLiteral', attrs: {}, slots: {}}));
    assert.notEqual(stableKey({kind: 'NullLiteral', attrs: {value: null}, slots: {}}), stableKey(null));
});

test('empty student state is supported and malformed lexical input is rejected', () => {
    assert.deepEqual(parseGraphSql('', {allowEmpty: true}).root.slots.statements, []);
    assert.throws(() => parseGraphSql(''), error => error.code === 'empty-reference');
    assert.throws(() => parse("SELECT 'unfinished"), error => error.code === 'unterminated-quote');
    assert.throws(() => parse('SELECT (id FROM item'), error => error.code === 'unbalanced-parentheses');
    assert.throws(() => parse('SELECT 1abc'), error => error.code === 'graph-invalid-numeric-token');
    assert.throws(() => parse('SELECT 0x'), error => error.code === 'graph-invalid-numeric-token');
});

test('graph-scoped immutable keys preserve canonical equality and isolate mutable callers', () => {
    const key = graphKey(), source = parse('SELECT id FROM item WHERE id>2');
    const changed = {...source, slots: {...source.slots, statements: [parse('SELECT id FROM item WHERE id>3').slots.statements[0]]}};
    assert.equal(key(source), stableKey(source));
    assert.equal(key(changed), stableKey(changed));
    assert.notEqual(key(source), key(changed));
    assert.equal(key({kind:'Select',attrs:{distinct:false},slots:{from:[]}}), key({kind:'Select',attrs:{},slots:{}}));
    const ordinary = {value:1};stableKey(ordinary);ordinary.value=2;
    assert.equal(stableKey(ordinary), stableKey({value:2}));
    assert.equal(graphKey()(ordinary), stableKey(ordinary));
});
