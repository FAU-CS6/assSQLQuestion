'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {candidates}=require('./student-variants.cjs');
const setup="CREATE TABLE sample(x INTEGER,y INTEGER,label TEXT);INSERT INTO sample VALUES(NULL,NULL,NULL),(0,0,''),(1,2,'a'),(2,1,'b'),(3,3,'a'),(7,1,'a'),(7,1,'a');CREATE TABLE detail(x INTEGER);INSERT INTO detail VALUES(1),(2),(2),(7),(NULL);";
for(const sql of [
 'SELECT x FROM sample WHERE x>1 AND y<3',
 'SELECT x FROM sample WHERE (x>1 OR y=1) AND label=\'a\'',
 'SELECT x FROM sample WHERE x=1 OR (y=1 AND label=\'a\')',
 'SELECT x FROM sample WHERE NOT(x=1) AND y<>2',
 'SELECT COUNT(*) AS amount,x FROM sample GROUP BY x HAVING amount>1 ORDER BY x',
 'SELECT (x>1) AS flag FROM sample',
 'SELECT s.x FROM sample s INNER JOIN detail d ON s.x=d.x WHERE s.y>0',
 'SELECT x FROM sample WHERE x>6 AND label=\'a\''
])test('generated correct variants preserve independently executed Boolean grouping: '+sql,()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec(setup);const run=s=>{const stmt=db.prepare(s);return{columns:stmt.columns().map(c=>c.name.toLowerCase()),rows:stmt.all().map(row=>JSON.stringify(Object.values(row))).sort()};};
  const expected=run(sql),plan=candidates({question:'',metadata:{SEQUENCE_B:sql}});assert.ok(plan.correct.length>=3);
  for(const answer of plan.correct)assert.deepEqual(run(answer.sql),expected,answer.name+'\n'+answer.sql);
 }finally{db.close();}
});

test('serializing a subquery cannot mutate the intended AST used by later variants',()=>{
 const {parsed}=require('./student-variants.cjs');
 const p=parsed('DELETE FROM sample WHERE x IN(SELECT x FROM detail WHERE x>1 AND x<8)');
 const before=JSON.stringify(p.ast);p.render(p.ast);assert.equal(JSON.stringify(p.ast),before);
});

test('unconditional control joins use predeclared distinct gross mistakes without limiting SQL execution',()=>{
 const plan=candidates({question:'',metadata:{SEQUENCE_A:'CREATE TABLE source(id);CREATE TABLE detail(id);',SEQUENCE_B:'DELETE FROM detail;',SEQUENCE_C:'SELECT source.id FROM source LEFT JOIN detail'}});
 const preferred=plan.major.filter(s=>s.preferred);assert.equal(preferred.length,3);
 assert.deepEqual(preferred.map(s=>s.family),['wrong-operation','wrong-operation-and-source','wrong-source']);
 assert.ok(plan.major.some(s=>s.name==='empty-answer'),'Original evidence candidates remain available');
 for(const spec of preferred){const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE source(id);CREATE TABLE detail(id);INSERT INTO source VALUES(1),(2);INSERT INTO detail VALUES(1),(2)');
  assert.throws(()=>{db.exec(spec.sql);db.prepare('SELECT source.id FROM source LEFT JOIN detail').all();},/no such table/);
 }finally{db.close();}}
 const normal=candidates({question:'',metadata:{SEQUENCE_A:'',SEQUENCE_B:'DELETE FROM detail;',SEQUENCE_C:'SELECT * FROM detail'}});assert.equal(normal.major.filter(s=>s.preferred).length,0);
});
