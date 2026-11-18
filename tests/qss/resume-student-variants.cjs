/* Carry only complete native question checkpoints into a NEW private directory.
 * Original observations stay untouched. An interrupted question is repeated in
 * full; no score-dependent candidate selection or SQL/QSS execution occurs here.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
async function digestFile(file){const h=crypto.createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function lines(file,each){let count=0;for await(const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity}))await each(JSON.parse(line),line,count++);return count;}
async function carryCompleted({source,destination,corpus,prefixes}){
 source=path.resolve(source);destination=path.resolve(destination);assert.notEqual(source,destination);
 assert.equal(fs.existsSync(destination),false,'Use a new recovery directory; never rewrite old evidence.');
 const frozen=JSON.parse(fs.readFileSync(path.join(source,'frozen.json')));
 const root=path.resolve(__dirname,'../..');for(const [file,digest]of Object.entries(frozen.files))assert.equal(await digestFile(path.join(root,file)),digest,'Frozen source '+file);
 fs.mkdirSync(destination,{mode:0o700});
 for(const file of ['plans.jsonl','frozen.json','generation-report.json'])fs.copyFileSync(path.join(source,file),path.join(destination,file),fs.constants.COPYFILE_EXCL);
 assert.equal(await digestFile(path.join(destination,'plans.jsonl')),frozen.plans_sha256);
 const summary=[];
 for(const prefix of prefixes){
  assert.match(prefix,/^[a-zA-Z0-9_-]+$/);const filename=suffix=>path.join(source,prefix+suffix);
  const report=JSON.parse(fs.readFileSync(filename('report.json'))),exam=JSON.parse(fs.readFileSync(path.join(corpus,prefix+'exam-state.json')));
  assert.equal(report.finished,false);assert.deepEqual(report.failures,[]);assert.deepEqual(report.page_errors,[]);
  for(const field of ['qss_worker_sha256','runtime_sha256','sql_worker_sha256','php_config_sha256'])assert.equal(report[field],frozen[field]);
  const count=report.questions,keys=Object.keys(exam.questions).slice(0,count),completed=new Set(keys);
  assert.ok(Number.isSafeInteger(count)&&count>=0&&count<exam.source_count);
  let restored=0,unsubmittedRestores=0;const restoredOutput=fs.createWriteStream(path.join(destination,prefix+'restored.jsonl'),{flags:'wx',mode:0o600});
  await lines(filename('restored.jsonl'),(row,line)=>{
   assert.equal(row.question_id,exam.questions[row.key].question_id);
   if(restored===count){assert.equal(row.key,Object.keys(exam.questions)[count]);assert.equal(unsubmittedRestores++,0);return;}
   assert.equal(row.key,keys[restored++]);restoredOutput.write(line+'\n');
  });
  assert.equal(restored,count);await new Promise(resolve=>restoredOutput.end(resolve));
  const totals={cases:0,correct:0,minor:0,major:0,substantive_correct:0},families={},retainedDigest=crypto.createHash('sha256');let excluded=0;
  const output=fs.createWriteStream(path.join(destination,prefix+'cases.jsonl'),{flags:'wx',mode:0o600});
  const totalRows=await lines(filename('cases.jsonl'),(row,line)=>{
   assert.deepEqual(row.failures,[]);assert.equal(row.question_id,exam.questions[row.key].question_id);
   if(!completed.has(row.key)){assert.equal(row.ordinal,exam.source_start+count+1,'Exclude only the interrupted next question');excluded++;return;}
   output.write(line+'\n');retainedDigest.update(line+'\n');totals.cases++;totals[row.category]++;
   if(row.category==='correct'){families[row.family]=(families[row.family]||0)+1;if(row.substantive)totals.substantive_correct++;}
  });assert.equal(totalRows,report.cases);await new Promise(resolve=>output.end(resolve));
  Object.assign(report,totals,{correct_families:families,shortfalls:report.shortfalls.filter(row=>completed.has(row.key)),frozen_build_verified:false});
  report.recovery={source_directory:source,source_report_sha256:await digestFile(filename('report.json')),
   source_cases_sha256:await digestFile(filename('cases.jsonl')),source_restored_sha256:await digestFile(filename('restored.jsonl')),
   retained_cases:totals.cases,retained_cases_sha256:retainedDigest.digest('hex'),completed_questions:count,excluded_partial_cases:excluded,excluded_unsubmitted_restores:unsubmittedRestores};
  fs.writeFileSync(path.join(destination,prefix+'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  summary.push({prefix,completed_questions:count,retained_cases:totals.cases,excluded_partial_cases:excluded});
 }
 return summary;
}
module.exports={carryCompleted,digestFile};
if(require.main===module)carryCompleted({source:process.argv[2],destination:process.argv[3],corpus:process.env.ILIAS_CORPUS_DIRECTORY||'/tmp/asssql-paper-corpus',prefixes:process.argv.slice(4)})
 .then(summary=>console.log(JSON.stringify(summary))).catch(error=>{console.error(error);process.exitCode=1;});
