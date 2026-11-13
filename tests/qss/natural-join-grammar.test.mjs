import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';
const ast = sql => parseGraphSql(sql, {allowPartial:false}).root;

test('NATURAL is a right-source join property rather than a left-source alias', () => {
    for (const spelling of ['NATURAL JOIN', 'NATURAL INNER JOIN', 'NATURAL LEFT JOIN', 'NATURAL LEFT OUTER JOIN', 'LEFT NATURAL JOIN', 'NATURAL CROSS JOIN']) {
        const root = ast('SELECT a.x FROM a '+spelling+' b AS right_table WHERE a.x>0');
        const from = root.slots.statements[0].slots.from;
        assert.equal(from[0].attrs.as, null);
        assert.equal(from[1].attrs.natural, true);
        assert.equal(from[1].attrs.as, 'right_table');
        assert.notEqual(stableKey(root), stableKey(ast('SELECT a.x FROM a '+spelling.replace('NATURAL ','')+' b AS right_table WHERE a.x>0')));
        assert.equal([...createEditGraph(root,root).edits.find(e=>e.name==='relocateInnerJoinPredicate').apply(root)].length,0);
    }
    assert.throws(()=>ast('SELECT * FROM a NATURAL JOIN b ON a.x=b.x'));
    assert.throws(()=>ast('SELECT * FROM a NATURAL JOIN b USING(x)'));
});

test('explicit natural aliases and table names remain ordinary identifiers', () => {
    for(const sql of ['SELECT * FROM a AS natural JOIN b ON natural.x=b.x', 'SELECT * FROM "natural" JOIN b ON "natural".x=b.x', 'SELECT * FROM natural JOIN b ON natural.x=b.x']) {
        const from=ast(sql).slots.statements[0].slots.from;
        assert.ok(from.every(source=>!source.attrs.natural));
    }
    const nested=ast('SELECT * FROM (SELECT * FROM a NATURAL JOIN b) q');
    assert.equal(nested.slots.statements[0].slots.from[0].slots.expr.slots.ast.slots.from[1].attrs.natural,true);
});

test('SQLite confirms NATURAL matching and LEFT extension differ from ordinary joins', () => {
    const db=new DatabaseSync(':memory:');
    try {
        db.exec("CREATE TABLE a(x INT,label TEXT);CREATE TABLE b(x INT,detail TEXT);INSERT INTO a VALUES(1,'one'),(2,'two');INSERT INTO b VALUES(1,'match'),(3,'other');");
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM a NATURAL JOIN b').get().n,1);
        assert.equal(db.prepare('SELECT COUNT(*) AS n FROM a JOIN b').get().n,4);
        assert.deepEqual(db.prepare('SELECT a.x,b.detail FROM a NATURAL LEFT JOIN b ORDER BY a.x').all(),[{x:1,detail:'match'},{x:2,detail:null}]);
        for(const spelling of ['NATURAL JOIN','NATURAL INNER JOIN','NATURAL LEFT JOIN','NATURAL LEFT OUTER JOIN','LEFT NATURAL JOIN','NATURAL CROSS JOIN']) {
            db.prepare('SELECT * FROM a '+spelling+' b').all();
            assert.equal(ast('SELECT * FROM a '+spelling+' b').slots.statements[0].slots.from[1].attrs.natural,true);
        }
    } finally {db.close();}
});
