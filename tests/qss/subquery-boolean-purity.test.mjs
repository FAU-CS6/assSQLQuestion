import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createSubqueryBooleanPurity} from '../../lib/qss/src/subquery-boolean-purity.mjs';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {atomicPredicateFacts} from '../../lib/qss/src/atomic-predicate-bound.mjs';
import {locations} from '../../lib/qss/src/sqlite-join-scope.mjs';

const setup = 'CREATE TABLE item(id INTEGER PRIMARY KEY, key INTEGER, flag INTEGER, outer_only INTEGER); CREATE TABLE lookup(id INTEGER, label TEXT);';
const schema = {tables: [
    {name: 'item', type: 'table', columns: [{name: 'id', type: 'INTEGER', pk: 1}, {name: 'key', type: 'INTEGER'}, {name: 'flag', type: 'INTEGER'}, {name: 'outer_only', type: 'INTEGER'}]},
    {name: 'lookup', type: 'table', columns: [{name: 'id', type: 'INTEGER'}, {name: 'label', type: 'TEXT'}]}
]};
const ast = sql => parseGraphSql(sql, {schema}).root;
const where = root => root.slots.statements[0].slots.where;
const path = ['slots', 'statements', 0, 'slots', 'where'];
const guard = (activeSchema = schema, extra = {}) => createSubqueryBooleanPurity(activeSchema, {schemaSql: setup, ...extra});
const exchange = root => {
    const copy = JSON.parse(JSON.stringify(root)), value = where(copy);
    [value.slots.left, value.slots.right] = [value.slots.right, value.slots.left];
    return copy;
};
const sorted = values => [...values].sort();
function dbFor(lookupRows) {
    const db = new DatabaseSync(':memory:');
    db.exec(setup);
    db.exec('INSERT INTO item VALUES(1,1,1,1),(2,2,0,2),(3,NULL,NULL,3),(4,3,1,NULL),(5,2,NULL,5),(6,1,0,6);');
    if (lookupRows) db.exec('INSERT INTO lookup VALUES ' + lookupRows + ';');
    return db;
}

test('ordinary uncorrelated single-column scalar and IN queries permit outer AND/OR commutation', () => {
    for (const statement of ['SELECT id FROM item', 'DELETE FROM item', 'UPDATE item SET flag=2']) {
        for (const operator of ['AND', 'OR']) for (const comparison of ['=', 'IN', 'NOT IN']) {
            const root = ast(`${statement} WHERE flag=1 ${operator} key ${comparison} (SELECT id FROM lookup WHERE label='match')`);
            assert.equal(guard()(where(root), root, path), true);
            const swapped = exchange(root);
            assert.equal(guard()(where(swapped), swapped, path), true);
        }
    }
    const quoted = ast('DELETE FROM item WHERE flag=1 AND key=(SELECT id FROM lookup WHERE label="match")');
    assert.equal(guard()(where(quoted), quoted), true, 'Unbound DQS string is deterministic.');
});

test('volatile unknown correlated nested ordered grouped and limited subqueries are rejected', () => {
    const bad = [
        'SELECT random() FROM lookup', 'SELECT id FROM lookup WHERE random()=1',
        'SELECT id FROM lookup WHERE missing=1', 'SELECT id FROM lookup WHERE outer_only=1',
        'SELECT id FROM lookup WHERE id=item.key', 'SELECT id FROM lookup WHERE label="outer_only"',
        'SELECT id FROM lookup WHERE id=(SELECT id FROM lookup)', 'SELECT id FROM lookup LIMIT 1',
        'SELECT id FROM lookup ORDER BY id', 'SELECT DISTINCT id FROM lookup',
        'SELECT id FROM lookup GROUP BY id', 'SELECT id,label FROM lookup',
        'SELECT count(*) FROM lookup', 'SELECT id FROM (SELECT id FROM lookup) AS derived'
    ];
    for (const query of bad) {
        const root = ast('DELETE FROM item WHERE flag=1 AND key=(' + query + ')');
        assert.equal(guard()(where(root), root), false, query);
    }
    const unknownOuter = ast('DELETE FROM item WHERE missing=1 AND key=(SELECT id FROM lookup)');
    assert.equal(guard()(where(unknownOuter), unknownOuter), false);
    const aliasCapture = ast('SELECT outer_only AS hidden FROM item WHERE flag=1 AND key=(SELECT id FROM lookup WHERE label="hidden")');
    assert.equal(guard()(where(aliasCapture), aliasCapture), false, 'Quoted outer projection alias may correlate.');
    const two = ast('DELETE FROM item WHERE key=(SELECT id FROM lookup) AND outer_only IN(SELECT id FROM lookup)');
    assert.equal(guard()(where(two), two), false, 'Multiple query scope identities require a separate heuristic proof.');
});

test('views shadow namespaces CTEs conflict policies and missing provenance fail closed', () => {
    const sql = 'DELETE FROM item WHERE flag=1 AND key=(SELECT id FROM lookup)', root = ast(sql);
    const viewSchema = JSON.parse(JSON.stringify(schema)); viewSchema.tables[1].type = 'view';
    assert.equal(guard(viewSchema)(where(root), root), false);
    for (const suffix of [' CREATE TEMP TABLE hidden(id);', ' CREATE VIRTUAL TABLE hidden USING fts3(x);',
        ' ATTACH DATABASE \'x\' AS extra;', ' CREATE TRIGGER observe AFTER DELETE ON item BEGIN SELECT 1; END;']) {
        assert.equal(guard(schema, {schemaSql: setup + suffix})(where(root), root), false);
    }
    for (const options of [{schemaSql: ''}, {ambiguousSchemaNamespaces: true}, {freeLabels: ['label']}, {freeDiagnostics: true}]) {
        assert.equal(guard(schema, options)(where(root), root), false);
    }
    const cte = ast('WITH lookup AS (SELECT id FROM item) SELECT id FROM item WHERE flag=1 AND key IN(SELECT id FROM lookup)');
    assert.equal(guard()(where(cte), cte), false);
    const conflict = ast('UPDATE OR IGNORE item SET key=1 WHERE flag=1 AND key IN(SELECT id FROM lookup)');
    assert.equal(guard()(where(conflict), conflict), false);
    const many = ast(sql + '; SELECT id FROM item;');
    assert.equal(guard()(where(many), many), false);
});

test('the guard validates actual node location and does not extend projection or inner-query commutation', () => {
    const root = ast('SELECT id FROM item WHERE flag=1 AND key IN(SELECT id FROM lookup WHERE id=1 AND label=\'match\')');
    assert.equal(guard()(where(root), root, []), false);
    assert.equal(guard()(where(root), root, ['slots', 'statements', 0, 'slots', 'columns']), false);
    const inner = [...locations(root)].find(entry => entry.node.kind === 'BinaryExpression' && entry.node.attrs.operator === 'AND' && entry.node !== where(root));
    assert.equal(guard()(inner.node, root, inner.path), false);
    const projection = ast('SELECT flag=1 AND key IN(SELECT id FROM lookup) AS value FROM item');
    const candidate = [...locations(projection)].find(entry => entry.node.kind === 'BinaryExpression' && entry.node.attrs.operator === 'AND');
    assert.equal(guard()(candidate.node, projection, candidate.path), false);
});

test('SQLite scalar and membership truth tables survive commutation for NULL empty and multirow inputs', () => {
    const datasets = ['', "(NULL,'match')", "(1,'match')", "(2,'match'),(1,'match'),(NULL,'match'),(2,'other')"];
    let comparisons = 0, sqliteVersion;
    for (const data of datasets) {
        const db = dbFor(data);
        try {
            sqliteVersion = db.prepare('SELECT sqlite_version() AS version').get().version;
            for (const operator of ['AND', 'OR']) for (const cmp of ['=', '!=', 'IN', 'NOT IN']) {
                const left = 'flag=1', right = `key ${cmp} (SELECT id FROM lookup WHERE label='match')`;
                const root = ast(`SELECT id FROM item WHERE ${left} ${operator} ${right}`);
                assert.equal(guard()(where(root), root), true);
                const a = db.prepare(`SELECT id,(${left} ${operator} ${right}) AS truth FROM item ORDER BY id`).all();
                const b = db.prepare(`SELECT id,(${right} ${operator} ${left}) AS truth FROM item ORDER BY id`).all();
                assert.deepEqual(a, b);
                comparisons++;
            }
        } finally { db.close(); }
    }
    assert.equal(comparisons, 32);
    globalThis.__subqueryGuardStats?.({sqliteVersion, truthComparisons: comparisons, datasets: datasets.length});
});

test('SQLite DELETE and UPDATE effects remain equal after guarded commutation', () => {
    let comparisons = 0;
    for (const data of ['', "(NULL,'match')", "(1,'match'),(2,'match'),(NULL,'match')"]) {
        for (const operator of ['AND', 'OR']) for (const cmp of ['=', 'IN', 'NOT IN']) {
            for (const command of ['DELETE FROM item', 'UPDATE item SET outer_only=42']) {
                const left = 'flag=1', right = `key ${cmp} (SELECT id FROM lookup WHERE label='match')`;
                const a = dbFor(data), b = dbFor(data);
                try {
                    const original = `${command} WHERE ${left} ${operator} ${right}`;
                    const root = ast(original); assert.equal(guard()(where(root), root), true);
                    a.exec(original); b.exec(`${command} WHERE ${right} ${operator} ${left}`);
                    assert.deepEqual(a.prepare('SELECT * FROM item ORDER BY id').all(), b.prepare('SELECT * FROM item ORDER BY id').all());
                    comparisons++;
                } finally { a.close(); b.close(); }
            }
        }
    }
    assert.equal(comparisons, 36);
    globalThis.__subqueryGuardStats?.({dmlComparisons: comparisons});
});

test('new guarded commute preserves all heuristic fact sets and retains an exact zero-cost path', async () => {
    for (const operator of ['AND', 'OR']) for (const cmp of ['=', 'IN', 'NOT IN']) {
        const from = ast(`DELETE FROM item WHERE flag=1 ${operator} key ${cmp} (SELECT id FROM lookup WHERE label='match')`);
        const target = exchange(from), graph = createEditGraph(target, from, schema, {}, {schemaSql: setup});
        const a = graph.abstractRoot(from), b = graph.abstractRoot(target);
        assert.deepEqual(sorted(graph.symbolFacts(a)), sorted(graph.symbolFacts(b)));
        assert.deepEqual(sorted(graph.predicateFacts(a)), sorted(graph.predicateFacts(b)));
        assert.deepEqual(sorted(atomicPredicateFacts(a)), sorted(atomicPredicateFacts(b)));
        const commute = graph.edits.find(edit => edit.name === 'commuteBooleanOperands');
        assert.ok([...commute.apply(from)].some(edge => stableKey(edge.root) === stableKey(target)), 'Central registry offers the guarded edge.');
        const result = await shortestSqlEditPath(target, from, graph, {async tick() {}}, {cutoff: 0.5});
        assert.equal(result.capped, false);
        assert.equal(result.distance, 0);
        assert.ok(result.edits.every(edit => edit.cost === 0));
    }
});


test('schema provenance is scanned lazily and cached only when a subquery commute is needed', () => {
    let reads = 0;
    const options = {get schemaSql() { reads++; return setup; }};
    const safe = createSubqueryBooleanPurity(schema, options);
    assert.equal(reads, 0, 'Factory creation does not tokenize setup SQL.');
    const plain = ast('DELETE FROM item WHERE flag=1 AND key=2');
    assert.equal(safe(where(plain), plain), false);
    assert.equal(reads, 0, 'Ordinary scalar expressions do not scan setup SQL.');
    const root = ast('DELETE FROM item WHERE flag=1 AND key IN(SELECT id FROM lookup)');
    assert.equal(safe(where(root), root), true);
    const afterFirst = reads;
    assert.ok(afterFirst > 0);
    assert.equal(safe(where(root), root), true);
    const swapped = exchange(root);
    assert.equal(safe(where(swapped), swapped), true);
    assert.equal(reads, afterFirst, 'One request-local provenance/catalogue preparation serves later roots.');
});
