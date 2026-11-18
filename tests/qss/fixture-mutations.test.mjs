import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';

const require = createRequire(import.meta.url);
const {errorCandidates} = require('./fixture-mutations.cjs');
const projection = sql => errorCandidates(sql).find(candidate => candidate.kind === 'projection_expression')?.answer;

// Anonymous test fixtures only. Private StudOn SQL continues to execute in
// Chrome; this regression independently checks that the generator emits SQL.
test('projection mutation retains explicit, implicit and quoted aliases in executable SQLite', () => {
    const db = new DatabaseSync(':memory:', {enableDoubleQuotedStringLiterals: true});
    try {
        db.exec('CREATE TABLE sample(id INTEGER, amount REAL); INSERT INTO sample VALUES(1,4),(2,7);');
        for (const sql of [
            'SELECT s.amount mark FROM sample s',
            'SELECT s.amount "mark" FROM sample s',
            'SELECT s.amount "mark value" FROM sample s',
            "SELECT s.amount 'mark' FROM sample s",
            'SELECT s.amount AS mark FROM sample s',
            'SELECT SUM(s.amount) total FROM sample s',
            'SELECT (s.amount>5) large FROM sample s',
            'SELECT CASE WHEN s.amount>5 THEN 1 ELSE 0 END large FROM sample s',
            'SELECT s.amount /* comment */ "mark" FROM sample s',
            'SELECT s.amount -- comment\n "mark" FROM sample s'
        ]) {
            const mutated = projection(sql);
            assert.ok(mutated);
            const expected = db.prepare(sql).all(), changed = db.prepare(mutated).all();
            assert.notDeepEqual(changed, expected);
            assert.deepEqual(Object.keys(changed[0]), Object.keys(expected[0]), 'The alias must remain an output name.');
        }
        assert.throws(() => db.prepare('SELECT (s.amount mark)+1 FROM sample s'), /syntax error/,
            'The previous implicit-alias mutation was invalid SQL, not a missing product feature.');
    } finally { db.close(); }
});

test('alias handling does not mistake column names, qualifications, COLLATE or expressions for aliases', () => {
    const db = new DatabaseSync(':memory:', {enableDoubleQuotedStringLiterals: true});
    try {
        db.exec('CREATE TABLE sample(id INTEGER, amount REAL); INSERT INTO sample VALUES(1,4),(2,7);');
        for (const sql of ['SELECT amount FROM sample', 'SELECT s.amount FROM sample s',
            'SELECT "amount" FROM sample', 'SELECT s."amount" FROM sample s',
            'SELECT amount COLLATE BINARY FROM sample', 'SELECT amount COLLATE "BINARY" FROM sample',
            'SELECT amount+id FROM sample', 'SELECT amount>id FROM sample', 'SELECT NOT id FROM sample',
            'SELECT CASE WHEN amount>5 THEN 1 ELSE 0 END FROM sample']) {
            const changed = db.prepare(projection(sql)).all();
            assert.ok(changed.length);
        }
    } finally { db.close(); }
});

test('already valid explicit-AS and unaliased projection mutation texts remain unchanged', () => {
    assert.equal(projection('SELECT amount AS score FROM sample'), 'SELECT (amount) + 1 AS score FROM sample');
    assert.equal(projection('SELECT amount FROM sample'), 'SELECT (amount) + 1 FROM sample');
    assert.equal(projection('SELECT SUM(amount) AS total FROM sample'), 'SELECT (SUM(amount)) + 1 AS total FROM sample');
});
