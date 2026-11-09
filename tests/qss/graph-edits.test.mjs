import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey, walkNodes} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {predicateFacts} from '../../lib/qss/src/graph-search.mjs';

const ast = sql => parseGraphSql(sql, {allowEmpty: true}).root;
const edit = (graph, name) => {
    const result = graph.edits.find(value => value.name === name);
    assert.ok(result, 'Missing graph edit: ' + name);
    return result;
};
const find = (graph, name, source, destination) => [...edit(graph, name).apply(source)].find(value => stableKey(value.root) === stableKey(destination));
const symbols = root => {
    const result = new Set();
    for (const {node} of walkNodes(root)) {
        const field = ['NumberLiteral', 'StringLiteral', 'DoubleQuotedLiteral', 'BooleanLiteral', 'BigIntLiteral'].includes(node.kind) ? 'value'
            : node.kind === 'ColumnReference' ? 'column' : node.kind === 'TableSource' ? 'table' : node.kind === 'AggregateExpression' ? 'name' : null;
        if (field && node.attrs[field] != null) result.add(JSON.stringify([node.kind, field, node.attrs[field]]));
    }
    return result;
};

test('intrinsic addColumnReference fills the paper AVG() hole in one SQL edit', () => {
    const source = ast('SELECT AVG() FROM students'), destination = ast('SELECT AVG(age) FROM students');
    const graph = createEditGraph(destination, source, {tables: [{name: 'students', columns: [{name: 'age'}]}]});
    const edge = find(graph, 'addAggregateArgumentsExprColumnReference', source, destination);
    assert.ok(edge);
    assert.equal(edge.operation.cost, 1);
    assert.equal(stableKey(replayOperation(source, edge.operation)), stableKey(destination));
});

test('attribute edits generate changes at all positions, including a position already matching the target', () => {
    const source = ast('SELECT 1, 1'), destination = ast('SELECT 2, 1');
    const graph = createEditGraph(destination, source);
    const neighbours = [...edit(graph, 'changeNumberLiteralValue').apply(source)].map(value => stableKey(value.root));
    assert.ok(neighbours.includes(stableKey(destination)));
    assert.ok(neighbours.includes(stableKey(ast('SELECT 1, 2'))), 'No positional target guidance is allowed.');
});

test('Fig.7 reverse idempotence enables the cheaper duplicate-then-change path', () => {
    const source = ast('SELECT id FROM students WHERE age=18');
    const destination = ast('SELECT id FROM students WHERE age=18 AND age=19');
    const duplicated = ast('SELECT id FROM students WHERE age=18 AND age=18');
    const graph = createEditGraph(destination, source);
    const growth = find(graph, 'duplicateBooleanPredicate', source, duplicated);
    assert.ok(growth, 'The graph must include the growing direction, not merely simplify.');
    assert.equal(growth.operation.cost, 0);
    const change = find(graph, 'changeLiteral', growth.root, destination);
    assert.ok(change);
    assert.equal(change.operation.cost, 1);
    assert.deepEqual(replayOperation(replayOperation(source, growth.operation), change.operation), destination);
    assert.ok(find(graph, 'collapseDuplicateBooleanPredicate', duplicated, source));
});

test('Boolean commutation and reassociation are actual reversible AST edges', () => {
    const source = ast('SELECT id FROM students WHERE age=18 AND id>1');
    const destination = ast('SELECT id FROM students WHERE id>1 AND age=18');
    const graph = createEditGraph(destination, source);
    assert.ok(find(graph, 'commuteBooleanOperands', source, destination));
    assert.ok(find(graph, 'commuteBooleanOperands', destination, source));
    const left = ast('SELECT id FROM students WHERE (age=18 AND id>1) AND id<9');
    const right = ast('SELECT id FROM students WHERE age=18 AND (id>1 AND id<9)');
    const associated = createEditGraph(right, left);
    assert.ok(find(associated, 'associateBooleanOperands', left, right));
    assert.ok(find(associated, 'associateBooleanOperands', right, left));
});

test('volatile operands and non-Boolean numeric expressions receive no Boolean equivalence edges', () => {
    const volatile = ast('SELECT id FROM students WHERE random()>0 AND random()<0');
    const graph = createEditGraph(volatile, volatile);
    assert.equal([...edit(graph, 'commuteBooleanOperands').apply(volatile)].length, 0);
    assert.equal([...edit(graph, 'duplicateBooleanPredicate').apply(ast('SELECT 7'))].length, 0);
    assert.equal([...edit(graph, 'duplicateBooleanPredicate').apply(volatile)].length, 0);
});

test('SELECT aliases expanding volatile expressions do not acquire free Boolean laws', () => {
    const source = ast('SELECT probe(1) AS a, probe(2) AS b FROM sample WHERE a AND b');
    const destination = ast('SELECT probe(1) AS a, probe(2) AS b FROM sample WHERE b AND a');
    const graph = createEditGraph(destination, source);
    assert.equal([...edit(graph, 'commuteBooleanOperands').apply(source)].length, 0);
    assert.equal([...edit(graph, 'duplicateBooleanPredicate').apply(source)].length, 0);
    assert.ok(find(graph, 'swapBinaryOperands', source, destination), 'The separate paid repair remains available.');
    for (const [sql, name] of [
        ['SELECT probe(1) AS a FROM sample WHERE a<>1', 'rewriteNotEqual'],
        ['SELECT probe(1) AS a FROM sample WHERE a>1', 'mirrorColumnLiteralComparison']
    ]) {
        const state = ast(sql);
        assert.equal([...edit(createEditGraph(state, state), name).apply(state)].length, 0, name);
    }
});

test('correlated SELECT aliases also prevent free reordering in an inner scope', () => {
    const source = ast('SELECT probe(1) AS a, probe(2) AS b FROM sample s WHERE EXISTS(SELECT 1 FROM detail d WHERE a AND b)');
    const destination = ast('SELECT probe(1) AS a, probe(2) AS b FROM sample s WHERE EXISTS(SELECT 1 FROM detail d WHERE b AND a)');
    const graph = createEditGraph(destination, source);
    assert.equal([...edit(graph, 'commuteBooleanOperands').apply(source)].length, 0);
});

test('unrelated function projections do not disable base-column Boolean equivalences', () => {
    for (const [before, after] of [
        ['SELECT probe(1) AS unused FROM sample WHERE id>0 AND value>0',
            'SELECT probe(1) AS unused FROM sample WHERE value>0 AND id>0'],
        ['SELECT probe(1) AS id FROM sample s WHERE s.id>0 AND s.value>0',
            'SELECT probe(1) AS id FROM sample s WHERE s.value>0 AND s.id>0']
    ]) {
        const source = ast(before), destination = ast(after);
        const graph = createEditGraph(destination, source, {tables: [{name: 'sample', type: 'table'}]});
        assert.ok(find(graph, 'commuteBooleanOperands', source, destination), before);
    }
});

test('derived, CTE and view columns do not hide volatility behind free Boolean laws', () => {
    for (const sql of [
        'SELECT p FROM (SELECT probe(1) AS p, probe(2) AS q) d WHERE p AND q',
        'SELECT d.p FROM (SELECT probe(1) AS p, probe(2) AS q) d WHERE d.p AND d.q',
        'WITH d AS (SELECT probe(1) AS p, probe(2) AS q) SELECT p FROM d WHERE p AND q',
        'SELECT v.p FROM volatile_view v WHERE v.p AND v.q',
        'SELECT p FROM volatile_view WHERE p AND q'
    ]) {
        const source = ast(sql), graph = createEditGraph(source, source, {tables: [{name: 'volatile_view', type: 'view'}]});
        assert.equal([...edit(graph, 'commuteBooleanOperands').apply(source)].length, 0, sql);
        assert.equal([...edit(graph, 'duplicateBooleanPredicate').apply(source)].length, 0, sql);
    }
});

test('volatile aliases and opaque column provenance prevent free INNER JOIN predicate relocation', () => {
    for (const sql of [
        'SELECT probe(1) AS a FROM sample s INNER JOIN detail d ON a>0',
        'SELECT probe(1) AS a FROM sample s INNER JOIN detail d ON s.id=d.parent WHERE a>0',
        'SELECT v.p FROM volatile_view v INNER JOIN detail d ON v.p=d.parent',
        'SELECT d.p FROM (SELECT probe(1) AS p) d INNER JOIN sample s ON d.p=s.id'
    ]) {
        const source = ast(sql), graph = createEditGraph(source, source, {tables: [{name: 'volatile_view', type: 'view'}]});
        assert.equal([...edit(graph, 'relocateInnerJoinPredicate').apply(source)].length, 0, sql);
    }
});

test('pure CHECK columns remain eligible and volatile view aliases can still be renamed safely', () => {
    const source = ast('CREATE TABLE sample(id INTEGER, value INTEGER, CHECK(id>0 AND value>0))');
    const destination = ast('CREATE TABLE sample(id INTEGER, value INTEGER, CHECK(value>0 AND id>0))');
    const schema = {tables: [{name: 'volatile_view', type: 'view'}, {name: 'sample', type: 'table'}]};
    assert.ok(find(createEditGraph(destination, source, schema), 'commuteBooleanOperands', source, destination));
    const before = ast('SELECT a.p FROM volatile_view a'), after = ast('SELECT b.p FROM volatile_view b');
    assert.ok(find(createEditGraph(after, before, schema), 'renameBoundTableAlias', before, after));
    const update = ast('UPDATE volatile_view SET p=1 WHERE p AND q');
    assert.equal([...edit(createEditGraph(update, update, schema), 'commuteBooleanOperands').apply(update)].length, 0);
});

test('!= / NOT equality and safe column/literal mirrors retain explicit zero-price paths', () => {
    const source = ast('SELECT id FROM students WHERE age<>18');
    const destination = ast('SELECT id FROM students WHERE NOT(age=18)');
    const graph = createEditGraph(destination, source);
    assert.ok(find(graph, 'rewriteNotEqual', source, destination));
    assert.ok(find(graph, 'rewriteNotEqual', destination, source));
    const mirror = ast('SELECT id FROM students WHERE 18>age');
    const less = ast('SELECT id FROM students WHERE age<18');
    assert.ok(find(createEditGraph(mirror, less), 'mirrorColumnLiteralComparison', less, mirror));
    const columns = ast('SELECT id FROM students WHERE name>age');
    assert.equal([...edit(createEditGraph(columns, columns), 'mirrorColumnLiteralComparison').apply(columns)].length, 0);
});

test('literal replacement carries SQLite storage-class metadata together', () => {
    const source = ast('SELECT 1'), destination = ast('SELECT 1.0');
    const graph = createEditGraph(destination, source);
    const edge = find(graph, 'changeLiteral', source, destination);
    assert.ok(edge);
    assert.equal(edge.operation.cost, 1);
});

test('an extra binary operation is one paid SQL repair retaining an existing operand', () => {
    const source = ast('SELECT price+1 FROM item'), destination = ast('SELECT price FROM item');
    const graph = createEditGraph(destination, source);
    const repaired = find(graph, 'removeExtraneousBinaryTerm', source, destination);
    assert.ok(repaired);
    assert.equal(repaired.operation.cost, 1);
    assert.equal(stableKey(replayOperation(source, repaired.operation)), stableKey(destination));
});

test('comparison mirroring with explicit COLLATE, two columns or CAST is a paid SQL edit', () => {
    for (const [before, after] of [
        ["SELECT id FROM sample WHERE name COLLATE NOCASE>'B' COLLATE BINARY",
            "SELECT id FROM sample WHERE 'B' COLLATE BINARY<name COLLATE NOCASE"],
        ['SELECT id FROM sample WHERE left_value>right_value',
            'SELECT id FROM sample WHERE right_value<left_value'],
        ['SELECT id FROM sample WHERE CAST(name AS TEXT)>right_value',
            'SELECT id FROM sample WHERE right_value<CAST(name AS TEXT)']
    ]) {
        const source = ast(before), destination = ast(after), graph = createEditGraph(destination, source);
        const paid = edit(graph, 'mirrorComparisonOperands');
        const edge = find(graph, paid.name, source, destination);
        assert.ok(edge, before);
        assert.equal(paid.cost, 1); assert.equal(edge.operation.cost, 1);
        assert.equal(stableKey(replayOperation(source, edge.operation)), stableKey(destination));
        assert.equal(Boolean(find(graph, 'mirrorColumnLiteralComparison', source, destination)), false,
            'The guarded free mirror cannot replace this paid edge.');
    }
});

test('binary operand swaps are paid, including volatile AND expressions', () => {
    for (const [before, after] of [
        ['SELECT amount-name FROM sample', 'SELECT name-amount FROM sample'],
        ['SELECT id FROM sample WHERE probe(1) AND probe(2)',
            'SELECT id FROM sample WHERE probe(2) AND probe(1)']
    ]) {
        const source = ast(before), destination = ast(after), graph = createEditGraph(destination, source);
        const swapped = find(graph, 'swapBinaryOperands', source, destination);
        assert.ok(swapped);
        assert.equal(edit(graph, 'swapBinaryOperands').cost, 1);
        assert.equal(swapped.operation.cost, 1);
        assert.equal(stableKey(replayOperation(source, swapped.operation)), stableKey(destination));
        assert.equal(Boolean(find(graph, 'commuteBooleanOperands', source, destination)), false,
            'Volatile expressions and non-Boolean operations do not get a free swap.');
    }
});

test('SQL equality reassociation has a paid edge rather than a Boolean equivalence edge', () => {
    const source = ast('SELECT ((2=1)=0) AS value'), destination = ast('SELECT (2=(1=0)) AS value');
    const graph = createEditGraph(destination, source);
    for (const [before, after] of [[source, destination], [destination, source]]) {
        const regrouped = find(graph, 'reassociateBinaryOperands', before, after);
        assert.ok(regrouped);
        assert.equal(regrouped.operation.cost, 1);
        assert.equal(stableKey(replayOperation(before, regrouped.operation)), stableKey(after));
        assert.equal(Boolean(find(graph, 'associateBooleanOperands', before, after)), false);
    }
});

test('removing an extraneous projected term remains paid and can retain either operand', () => {
    const source = ast('SELECT price+1 FROM item');
    for (const sql of ['SELECT price FROM item', 'SELECT 1 FROM item']) {
        const destination = ast(sql), graph = createEditGraph(destination, source);
        const edge = find(graph, 'removeExtraneousBinaryTerm', source, destination);
        assert.ok(edge);
        assert.equal(edge.operation.cost, 1);
        assert.equal(stableKey(replayOperation(source, edge.operation)), stableKey(destination));
        assert.equal(graph.edits.filter(rule => rule.cost === 0)
            .some(rule => Boolean(find(graph, rule.name, source, destination))), false);
    }
});

test('outer JOIN predicate relocation is reversible but paid; INNER JOIN relocation stays free', () => {
    for (const join of ['LEFT JOIN', 'RIGHT JOIN', 'FULL JOIN']) {
        const on = ast('SELECT a.id FROM item a LEFT JOIN detail d ON a.id=d.item_id');
        const where = ast('SELECT a.id FROM item a LEFT JOIN detail d ON 1=1 WHERE a.id=d.item_id');
        // RIGHT/FULL are graph-state tests here: the SQLite input adapter does
        // not currently parse those textual JOIN variants. LEFT is parsed end
        // to end, including the independent SQLite counterexample suite.
        on.slots.statements[0].slots.from[1].attrs.join = join;
        where.slots.statements[0].slots.from[1].attrs.join = join;
        const graph = createEditGraph(on, where);
        assert.equal(edit(graph, 'relocateOuterJoinPredicate').cost, 1);
        for (const [source, destination] of [[on, where], [where, on]]) {
            const moved = find(graph, 'relocateOuterJoinPredicate', source, destination);
            assert.ok(moved, join);
            assert.equal(moved.operation.cost, 1);
            assert.equal(stableKey(replayOperation(source, moved.operation)), stableKey(destination));
            assert.equal(Boolean(find(graph, 'relocateInnerJoinPredicate', source, destination)), false);
        }
    }
    const inner = ast('SELECT a.id FROM item a INNER JOIN detail d ON a.id=d.item_id');
    const cross = ast('SELECT a.id FROM item a, detail d WHERE a.id=d.item_id');
    const innerGraph = createEditGraph(inner, cross);
    const moved = find(innerGraph, 'relocateInnerJoinPredicate', inner, cross);
    assert.ok(moved); assert.equal(moved.operation.cost, 0);
    assert.equal(stableKey(replayOperation(inner, moved.operation)), stableKey(cross));
});

test('bound alias renaming updates correlated references and avoids local shadowing', () => {
    const source = ast('SELECT a.id FROM students a WHERE EXISTS(SELECT 1 FROM details d WHERE d.parent=a.id)');
    const destination = ast('SELECT b.id FROM students b WHERE EXISTS(SELECT 1 FROM details d WHERE d.parent=b.id)');
    const graph = createEditGraph(destination, source);
    assert.ok(find(graph, 'renameBoundTableAlias', source, destination));
    const shadow = ast('SELECT a.id FROM students a WHERE EXISTS(SELECT a.id FROM details a)');
    const renamed = ast('SELECT b.id FROM students b WHERE EXISTS(SELECT a.id FROM details a)');
    assert.ok(find(createEditGraph(renamed, shadow), 'renameBoundTableAlias', shadow, renamed));
});

test('alias renaming cannot capture a correlated reference in an inner scope', () => {
    const source = ast('SELECT a.id FROM students a WHERE EXISTS(SELECT b.id FROM details b WHERE b.parent=a.id)');
    const destination = ast('SELECT b.id FROM students b WHERE EXISTS(SELECT b.id FROM details b WHERE b.parent=b.id)');
    const graph = createEditGraph(destination, source);
    assert.equal(Boolean(find(graph, 'renameBoundTableAlias', source, destination)), false);
});

test('alias renaming does not choose a binding for an ambiguous unaliased self-join', () => {
    const source = ast('SELECT students.id FROM students, students');
    const destination = ast('SELECT a.id FROM students a, students');
    const graph = createEditGraph(destination, source);
    assert.equal([...edit(graph, 'renameBoundTableAlias').apply(source)].length, 0);
});

test('zero-cost alias renaming never repairs a previously unbound new qualifier', () => {
    for (const [before, after] of [
        ['SELECT item.id FROM item AS a', 'SELECT item.id FROM item AS item'],
        ['SELECT b.id FROM item', 'SELECT b.id FROM item AS b'],
        ['SELECT a.id FROM item a WHERE EXISTS(SELECT b.id FROM detail d)',
            'SELECT b.id FROM item b WHERE EXISTS(SELECT b.id FROM detail d)'],
        ['SELECT a.id FROM item a WHERE EXISTS(SELECT b.id FROM detail a)',
            'SELECT b.id FROM item b WHERE EXISTS(SELECT b.id FROM detail a)'],
        ['SELECT z.id FROM outer_table z WHERE EXISTS(SELECT z.id FROM item a)',
            'SELECT z.id FROM outer_table z WHERE EXISTS(SELECT z.id FROM item z)']
    ]) {
        const source = ast(before), destination = ast(after), graph = createEditGraph(destination, source);
        assert.equal(Boolean(find(graph, 'renameBoundTableAlias', source, destination)), false, before);
    }
});

test('nested local new aliases remain valid when renamed outer references cannot be captured', () => {
    for (const [before, after] of [
        ['SELECT a.id FROM item a WHERE EXISTS(SELECT b.id FROM detail b)',
            'SELECT b.id FROM item b WHERE EXISTS(SELECT b.id FROM detail b)'],
        ['SELECT a.id FROM item a WHERE EXISTS(SELECT b.id FROM detail b WHERE EXISTS(SELECT a.id FROM leaf a))',
            'SELECT b.id FROM item b WHERE EXISTS(SELECT b.id FROM detail b WHERE EXISTS(SELECT a.id FROM leaf a))']
    ]) {
        const source = ast(before), destination = ast(after), graph = createEditGraph(destination, source);
        const renamed = find(graph, 'renameBoundTableAlias', source, destination);
        assert.ok(renamed, before);
        assert.equal(stableKey(replayOperation(source, renamed.operation)), stableKey(destination));
    }
});

test('a hidden physical table name is not an existing alias binding', () => {
    const source = ast('SELECT a.id, b.id FROM item a, item b');
    const destination = ast('SELECT item.id, b.id FROM item item, item b');
    const graph = createEditGraph(destination, source);
    assert.ok(find(graph, 'renameBoundTableAlias', source, destination));
});

test('an explicitly empty alias remains a real binding during zero-cost renaming', () => {
    const source = ast('SELECT "".id FROM item AS ""');
    const destination = ast('SELECT a.id FROM item AS a');
    const invalid = ast('SELECT "".id FROM item AS a');
    const graph = createEditGraph(destination, source);
    assert.ok(find(graph, 'renameBoundTableAlias', source, destination));
    assert.equal(Boolean(find(graph, 'renameBoundTableAlias', source, invalid)), false);
    for (const {root} of edit(graph, 'renameBoundTableAlias').apply(source)) {
        const select = root.slots.statements[0];
        assert.equal(select.slots.columns[0].slots.expr.attrs.table, select.slots.from[0].attrs.as);
    }
    assert.equal(Boolean(find(createEditGraph(source, invalid), 'renameBoundTableAlias', invalid, source)), false,
        'Renaming to the empty identifier must not capture a previously unbound empty qualifier.');
    const ambiguous = ast('SELECT "".id FROM item AS "", item AS ""');
    assert.equal([...edit(createEditGraph(destination, ambiguous), 'renameBoundTableAlias').apply(ambiguous)].length, 0);
});

test('INNER JOIN scope guards distinguish an empty qualifier from an absent qualifier', () => {
    const source = ast('SELECT "".id FROM item AS "" INNER JOIN detail d ON "".id=d.parent');
    const destination = ast('SELECT "".id FROM item AS "", detail d WHERE "".id=d.parent');
    const graph = createEditGraph(destination, source);
    assert.ok(find(graph, 'relocateInnerJoinPredicate', source, destination));
    assert.ok(find(graph, 'relocateInnerJoinPredicate', destination, source));
    const invalid = ast('SELECT a.id FROM item a INNER JOIN detail d ON "".id=d.parent');
    assert.equal([...edit(createEditGraph(destination, invalid), 'relocateInnerJoinPredicate').apply(invalid)].length, 0);
});

test('INNER JOIN/WHERE relocation is reversible for explicit projections and pure predicates', () => {
    const source = ast('SELECT a.id FROM students a INNER JOIN details d ON a.id=d.parent');
    const destination = ast('SELECT a.id FROM students a, details d WHERE a.id=d.parent');
    const graph = createEditGraph(destination, source);
    assert.ok(find(graph, 'relocateInnerJoinPredicate', source, destination));
    assert.ok(find(graph, 'relocateInnerJoinPredicate', destination, source));
    for (const sql of ['SELECT a.id FROM students a LEFT JOIN details d ON a.id=d.parent',
        'SELECT * FROM students a INNER JOIN details d USING(id)',
        'SELECT a.id FROM students a INNER JOIN details d ON random()>0']) {
        const state = ast(sql);
        assert.equal([...edit(createEditGraph(destination, state), 'relocateInnerJoinPredicate').apply(state)].length, 0);
    }
});

test('INNER JOIN star relocation retains the exact source sequence without USING column suppression', () => {
    const source = ast('SELECT * FROM students a INNER JOIN details d ON a.id=d.parent');
    const destination = ast('SELECT * FROM students a, details d WHERE a.id=d.parent');
    const graph = createEditGraph(destination, source);
    for (const [before, after] of [[source, destination], [destination, source]]) {
        const edge = find(graph, 'relocateInnerJoinPredicate', before, after);
        assert.ok(edge); assert.equal(edge.operation.cost, 0);
        assert.equal(stableKey(replayOperation(before, edge.operation)), stableKey(after));
        const from = root => root.slots.statements[0].slots.from.map(node => [node.attrs.table, node.attrs.as]);
        assert.deepEqual(from(before), from(after));
    }
});

test('changing mixed AND/OR grouping has a paid SQL edit, never a free associativity', () => {
    const source = ast('SELECT id FROM item WHERE (id=1 AND amount=2) OR amount=3');
    const destination = ast('SELECT id FROM item WHERE id=1 AND (amount=2 OR amount=3)');
    const graph = createEditGraph(destination, source);
    const edge = find(graph, 'reassociateBinaryOperands', source, destination);
    assert.ok(edge); assert.equal(edge.operation.cost, 1);
    assert.equal(Boolean(find(graph, 'associateBooleanOperands', source, destination)), false);
    assert.equal(stableKey(replayOperation(source, edge.operation)), stableKey(destination));
});

test('all neighbour operations replay and obey their declared symbol-introduction bounds', () => {
    const source = ast('SELECT a.id, AVG(a.age) FROM students a WHERE a.age>18 AND a.id<>2');
    const destination = ast('SELECT b.name, MAX(b.age) FROM students b WHERE b.age>19 AND b.id<>3');
    const graph = createEditGraph(destination, source, {tables: [{name: 'students', columns: [{name: 'id'}, {name: 'name'}, {name: 'age'}]}]});
    const starting = stableKey(source), before = symbols(source), beforePredicates = predicateFacts(source);
    let total = 0;
    for (const rule of graph.edits) for (const edge of rule.apply(source)) {
        ++total;
        assert.deepEqual(replayOperation(source, edge.operation), edge.root);
        assert.equal(stableKey(source), starting, 'Neighbour construction must not mutate its input.');
        const after = symbols(edge.root);
        const afterPredicates = predicateFacts(edge.root);
        assert.ok([...after].filter(value => !before.has(value)).length <= rule.maxNewSymbols, rule.name);
        assert.equal(rule.maxNewPredicates, rule.preservesSymbolSet ? 0 : 1, rule.name + ' binary predicate guidance');
        if (rule.preservesSymbolSet) assert.deepEqual([...after].sort(), [...before].sort(), rule.name);
        if (rule.cost === 0) assert.deepEqual([...afterPredicates].sort(), [...beforePredicates].sort(), rule.name + ' zero-cost predicate invariant');
        assert.ok(graph.bounded(edge.root), rule.name);
    }
    assert.ok(total > 100);
});

test('edit prices are fixed, nonnegative and configurable by SQL edit name', () => {
    const source = ast('SELECT 1, 1'), destination = ast('SELECT 2, 1');
    const graph = createEditGraph(destination, source, {}, {changeLiteral: 7, changeSelectDistinct: 3});
    assert.equal(edit(graph, 'changeLiteral').cost, 7);
    for (const result of edit(graph, 'changeLiteral').apply(source)) assert.equal(result.operation.cost, 7);
    for (const cost of [-1, NaN, Infinity, 0.5]) assert.throws(() => createEditGraph(destination, source, {}, {changeLiteral: cost}), /nonnegative safe integers/);
    assert.throws(() => createEditGraph(destination, source, {}, {typoEdit: 1}), /Unknown SQL edit/);
});

test('shallow constructors never insert a complete non-leaf reference subtree', () => {
    const source = ast('SELECT id FROM students');
    const destination = ast('SELECT AVG(age) FROM students WHERE age>18');
    const graph = createEditGraph(destination, source);
    const additions = graph.edits.filter(rule => rule.name.startsWith('add') && rule.name.includes('SelectWhere'));
    assert.ok(additions.length);
    for (const rule of additions) for (const edge of rule.apply(source)) {
        const added = edge.operation.after;
        if (added.kind === 'BinaryExpression') assert.ok(added.slots.left === null && added.slots.right === null);
        if (added.kind === 'AggregateExpression') assert.equal(added.slots.args?.slots.expr ?? null, null);
    }
});
