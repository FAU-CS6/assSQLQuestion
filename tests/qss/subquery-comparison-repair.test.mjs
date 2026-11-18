import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {registerSubqueryComparisonRepair, SUBQUERY_COMPARISON_STEP} from '../../lib/qss/src/subquery-comparison-repair.mjs';
import {registerLocalSubqueryEquivalences, LOCAL_SUBQUERY_STEPS} from '../../lib/qss/src/local-subquery-equivalences.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';

const sql = 'CREATE TABLE scores(person INTEGER,score INTEGER);CREATE TABLE people(id INTEGER PRIMARY KEY,name TEXT);';
const schema = {tables: [{name: 'scores', type: 'table', columns: [{name: 'person', type: 'INTEGER'}, {name: 'score', type: 'INTEGER'}]},
    {name: 'people', type: 'table', columns: [{name: 'id', type: 'INTEGER', pk: 1}, {name: 'name', type: 'TEXT', pk: 0}]}]};
const ast = text => parseGraphSql(text).root;
function graphFor(to, from, costs = {}, options = {}) {
    const settings = {schemaSql: sql, ...options};
    let graph = createEditGraph(to, from, schema, {}, settings);
    const ids = [SUBQUERY_COMPARISON_STEP, ...LOCAL_SUBQUERY_STEPS].map(step => step.id);
    if (ids.every(name => graph.edits.some(edit => edit.name === name))) return createEditGraph(to, from, schema, costs, settings);
    const register = (name, description, defaultCost, generate, annotations) => {
        if (graph.edits.some(edit => edit.name === name)) return;
        const cost = costs[name] ?? defaultCost;
        graph.edits.push({name, description, cost, maxNewPredicates: defaultCost ? 1 : 0, maxNewDistinct: 0,
            maxNewSources: 0, maxNewRelations: 0, statementOperation: null, statementKind: null, introducedComponent: null,
            componentWorkBounded: true, ...annotations, *apply(root) {
                for (const change of generate(root)) {
                    const operation = {type: 'sql-edit', name, cost, path: change.path,
                        before: change.path.reduce((node, part) => node[part], root), after: change.after};
                    const next = replayOperation(root, operation);
                    if (graph.bounded(next) && graph.key(next) !== graph.key(root)) yield {root: next, operation};
                }
            }});
    };
    registerSubqueryComparisonRepair(register);
    registerLocalSubqueryEquivalences(register, schema, settings);
    return graph;
}
const rule = (graph, name) => graph.edits.find(edit => edit.name === name);
const inSql = "DELETE FROM scores WHERE person IN (SELECT id FROM people WHERE name='Same')";
const scalarSql = "DELETE FROM scores WHERE person=(SELECT id FROM people WHERE name='Same')";
const rowSql = 'SELECT * FROM scores ORDER BY person';
function execute(text) {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(sql + "INSERT INTO people VALUES(1,'Same'),(2,'Same'),(3,NULL);INSERT INTO scores VALUES(1,0),(2,0),(3,0);" + text);
        return db.prepare(rowSql).all();
    } finally { db.close(); }
}

test('membership versus scalar subquery is a paid semantic change with duplicate-name and NULL counterexamples', () => {
    assert.notDeepEqual(execute(inSql), execute(scalarSql));
    assert.notDeepEqual(execute(inSql.replace('DELETE FROM scores', 'UPDATE scores SET score=4')),
        execute(scalarSql.replace('DELETE FROM scores', 'UPDATE scores SET score=4')));
    const db = new DatabaseSync(':memory:');
    try { db.exec('CREATE TABLE n(x);INSERT INTO n VALUES(1),(NULL);');
        assert.notDeepEqual(db.prepare('SELECT 2 NOT IN (SELECT x FROM n) AS answer').all(),
            db.prepare('SELECT 2 != (SELECT x FROM n) AS answer').all());
    } finally { db.close(); }
    const from = ast(inSql), to = ast(scalarSql), graph = graphFor(to, from);
    const edge = [...rule(graph, SUBQUERY_COMPARISON_STEP.id).apply(from)].find(edge => stableKey(edge.root) === stableKey(to));
    assert.ok(edge); assert.equal(edge.operation.cost, 1);
    assert.equal(edge.operation.after.slots.left, edge.operation.before.slots.left);
    assert.equal(edge.operation.after.slots.right, edge.operation.before.slots.right.slots.value[0]);
    assert.equal(stableKey(replayOperation(from, edge.operation)), stableKey(to));
});

test('subquery comparisons exclude row operands multiple outputs and literal membership lists', () => {
    for (const text of ['SELECT 1 IN (1,2)', 'SELECT 1 IN (SELECT id,name FROM people)',
        'SELECT 1 IN (SELECT * FROM people)', 'SELECT (1,2) IN (SELECT id,name FROM people)',
        'SELECT 1=(SELECT * FROM people)']) {
        const root = ast(text), graph = graphFor(root, root);
        assert.equal([...rule(graph, SUBQUERY_COMPARISON_STEP.id).apply(root)].length, 0, text);
    }
});

test('paid subquery comparison costs zero one seven agree with all-pairs directed Dijkstra and exact replay', async () => {
    const from = ast(inSql), to = ast(scalarSql);
    for (const cost of [0, 1, 7]) {
        const full = graphFor(to, from, {[SUBQUERY_COMPARISON_STEP.id]: cost});
        const edit = rule(full, SUBQUERY_COMPARISON_STEP.id), graph = {...full, edits: [edit]};
        const states = new Map([[stableKey(from), from]]), pending = [from];
        while (pending.length) for (const edge of edit.apply(pending.shift())) {
            const key = stableKey(edge.root); if (!states.has(key)) { states.set(key, edge.root); pending.push(edge.root); }
        }
        assert.equal(states.size, 11);
        for (const start of states.values()) {
            const best = new Map([[stableKey(start), 0]]), queue = [{root: start, cost: 0}];
            while (queue.length) {
                queue.sort((a, b) => a.cost - b.cost); const item = queue.shift();
                if (best.get(stableKey(item.root)) !== item.cost) continue;
                for (const edge of edit.apply(item.root)) {
                    const key = stableKey(edge.root), next = item.cost + cost;
                    if (next < (best.get(key) ?? Infinity)) { best.set(key, next); queue.push({root: edge.root, cost: next}); }
                }
            }
            for (const finish of states.values()) {
                const result = await shortestSqlEditPath(finish, start, graph, {async tick() {}}, {cutoff: cost * 2 + 1});
                assert.equal(result.distance, best.get(stableKey(finish))); assert.equal(result.capped, false);
                let actual = start; for (const edge of result.edits) actual = replayOperation(actual, edge.operation);
                assert.equal(stableKey(actual), stableKey(finish));
            }
        }
    }
});

test('physical local subquery qualifiers and identical aliases are actual bidirectional SQLite equivalences', async () => {
    for (const [name, a, b] of [
        ['qualifyLocalSubqueryColumn', scalarSql, scalarSql.replace('SELECT id', 'SELECT people.id')],
        ['qualifyLocalSubqueryColumn', scalarSql, scalarSql.replace("WHERE name='Same'", "WHERE people.name='Same'")],
        ['toggleLocalSubqueryTableAlias', scalarSql, scalarSql.replace('FROM people', 'FROM people AS people')]
    ]) {
        assert.deepEqual(execute(a), execute(b));
        const from = ast(a), to = ast(b);
        for (const cost of [0, 1, 7]) {
            const full = graphFor(to, from, {[name]: cost}), graph = {...full, edits: [rule(full, name)]};
            for (const [start, finish] of [[from, to], [to, from]]) {
                const result = await shortestSqlEditPath(finish, start, graph, {async tick() {}}, {cutoff: cost + 1});
                assert.equal(result.distance, cost); let actual = start;
                for (const edge of result.edits) actual = replayOperation(actual, edge.operation);
                assert.equal(stableKey(actual), stableKey(finish));
                for (const facts of [symbolFacts, predicateFacts]) assert.deepEqual(
                    [...facts(graph.abstractRoot(start))].sort(), [...facts(graph.abstractRoot(finish))].sort());
            }
        }
    }
});

test('local subquery rules refuse correlation inherited CTEs nested scopes hidden columns and output-name hazards', () => {
    for (const text of [
        "SELECT person FROM scores WHERE person IN (SELECT id FROM people WHERE name=scores.person)",
        "WITH people AS (SELECT person AS other FROM scores) SELECT 1=(SELECT id FROM people)",
        'SELECT 1=(SELECT rowid FROM people)', 'SELECT 1=(SELECT id+1 FROM people)',
        'SELECT 1=(SELECT id FROM people ORDER BY id)', 'SELECT 1=(SELECT id FROM people GROUP BY id)',
        'SELECT 1=(SELECT id FROM main.people)', 'SELECT 1=(SELECT id FROM people AS p WHERE p.name=scores.person)'
    ]) {
        const root = ast(text), graph = graphFor(root, root);
        for (const step of LOCAL_SUBQUERY_STEPS) assert.equal([...rule(graph, step.id).apply(root)].length, 0, text);
    }
    const nested = ast('SELECT 1=(SELECT id FROM people WHERE id IN (SELECT person FROM scores))');
    const nestedGraph = graphFor(nested, nested);
    for (const step of LOCAL_SUBQUERY_STEPS) for (const edge of rule(nestedGraph, step.id).apply(nested)) {
        // Only the innermost, independently local subquery qualifies; the
        // containing SELECT is not traversed as if all columns were local.
        assert.equal(edge.operation.path.filter(part => part === 'ast').length, 2);
    }
    const root = ast(scalarSql);
    for (const settings of [{outputColumnNamesObserved: true}, {ambiguousSchemaNamespaces: true}, {freeLabels: ['id']}]) {
        const graph = graphFor(root, root, {}, settings);
        for (const step of LOCAL_SUBQUERY_STEPS) assert.equal([...rule(graph, step.id).apply(root)].length, 0);
    }
});
