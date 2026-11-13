import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey, walkNodes} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts, predicateFacts} from '../../lib/qss/src/graph-features.mjs';

const parse = sql => parseGraphSql(sql).root;
const fks = root => [...walkNodes(root)].filter(({node}) => node.kind === 'ReferenceDefinition').map(({node}) => node);
const actions = ['ON DELETE CASCADE', 'ON DELETE SET NULL', 'ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED', 'ON DELETE CASCADE NOT DEFERRABLE INITIALLY IMMEDIATE'];
const names = ['a', 'b', 'c', 'd'];
function ddl(count, inline) {
    const columns = names.slice(0, count).map((name, i) => name + ' INTEGER' + (i < inline ? ' REFERENCES parent(id) ' + actions[i] : ''));
    const constraints = names.slice(inline, count).map((name, offset) => 'FOREIGN KEY(' + name + ') REFERENCES parent(id) ' + actions[inline + offset]);
    return 'CREATE TABLE child(' + [...columns, ...constraints].join(',') + ')';
}
function observe(sql, count) {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('PRAGMA foreign_keys=ON;CREATE TABLE parent(id INTEGER PRIMARY KEY);INSERT INTO parent VALUES(1);' + sql);
        const foreignKeys = db.prepare('PRAGMA foreign_key_list(child)').all();
        db.exec('INSERT INTO child VALUES(' + Array(count).fill('1').join(',') + ')');
        let deleteError = null;
        try { db.exec('DELETE FROM parent'); } catch (error) { deleteError = error.message; }
        return {foreignKeys, rows: db.prepare('SELECT * FROM child').all(), deleteError};
    } finally { db.close(); }
}

test('three and four inline foreign keys move individually without changing action order or facts', () => {
    for (const count of [3, 4]) {
        const from = parse(ddl(count, count)), to = parse(ddl(count, 0));
        const graph = createEditGraph(to, from, {tables: [{name: 'parent', columns: [{name: 'id', pk: 1, type: 'INTEGER'}]}]});
        const edit = graph.edits.find(edge => edge.name === 'relocateSingleColumnForeignKey');
        const initialFKs = fks(from).map(stableKey), initialObservation = observe(ddl(count, count), count);
        let current = from;
        for (let inline = count - 1; inline >= 0; inline--) {
            const expected = parse(ddl(count, inline));
            const next = [...edit.apply(current)].find(candidate => stableKey(candidate.root) === stableKey(expected));
            assert.ok(next, 'Last inline FK must move before previously moved table FKs.');
            assert.deepEqual(fks(next.root).map(stableKey), initialFKs);
            assert.deepEqual([...symbolFacts(graph.abstractRoot(next.root))].sort(), [...symbolFacts(graph.abstractRoot(current))].sort());
            assert.deepEqual([...predicateFacts(graph.abstractRoot(next.root))].sort(), [...predicateFacts(graph.abstractRoot(current))].sort());
            assert.equal(stableKey(replayOperation(current, next.operation)), stableKey(expected));
            assert.ok([...edit.apply(next.root)].some(candidate => stableKey(candidate.root) === stableKey(current)), 'Relocation must remain reversible.');
            assert.deepEqual(observe(ddl(count, inline), count), initialObservation);
            current = next.root;
        }
        assert.equal(stableKey(current), stableKey(to));
    }
});

test('moving an FK never reverses conflicting CASCADE and SET NULL actions on the same column', () => {
    const a = 'CREATE TABLE child(a INTEGER REFERENCES parent(id) ON DELETE CASCADE,FOREIGN KEY(a) REFERENCES parent(id) ON DELETE SET NULL)';
    const sameOrder = 'CREATE TABLE child(a INTEGER,FOREIGN KEY(a) REFERENCES parent(id) ON DELETE CASCADE,FOREIGN KEY(a) REFERENCES parent(id) ON DELETE SET NULL)';
    const reversed = 'CREATE TABLE child(a INTEGER,FOREIGN KEY(a) REFERENCES parent(id) ON DELETE SET NULL,FOREIGN KEY(a) REFERENCES parent(id) ON DELETE CASCADE)';
    assert.deepEqual(observe(a, 1), observe(sameOrder, 1));
    assert.notDeepEqual(observe(a, 1).rows, observe(reversed, 1).rows);
    const from = parse(a), good = parse(sameOrder), bad = parse(reversed), graph = createEditGraph(good, from);
    const edit = graph.edits.find(edge => edge.name === 'relocateSingleColumnForeignKey');
    const neighbours = [...edit.apply(from)];
    assert.ok(neighbours.some(candidate => stableKey(candidate.root) === stableKey(good)));
    assert.ok(neighbours.every(candidate => stableKey(candidate.root) !== stableKey(bad)));
});

test('later inline foreign keys still block moves that would reverse declaration order', () => {
    const from = parse(ddl(4, 4)), to = parse(ddl(4, 0));
    const graph = createEditGraph(to, from), edit = graph.edits.find(edge => edge.name === 'relocateSingleColumnForeignKey');
    const candidates = [...edit.apply(from)];
    assert.equal(candidates.length, 1);
    assert.equal(stableKey(candidates[0].root), stableKey(parse(ddl(4, 3))));
});

test('DEFERRABLE and INITIALLY declarations are preserved, case folded and never silently equated', () => {
    const deferred = 'CREATE TABLE child(a INT REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)';
    const immediate = 'CREATE TABLE child(a INT REFERENCES parent(id) NOT DEFERRABLE INITIALLY IMMEDIATE)';
    assert.equal(fks(parse(deferred))[0].attrs.deferrable, 'DEFERRABLE');
    assert.equal(fks(parse(deferred))[0].attrs.initially, 'DEFERRED');
    assert.equal(fks(parse(immediate))[0].attrs.deferrable, 'NOT DEFERRABLE');
    assert.deepEqual(parse(deferred), parse(deferred.toLowerCase()));
    assert.notEqual(stableKey(parse(deferred)), stableKey(parse(immediate)));
    assert.notEqual(stableKey(parse(deferred)), stableKey(parse('CREATE TABLE child(a INT REFERENCES parent(id))')));
    assert.equal(parseGraphSql(deferred, {allowPartial: false}).validation, 'sqlite-dialect-ast');
    for (const sql of [
        'CREATE TABLE child(a INT REFERENCES parent(id) DEFERRABLE INITIALLY LATER)',
        'CREATE TABLE child(a INT REFERENCES parent(id) NOT NULL DEFERRABLE)',
        'CREATE TABLE child(a INT REFERENCES parent(id) DEFERRABLE DEFERRABLE)'
    ]) assert.throws(() => parse(sql));
});

test('deferred foreign keys keep their transaction timing under inline/table relocation', () => {
    for (const inline of [true, false]) {
        const declaration = inline
            ? 'CREATE TABLE child(a INT REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)'
            : 'CREATE TABLE child(a INT,FOREIGN KEY(a) REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)';
        const db = new DatabaseSync(':memory:');
        try {
            db.exec('PRAGMA foreign_keys=ON;CREATE TABLE parent(id INTEGER PRIMARY KEY);' + declaration);
            db.exec('BEGIN;INSERT INTO child VALUES(1);INSERT INTO parent VALUES(1);COMMIT');
            assert.deepEqual(db.prepare('SELECT * FROM child').all(), [{a: 1}]);
        } finally { db.close(); }
    }
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('PRAGMA foreign_keys=ON;CREATE TABLE parent(id INTEGER PRIMARY KEY);CREATE TABLE child(a INT REFERENCES parent(id) NOT DEFERRABLE INITIALLY IMMEDIATE);BEGIN');
        assert.throws(() => db.exec('INSERT INTO child VALUES(1)'), /FOREIGN KEY/);
        db.exec('ROLLBACK');
    } finally { db.close(); }
});
