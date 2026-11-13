import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {registerJoinedAliasEquivalences, JOINED_ALIAS_STEPS} from '../../lib/qss/src/joined-alias-equivalences.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';

const schemaSql = 'CREATE TABLE a(id INTEGER PRIMARY KEY,name TEXT);CREATE TABLE b(parent_id INTEGER,label TEXT);';
const schema = {tables: [{name: 'a', type: 'table', columns: [{name: 'id', pk: 1}, {name: 'name', pk: 0}]},
    {name: 'b', type: 'table', columns: [{name: 'parent_id', pk: 0}, {name: 'label', pk: 0}]}]};
const ast = sql => parseGraphSql(sql, {schema}).root;
function graphFor(to, from, costs = {}, options = {}, catalog = schema) {
    const settings = {schemaSql, ...options}, graph = createEditGraph(to, from, catalog, {}, settings);
    if (JOINED_ALIAS_STEPS.every(step => graph.edits.some(edit => edit.name === step.id))) return createEditGraph(to, from, catalog, costs, settings);
    registerJoinedAliasEquivalences((name, description, defaultCost, generate, annotations) => {
        const cost = costs[name] ?? defaultCost;
        graph.edits.push({name, description, cost, maxNewPredicates: 0, maxNewDistinct: 0, maxNewSources: 0, maxNewRelations: 0,
            statementOperation: null, statementKind: null, introducedComponent: null, componentWorkBounded: true, ...annotations,
            *apply(root) {
                for (const change of generate(root)) {
                    const operation = {type: 'sql-edit', name, cost, path: change.path,
                        before: change.path.reduce((node, part) => node?.[part], root), after: change.after};
                    const next = replayOperation(root, operation);
                    if (graph.bounded(next) && graph.key(next) !== graph.key(root)) yield {root: next, operation};
                }
            }});
    }, catalog, settings);
    return graph;
}
const edit = (graph, name) => graph.edits.find(e => e.name === name);
const find = (graph, name, from, to) => [...edit(graph, name).apply(from)].find(edge => stableKey(edge.root) === stableKey(to));
function oracle(a, b, extra = '') {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(schemaSql + "INSERT INTO a VALUES(1,'Alpha'),(2,NULL),(3,'Gamma');INSERT INTO b VALUES(1,'one'),(1,NULL),(9,'missing');" + extra);
        return [db.prepare(a).all(), db.prepare(b).all()];
    } finally { db.close(); }
}

test('multi-source bare output aliases and identical table aliases are directed replayable equivalences', () => {
    for (const [name, a, b] of [
        ['toggleJoinedProjectionAlias', 'SELECT a.name FROM a JOIN b ON b.parent_id=a.id', 'SELECT a.name AS name FROM a JOIN b ON b.parent_id=a.id'],
        ['toggleJoinedProjectionAlias', 'SELECT name FROM a,b WHERE a.id=b.parent_id', 'SELECT name AS name FROM a,b WHERE a.id=b.parent_id'],
        ['toggleJoinedProjectionAlias', 'SELECT b.label FROM a LEFT JOIN b ON b.parent_id=a.id', 'SELECT b.label AS label FROM a LEFT JOIN b ON b.parent_id=a.id'],
        ['toggleJoinedIdenticalTableAlias', 'SELECT a.name FROM a,b WHERE a.id=b.parent_id', 'SELECT a.name FROM a AS a,b WHERE a.id=b.parent_id'],
        ['toggleJoinedIdenticalTableAlias', 'SELECT a.name FROM a LEFT JOIN b ON b.parent_id=a.id', 'SELECT a.name FROM a LEFT JOIN b AS b ON b.parent_id=a.id']
    ]) {
        const from = ast(a), to = ast(b), graph = graphFor(to, from);
        assert.notEqual(stableKey(from), stableKey(to)); assert.deepEqual(...oracle(a, b));
        for (const [start, finish] of [[from, to], [to, from]]) {
            const edge = find(graph, name, start, finish); assert.ok(edge, a + ' / ' + b);
            assert.equal(edge.operation.cost, 0); assert.equal(stableKey(replayOperation(start, edge.operation)), stableKey(finish));
        }
    }
});

test('projection aliases exclude ORDER GROUP HAVING duplicate headers expressions and mismatched output case', () => {
    for (const sql of ['SELECT a.name AS NAME FROM a,b', 'SELECT a.id+1 AS id FROM a,b',
        'SELECT a.name COLLATE NOCASE AS name FROM a,b', 'SELECT a.name AS name FROM a,b ORDER BY name',
        'SELECT a.name AS name FROM a,b GROUP BY name', 'SELECT a.name AS name FROM a,b HAVING name IS NOT NULL',
        'SELECT a.name AS name,b.label AS name FROM a,b', 'SELECT a.name,a.name AS name FROM a,b',
        'SELECT absent AS absent FROM a,b']) {
        const root = ast(sql), graph = graphFor(root, root);
        assert.equal([...edit(graph, 'toggleJoinedProjectionAlias').apply(root)].length, 0, sql);
    }
    assert.notDeepEqual(...oracle('SELECT a.name FROM a,b', 'SELECT a.name AS NAME FROM a,b'));
    assert.notDeepEqual(...oracle('SELECT a.id,b.parent_id AS id FROM a,b ORDER BY id', 'SELECT a.id,b.parent_id FROM a,b ORDER BY id'));
});

test('aliases cannot bypass scope namespace natural using hidden-column or source-capture guards', () => {
    for (const sql of ['SELECT a.name AS name FROM a', 'SELECT a.name AS name FROM a NATURAL JOIN b',
        'SELECT a.name AS name FROM a JOIN b USING(id)', 'SELECT a.name AS name FROM a,(SELECT parent_id FROM b) q',
        'WITH q AS (SELECT parent_id FROM b) SELECT a.name AS name FROM a,q',
        'SELECT a.name AS name FROM a,b WHERE EXISTS(SELECT 1 FROM b)', 'SELECT a.name AS name FROM main.a,b',
        'SELECT a.name AS name FROM a AS same,b AS same']) {
        const root = ast(sql), graph = graphFor(root, root);
        for (const step of JOINED_ALIAS_STEPS) assert.equal([...edit(graph, step.id).apply(root)].length, 0, sql);
    }
    const root = ast('SELECT a.name AS name FROM a AS a,b');
    for (const settings of [{schemaSql: ''}, {schemaSql: schemaSql + 'CREATE VIRTUAL TABLE f USING fts4(content);'},
        {schemaSql: schemaSql + 'CREATE TEMP TABLE t(x);'}, {schemaSql: schemaSql + "ATTACH ':memory:' AS other;"},
        {ambiguousSchemaNamespaces: true}, {outputColumnNamesObserved: true}, {freeLabels: ['name']}]) {
        const graph = graphFor(root, root, {}, settings);
        for (const step of JOINED_ALIAS_STEPS) assert.equal([...edit(graph, step.id).apply(root)].length, 0);
    }
    const catalog = {tables: [schema.tables[0], {...schema.tables[1], type: 'view'}]};
    for (const step of JOINED_ALIAS_STEPS) assert.equal([...edit(graphFor(root, root, {}, {}, catalog), step.id).apply(root)].length, 0);
});

test('new alias edges preserve symbol predicate and abstract fact sets', () => {
    const root = ast('SELECT a.name AS name FROM a AS a JOIN b AS b ON b.parent_id=a.id WHERE b.label IS NOT NULL');
    const graph = graphFor(root, root);
    for (const step of JOINED_ALIAS_STEPS) for (const edge of edit(graph, step.id).apply(root)) {
        for (const facts of [symbolFacts, predicateFacts]) {
            assert.deepEqual([...facts(root)].sort(), [...facts(edge.root)].sort());
            assert.deepEqual([...facts(graph.abstractRoot(root))].sort(), [...facts(graph.abstractRoot(edge.root))].sort());
        }
    }
});

test('each new alias step respects independent zero one seven costs with exact search and replay', async () => {
    for (const [name, a, b] of [
        ['toggleJoinedProjectionAlias', 'SELECT a.name FROM a,b', 'SELECT a.name AS name FROM a,b'],
        ['toggleJoinedIdenticalTableAlias', 'SELECT a.name FROM a,b', 'SELECT a.name FROM a AS a,b']
    ]) for (const cost of [0, 1, 7]) {
        const from = ast(a), to = ast(b), full = graphFor(to, from, {[name]: cost});
        const graph = {...full, edits: [edit(full, name)]};
        for (const [start, finish] of [[from, to], [to, from]]) {
            const result = await shortestSqlEditPath(finish, start, graph, {async tick() {}}, {cutoff: cost + 1});
            assert.equal(result.distance, cost); assert.equal(result.capped, false);
            let actual = start; for (const edge of result.edits) actual = replayOperation(actual, edge.operation);
            assert.equal(stableKey(actual), stableKey(finish));
        }
    }
});

test('joined alias combinations agree with an independent directed Dijkstra over their finite cube', async () => {
    const from = ast('SELECT a.name FROM a,b'), to = ast('SELECT a.name AS name FROM a AS a,b AS b');
    for (const cost of [0, 1, 7]) {
        const full = graphFor(to, from, Object.fromEntries(JOINED_ALIAS_STEPS.map(step => [step.id, cost])));
        const graph = {...full, edits: full.edits.filter(edit => JOINED_ALIAS_STEPS.some(step => step.id === edit.name))};
        const states = new Map([[stableKey(from), from]]), todo = [from];
        while (todo.length) {
            const root = todo.shift();
            for (const rule of graph.edits) for (const edge of rule.apply(root)) {
                const key = stableKey(edge.root); if (!states.has(key)) { states.set(key, edge.root); todo.push(edge.root); }
            }
        }
        assert.equal(states.size, 8);
        for (const start of states.values()) {
            const best = new Map([[stableKey(start), 0]]), queue = [{root: start, distance: 0}];
            while (queue.length) {
                queue.sort((a, b) => a.distance - b.distance); const item = queue.shift();
                if (item.distance !== best.get(stableKey(item.root))) continue;
                for (const rule of graph.edits) for (const edge of rule.apply(item.root)) {
                    const key = stableKey(edge.root), distance = item.distance + rule.cost;
                    if (distance < (best.get(key) ?? Infinity)) { best.set(key, distance); queue.push({root: edge.root, distance}); }
                }
            }
            for (const finish of states.values()) {
                const result = await shortestSqlEditPath(finish, start, graph, {async tick() {}}, {cutoff: 3 * cost + 1});
                assert.equal(result.distance, best.get(stableKey(finish))); assert.equal(result.capped, false);
                let actual = start; for (const edge of result.edits) actual = replayOperation(actual, edge.operation);
                assert.equal(stableKey(actual), stableKey(finish));
            }
        }
    }
});
