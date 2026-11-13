import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {createStatementBound} from '../../lib/qss/src/statement-bound.mjs';
import {ordinaryCatalog} from '../../lib/qss/src/sqlite-join-scope.mjs';
import {semijoinProvenancePossible} from '../../lib/qss/src/sqlite-semijoin-equivalence.mjs';
import {minimumEffectRatio, ceilEffect} from '../../lib/qss/src/integer-bound.mjs';

const parse = sql => parseGraphSql(sql).root;
const context = () => ({visited: 0, async tick() {}});
const sorted = values => [...values].sort();
const schema = {tables: [
    {name: 'items', type: 'table', columns: [{name: 'id', type: 'INTEGER', pk: 0}, {name: 'amount', type: 'INTEGER', pk: 0}]},
    {name: 'detail', type: 'table', columns: [{name: 'item', type: 'INTEGER', pk: 0}, {name: 'flag', type: 'INTEGER', pk: 0}]}
]};
const ddl = 'CREATE TABLE items(id INTEGER,amount INTEGER);CREATE TABLE detail(item INTEGER,flag INTEGER);';
const keyedDdl = ddl.replace('detail(item INTEGER,flag INTEGER)', 'detail(item INTEGER UNIQUE,flag INTEGER)');
const bothPkDdl = ddl.replace('items(id INTEGER,', 'items(id INTEGER PRIMARY KEY,').replace('detail(item INTEGER,', 'detail(item INTEGER PRIMARY KEY,');
const bothPkSchema = {tables: schema.tables.map(table => ({...table, columns: table.columns.map((column, i) => ({...column, pk: i === 0 ? 1 : 0}))}))};
const graphFor = (target, source, settings = {}, costs = {}) => createEditGraph(target, source,
    settings.schema ?? schema, costs, {schemaSql: settings.schemaSql ?? ddl, ...settings.options});
const facts = (graph, root) => sorted(graph.predicateFacts(graph.abstractRoot(root)));
const hasFilter = (graph, root) => facts(graph, root).some(value => value.startsWith('["filter-boolean",'));
const boolSource = parse('SELECT id FROM items WHERE id=1 AND(amount=2 OR amount=3)');
const boolTarget = parse('SELECT id FROM items WHERE (id=1 AND amount=2) OR amount=3');

test('semijoin impossibility uses fixed catalog provenance and fixed blocked options, never the current query shape', () => {
    for (const [metadata, sql, expected] of [
        [schema, '', false], [schema, 'CREATE TABLE items(id INTEGER PRIMARY KEY,amount INTEGER);', false],
        [schema, ddl, false], [schema, keyedDdl, true],
        [schema, keyedDdl.replace('amount INTEGER', 'amount INTEGER COLLATE NOCASE'), false],
        [schema, keyedDdl + 'CREATE TEMP TABLE hidden(x);', false],
        [schema, keyedDdl + "ATTACH ':memory:' AS extra;", false],
        [schema, keyedDdl + 'ALTER TABLE items ADD extra INTEGER;', false],
        [{tables: schema.tables.map(t => ({...t, type: 'view'}))}, keyedDdl, false]
    ]) assert.equal(semijoinProvenancePossible(ordinaryCatalog(metadata, sql)), expected, sql);
    const catalog = ordinaryCatalog(schema, keyedDdl);
    for (const options of [{outputColumnNamesObserved: true}, {ambiguousSchemaNamespaces: true}, {freeLabels: ['bucket']}]) {
        assert.equal(semijoinProvenancePossible(catalog, options), false);
    }
    assert.equal(semijoinProvenancePossible(catalog, {freeLabels: []}), true);
    const pkSchema = {tables: schema.tables.map(t => ({...t, columns: t.columns.map(c => ({...c,
        pk: t.name === 'detail' && c.name === 'item' ? 1 : 0}))}))};
    assert.equal(semijoinProvenancePossible(ordinaryCatalog(pkSchema, ddl)), true);
});

test('Boolean precedence retains a certified one-edit bound without possible semijoin provenance', async () => {
    for (const settings of [{schema: {}, schemaSql: ''},
        {schema: {tables: [schema.tables[0]]}, schemaSql: 'CREATE TABLE items(id INTEGER,amount INTEGER);'},
        {}, {schemaSql: keyedDdl, options: {outputColumnNamesObserved: true}},
        {schemaSql: keyedDdl, options: {ambiguousSchemaNamespaces: true}},
        {schema: bothPkSchema, schemaSql: bothPkDdl}]) {
        const graph = graphFor(boolTarget, boolSource, settings);
        assert.ok(hasFilter(graph, boolSource));
        assert.notDeepEqual(facts(graph, boolSource), facts(graph, boolTarget));
        assert.equal(createStatementBound(boolTarget, graph).measure(boolSource), 1);
        const result = await shortestSqlEditPath(boolTarget, boolSource, graph, context(), {cutoff: 5});
        assert.equal(result.distance, 1); assert.equal(result.visited, 0);
        assert.equal(result.edits.reduce((sum, edit) => sum + edit.cost, 0), 1);
        let replay = boolSource;
        for (const edit of result.edits) replay = replayOperation(replay, edit.operation);
        assert.equal(stableKey(replay), stableKey(boolTarget));
    }
});

test('possible UNIQUE semijoin keeps the coarser facts across every actual free edge and remains zero distance', async () => {
    const source = parse('SELECT amount FROM items WHERE id IN(SELECT item FROM detail WHERE flag=2)');
    const target = parse('SELECT items.amount FROM items JOIN detail ON items.id=detail.item WHERE detail.flag=2');
    const graph = graphFor(target, source, {schemaSql: keyedDdl});
    assert.equal(hasFilter(graph, source), false); assert.equal(hasFilter(graph, target), false);
    const rule = graph.edits.find(edit => edit.name === 'rewriteUniqueFilteredSemijoin');
    assert.ok([...rule.apply(source)].some(edge => stableKey(edge.root) === stableKey(target)));
    const result = await shortestSqlEditPath(target, source, graph, context());
    assert.equal(result.distance, 0); assert.equal(result.visited, 0);
    for (const root of [source, target]) for (const edit of graph.edits.filter(edit => edit.cost === 0)) {
        for (const edge of edit.apply(root)) assert.deepEqual(facts(graph, root), facts(graph, edge.root), edit.name);
    }
    // A simple AND-only filter still uses the graph-wide relaxation even
    // when its current query is not itself a semijoin candidate.
    const plain = parse('SELECT id FROM items WHERE amount=2');
    const plainGraph = graphFor(plain, plain, {schemaSql: keyedDdl});
    assert.equal(hasFilter(plainGraph, plain), false);
    // A non-collapsing canonical OR cannot occur at either semijoin endpoint.
    const booleanGraph = graphFor(boolTarget, boolSource, {schemaSql: keyedDdl});
    assert.equal(hasFilter(booleanGraph, boolSource), true);
});

test('retained Boolean filters preserve all free edges including source commutation and grammar partials', () => {
    const examples = [
        'SELECT items.amount FROM items JOIN detail ON items.id=detail.item WHERE detail.flag=2',
        'SELECT items.amount AS amount FROM items AS items JOIN detail AS detail ON items.id=detail.item WHERE (items.id=1 AND detail.flag=2) OR detail.flag=3',
        'SELECT id FROM items WHERE NOT(id=1 AND(amount=2 OR amount=3))',
        'SELECT id FROM items WHERE amount BETWEEN 1 AND 3',
        "SELECT id FROM items WHERE amount IN (1,2,3)",
        'SELECT id FROM items WHERE EXISTS(SELECT item FROM detail WHERE flag=2) AND amount=3',
        "SELECT CASE WHEN id>0 THEN 'yes' ELSE 'no' END AS bucket FROM items GROUP BY bucket"
    ];
    let checked = 0, commuted = 0, partialCount = 0;
    for (const sql of examples) for (const settings of [{}, {schema: bothPkSchema, schemaSql: bothPkDdl},
        {schemaSql: keyedDdl, options: {outputColumnNamesObserved: true}},
        {schemaSql: keyedDdl, options: {freeLabels: ['bucket']}}]) {
        const source = parse(sql), graph = graphFor(source, source, settings);
        const states = new Map([[stableKey(source), source]]);
        for (const edit of graph.edits.filter(edit => /^removeBinaryExpression(?:Left|Right)/.test(edit.name))) {
            for (const edge of edit.apply(source)) { states.set(stableKey(edge.root), edge.root); partialCount++; }
        }
        const bound = createStatementBound(source, graph);
        for (const root of states.values()) for (const edit of graph.edits.filter(edit => edit.cost === 0)) {
            for (const edge of edit.apply(root)) {
                checked++; if (edit.name === 'commuteInnerJoinSources') commuted++;
                assert.deepEqual(facts(graph, root), facts(graph, edge.root), edit.name + ' ' + sql);
                assert.equal(bound.measure(root), bound.measure(edge.root), edit.name + ' statement bound');
            }
        }
    }
    assert.ok(checked > 100); assert.ok(commuted > 0); assert.ok(partialCount > 0);
});

test('fact and statement lower bounds retain lazy decreases under paid and custom-free repairs', () => {
    for (const settings of [{}, {schemaSql: keyedDdl}, {schemaSql: keyedDdl, options: {freeLabels: ['bucket']}}]) {
        for (const costs of [{}, {reassociateBinaryOperands: 0}, {reassociateBinaryOperands: 7}, {baseRemoveComponent: 0},
            {baseAddStructural: 0}, {baseRemoveStructural: 1}]) {
            const graph = graphFor(boolTarget, boolSource, settings, costs), destination = facts(graph, boolTarget);
            const ratio = minimumEffectRatio(graph.edits, 'maxNewPredicates');
            const predicateBound = root => ceilEffect(ratio, JSON.stringify(facts(graph, root)) === JSON.stringify(destination) ? 0 : 1);
            const statementBound = createStatementBound(boolTarget, graph);
            for (const root of [boolSource, boolTarget]) for (const edit of graph.edits) for (const edge of edit.apply(root)) {
                const before = predicateBound(root), after = predicateBound(edge.root);
                assert.ok(before <= edit.cost + after, edit.name + ' predicate cost');
                assert.ok(Math.max(0, before - ceilEffect(ratio, edit.maxNewPredicates)) <= after, edit.name + ' predicate remaining');
                assert.ok(statementBound.measure(root) <= edit.cost + statementBound.measure(edge.root), edit.name + ' statement cost');
                assert.ok(statementBound.measure(root) - statementBound.decrease(edit) <= statementBound.measure(edge.root), edit.name + ' statement remaining');
            }
        }
    }
});


test('canonical OR retention follows normalization through idempotence De Morgan and literal IN lists', () => {
    const examples = [
        ['id=1 OR id=1', false], ['id=1 OR amount=2', true],
        ['NOT(id=1 AND amount=2)', true], ['NOT(id=1 OR amount=2)', false],
        ['amount IN (1,2)', true], ['amount NOT IN (1,2)', false],
        ['id=1 AND(amount=2 OR amount=2)', false],
        ['id=1 AND(amount=2 OR amount=3)', true]
    ];
    for (const [where, expected] of examples) {
        const root = parse('SELECT id FROM items WHERE ' + where);
        const graph = graphFor(root, root, {schema: bothPkSchema, schemaSql: bothPkDdl});
        assert.equal(hasFilter(graph, root), expected, where);
        for (const edit of graph.edits.filter(edit => edit.cost === 0)) for (const edge of edit.apply(root)) {
            assert.deepEqual(facts(graph, root), facts(graph, edge.root), edit.name + ' ' + where);
        }
    }
});
