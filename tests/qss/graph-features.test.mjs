import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey, clone} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';

const ast = sql => parseGraphSql(sql, {allowEmpty: true}).root;
const sorted = values => [...values].sort();
const equalFacts = (a, b, fn) => assert.deepEqual(sorted(fn(ast(a))), sorted(fn(ast(b))));
const differentPredicates = (a, b) => assert.notDeepEqual(sorted(predicateFacts(ast(a))), sorted(predicateFacts(ast(b))));

test('role-aware symbol facts distinguish projection, WHERE, HAVING and ordering', () => {
    const a = ast('SELECT id FROM item WHERE value>1 ORDER BY id');
    const b = ast('SELECT value FROM item WHERE id>1 ORDER BY id');
    assert.notDeepEqual(sorted(symbolFacts(a)), sorted(symbolFacts(b)));
    const roles = [...symbolFacts(a)].map(JSON.parse).map(fact => fact[0]);
    assert.ok(roles.includes('projection')); assert.ok(roles.includes('predicate'));
    assert.ok(roles.includes('order')); assert.ok(roles.includes('source'));
    assert.deepEqual(sorted(symbolFacts(ast('SELECT id,id FROM item'))), sorted(symbolFacts(ast('SELECT id FROM item'))));
});

test('plain comparison mirrors and NOT-equality retain one canonical predicate fact', () => {
    for (const [a, b] of [
        ['SELECT id FROM item WHERE value>1', 'SELECT id FROM item WHERE 1<value'],
        ['SELECT id FROM item WHERE value<>1', 'SELECT id FROM item WHERE NOT(value=1)'],
        ['SELECT NOT(value=1) FROM item', 'SELECT value!=1 FROM item'],
        ['SELECT id FROM item WHERE value!=1 AND id=1', 'SELECT id FROM item WHERE NOT(value=1) AND id=1']
    ]) { equalFacts(a, b, predicateFacts); equalFacts(a, b, symbolFacts); }
});

test('CAST, COLLATE, DQS and numeric storage classes remain visible in predicate signatures', () => {
    differentPredicates("SELECT id FROM item WHERE label COLLATE NOCASE>'B' COLLATE BINARY", "SELECT id FROM item WHERE 'B' COLLATE BINARY<label COLLATE NOCASE");
    differentPredicates('SELECT id FROM item WHERE CAST(value AS TEXT)=1', 'SELECT id FROM item WHERE CAST(value AS NUMERIC)=1');
    differentPredicates('SELECT typeof(1) FROM item', 'SELECT typeof(1.0) FROM item');
    differentPredicates('SELECT "X" FROM item', 'SELECT "x" FROM item');
});

test('projection expression and DISTINCT facts detect errors despite preserved leaf symbols', () => {
    differentPredicates('SELECT value FROM item WHERE id=1', 'SELECT (value)+1 FROM item WHERE id=1');
    differentPredicates('SELECT DISTINCT id FROM item', 'SELECT id FROM item');
    equalFacts('SELECT id FROM item', 'SELECT id,id FROM item', symbolFacts);
    differentPredicates('SELECT id FROM item WHERE probe(1) AND probe(2)', 'SELECT id FROM item WHERE probe(2) AND probe(1)');
});

test('alias abstraction binds correlated references to stable sources and respects shadowing', () => {
    const a = 'SELECT a.id FROM item a WHERE EXISTS(SELECT d.id FROM detail d WHERE d.parent=a.id)';
    const b = 'SELECT b.id FROM item b WHERE EXISTS(SELECT e.id FROM detail e WHERE e.parent=b.id)';
    equalFacts(a, b, predicateFacts);
    equalFacts('SELECT a.id FROM item a WHERE EXISTS(SELECT a.id FROM detail a WHERE a.parent=1)',
        'SELECT b.id FROM item b WHERE EXISTS(SELECT a.id FROM detail a WHERE a.parent=1)', predicateFacts);
    differentPredicates(a, 'SELECT a.id FROM item a WHERE EXISTS(SELECT d.id FROM detail d WHERE d.parent=d.id)');
    differentPredicates('SELECT a.id FROM item a JOIN item b ON a.id=b.id WHERE a.value>1',
        'SELECT a.id FROM item a JOIN item b ON a.id=b.id WHERE b.value>1');
    differentPredicates('SELECT item.id FROM item AS a', 'SELECT item.id FROM item');
    differentPredicates('SELECT b.id FROM item', 'SELECT b.id FROM item b');
    equalFacts('SELECT "".id FROM item AS "" WHERE EXISTS(SELECT d.id FROM detail d WHERE d.parent="".id)',
        'SELECT b.id FROM item b WHERE EXISTS(SELECT d.id FROM detail d WHERE d.parent=b.id)', predicateFacts);
    differentPredicates('SELECT "".id FROM item AS ""', 'SELECT "".id FROM item AS a');
});

test('JOIN ON and WHERE share predicate symbol and expression roles', () => {
    const a = 'SELECT a.id FROM item a INNER JOIN detail d ON a.id=d.parent WHERE a.value>1';
    const b = 'SELECT a.id FROM item a,detail d WHERE a.value>1 AND a.id=d.parent';
    equalFacts(a, b, predicateFacts); equalFacts(a, b, symbolFacts);
    const outer = 'SELECT a.id FROM item a LEFT JOIN detail d ON a.id=d.parent WHERE a.value>1';
    equalFacts(outer, b, symbolFacts);
    differentPredicates(outer, b);
    equalFacts('SELECT a.id FROM item a JOIN detail d ON a.id=d.parent WHERE probe(1) AND probe(2)',
        'SELECT a.id FROM item a,detail d WHERE (probe(1) AND probe(2)) AND a.id=d.parent', predicateFacts);
});

test('combined filter and HAVING structure preserve Boolean precedence', () => {
    differentPredicates('SELECT id FROM item WHERE (id=1 AND amount=2) OR amount=3',
        'SELECT id FROM item WHERE id=1 AND(amount=2 OR amount=3)');
    differentPredicates('SELECT id FROM item GROUP BY id HAVING (id=1 AND amount=2) OR amount=3',
        'SELECT id FROM item GROUP BY id HAVING id=1 AND(amount=2 OR amount=3)');
    equalFacts('SELECT a.id FROM item a JOIN detail d ON a.id=d.parent WHERE amount=2 OR amount=3',
        'SELECT a.id FROM item a,detail d WHERE (amount=2 OR amount=3) AND a.id=d.parent', predicateFacts);
});

test('identical WHERE predicates in separate DML statements retain separate signatures', () => {
    const reference = ast("UPDATE item SET value=1 WHERE label='x'; UPDATE item SET value=2 WHERE label='x'; DELETE FROM item WHERE label='x'");
    const answer = ast("UPDATE item SET value=1 WHERE label<>'x'; UPDATE item SET value=2 WHERE label='x'; DELETE FROM item WHERE label='x'");
    assert.ok([...predicateFacts(reference)].some(fact => !predicateFacts(answer).has(fact)),
        'Another statement retaining the old predicate must not hide the changed statement.');
    const graph = createEditGraph(reference, answer);
    const change = graph.edits.find(edit => edit.name === 'changeBinaryExpressionOperator');
    assert.equal(change.cost, 1);
    assert.ok([...change.apply(answer)].some(edge => stableKey(edge.root) === stableKey(reference)));
});

test('nested SELECT resets symbol roles and non-SELECT constructs use global other', () => {
    const facts = [...symbolFacts(ast('CREATE TABLE other(id INTEGER); SELECT id FROM item WHERE id IN(SELECT value FROM detail ORDER BY value)'))].map(JSON.parse);
    assert.ok(facts.some(fact => fact[0] === 'other' && fact[1] === 'ColumnReference' && fact[3] === 'id'));
    assert.ok(facts.some(fact => fact[0] === 'projection' && fact[1] === 'ColumnReference' && fact[3] === 'value'));
    assert.ok(facts.some(fact => fact[0] === 'order' && fact[1] === 'ColumnReference' && fact[3] === 'value'));
});

test('all actually generated zero-cost neighbours preserve both fact sets', () => {
    const examples = [
        'SELECT DISTINCT a.id, NOT(a.value=1), (a.id>1 AND a.value<2) FROM item a JOIN detail d ON a.id=d.parent WHERE (a.id>1 AND a.value<>2) AND a.value<9 ORDER BY a.id',
        'SELECT a.id FROM item a WHERE EXISTS(SELECT d.id FROM detail d WHERE d.parent=a.id AND d.id>1)',
        'SELECT a.id FROM item a WHERE EXISTS(SELECT a.id FROM detail a WHERE a.parent>1)',
        "SELECT label COLLATE NOCASE FROM item WHERE label COLLATE NOCASE>'B' COLLATE BINARY AND value<>1",
        'SELECT CAST(value AS TEXT)>1 FROM item WHERE NOT(CAST(value AS NUMERIC)=1)',
        'SELECT ((id>1 AND value<2)=1) FROM item WHERE NOT(id=1) OR value!=1',
        'SELECT item.id FROM item AS a',
        'SELECT b.id FROM item',
        'SELECT a.id FROM item a JOIN detail d ON a.id=d.parent WHERE probe(1) AND probe(2)',
        'SELECT a.id FROM item a LEFT JOIN detail d ON a.id=d.parent AND d.id>1 WHERE a.value<>2',
        'SELECT "".id FROM item AS "" WHERE EXISTS(SELECT d.id FROM detail d WHERE d.parent="".id)',
        'SELECT a.id FROM item a JOIN detail d ON a.id=d.parent WHERE (a.id=1 AND a.value=2) OR a.value=3',
        'UPDATE item SET value=(SELECT d.value FROM detail d WHERE d.parent=item.id) WHERE flag<>0 AND id>1; UPDATE item SET value=2 WHERE NOT(flag=0) AND 1<id; DELETE FROM item WHERE flag=0',
        'UPDATE item SET value=1 WHERE flag=0; DELETE FROM item WHERE EXISTS(SELECT d.id FROM detail d WHERE d.parent=item.id)'
    ];
    let checked = 0;
    for (const sql of examples) {
        const source = ast(sql), target = ast(sql.replaceAll(' a.', ' b.').replaceAll('item a ', 'item b '));
        const graph = createEditGraph(target, source);
        const symbols = sorted(symbolFacts(source)), predicates = sorted(predicateFacts(source));
        for (const edit of graph.edits.filter(edit => edit.cost === 0)) for (const edge of edit.apply(source)) {
            checked++;
            assert.deepEqual(sorted(symbolFacts(edge.root)), symbols, edit.name + ' symbols');
            assert.deepEqual(sorted(predicateFacts(edge.root)), predicates, edit.name + ' predicates');
        }
    }
    assert.ok(checked > 50, 'Exercise a substantial set of actual graph edges.');
});

test('each positive-cost edge obeys the declared role-aware symbol-introduction bound', () => {
    const source = ast('SELECT a.id, AVG(a.value) FROM item a WHERE a.id>1 AND a.value<>2');
    const target = ast('SELECT b.name, MAX(b.value) FROM item b WHERE b.id>2 AND b.value<>3');
    const graph = createEditGraph(target, source, {tables: [{name: 'item', columns: [{name: 'id'}, {name: 'value'}, {name: 'name'}]}]});
    const before = symbolFacts(source);
    let checked = 0;
    for (const edit of graph.edits.filter(edit => edit.cost > 0)) for (const edge of edit.apply(source)) {
        checked++;
        const introduced = [...symbolFacts(edge.root)].filter(fact => !before.has(fact));
        assert.ok(introduced.length <= edit.maxNewSymbols, edit.name + ' introduced ' + introduced.length);
    }
    assert.ok(checked > 100);
});

test('shared constructor instances retain per-occurrence scopes across zero alias edges', () => {
    const source = ast('SELECT id FROM item a WHERE EXISTS(SELECT id FROM detail d WHERE d.parent=a.id)');
    const outer = source.slots.statements[0], inner = outer.slots.where.slots.expr.slots.ast;
    // The edit catalogue caches leaf constructors; the same immutable object
    // may consequently occur in two query scopes. It still denotes a SQL tree.
    inner.slots.columns[0].slots.expr = outer.slots.columns[0].slots.expr;
    const copied = clone(source);
    assert.equal(stableKey(source), stableKey(copied));
    assert.deepEqual(sorted(symbolFacts(source)), sorted(symbolFacts(copied)));
    assert.deepEqual(sorted(predicateFacts(source)), sorted(predicateFacts(copied)));
    const graph = createEditGraph(source, source);
    let checked = 0;
    for (const edit of graph.edits.filter(edit => edit.cost === 0)) for (const edge of edit.apply(source)) {
        checked++;
        assert.deepEqual(sorted(symbolFacts(source)), sorted(symbolFacts(edge.root)), edit.name);
        assert.deepEqual(sorted(predicateFacts(source)), sorted(predicateFacts(edge.root)), edit.name);
    }
    assert.ok(checked >= 6);
});

test('successive reverse-idempotence edges preserve recursively normalized function arguments', () => {
    const source = ast('SELECT probe((id>1 AND value<>2)), id FROM item a WHERE probe(NOT(id=1)) AND probe(2)');
    const graph = createEditGraph(source, source);
    const zero = graph.edits.filter(edit => edit.cost === 0);
    const expectedSymbols = sorted(symbolFacts(source)), expectedPredicates = sorted(predicateFacts(source));
    const frontier = [{root: source, depth: 0}], seen = new Set([stableKey(source)]);
    let checked = 0;
    // A deterministic finite regression sample; no production search limit.
    for (let at = 0; at < frontier.length && at < 180; at++) {
        const current = frontier[at];
        if (current.depth >= 2) continue;
        for (const edit of zero) for (const edge of edit.apply(current.root)) {
            checked++;
            assert.deepEqual(sorted(symbolFacts(edge.root)), expectedSymbols, edit.name);
            assert.deepEqual(sorted(predicateFacts(edge.root)), expectedPredicates, edit.name);
            const key = stableKey(edge.root);
            if (!seen.has(key)) { seen.add(key); frontier.push({root: edge.root, depth: current.depth + 1}); }
        }
    }
    assert.ok(checked > 250);
});

test('DDL type parameters retain a necessary paid-repair fact even when another column has the target type', () => {
    const reference = ast('CREATE TABLE item(a VARCHAR(10), b VARCHAR(10), CHECK(a>0 AND a<9))');
    const answer = ast('CREATE TABLE item(a VARCHAR(11), b VARCHAR(10), CHECK(a>0 AND a<9))');
    const present = predicateFacts(answer);
    assert.ok([...predicateFacts(reference)].some(value => !present.has(value)));
    const graph = createEditGraph(reference, answer), expected = sorted(predicateFacts(answer));
    let checked = 0;
    for (const edit of graph.edits.filter(edit => edit.cost === 0)) for (const edge of edit.apply(answer)) {
        checked++;
        assert.deepEqual(sorted(predicateFacts(edge.root)), expected, edit.name);
    }
    assert.ok(checked > 0);
});
