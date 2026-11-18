import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';
import {createSQLiteEquivalenceFactView} from '../../lib/qss/src/sqlite-equivalences.mjs';
import {heuristicCertificate, shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';

const schema = {tables: [{name: 'sample', type: 'table', columns: [{name: 'id', pk: 1}, {name: 'value'}]}]};
const ast = sql => parseGraphSql(sql, {schema, allowPartial: false}).root;
const set = values => [...values].sort();
const samples = [
    'CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL,value TEXT NOT NULL DEFAULT "unset" CHECK(value IN (\'ja\',\'nein\')))',
    'CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL REFERENCES sample(id),value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 3))',
    'CREATE TABLE fresh(id INTEGER PRIMARY KEY DESC NOT NULL,value TEXT NOT NULL)',
    'CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL,value TEXT NOT NULL) WITHOUT ROWID',
    'CREATE TABLE fresh(id INTEGER CONSTRAINT pk PRIMARY KEY NOT NULL,value TEXT NOT NULL)',
    'CREATE TABLE fresh(id INT PRIMARY KEY NOT NULL,value TEXT NOT NULL)',
    'ALTER TABLE sample ADD value TEXT NOT NULL DEFAULT \'ja\' CHECK(value IN(\'ja\',\'nein\'))',
    'CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL,value INTEGER NOT NULL,FOREIGN KEY(value) REFERENCES sample)'
];

test('nullable abstraction forgets only the INTEGER inline primary-key family', () => {
    const view = createSQLiteEquivalenceFactView();
    for (const sql of samples) {
        const source = ast(sql), key = stableKey(source), normalized = view(source);
        const definition = normalized.slots.statements[0].slots.create_definitions?.[0];
        if (sql.includes('id INTEGER')) assert.equal(definition.slots.nullable, undefined);
        if (sql.includes('id INT PRIMARY')) assert.equal(definition.slots.nullable.kind, 'NotNull');
        const ordinary = normalized.slots.statements[0].slots.create_definitions?.[1]
            || normalized.slots.statements[0].slots.expr?.[0];
        assert.equal(ordinary.slots.nullable.kind, 'NotNull');
        assert.equal(stableKey(source), key); assert.equal(view(source), normalized);
        const withoutNullable = value => !value || typeof value !== 'object' ? value : Array.isArray(value)
            ? value.map(withoutNullable) : Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'nullable').map(([key, child]) => [key, withoutNullable(child)]));
        assert.deepEqual(set(symbolFacts(withoutNullable(source))), set(symbolFacts(source)));
    }
});

test('every default-free edge retains symbol and predicate facts after precise nullable abstraction', t => {
    let checked = 0; const covered = new Set();
    for (const sql of samples) {
        const source = ast(sql), target = ast(sql.replace(/NOT NULL/g, '').replace('value BETWEEN 1 AND 3', 'value>=1 AND value<=3'));
        const graph = createEditGraph(target, source, schema), roots = new Map([[stableKey(source), source], [stableKey(target), target]]);
        for (const root of [source, target]) for (const edit of graph.edits.filter(edit => ['toggleIntegerPrimaryKeyNotNull', 'relocateSingleColumnForeignKey'].includes(edit.name))) {
            for (const next of edit.apply(root)) roots.set(stableKey(next.root), next.root);
        }
        for (const root of roots.values()) for (const edit of graph.edits.filter(edit => edit.cost === 0)) for (const next of edit.apply(root)) {
            const label = edit.name + ': ' + sql;
            assert.deepEqual(set(symbolFacts(graph.abstractRoot(root))), set(symbolFacts(graph.abstractRoot(next.root))), label);
            assert.deepEqual(set(predicateFacts(graph.abstractRoot(root))), set(predicateFacts(graph.abstractRoot(next.root))), label);
            assert.equal(stableKey(replayOperation(root, next.operation)), stableKey(next.root));
            checked++; covered.add(edit.name);
        }
    }
    for (const name of ['toggleIntegerPrimaryKeyNotNull', 'relocateSingleColumnForeignKey', 'rewriteLiteralInList', 'rewriteBetweenRange']) assert.ok(covered.has(name), name);
    assert.ok(checked > 100); t.diagnostic(checked + ' real default-free edges preserve both fact sets');
});

test('ordinary missing NOT NULL supplies a binary paid-step bound while customized free repairs disable it', async () => {
    for (const [before, after] of [
        ['ALTER TABLE sample ADD flag TEXT DEFAULT \'ja\' CHECK(flag IN(\'ja\',\'nein\'))', 'ALTER TABLE sample ADD flag TEXT NOT NULL DEFAULT \'ja\' CHECK(flag IN(\'ja\',\'nein\'))'],
        ['CREATE TABLE fresh(id INTEGER PRIMARY KEY,value INTEGER)', 'CREATE TABLE fresh(id INTEGER PRIMARY KEY,value INTEGER NOT NULL)']
    ]) {
        const answer = ast(before), reference = ast(after), graph = createEditGraph(reference, answer, schema);
        assert.notDeepEqual(set(predicateFacts(graph.abstractRoot(answer))), set(predicateFacts(graph.abstractRoot(reference))));
        assert.equal(heuristicCertificate(graph.edits, 'maxNewPredicates').unit, 1);
        const result = await shortestSqlEditPath(reference, answer, graph, {visited: 0, async tick() {} });
        assert.equal(result.distance, 1); assert.equal(result.edits.reduce((sum, edit) => sum + edit.cost, 0), 1);
        const free = createEditGraph(reference, answer, schema, {repairColumnNullable: 0});
        assert.equal(heuristicCertificate(free.edits, 'maxNewPredicates').enabled, false);
        assert.equal((await shortestSqlEditPath(reference, answer, free, {visited: 0, async tick() {} })).distance, 0);
    }
    // A context-changing paid edge may create many facts. The predicate bound
    // remains one unit; making that edit free disables the certificate.
    const from = ast('CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL)'), to = ast('CREATE TABLE fresh(id TEXT PRIMARY KEY NOT NULL)');
    const graph = createEditGraph(to, from, schema, {changeDataTypeDataType: 0});
    assert.equal(heuristicCertificate(graph.edits, 'maxNewPredicates').enabled, false);
});
