import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey, walkNodes} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts} from '../../lib/qss/src/graph-features.mjs';
import {heuristicCertificate, shortestSqlEditPath, sqlWorkBound} from '../../lib/qss/src/graph-search.mjs';

const ast = sql => parseGraphSql(sql).root;
const rule = graph => graph.edits.find(edit => edit.name === 'restoreMissingBinaryTerm');
const find = (edit, from, to) => [...edit.apply(from)].find(edge => stableKey(edge.root) === stableKey(to));
const count = (root, kinds) => [...walkNodes(root)].filter(({node}) => kinds.includes(node.kind)).length;
const context = () => ({visited: 0, async tick() {}});

test('missing binary terms restore either operand with a paid replayable edge', () => {
    for (const [a, b] of [
        ['SELECT MAX(v) FROM item', 'SELECT MAX(v)-MIN(v) FROM item'],
        ['SELECT MIN(v) FROM item', 'SELECT MAX(v)-MIN(v) FROM item'],
        ['SELECT a FROM item', 'SELECT a+b*c FROM item'],
        ['SELECT a FROM item', 'SELECT a>3 FROM item'],
        ['SELECT a>3 FROM item', 'SELECT a>3 AND b IS NULL FROM item'],
        ["SELECT a FROM item", "SELECT a || 'suffix' FROM item"],
        ["SELECT a FROM item", "SELECT a LIKE 'x%' ESCAPE '!' FROM item"]
    ]) {
        const from = ast(a), to = ast(b), graph = createEditGraph(to, from), original = stableKey(from);
        const edge = find(rule(graph), from, to);
        assert.ok(edge, a + ' -> ' + b); assert.equal(edge.operation.cost, 1);
        assert.equal(stableKey(replayOperation(from, edge.operation)), stableKey(to));
        assert.ok(find(graph.edits.find(edit => edit.name === 'removeExtraneousBinaryTerm'), to, from));
        assert.equal(stableKey(from), original, 'Inputs remain immutable.');
    }
});

test('missing binary terms apply at every expression position and keep observed operator pairs', () => {
    const from = ast('SELECT a,a FROM item'), to = ast('SELECT a-b,a FROM item');
    const graph = createEditGraph(to, from), edit = rule(graph);
    assert.ok(find(edit, from, to));
    assert.ok(find(edit, from, ast('SELECT a,a-b FROM item')), 'The target position does not constrain applicability.');
    assert.ok(!find(edit, from, ast('SELECT a+b,a FROM item')), 'No unobserved operator/operand Cartesian product.');
    const nested = [...edit.apply(from)];
    assert.equal(new Set(nested.map(edge => stableKey(edge.root))).size, nested.length);
});

test('missing binary terms never introduce query sources DISTINCT or work components', () => {
    const from = ast('SELECT a FROM item'), to = ast('SELECT a+(SELECT DISTINCT b FROM other) FROM item');
    const graph = createEditGraph(to, from), edit = rule(graph);
    assert.ok(!find(edit, from, to), 'A complete scalar subquery is not a missing-term template.');
    const structural = ['Script', 'Select', 'CompoundSelect', 'Values', 'TableSource', 'Definition', 'DataType', 'SelectItem', 'OrderByItem'];
    for (const edge of edit.apply(from)) for (const kind of structural) assert.equal(count(edge.root, [kind]), count(from, [kind]));
    // A query already present in the retained operand is not copied or removed.
    const retained = ast('SELECT (SELECT b FROM other) FROM item');
    const withLiteral = ast('SELECT (SELECT b FROM other)+1 FROM item');
    const retainedGraph = createEditGraph(withLiteral, retained), restored = find(rule(retainedGraph), retained, withLiteral);
    assert.ok(restored);
    for (const kind of structural) assert.equal(count(restored.root, [kind]), count(retained, [kind]));
});

test('inserted binary terms retain collations casts literal classes and LIKE escape slots', () => {
    for (const target of ["SELECT a + CAST(b AS REAL) FROM item", "SELECT a = b COLLATE NOCASE FROM item", "SELECT a + 1.0 FROM item", "SELECT a LIKE 'x%' ESCAPE '!' FROM item"]) {
        const from = ast('SELECT a FROM item'), to = ast(target), graph = createEditGraph(to, from);
        const edge = find(rule(graph), from, to); assert.ok(edge, target);
        assert.equal(stableKey(replayOperation(from, edge.operation)), stableKey(to));
    }
});

test('missing-term symbol and component annotations bound all generated edges including free labels', () => {
    for (const [a, b, requirements] of [
        ['SELECT MAX(v) FROM item HAVING MAX(v)>2', 'SELECT MAX(v)-MIN(w) FROM item HAVING MAX(v)-MIN(w)>2', {}],
        ["SELECT (a>0) || 'yes' AS label FROM item GROUP BY label", "SELECT ((a>0) || 'yes')+b AS label FROM item GROUP BY label", {freeLabels: ['label']}],
        ["SELECT a FROM item", "SELECT a || CASE WHEN b>0 THEN 'yes' ELSE 'no' END FROM item", {}]
    ]) {
        const from = ast(a), to = ast(b), graph = createEditGraph(to, from, {}, {}, requirements), edit = rule(graph);
        const before = symbolFacts(graph.abstractRoot(from));
        const certificate = heuristicCertificate(graph.edits);
        const work = sqlWorkBound(to, graph, certificate.unit);
        for (const edge of edit.apply(from)) {
            const added = [...symbolFacts(graph.abstractRoot(edge.root))].filter(fact => !before.has(fact)).length;
            assert.ok(added <= edit.maxNewSymbols, 'Introduced symbol facts are conservatively bounded.');
            assert.equal(count(edge.root, ['Definition', 'DataType', 'SelectItem', 'OrderByItem']), count(from, ['Definition', 'DataType', 'SelectItem', 'OrderByItem']));
            assert.ok(work.decrease(edit) <= edit.cost, 'Partitioned work never exceeds the real edge cost.');
            assert.equal(stableKey(replayOperation(from, edge.operation)), stableKey(edge.root));
        }
    }
});

test('missing binary term prices remain individually configurable and exact search replays them', async () => {
    const from = ast('SELECT MAX(v) FROM item'), to = ast('SELECT MAX(v)-MIN(v) FROM item');
    for (const cost of [0, 1, 2, 7]) {
        const complete = createEditGraph(to, from, {}, {restoreMissingBinaryTerm: cost});
        const edit = rule(complete); assert.equal(edit.cost, cost);
        const graph = {...complete, edits: [edit]};
        const result = await shortestSqlEditPath(to, from, graph, context(), {cutoff: cost + 1});
        assert.equal(result.capped, false); assert.equal(result.distance, cost);
        let current = from;
        for (const step of result.edits) current = replayOperation(current, step.operation);
        assert.equal(stableKey(current), stableKey(to));
        if (!cost) assert.equal(heuristicCertificate(graph.edits).enabled, false);
    }
    const absent = createEditGraph(ast('SELECT a'), ast('SELECT b'), {}, {restoreMissingBinaryTerm: 3});
    assert.equal(rule(absent).cost, 3); assert.equal([...rule(absent).apply(ast('SELECT b'))].length, 0);
});

test('restoring a missing arithmetic term is a semantic repair and is not free by default', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('CREATE TABLE item(v); INSERT INTO item VALUES(80),(150)');
        const a = 'SELECT MAX(v)>100 AS answer FROM item', b = 'SELECT MAX(v)-MIN(v)>100 AS answer FROM item';
        assert.notDeepEqual(db.prepare(a).all(), db.prepare(b).all());
        const graph = createEditGraph(ast(b), ast(a)); assert.equal(rule(graph).cost, 1);
        assert.ok(find(rule(graph), ast(a), ast(b)));
    } finally { db.close(); }
});
