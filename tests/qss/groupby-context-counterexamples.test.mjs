import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';

// A GROUP BY permutation needs a proof for the complete query context. The
// inner query having no LIMIT, bare column or volatile expression is not enough.
const compare = (setup, query) => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec(setup);
        return ['a,b', 'b,a'].map(group => db.prepare(query.replace('%GROUP%', group)).all());
    } finally { db.close(); }
};

test('GROUP BY order can change an outer GROUP_CONCAT even without any LIMIT', () => {
    const [a, b] = compare('CREATE TABLE t(a,b); INSERT INTO t VALUES(1,2),(2,1)',
        "SELECT GROUP_CONCAT(a || ':' || b) AS answer FROM (SELECT a,b FROM t GROUP BY %GROUP%)");
    assert.deepEqual(a, [{answer: '1:2,2:1'}]); assert.deepEqual(b, [{answer: '2:1,1:2'}]);
});

test('GROUP BY order can change an outer floating SUM despite fully grouped inner projections', () => {
    const [a, b] = compare('CREATE TABLE t(a,b,v); INSERT INTO t VALUES(1,1,1e16),(2,3,-1e16),(3,2,1.0)',
        'SELECT SUM(v) AS answer FROM (SELECT a,b,SUM(v) AS v FROM t GROUP BY %GROUP%)');
    assert.deepEqual(a, [{answer: 1}]); assert.deepEqual(b, [{answer: 0}]);
});

test('GROUP BY order can change the observable representative selected by NOCASE MIN or grouping', () => {
    const setup = "CREATE TABLE t(a TEXT,b); INSERT INTO t VALUES('A',2),('a',1)";
    const [minA, minB] = compare(setup,
        'SELECT MIN(a COLLATE NOCASE) AS answer FROM (SELECT a,b FROM t GROUP BY %GROUP%)');
    assert.deepEqual(minA, [{answer: 'A'}]); assert.deepEqual(minB, [{answer: 'a'}]);
    const [groupA, groupB] = compare(setup,
        'SELECT a,COUNT(*) AS n FROM (SELECT a,b FROM t GROUP BY %GROUP%) GROUP BY a COLLATE NOCASE');
    assert.deepEqual(groupA, [{a: 'a', n: 2}]); assert.deepEqual(groupB, [{a: 'A', n: 2}]);
});

test('GROUP BY permutation can change a limited top-level result', () => {
    const [a, b] = compare('CREATE TABLE t(a,b); INSERT INTO t VALUES(1,2),(2,1)',
        'SELECT a,b FROM t GROUP BY %GROUP% LIMIT 1');
    assert.deepEqual(a, [{a: 1, b: 2}]); assert.deepEqual(b, [{a: 2, b: 1}]);
});
