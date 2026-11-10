'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const {carryCompleted}=require('./resume-student-variants.cjs');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
function fixture(t,failed=false){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'asssql-checkpoint-gate-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const source=path.join(root,'source'),corpus=path.join(root,'corpus'),destination=path.join(root,'recovery');fs.mkdirSync(source);fs.mkdirSync(corpus);
 const plans='{"anonymous_checkpoint_fixture":true}\n',fields=Object.fromEntries(['qss_worker_sha256','runtime_sha256','sql_worker_sha256','php_config_sha256'].map(k=>[k,'a'.repeat(64)]));
 fs.writeFileSync(path.join(source,'plans.jsonl'),plans);fs.writeFileSync(path.join(source,'generation-report.json'),'{}');
 fs.writeFileSync(path.join(source,'frozen.json'),JSON.stringify({...fields,files:{},plans_sha256:hash(plans)}));
 const report={...fields,finished:false,questions:1,cases:2,failures:[],page_errors:[],shortfalls:[{key:'one'},{key:'two'}]};
 fs.writeFileSync(path.join(source,'part-report.json'),JSON.stringify(report));
 fs.writeFileSync(path.join(corpus,'part-exam-state.json'),JSON.stringify({source_start:0,source_count:3,questions:{one:{question_id:101},two:{question_id:102},three:{question_id:103}}}));
 const rows=[{key:'one',ordinal:1,question_id:101,category:'correct',family:'reference',substantive:false,failures:[]},
  {key:'two',ordinal:2,question_id:102,category:'minor',family:'local',substantive:true,failures:failed?['known scoring failure']:[]}];
 fs.writeFileSync(path.join(source,'part-cases.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
 fs.writeFileSync(path.join(source,'part-restored.jsonl'),JSON.stringify({key:'one',question_id:101})+'\n');
 return{source,corpus,destination,prefixes:['part-']};
}
test('recovery carries complete checkpoints, preserves original bytes and repeats the interrupted question',async t=>{
 const options=fixture(t),file=path.join(options.source,'part-cases.jsonl'),before=fs.readFileSync(file);
 const [summary]=await carryCompleted(options);assert.deepEqual(summary,{prefix:'part-',completed_questions:1,retained_cases:1,excluded_partial_cases:1});
 assert.deepEqual(fs.readFileSync(file),before);
 const recovered=fs.readFileSync(path.join(options.destination,'part-cases.jsonl'),'utf8');assert.equal(recovered,before.toString().split('\n')[0]+'\n');
 const report=JSON.parse(fs.readFileSync(path.join(options.destination,'part-report.json')));assert.equal(report.cases,1);assert.deepEqual(report.shortfalls,[{key:'one'}]);
 assert.equal(report.recovery.source_cases_sha256,hash(before));assert.equal(report.recovery.retained_cases_sha256,hash(recovered));
 await assert.rejects(carryCompleted(options),/new recovery directory/);
});
test('recovery cannot hide a known scoring failure by discarding an incomplete question',async t=>{
 await assert.rejects(carryCompleted(fixture(t,true)),/known scoring failure/);
});
test('a checked model followed by failed native navigation does not advance the completed checkpoint',async t=>{
 const options=fixture(t);fs.appendFileSync(path.join(options.source,'part-restored.jsonl'),JSON.stringify({key:'two',question_id:102})+'\n');
 await carryCompleted(options);
 const report=JSON.parse(fs.readFileSync(path.join(options.destination,'part-report.json')));
 assert.equal(report.questions,1);assert.equal(report.recovery.excluded_unsubmitted_restores,1);
 assert.equal(fs.readFileSync(path.join(options.destination,'part-restored.jsonl'),'utf8').trim().split('\n').length,1);
});
