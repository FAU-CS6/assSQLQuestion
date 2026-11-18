/* Read-only gate for the complete private 699-question native Chrome matrix.
 * Inputs are streamed; this tool executes neither SQL nor QSS and never edits
 * source questions, observations, submissions or grades.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'../..'),hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
async function stream(file,each){
 const input=fs.createReadStream(file),digest=crypto.createHash('sha256');input.on('data',chunk=>digest.update(chunk));let count=0;
 for await(const line of readline.createInterface({input,crlfDelay:Infinity})){assert.ok(line.trim());await each(JSON.parse(line),count++);}
 return{sha256:digest.digest('hex'),rows:count};
}
const same=(a,b)=>!a.error&&!b.error&&a.relation_sha256===b.relation_sha256&&a.state_sha256===b.state_sha256;
function checkCase(row,expected){
 assert.deepEqual(row.failures,[]);
 assert.equal(row.answer_sha256,typeof row.answer==='string'?hash(row.answer):expected.answer_sha256);
 const result=row.result,q=result?.qss;assert.ok(q,'Missing native QSS sidecar');
 assert.equal(q.engine,'graph-qss-sqlite-v2');assert.equal(q.version,require('../../lib/qss/cost-catalog.json').modelVersion);assert.equal(q.modelVersion,require('../../lib/qss/cost-catalog.json').modelVersion);
 assert.equal(q.rubric,'paper-linear-v2');assert.equal(q.provisionalRubric,true);
 assert.equal(q.scale,expected.maximum>0?expected.maximum/5:1);assert.equal(q.maxPoints,expected.maximum);
 assert.equal(q.answerDigest,row.answer_sha256,'Answer binding');assert.match(q.referenceRevision,/^[a-f0-9]{64}$/);
 assert.equal(q.formula,'max(maxPoints - distance * scale, 0)');assert.equal(q.scoreCertifiedWithinModel,true);
 assert.ok(result.progress.length&&result.progress.every(p=>p.resultHidden&&p.nextDisabled),'Question-local progress and navigation barrier');
 assert.equal(result.workers_disposed,true);
 // The last native question has Finish Test instead of Next. Missing Next is
 // valid only there; the enclosing gate also requires the finalized attempt.
 assert.ok(result.next_disabled===false||expected.isFinalQuestion&&result.next_disabled===undefined,'Next must be enabled or absent on the final question');
 if(expected.requirePhaseTimings)for(const field of ['sql_pipeline_ms','qss_ms','official_metrics_ms','browser_total_ms'])
  assert.ok(Number.isFinite(result.timings?.[field])&&result.timings[field]>=0,'Missing browser phase measurement '+field);
 assert.ok(['exact','score-zero-certified'].includes(q.status),'Uncertified QSS grade');
 assert.equal(q.editsTruncated,false);
 if(q.status==='exact'){
  assert.equal(q.exactWithinModel,true);assert.ok(Number.isSafeInteger(q.distance)&&q.distance>=0);
  assert.equal(q.edits.reduce((n,e)=>n+e.cost,0),q.distance);
  const points=Math.round((Math.max(expected.maximum-q.distance*q.scale,0)+Number.EPSILON)*1e4)/1e4;
  assert.equal(q.points,points);
 }else{assert.equal(q.distance,null);assert.ok(q.lowerBound*q.scale>=expected.maximum);assert.equal(q.points,0);}
 if(row.category==='correct'){assert.equal(q.distance,0,'Correct answer lost credit');assert.equal(q.points,expected.maximum);assert.equal(result.error,null);assert.ok(row.proof);}
 else if(row.category==='minor')assert.ok(q.points>0&&q.points<expected.maximum,'Local error must retain partial credit');
 else{assert.equal(row.category,'major');assert.equal(q.points,0,'Unrelated answer received credit');}
}
async function verify({corpus,out,frozenFile,prefixes,teacherFile,semanticFile}){
 assert.equal(prefixes.length,4);assert.equal(new Set(prefixes).size,4);
 const frozen=json(frozenFile),manifest=json(path.join(corpus,'manifest.json'));
 assert.equal(manifest.questions,699);assert.deepEqual(manifest.pools.map(p=>p.count),[23,65,504,68,39]);
 assert.equal(frozen.model_version,require('../../lib/qss/cost-catalog.json').modelVersion);
 for(const [file,digest]of Object.entries(frozen.files))assert.equal(hash(fs.readFileSync(path.join(ROOT,file))),digest,'Frozen source '+file);
 const sources=new Map(),keys=[],pools={};let maximum=0;
 const original=await stream(path.join(corpus,'questions.jsonl'),(row,i)=>{
  assert.equal(sources.has(row.key),false);keys.push(row.key);pools[row.pool]=(pools[row.pool]||0)+1;
  const metrics=JSON.parse(row.metadata.SOLUTION_METRICS).map(m=>typeof m==='string'?JSON.parse(m):m);
  const points=metrics.reduce((n,m)=>n+Number(m.points),0);maximum+=points;
  sources.set(row.key,{ordinal:i+1,maximum:points,answer_sha256:hash(row.metadata.SEQUENCE_B.replace(/\r\n?/g,'\n')),
   output_sha256:hash(JSON.stringify(JSON.parse(row.metadata.OUTPUT_RELATION)))});
 });
 assert.equal(original.rows,699);assert.equal(original.sha256,frozen.source_questions_sha256);
 const plans=new Map();
 const planInput=await stream(path.join(out,'plans.jsonl'),(plan,i)=>{
  assert.equal(plan.key,keys[i]);assert.equal(plan.ordinal,i+1);
  const specs=new Map();for(const category of ['correct','minor','major'])for(const spec of plan[category])specs.set(category+':'+spec.name,{...spec,sql:undefined,sha256:hash(spec.sql)});
  plans.set(plan.key,{specs,requirements:plan.requirements});
 });assert.equal(planInput.rows,699);assert.equal(planInput.sha256,frozen.plans_sha256);
 const seen=new Set(),nativeIds=new Set(),originalIds=new Set(),students=new Set(),teachers=new Set(),parts=[],shortfalls=[],families={},timings=[];
 const totals={questions:0,cases:0,correct:0,minor:0,major:0,substantive_correct:0};let end=0;
 const phaseTimings=Object.fromEntries(['sql_pipeline_ms','qss_ms','official_metrics_ms','browser_total_ms'].map(key=>[key,[]]));
 for(const prefix of prefixes){
  assert.match(prefix,/^[a-zA-Z0-9_-]+$/);
  const state=json(path.join(corpus,prefix+'exam-state.json')),report=json(path.join(out,prefix+'report.json'));
  const db=json(path.join(out,prefix+'database-report.json')),legacy=json(path.join(out,prefix+'legacy-report.json'));
  const rangeKeys=Object.keys(state.questions);assert.equal(state.source_start,end);end=state.source_end_exclusive;
  students.add(state.student_id);teachers.add(state.teacher_id);assert.notEqual(state.student_id,state.teacher_id,'Separate ordinary teacher/student accounts');
  assert.deepEqual(rangeKeys,keys.slice(state.source_start,end));assert.equal(state.source_count,rangeKeys.length);
  assert.equal(state.source_questions_sha256,original.sha256);assert.equal(state.source_keys_sha256,hash(JSON.stringify(rangeKeys)));
  assert.equal(report.test_id,state.test_id);assert.equal(report.student_id,state.student_id);
  assert.equal(report.headless,true);assert.match(report.user_agent,/HeadlessChrome\//);assert.equal(report.browser,frozen.browser);
  for(const field of ['qss_worker_sha256','runtime_sha256','sql_worker_sha256','php_config_sha256'])assert.equal(report[field],frozen[field],'Mixed native build '+field);
  assert.equal(report.finished,true);assert.equal(report.frozen_build_verified,true);assert.deepEqual(report.failures,[]);assert.deepEqual(report.page_errors,[]);
  assert.equal(report.timing_instrumentation,'per-run-browser-phases-v1');
  assert.equal(report.questions,rangeKeys.length);assert.equal(report.coverage.completed,true);assert.equal(report.coverage.completed_questions,rangeKeys.length);
  const perQuestion=new Map();let rangeMaximum=0;
  for(const [i,key]of rangeKeys.entries()){
   assert.equal(seen.has(key),false);seen.add(key);const expected=sources.get(key),identity=state.questions[key];rangeMaximum+=expected.maximum;
   assert.equal(identity.original_source_ordinal,expected.ordinal);
   for(const [ids,id]of [[nativeIds,identity.question_id],[originalIds,identity.original_question_id]]){assert.ok(Number.isSafeInteger(id)&&id>0);assert.equal(ids.has(id),false);ids.add(id);}
   perQuestion.set(key,{...expected,identity,sequence:i+1,isFinalQuestion:i===rangeKeys.length-1,requirePhaseTimings:true,counts:{correct:0,minor:0,major:0},answers:new Set(),reference:null});
  }
  const observed={questions:rangeKeys.length,cases:0,correct:0,minor:0,major:0,substantive_correct:0};
  const retainedDigest=crypto.createHash('sha256');
  const cases=await stream(path.join(out,prefix+'cases.jsonl'),(row,index)=>{
   if(report.recovery&&index<report.recovery.retained_cases)retainedDigest.update(JSON.stringify(row)+'\n');
   const expected=perQuestion.get(row.key);assert.ok(expected,'Case outside declared native range');
   assert.equal(row.ordinal,expected.ordinal);assert.equal(row.question_id,expected.identity.question_id);
   assert.deepEqual(row.actual_native_identity,{sequence:expected.sequence,form_sequence:expected.sequence,autosave_sequence:expected.sequence,question_id:row.question_id});
   const plan=plans.get(row.key),spec=plan.specs.get(row.category+':'+row.name);assert.ok(spec,'Case absent from predeclared plan');
   assert.equal(spec.sha256,row.answer_sha256);assert.equal(spec.family,row.family);assert.equal(spec.proof,row.proof);assert.equal(spec.substantive,row.substantive);
   assert.equal(expected.answers.has(row.answer_sha256),false,'Duplicate variant');expected.answers.add(row.answer_sha256);
   checkCase(row,expected);
   expected.referenceRevision??=row.result.qss.referenceRevision;assert.equal(row.result.qss.referenceRevision,expected.referenceRevision);
   expected.counts[row.category]++;observed.cases++;observed[row.category]++;timings.push(row.result.wall_ms);
   for(const field of Object.keys(phaseTimings))phaseTimings[field].push(row.result.timings[field]);
   if(row.name==='model-answer'){assert.equal(row.answer_sha256,expected.answer_sha256);expected.reference=row.observed;}
   else assert.ok(expected.reference,'Model observation must precede alternatives');
   if(row.category==='correct'){
    if(!same(expected.reference,row.observed))assert.ok(row.catalog_proof===true||plan.requirements.freeLabelColumns.length&&row.observed.task_relation_sha256===expected.reference.task_relation_sha256,'Independent correct-answer observation');
    families[row.family]=(families[row.family]||0)+1;if(row.substantive)observed.substantive_correct++;
   }else if(row.category==='minor'){assert.notEqual(row.observed.phase,'B','Invalid B is not a selected local counterexample');assert.equal(same(expected.reference,row.observed),false,'Missing independent error counterexample');}
  });
  if(report.recovery){
   const recovery=report.recovery,old=path.resolve(recovery.source_directory);assert.notEqual(old,path.resolve(out));
   for(const [suffix,field]of [['report.json','source_report_sha256'],['cases.jsonl','source_cases_sha256'],['restored.jsonl','source_restored_sha256']]){
    const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(path.join(old,prefix+suffix)))h.update(chunk);
    assert.equal(h.digest('hex'),recovery[field],'Immutable recovery input '+suffix);
   }
   assert.equal(retainedDigest.digest('hex'),recovery.retained_cases_sha256,'Recovered cases remain byte-equivalent JSON records');
   assert.ok(recovery.completed_questions<state.source_count&&recovery.retained_cases<=cases.rows);
  }
  const actualShortfalls=[];
  for(const [key,expected]of perQuestion){
   assert.ok(expected.counts.correct>=1&&expected.counts.correct<=4);assert.ok(expected.counts.minor<=3);assert.equal(expected.counts.major,3);
   if(expected.counts.correct<4||expected.counts.minor<3)actualShortfalls.push({ordinal:expected.ordinal,key,counts:expected.counts});
  }
  assert.deepEqual(report.shortfalls,actualShortfalls);shortfalls.push(...actualShortfalls);
  for(const [field,value]of Object.entries(observed)){assert.equal(report[field],value,field);totals[field]+=value;}
  let restoredIndex=0;
  const restoredInput=await stream(path.join(out,prefix+'restored.jsonl'),row=>{
   assert.equal(row.key,rangeKeys[restoredIndex++]);const expected=perQuestion.get(row.key);
   assert.equal(row.ordinal,expected.ordinal);assert.equal(row.question_id,expected.identity.question_id);assert.equal(row.answer_sha256,expected.answer_sha256);
   checkCase({...row,category:'correct',proof:'given-reference',failures:[]},expected);
   assert.equal(row.result.qss.referenceRevision,expected.referenceRevision);
   assert.equal(row.result.output_relation_sha256,expected.output_sha256);assert.equal(row.result.legacy_points,expected.maximum);
  });
  assert.equal(restoredIndex,rangeKeys.length);
  assert.equal(legacy.cases_sha256,cases.sha256);assert.equal(legacy.cases,cases.rows);assert.equal(legacy.questions,rangeKeys.length);
  assert.equal(legacy.unchanged_with_qss,cases.rows);assert.equal(legacy.legacy_points_match,cases.rows);assert.deepEqual(legacy.failures,[]);
  assert.equal(db.test_id,state.test_id);assert.equal(db.student_id,state.student_id);assert.equal(db.student_is_system_admin,false);assert.deepEqual(db.failures,[]);
  for(const field of ['expected','authorized_answers','qss_saved','qss_exact_self','stored_grade_rows'])assert.equal(db[field],rangeKeys.length,field);
  assert.deepEqual(db.question_ids,[...perQuestion.values()].map(q=>q.identity.question_id).sort((a,b)=>a-b));
  assert.deepEqual(db.saved_bindings,[...perQuestion.values()].sort((a,b)=>a.identity.question_id-b.identity.question_id)
   .map(q=>({question_id:q.identity.question_id,answer_digest:q.answer_sha256,reference_revision:q.referenceRevision})));
  assert.equal(db.manual_overrides,0);assert.equal(db.legacy_points,rangeMaximum);assert.equal(db.maximum_points,rangeMaximum);
  assert.equal(db.native_attempt.finalized_by,'finished_by_participant');assert.equal(Number(db.native_attempt.points),rangeMaximum);
  assert.equal(Number(db.native_attempt.answeredquestions),rangeKeys.length);assert.equal(Number(db.native_attempt.questioncount),rangeKeys.length);
  parts.push({prefix,test_id:state.test_id,active_id:db.active_id,source_start:state.source_start,source_end_exclusive:end,...observed,cases_sha256:cases.sha256,
   input_sha256:{state:hash(fs.readFileSync(path.join(corpus,prefix+'exam-state.json'))),browser_report:hash(fs.readFileSync(path.join(out,prefix+'report.json'))),
    restored_models:restoredInput.sha256,database_report:hash(fs.readFileSync(path.join(out,prefix+'database-report.json'))),legacy_case_report:hash(fs.readFileSync(path.join(out,prefix+'legacy-report.json')))}});
 }
 assert.equal(end,699);assert.equal(seen.size,699);for(const id of nativeIds)assert.equal(originalIds.has(id),false);
 const teacher=json(teacherFile),semantic=json(semanticFile);
 assert.equal(students.size,1);assert.equal(teachers.size,1);assert.equal(teachers.has(teacher.teacher_user_id),true);
 assert.equal(teacher.headless,true);assert.match(teacher.user_agent,/HeadlessChrome\//);assert.equal(teacher.qss_worker_sha256,frozen.qss_worker_sha256);assert.equal(teacher.qss_worker_unchanged,true);
 assert.equal(teacher.imported_questions,699);assert.equal(teacher.reimported_questions,699);assert.equal(teacher.pools.length,5);
 assert.deepEqual(teacher.pools.map(p=>p.key),manifest.pools.map(p=>p.key));
 for(const [i,pool]of teacher.pools.entries()){assert.equal(pool.imported_count,manifest.pools[i].count);assert.equal(pool.reimported_count,manifest.pools[i].count);}
 assert.equal(semantic.questions,699);assert.equal(semantic.reimported,699);assert.equal(semantic.source_questions_sha256,original.sha256);
 assert.equal(semantic.teacher_user_id,teacher.teacher_user_id);assert.equal(semantic.teacher_is_system_administrator,false);
 assert.equal(semantic.all_pool_and_question_owners_are_teacher,true);assert.equal(semantic.ownership_verified_questions,1398);assert.deepEqual(semantic.failures,[]);
 timings.sort((a,b)=>a-b);
 return{accepted:true,completed:true,observed_at:new Date().toISOString(),model_version:require('../../lib/qss/cost-catalog.json').modelVersion,...totals,parts,pool_counts:pools,
  source_questions_sha256:original.sha256,plans_sha256:planInput.sha256,frozen_proof_sha256:hash(fs.readFileSync(frozenFile)),
  teacher_transfer_sha256:hash(fs.readFileSync(teacherFile)),teacher_semantics_sha256:hash(fs.readFileSync(semanticFile)),
  qss_worker_sha256:frozen.qss_worker_sha256,runtime_sha256:frozen.runtime_sha256,shortfalls,correct_families:families,
  native_case_wall_ms:{median:timings[Math.floor(timings.length/2)],p95:timings[Math.floor(timings.length*.95)],maximum:timings.at(-1)},
  native_phase_ms:Object.fromEntries(Object.entries(phaseTimings).map(([field,values])=>{
   values.sort((a,b)=>a-b);return[field,{median:values[Math.floor(values.length/2)],p95:values[Math.ceil(values.length*.95)-1],maximum:values.at(-1)}];
  })),
  legacy_points:maximum,maximum_points:maximum,official_case_scores_verified:totals.cases,finished_native_tests:4,
  teacher_imported:699,teacher_reimported:699,teacher_student_are_system_administrators:false,
  scope:'Native Chrome generated-answer matrix and saved official grades; no human calibration or complete SQL-equivalence proof',failures:[]};
}
module.exports={verify,checkCase};
if(require.main===module)verify({corpus:process.env.ILIAS_CORPUS_DIRECTORY||'/tmp/asssql-paper-corpus',out:process.env.STUDENT_VARIANTS_DIRECTORY||'/tmp/asssql-student-variants-final',
 frozenFile:process.env.QSS_FROZEN_BUNDLES,teacherFile:process.env.QSS_TEACHER_TRANSFER,semanticFile:process.env.QSS_TEACHER_SEMANTICS,prefixes:process.argv.slice(2)})
 .then(report=>{const file=path.join(process.env.STUDENT_VARIANTS_DIRECTORY,'acceptance-report.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({...report,shortfalls:report.shortfalls.length,parts:report.parts.length}));})
 .catch(error=>{console.error(error);process.exitCode=1;});
