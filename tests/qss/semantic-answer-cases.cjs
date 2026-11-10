/* Anonymous, predeclared answers independent of the private question pools.
 * Positive pairs use named SQL laws; execution supplies counterexamples, never
 * the sole proof of equivalence. SQL and QSS run only in the browser runner. */
'use strict';

function cases() {
 const out=[];
 const add=(id,family,reference,answer,equivalent,proof,control='')=>out.push({id,family,reference,answer,equivalent,proof,control});
 for(const [op,opposite]of [['>','<='],['<','>='],['>=','<'],['<=','>'],['=','<>'],['<>','=']]){
  add('complement-'+op,'comparison-complement',`SELECT id FROM sample WHERE x${op}2 ORDER BY id`,`SELECT id FROM sample WHERE NOT(x${opposite}2) ORDER BY id`,true,'NULL-preserving comparison complement');
 }
 const p='x>2',q='y<>1',r='label IS NOT NULL';
 for(const op of ['AND','OR']){
  const opposite=op==='AND'?'OR':'AND';
  add('de-morgan-'+op,'de-morgan',`SELECT id FROM sample WHERE (${p}) ${op} (${q}) ORDER BY id`,`SELECT id FROM sample WHERE NOT(NOT(${p}) ${opposite} NOT(${q})) ORDER BY id`,true,'De Morgan in SQL three-valued logic');
  add('associative-'+op,'boolean-associativity',`SELECT id FROM sample WHERE ((${p}) ${op} (${q})) ${op} (${r}) ORDER BY id`,`SELECT id FROM sample WHERE (${p}) ${op} ((${q}) ${op} (${r})) ORDER BY id`,true,'Pure Boolean associativity');
  add('idempotent-'+op,'boolean-idempotence',`SELECT id FROM sample WHERE ${p} ORDER BY id`,`SELECT id FROM sample WHERE (${p}) ${op} (${p}) ORDER BY id`,true,'Pure Boolean idempotence');
 }
 add('composed-boolean','composed-equivalence',`SELECT id FROM sample WHERE (${p}) AND (${q}) ORDER BY id`,`SELECT id FROM sample WHERE NOT(NOT(2<x) OR NOT(NOT(y=1))) ORDER BY id`,true,'Comparison mirroring, complement and De Morgan');
 add('boolean-case','three-valued-case',`SELECT id,(${p}) AS flag FROM sample ORDER BY id`,`SELECT id,CASE WHEN ${p} THEN 1 WHEN NOT(${p}) THEN 0 ELSE NULL END AS flag FROM sample ORDER BY id`,true,'Explicit true/false/unknown CASE encoding');
 add('count-constant','aggregate-count','SELECT COUNT(*) AS total FROM sample','SELECT COUNT(1) AS total FROM sample',true,'COUNT of a non-NULL constant counts every row');
 add('grouped-count','aggregate-count','SELECT label,COUNT(*) AS total FROM sample GROUP BY label ORDER BY label','SELECT label,COUNT(1) AS total FROM sample GROUP BY label ORDER BY label',true,'COUNT identity within each group');
 add('integer-constant','integer-arithmetic','SELECT id FROM sample WHERE x>6 ORDER BY id','SELECT id FROM sample WHERE x>(2*3) ORDER BY id',true,'Closed, non-overflowing int64 arithmetic');
 add('alias-binding','bound-alias','SELECT a.id FROM sample a WHERE a.x>2 ORDER BY a.id','SELECT b.id FROM sample b WHERE b.x>2 ORDER BY b.id',true,'Capture-free renaming of one table binding');
 add('inner-join','join-relocation','SELECT s.id,d.value FROM sample s INNER JOIN detail d ON s.id=d.sample_id WHERE s.x>2 ORDER BY s.id,d.value','SELECT s.id,d.value FROM sample s,detail d WHERE s.id=d.sample_id AND s.x>2 ORDER BY s.id,d.value',true,'Same source order and pure INNER JOIN/WHERE predicates');
 add('delete-complement','delete-predicate','DELETE FROM sample WHERE x>2','DELETE FROM sample WHERE NOT(x<=2)',true,'Same NULL-preserving deletion predicate','SELECT * FROM sample ORDER BY id');
 add('update-complement','update-predicate','UPDATE sample SET y=7 WHERE x>2','UPDATE sample SET y=7 WHERE NOT(x<=2)',true,'Same NULL-preserving update predicate','SELECT * FROM sample ORDER BY id');
 add('create-check','check-constraint','CREATE TABLE checked(value INTEGER CHECK(value>2))','CREATE TABLE checked(value INTEGER CHECK(NOT(value<=2)))',true,'CHECK receives the same three-valued predicate','PRAGMA table_info(checked)');
 add('alter-check','alter-check','ALTER TABLE sample ADD checked INTEGER CHECK(checked>2)','ALTER TABLE sample ADD checked INTEGER CHECK(NOT(checked<=2))',true,'Equivalent predicate bound to the newly added column','PRAGMA table_info(sample)');
 add('foreign-key-layout','foreign-key-layout','CREATE TABLE child(id INTEGER,pid INTEGER REFERENCES sample(id) ON DELETE CASCADE)','CREATE TABLE child(id INTEGER,pid INTEGER,FOREIGN KEY(pid) REFERENCES sample(id) ON DELETE CASCADE)',true,'Same unnamed single-column FK, action and action order','PRAGMA foreign_key_list(child)');
 add('null-case-error','NULL-counterexample',`SELECT id,(${p}) AS flag FROM sample ORDER BY id`,`SELECT id,CASE WHEN ${p} THEN 1 ELSE 0 END AS flag FROM sample ORDER BY id`,false,'NULL must not turn into false');
 add('nullable-count-error','NULL-counterexample','SELECT COUNT(*) AS total FROM sample','SELECT COUNT(x) AS total FROM sample',false,'Nullable values distinguish COUNT(column) from COUNT(*)');
 add('distinct-count-error','duplicate-counterexample','SELECT COUNT(*) AS total FROM sample','SELECT COUNT(DISTINCT x) AS total FROM sample',false,'Duplicates and NULL distinguish DISTINCT counts');
 add('outer-join-error','outer-join-counterexample','SELECT s.id,d.value FROM sample s LEFT JOIN detail d ON s.id=d.sample_id AND d.value=\'A\' ORDER BY s.id,d.value','SELECT s.id,d.value FROM sample s LEFT JOIN detail d ON s.id=d.sample_id WHERE d.value=\'A\' ORDER BY s.id,d.value',false,'Moving an outer-join predicate loses unmatched rows');
 add('collation-error','collation-counterexample','SELECT s.id,(s.label=d.value) AS flag FROM sample s JOIN detail d ON s.id=d.sample_id ORDER BY s.id,d.value','SELECT s.id,(d.value=s.label) AS flag FROM sample s JOIN detail d ON s.id=d.sample_id ORDER BY s.id,d.value',false,'Left-column NOCASE versus BINARY collation');
 // Observe SQLite storage classes/quoting: the legacy worker's JavaScript
 // numbers cannot distinguish all int64 values or INTEGER from rounded REAL.
 add('overflow-error','integer-overflow-counterexample','SELECT typeof(9223372036854775807) AS storage','SELECT typeof((9223372036854775807+1)-1) AS storage',false,'Overflow promotes INTEGER to REAL, observed inside SQLite');
 add('int64-precision-error','int64-counterexample',"SELECT 'int64:'||quote(9223372036854775807) AS value","SELECT 'int64:'||quote(9223372036854775806) AS value",false,'Distinct int64 values observed through prefixed SQLite text, not JS Number');
 add('affinity-error','affinity-counterexample','SELECT id,x AS value FROM sample ORDER BY id','SELECT id,(x+0) AS value FROM sample ORDER BY id',false,'Arithmetic changes TEXT values and storage classes');
 add('union-bag-error','duplicate-counterexample','SELECT x FROM sample UNION SELECT x FROM sample','SELECT x FROM sample UNION ALL SELECT x FROM sample',false,'UNION removes duplicates while UNION ALL preserves them');
 return out;
}

function datasets() {
 const prefix='CREATE TABLE sample(id INTEGER PRIMARY KEY,x,y,label TEXT COLLATE NOCASE);CREATE TABLE detail(sample_id INTEGER,value TEXT COLLATE BINARY);';
 return [
  {id:'mixed-null-types',setup:prefix+"INSERT INTO sample VALUES(1,NULL,1,'a'),(2,2,NULL,'A'),(3,3,0,NULL),(4,'3',1,'b'),(5,0,1,'B'),(6,-1,2,'a');INSERT INTO detail VALUES(1,'A'),(2,'a'),(2,'a'),(4,'b'),(8,'unmatched');"},
  {id:'duplicate-values',setup:prefix+"INSERT INTO sample VALUES(1,3,0,'a'),(2,3,0,'a'),(3,3,0,'a'),(4,NULL,NULL,NULL);INSERT INTO detail VALUES(1,'A'),(1,'A'),(2,NULL);"},
  {id:'null-only',setup:prefix+'INSERT INTO sample VALUES(1,NULL,NULL,NULL),(2,NULL,NULL,NULL);INSERT INTO detail VALUES(1,NULL);'},
  {id:'empty',setup:prefix}
 ];
}
module.exports={cases,datasets};
