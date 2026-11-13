import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';

const schema = {tables: [{name: 't', type: 'table', columns: [{name: 'x'}]}]};
const ast = sql => parseGraphSql(sql, {schema}).root;
function edge(from, to, flags = false) {
    const a = ast(from), b = ast(to), graph = createEditGraph(b, a, schema, {}, {outputColumnNamesObserved: flags});
    return [...graph.edits.find(e => e.name === 'renameBoundTableAlias').apply(a)].find(e => stableKey(e.root) === stableKey(b));
}
function rows(from, to, flags = '') {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('CREATE TABLE t(x);INSERT INTO t VALUES(3);' + flags);
        return [db.prepare(from).all(), db.prepare(to).all()];
    } finally { db.close(); }
}

test('table alias changes preserve implicit projection names and nested bindings', () => {
    for (const [from, to] of [
        ['SELECT a.x+1 FROM t a', 'SELECT b.x+1 FROM t b'],
        ['SELECT a.x COLLATE NOCASE FROM t a', 'SELECT b.x COLLATE NOCASE FROM t b'],
        ['SELECT "a.x+1" FROM (SELECT a.x+1 FROM t a) q', 'SELECT "a.x+1" FROM (SELECT b.x+1 FROM t b) q']
    ]) {
        assert.notDeepEqual(...rows(from, to));
        assert.equal(edge(from, to), undefined);
        assert.equal(edge(to, from), undefined);
    }
});

test('custom SQLite output naming prevents alias changes that alter headers', () => {
    for (const [from, to, flags] of [
        ['SELECT a.x FROM t a', 'SELECT b.x FROM t b', 'PRAGMA short_column_names=OFF;PRAGMA full_column_names=OFF;'],
        ['SELECT a.* FROM t a', 'SELECT b.* FROM t b', 'PRAGMA short_column_names=OFF;PRAGMA full_column_names=ON;'],
        ['SELECT * FROM t a', 'SELECT * FROM t b', 'PRAGMA short_column_names=OFF;PRAGMA full_column_names=ON;']
    ]) {
        assert.notDeepEqual(...rows(from, to, flags));
        assert.equal(edge(from, to, true), undefined);
    }
});

test('default bare columns and explicit output aliases retain their real free edges', () => {
    for (const [from, to] of [
        ['SELECT a.x FROM t a', 'SELECT b.x FROM t b'],
        ['SELECT a.x+1 AS answer FROM t a', 'SELECT b.x+1 AS answer FROM t b'],
        ['SELECT q.answer FROM (SELECT a.x+1 AS answer FROM t a) q', 'SELECT q.answer FROM (SELECT b.x+1 AS answer FROM t b) q']
    ]) {
        assert.deepEqual(...rows(from, to));
        const found = edge(from, to); assert.ok(found);
        assert.equal(stableKey(replayOperation(ast(from), found.operation)), stableKey(ast(to)));
    }
});
