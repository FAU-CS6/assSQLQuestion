import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';

test('browser assertions retain strict types, object prototypes, collection contents and rejection checks', async () => {
    for (const [left, right] of [[1, '1'], [0, -0], [1, 1n], [{x: 1}, Object.assign(Object.create(null), {x: 1})],
        [new Set([1]), new Set([2])], [new Map([['x', 1]]), new Map([['x', 2]])],
        [new Uint8Array([1]), new Uint8Array([2])]]) {
        assert.throws(() => assert.deepEqual(left, right));
    }
    assert.deepEqual(new Map([['x', new Set([2, 1])]]), new Map([['x', new Set([1, 2])]]));
    await assert.rejects(Promise.reject(new TypeError('expected')), TypeError);
    await assert.rejects(assert.rejects(Promise.resolve(1)), /Missing expected rejection/);
    assert.throws(() => assert.throws(() => {}), /Missing expected exception/);
});

test('SQLite test bridge uses shipped semantics, preserves column names and prepares eagerly', () => {
    const db = new DatabaseSync(':memory:');
    try {
        assert.equal(db.prepare('SELECT sqlite_version() AS v').get().v, '3.22.0');
        assert.deepEqual(db.prepare('SELECT "unbound name" AS answer').get(), {answer: 'unbound name'});
        const stmt = db.prepare('SELECT 1 AS answer');
        assert.deepEqual(stmt.columns(), [{name: 'answer'}]);
        assert.deepEqual(stmt.all(), [{answer: 1}]);
        const empty = db.prepare('SELECT 1 AS answer WHERE 0');
        assert.deepEqual(empty.all(), []);
        assert.equal(empty.get(), undefined);
        assert.throws(() => db.prepare('SELECT (1 mark)+1'), /syntax error/);
    } finally { db.close(); }
});

test('SQLite test bridge reads exact integer boundaries without converting REAL or TEXT into BigInt', () => {
    const db = new DatabaseSync(':memory:');
    try {
        const stmt = db.prepare("SELECT 9223372036854775807 AS high, -9223372036854775808 AS low, 1.0 AS real, '123' AS text, NULL AS nil");
        stmt.setReadBigInts(true);
        const expected = {high: 9223372036854775807n, low: -9223372036854775808n, real: 1, text: '123', nil: null};
        assert.deepEqual(stmt.get(), expected);
        assert.deepEqual(stmt.all(), [expected]);
        assert.deepEqual(stmt.get(), expected);
    } finally { db.close(); }
});
