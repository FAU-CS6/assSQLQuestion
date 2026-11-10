import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql,stableKey,walkNodes} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph,replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {symbolFacts,predicateFacts} from '../../lib/qss/src/graph-features.mjs';
import {exactInteger} from '../../lib/qss/src/sql-equivalences.mjs';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {questionRequirements,constructUse,requirementState} from '../../lib/qss/src/requirements.mjs';
const ast=s=>parseGraphSql(s).root;
const schema={tables:[{name:'sample',type:'table',columns:[{name:'x'},{name:'y'}]}]};
const expr=s=>ast('SELECT '+s+' AS result').slots.statements[0].slots.columns[0].slots.expr;
const set=s=>[...s].sort();
const sandbox={setTimeout,clearTimeout,AbortController};vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../../lib/qss/qss.js',import.meta.url),'utf8'),sandbox);
const evaluate=request=>sandbox.QSS.evaluate(request);

test('closed integer rewrites preserve SQLite storage class and reject overflow and zero division',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  for(const [a,b]of[['2*3','6'],['9223372036854775806+1','9223372036854775807'],['0xffffffffffffffff','-1'],['7%3','1']]){
   const actual=s=>{const stmt=db.prepare('SELECT '+s+' AS result,typeof('+s+') AS storage');stmt.setReadBigInts(true);return stmt.all();};
   assert.deepEqual(actual(a),actual(b));assert.equal(exactInteger(expr(a)),exactInteger(expr(b)));
  }
  for(const sql of ['9223372036854775807+1','(9223372036854775807+1)-1','4.0*1','1/0','1%0'])assert.equal(exactInteger(expr(sql)),null,sql);
 }finally{db.close();}
});

const equivalents=[
 ['SELECT x FROM sample WHERE x>2','SELECT x FROM sample WHERE NOT(x<=2)'],
 ['SELECT x FROM sample WHERE x>2 AND y<>1','SELECT x FROM sample WHERE NOT(NOT(x>2) OR NOT(y<>1))'],
 ['SELECT x FROM sample WHERE x>6','SELECT x FROM sample WHERE x>2*3'],
 ['SELECT (x>2) AS result FROM sample','SELECT CASE WHEN x>2 THEN 1 WHEN NOT(x>2) THEN 0 ELSE NULL END AS result FROM sample']
];

test('inline and table foreign keys retain enforcement, actions, trace and admissible facts',async()=>{
 const a='CREATE TABLE child(id INTEGER PRIMARY KEY,parent_id INT REFERENCES parent(id) ON DELETE CASCADE)';
 const b='CREATE TABLE child(id INTEGER PRIMARY KEY,parent_id INT,FOREIGN KEY(parent_id) REFERENCES parent(id) ON DELETE CASCADE)';
 for(const sql of [a,b]){
  const db=new DatabaseSync(':memory:');try{
   db.exec('PRAGMA foreign_keys=ON;CREATE TABLE parent(id INTEGER PRIMARY KEY);INSERT INTO parent VALUES(1);'+sql);
   db.exec('INSERT INTO child VALUES(1,NULL),(2,1)');
   assert.throws(()=>db.exec('INSERT INTO child VALUES(3,2)'),/FOREIGN KEY/);
   db.exec('DELETE FROM parent');assert.equal(db.prepare('SELECT count(*) AS n FROM child').get().n,1);
  }finally{db.close();}
 }
 const from=ast(a),to=ast(b),graph=createEditGraph(to,from,{});
 const edit=graph.edits.find(e=>e.name==='relocateSingleColumnForeignKey');
 assert.ok(edit);const operations=[...edit.apply(from)];assert.ok(operations.some(op=>stableKey(op.root)===stableKey(to)));
 for(const op of operations){const next=replayOperation(from,op.operation);assert.deepEqual(set(symbolFacts(next)),set(symbolFacts(from)));assert.deepEqual(set(predicateFacts(next)),set(predicateFacts(from)));}
 const result=await evaluate({reference:a,answer:b,maxPoints:5});assert.equal(result.distance,0);assert.equal(result.points,5);
});

test('free foreign-key relocation preserves action ordering; CASCADE/SET NULL is a real counterexample',()=>{
 const a='CREATE TABLE child(id INT,pid INT REFERENCES parent(id) ON DELETE CASCADE,FOREIGN KEY(pid) REFERENCES parent(id) ON DELETE SET NULL)';
 const b='CREATE TABLE child(id INT,pid INT,FOREIGN KEY(pid) REFERENCES parent(id) ON DELETE SET NULL,FOREIGN KEY(pid) REFERENCES parent(id) ON DELETE CASCADE)';
 const run=sql=>{const db=new DatabaseSync(':memory:');try{db.exec('PRAGMA foreign_keys=ON;CREATE TABLE parent(id INT PRIMARY KEY);INSERT INTO parent VALUES(1);'+sql+';INSERT INTO child VALUES(1,1);DELETE FROM parent');return db.prepare('SELECT * FROM child').all();}finally{db.close();}};
 assert.notDeepEqual(run(a),run(b));
 const r=ast(a),s=ast(b),graph=createEditGraph(r,s,{}),edit=graph.edits.find(e=>e.name==='relocateSingleColumnForeignKey');
 assert.ok(![...edit.apply(r)].some(n=>stableKey(n.root)===stableKey(s)));
 assert.ok(![...edit.apply(s)].some(n=>stableKey(n.root)===stableKey(r)));
});
test('new equivalences have real free SQL edges and agree on independently executed NULL truth tables',()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE sample(x,y);INSERT INTO sample VALUES(NULL,NULL),(NULL,1),(0,NULL),(0,0),(1,1),(2,0),(3,1),(7,2),(9,1);');
  for(const [reference,answer]of equivalents){
   assert.deepEqual(db.prepare(reference).all(),db.prepare(answer).all());
   const r=ast(reference),a=ast(answer),g=createEditGraph(r,a,schema);
   const edge=g.edits.filter(e=>e.cost===0).flatMap(e=>[...e.apply(a)]).find(n=>stableKey(n.root)===stableKey(r));
   assert.ok(edge,reference);assert.equal(stableKey(replayOperation(a,edge.operation)),stableKey(r));
   assert.deepEqual(set(symbolFacts(r)),set(symbolFacts(a)));assert.deepEqual(set(predicateFacts(r)),set(predicateFacts(a)));
  }
 }finally{db.close();}
});

test('all new free neighbours preserve admissible facts, including mixed Boolean and integer contexts',()=>{
 for(const sql of ['SELECT x AS n FROM sample WHERE x>2+3 AND y<>1',
   'SELECT CASE WHEN x=2 THEN 1 WHEN NOT(x=2) THEN 0 ELSE NULL END AS flag FROM sample',
   'UPDATE sample SET x=2*3 WHERE NOT(x<=2); DELETE FROM sample WHERE y=1',
   'CREATE TABLE checked(id INTEGER DEFAULT(2*3), CHECK(id>2+3))']){
  const root=ast(sql),g=createEditGraph(root,root,schema);let edges=0;
  for(const e of g.edits.filter(e=>e.cost===0))for(const n of e.apply(root)){
   assert.deepEqual(set(symbolFacts(n.root)),set(symbolFacts(root)),e.name);
   assert.deepEqual(set(predicateFacts(n.root)),set(predicateFacts(root)),e.name);edges++;
  }assert.ok(edges>0);
 }
});

test('DDL facts accept every incomplete neighbour allowed by the graph grammar',()=>{
 const root=ast('CREATE TABLE child(x INT REFERENCES parent(id),y INT CHECK(y>0))'),g=createEditGraph(root,root,{});
 for(const edit of g.edits)for(const edge of edit.apply(root)){
  assert.doesNotThrow(()=>predicateFacts(edge.root),edit.name);
  assert.doesNotThrow(()=>symbolFacts(edge.root),edit.name);
 }
});

test('quoted DDL CHECK and DML names resolve in their actual local schema while DEFAULT remains a string',()=>{
 const quoted=ast('CREATE TABLE child(x INT DEFAULT "x" CHECK("x">0));UPDATE child SET x="x"+1 WHERE "x">0');
 const plain=ast('CREATE TABLE child(x INT DEFAULT \'x\' CHECK(x>0));UPDATE child SET x=x+1 WHERE x>0');
 assert.equal(stableKey(quoted.slots.statements[0].slots.create_definitions[0].slots.check),stableKey(plain.slots.statements[0].slots.create_definitions[0].slots.check));
 assert.equal(stableKey(quoted.slots.statements[1]),stableKey(plain.slots.statements[1]));
 const defaults=quoted.slots.statements[0].slots.create_definitions[0].slots.default_val;
 assert.ok([...walkNodes(defaults)].some(({node})=>node.kind==='DoubleQuotedLiteral'));
});

test('ALTER ADD CHECK resolves quoted new and existing columns, enabling real free paths',async()=>{
 const context={tables:[{name:'sample',type:'table',columns:[{name:'id'}]}]};
 const reference='ALTER TABLE sample ADD COLUMN amount INTEGER DEFAULT 1 CHECK(amount>0)';
 for(const check of ['NOT("amount"<=0)','0<"amount"','"amount">(0+0)']){
  const answer='ALTER TABLE sample ADD COLUMN amount INTEGER DEFAULT 1 CHECK('+check+')';
  const observations=[];
  for(const sql of [reference,answer]){
   const db=new DatabaseSync(':memory:');try{
    db.exec('CREATE TABLE sample(id INTEGER);'+sql);
    const accepted=[];
    for(const value of ['NULL','-1','0','1','2']){
     try{db.exec('INSERT INTO sample VALUES(7,'+value+')');accepted.push(value);}catch(error){assert.match(error.message,/CHECK constraint/);}
    }
    observations.push(accepted);
   }finally{db.close();}
  }
  assert.deepEqual(observations[0],['NULL','1','2']);assert.deepEqual(observations[0],observations[1]);
  const r=await evaluate({reference,answer,schema:context,maxPoints:2});assert.equal(r.distance,0,check);assert.equal(r.points,2);assert.equal(r.traceVerified,true);
  const a=parseGraphSql(answer,{schema:context}).root,b=parseGraphSql(reference,{schema:context}).root;
  assert.deepEqual(set(predicateFacts(a)),set(predicateFacts(b)));
 }
 const plain=parseGraphSql('ALTER TABLE sample ADD COLUMN amount INT DEFAULT \'amount\' CHECK(amount>id)',{schema:context}).root;
 const quoted=parseGraphSql('ALTER TABLE sample ADD COLUMN amount INT DEFAULT "amount" CHECK("amount">"id")',{schema:context}).root;
 assert.equal(stableKey(plain.slots.statements[0].slots.expr[0].slots.check),stableKey(quoted.slots.statements[0].slots.expr[0].slots.check));
 assert.ok([...walkNodes(quoted)].some(({node})=>node.kind==='DoubleQuotedLiteral'&&node.attrs.value==='amount'));
});

test('extra and omitted aggregate output columns use certified local SQL repairs',async()=>{
 for(const answer of ['SELECT x AS n FROM sample','SELECT x AS n,COUNT(*) AS amount,1 AS extra FROM sample']){
  const result=await evaluate({reference:'SELECT x AS n,COUNT(*) AS amount FROM sample',answer,maxPoints:5,schema});
  assert.equal(result.status,'exact');assert.equal(result.distance,1);assert.equal(result.points,4);
  assert.equal(result.search,'exact-direct-bound-certificate');
 }
});

test('inner JOIN relocation also supports deterministic IN/EXISTS filters without assuming volatile queries pure',async()=>{
 const reference='SELECT s.x FROM sample s INNER JOIN detail d ON s.x=d.x WHERE s.x IN(1,2) AND EXISTS(SELECT 1 FROM detail e WHERE e.x=s.x)';
 const answer='SELECT s.x FROM sample s,detail d WHERE (s.x IN(1,2) AND EXISTS(SELECT 1 FROM detail e WHERE e.x=s.x)) AND s.x=d.x';
 const context={tables:[...schema.tables,{name:'detail',type:'table',columns:[{name:'x'}]}]};
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE sample(x,y);CREATE TABLE detail(x);INSERT INTO sample VALUES(1,0),(2,0),(NULL,0);INSERT INTO detail VALUES(1),(1),(2),(NULL)');
  assert.deepEqual(db.prepare(reference).all(),db.prepare(answer).all());
 }finally{db.close();}
 const r=ast(reference),a=ast(answer),graph=createEditGraph(r,a,context),edit=graph.edits.find(e=>e.name==='relocateInnerJoinPredicate');
 assert.ok([...edit.apply(a)].some(n=>stableKey(n.root)===stableKey(r)));
 assert.deepEqual(set(symbolFacts(a)),set(symbolFacts(r)));assert.deepEqual(set(predicateFacts(a)),set(predicateFacts(r)));
 const result=await evaluate({reference,answer,schema:context,maxPoints:5});assert.equal(result.distance,0);
 const volatile=ast(answer.replace('SELECT 1 FROM detail e','SELECT random() FROM detail e'));
 assert.equal([...createEditGraph(volatile,volatile,context).edits.find(e=>e.name===edit.name).apply(volatile)].length,0);
});

test('aggregate aliases permit pure comparison mirrors and partial aggregate ASTs remain representable',async()=>{
 const reference='SELECT COUNT(*) AS amount FROM sample HAVING amount>2',answer='SELECT COUNT(*) AS amount FROM sample HAVING 2<amount';
 const r=await evaluate({reference,answer,schema,maxPoints:5});assert.equal(r.distance,0);
 const root=ast(reference),g=createEditGraph(root,root,schema);
 for(const edit of g.edits)for(const edge of edit.apply(root))assert.doesNotThrow(()=>predicateFacts(edge.root),edit.name);
});

test('conditional aggregate aliases and finite IN lists retain their deterministic zero laws',async()=>{
 for(const [reference,answer]of[
  ['SELECT SUM(CASE WHEN x>0 THEN 1 ELSE 0 END) AS amount FROM sample HAVING amount>2','SELECT SUM(CASE WHEN x>0 THEN 1 ELSE 0 END) AS amount FROM sample HAVING NOT(amount<=2)'],
  ['SELECT x FROM sample WHERE x IN(1,2) AND y>0','SELECT x FROM sample WHERE y>0 AND x IN(1,2)']
  ,['SELECT x-SUM(y) AS amount FROM sample GROUP BY x HAVING amount!=0','SELECT x-SUM(y) AS amount FROM sample GROUP BY x HAVING NOT(amount=0)']
 ]){const r=await evaluate({reference,answer,schema,maxPoints:5});assert.equal(r.distance,0);assert.equal(r.points,5);}
 const r=await evaluate({reference:'SELECT x-random() AS amount FROM sample WHERE amount>0',answer:'SELECT x-random() AS amount FROM sample WHERE NOT(amount<=0)',schema,maxPoints:1,scale:1});assert.equal(r.points,0);
});

test('deterministic derived tables and locally declared views support free laws; hidden calls do not',async()=>{
 const ctx={tables:[...schema.tables,{name:'detail',type:'table',columns:[{name:'x'}]}]};
 for(const declaration of ['','CREATE VIEW known AS SELECT x FROM detail;']){
  const from=declaration?'known':'(SELECT x FROM detail GROUP BY x)';
  const reference=declaration+'SELECT a.x FROM sample a INNER JOIN '+from+' b ON a.x=b.x';
  const answer=declaration+'SELECT a.x FROM sample a,'+from+' b WHERE a.x=b.x';
  const r=await evaluate({reference,answer,schema:ctx,maxPoints:5});assert.equal(r.distance,0);
  const a=parseGraphSql(reference,{schema:ctx}).root,b=parseGraphSql(answer,{schema:ctx}).root;
  assert.deepEqual(set(symbolFacts(a)),set(symbolFacts(b)));assert.deepEqual(set(predicateFacts(a)),set(predicateFacts(b)));
 }
 const reference='CREATE VIEW hidden AS SELECT x,random() AS r FROM detail;SELECT x FROM hidden WHERE r>0 AND x>0';
 const answer='CREATE VIEW hidden AS SELECT x,random() AS r FROM detail;SELECT x FROM hidden WHERE x>0 AND r>0';
 const r=await evaluate({reference,answer,schema:ctx,maxPoints:1,scale:1});assert.equal(r.points,0);
});

test('JOIN relocation accepts deterministic statistical subqueries without marking arbitrary calls pure',async()=>{
 const ctx={tables:[...schema.tables,{name:'detail',type:'table',columns:[{name:'x'}]}]};
 const reference='SELECT a.x FROM sample a INNER JOIN detail b ON a.x=b.x WHERE a.x=(SELECT STDEV(x) FROM detail)';
 const answer='SELECT a.x FROM sample a,detail b WHERE a.x=(SELECT STDEV(x) FROM detail) AND a.x=b.x';
 const r=await evaluate({reference,answer,schema:ctx,maxPoints:5});assert.equal(r.distance,0);
 const invalid=await evaluate({reference:reference.replace('STDEV(x)','random()'),answer:answer.replace('STDEV(x)','random()'),schema:ctx,maxPoints:1,scale:1});assert.equal(invalid.points,0);
});

test('a misspelled DDL declaration with quoted CHECK bindings is one logical SQL repair',async()=>{
 const r=await evaluate({reference:'CREATE TABLE sample(x INT CHECK("x">0))',answer:'CREATE TABLE sample(x__typo INT CHECK("x">0))',maxPoints:5});
 assert.equal(r.distance,1);assert.equal(r.points,4);assert.equal(r.edits[0].name,'repairDeclaredColumnBinding');
 const altered=await evaluate({reference:'ALTER TABLE sample ADD COLUMN amount INT CHECK(amount>=1 AND amount<=8)',
  answer:'ALTER TABLE sample ADD COLUMN amount__typo INT CHECK("amount">=1 AND "amount"<=8)',schema,maxPoints:5});
 assert.equal(altered.distance,1);assert.equal(altered.points,4);assert.equal(altered.edits[0].name,'repairDeclaredColumnBinding');
 const constraint=await evaluate({reference:'ALTER TABLE sample ADD COLUMN amount INT DEFAULT 1 NOT NULL CHECK(amount>0)',
  answer:'ALTER TABLE sample ADD COLUMN amount INT DEFAULT 1 CHECK(amount>0)',schema,maxPoints:5});
 assert.equal(constraint.distance,1);assert.equal(constraint.points,4);assert.equal(constraint.edits[0].name,'repairColumnNullable');
});

test('compound ORDER BY resolves quoted output names and aliases from either arm',async()=>{
 const db=new DatabaseSync(':memory:');
 try{
  db.exec('CREATE TABLE sample(x,y);INSERT INTO sample VALUES(3,1),(1,2)');
  for(const name of ['amount','other']){
   const reference='SELECT COUNT(*) AS amount,x FROM sample GROUP BY x UNION SELECT 0 AS other,y FROM sample ORDER BY '+name+' DESC,x';
   const answer='SELECT COUNT(1) AS amount,x FROM sample GROUP BY x UNION SELECT 0 AS other,y FROM sample ORDER BY "'+name+'" DESC,"x"';
   assert.deepEqual(db.prepare(reference).all(),db.prepare(answer).all());
   const r=await evaluate({reference,answer,schema,maxPoints:5});assert.equal(r.distance,0);assert.equal(r.traceVerified,true);
  }
 }finally{db.close();}
});

test('restoring a missing output alias also restores its quoted HAVING binding',async()=>{
 const r=await evaluate({reference:'SELECT COUNT(*) AS amount,x FROM sample GROUP BY x HAVING "amount">1',
  answer:'SELECT x FROM sample GROUP BY x HAVING "amount">1',schema,maxPoints:5});
 assert.equal(r.distance,1);assert.equal(r.points,4);assert.equal(r.edits[0].name,'insertProjectedExpression');
});

test('implicit ascending ORDER BY is a grammar default, while DESC remains a material operation',async()=>{
 assert.equal(stableKey(ast('SELECT x FROM sample ORDER BY x')),stableKey(ast('SELECT x FROM sample ORDER BY x ASC')));
 const r=await evaluate({reference:'SELECT x FROM sample ORDER BY x ASC',answer:'SELECT x FROM sample ORDER BY x DESC',schema,maxPoints:5});assert.equal(r.distance,1);
});

test('an accidentally added LIMIT is a certified local clause error, with a real missing-row counterexample',async()=>{
 const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE sample(x,y);INSERT INTO sample VALUES(1,1),(2,2),(3,3)');assert.equal(db.prepare('SELECT * FROM sample LIMIT 2').all().length,2);assert.equal(db.prepare('SELECT * FROM sample').all().length,3);}finally{db.close();}
 const r=await evaluate({reference:'SELECT * FROM sample',answer:'SELECT * FROM sample LIMIT 2',schema,maxPoints:5});
 assert.equal(r.distance,1);assert.equal(r.points,4);assert.equal(r.search,'exact-direct-bound-certificate');
});

test('several JOIN relocations complete without enumerating unrelated free Boolean closures',async()=>{
 const context={tables:[...schema.tables,{name:'detail',type:'table',columns:[{name:'x'}]}]};
 const r=await evaluate({reference:'SELECT a.x FROM sample a INNER JOIN detail b ON a.x=b.x INNER JOIN detail c ON a.y=c.x WHERE a.x>0 AND c.x>0',
  answer:'SELECT a.x FROM sample a,detail b,detail c WHERE ((a.x>0 AND c.x>0) AND a.x=b.x) AND a.y=c.x',schema:context,maxPoints:5});
 assert.equal(r.distance,0);assert.equal(r.points,5);assert.ok(r.visited<10,JSON.stringify({visited:r.visited,search:r.search}));
});

test('quoted columns resolve through earlier views, explicit view columns and star-derived sources',()=>{
 for(const [a,b]of[
  ['CREATE VIEW named AS SELECT x FROM sample;DELETE FROM sample WHERE x IN(SELECT x FROM named)',
   'CREATE VIEW named AS SELECT "x" FROM sample;DELETE FROM sample WHERE "x" IN(SELECT "x" FROM named)'],
  ['CREATE VIEW named(chosen) AS SELECT x FROM sample;SELECT chosen FROM named',
   'CREATE VIEW named(chosen) AS SELECT "x" FROM sample;SELECT "chosen" FROM named'],
  ['SELECT x FROM(SELECT * FROM sample) AS named','SELECT "x" FROM(SELECT * FROM sample) AS named']
 ])assert.equal(stableKey(parseGraphSql(a,{schema}).root),stableKey(parseGraphSql(b,{schema}).root));
});

test('only explicitly unconstrained Boolean group labels permit CASE, inversion and injective affine relabelling',async()=>{
 const questionText='Welche Werte genau in cohort stehen ist unerheblich; sie müssen unterscheidbar sein.';
 const reference='SELECT(x>y) AS cohort,AVG(x) AS mean FROM sample GROUP BY cohort';
 for(const classifier of ["CASE WHEN x>y THEN 'A' WHEN NOT(x>y) THEN 'B' ELSE NULL END",'NOT(x>y)','(x>y)+2','2-(x>y)',"(x>y)||'?' "]){
  const answer='SELECT '+classifier+' AS cohort,AVG(x) AS mean FROM sample GROUP BY cohort';
  const r=await evaluate({reference,answer,questionText,schema,maxPoints:5});assert.equal(r.distance,0,classifier);assert.equal(r.points,5);
  const requirements=questionRequirements(questionText),a=ast(answer),b=ast(reference),g=createEditGraph(b,a,schema,{},requirements);
  for(const edit of g.edits.filter(e=>e.cost===0))for(const n of edit.apply(a)){
   assert.deepEqual(set(symbolFacts(g.abstractRoot(n.root))),set(symbolFacts(g.abstractRoot(a))),edit.name);
   assert.deepEqual(set(predicateFacts(g.abstractRoot(n.root))),set(predicateFacts(g.abstractRoot(a))),edit.name);
  }
 }
 const wrong=await evaluate({reference,answer:"SELECT CASE WHEN x>y THEN 'same' WHEN NOT(x>y) THEN 'same' ELSE NULL END AS cohort,AVG(x) AS mean FROM sample GROUP BY cohort",questionText,schema,maxPoints:1,scale:1});
 assert.equal(wrong.points,0,'Collapsing both groups is not an injective relabelling');
 const regular=await evaluate({reference,answer:"SELECT CASE WHEN x>y THEN 'A' WHEN NOT(x>y) THEN 'B' ELSE NULL END AS cohort,AVG(x) AS mean FROM sample GROUP BY cohort",schema,maxPoints:1,scale:1});assert.equal(regular.points,0);
});

test('question-permitted feedback tuples need successful executions and the verified result-row count',async()=>{
 const questionText='Welche Werte genau in cohort stehen ist unerheblich. Hängen Sie ein drittes Tupel (z.B. per UNION SELECT 0,0) an.';
 const reference='SELECT(x>y) AS cohort,AVG(x) AS mean FROM sample GROUP BY cohort UNION SELECT 0,0';
 const answer='SELECT(x>y) AS cohort,AVG(x) AS mean FROM sample GROUP BY cohort UNION SELECT -1,-1';
 const evidence={referenceExecutionValid:true,answerExecutionValid:true,referenceRows:3,answerRows:3};
 const r=await evaluate({reference,answer,schema,questionText,maxPoints:5,...evidence});assert.equal(r.distance,0);assert.equal(r.points,5);
 for(const invalid of [{},{...evidence,answerRows:2},{...evidence,answerExecutionValid:false}]){
  const wrong=await evaluate({reference,answer,schema,questionText,maxPoints:1,scale:1,...invalid});assert.equal(wrong.points,0);
 }
});

test('one local error keeps relative partial credit; missing the data source is a fundamental error',async()=>{
 for(const maxPoints of [1,2,5,25]){
  const r=await evaluate({reference:'SELECT x FROM sample WHERE x>2',answer:'SELECT x FROM sample WHERE x>3',schema,maxPoints});
  assert.equal(r.status,'exact');assert.equal(r.distance,1);assert.equal(r.points,maxPoints*.8);
  const wrong=await evaluate({reference:'SELECT x FROM sample WHERE x>2',answer:'SELECT 123 AS unrelated',schema,maxPoints});
  assert.equal(wrong.points,0);assert.equal(wrong.status,'score-zero-certified');assert.ok(wrong.lowerBound>=5);
 }
});

test('explicit method constraints come from the question and cover comma joins as well',()=>{
 const req=questionRequirements('Finden Sie eine Lösung ohne JOIN-Operation.');
 assert.deepEqual(req.forbidden,['join']);
 assert.equal(constructUse(ast('SELECT x FROM sample WHERE x IN(SELECT y FROM other)')).join,false);
 assert.equal(constructUse(ast('SELECT a.x FROM sample a,other b WHERE a.x=b.y')).join,true);
 const root=ast('SELECT a.x FROM sample a INNER JOIN other b ON a.x=b.y');
 const graph=createEditGraph(root,root,schema,{},req);
 for(const e of graph.edits.filter(e=>e.cost===0))for(const n of e.apply(root))assert.equal(requirementState(n.root,req),requirementState(root,req));
 assert.deepEqual(questionRequirements('Bauen Sie dies durch zwei vereinigte LEFT OUTER JOIN Operationen nachbauen.').required,['left-join','union']);
});
