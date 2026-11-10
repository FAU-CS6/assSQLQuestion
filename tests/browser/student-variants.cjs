/* Opt-in student answer matrix on native ILIAS question pages in installed,
 * headless Google Chrome. No SQL or QSS execution deadline is imposed.
 * All private plans and observations remain outside the repository.
 */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {examSourceCoverage}=require('./pool-corpus.cjs');
const {installOracle,selectVariants}=require('./student-variant-oracle.cjs');
const base=process.env.ILIAS_TEST_URL||'http://localhost:8080';
const plugin='/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion';
const directory=process.env.ILIAS_CORPUS_DIRECTORY||'/tmp/asssql-paper-corpus';
const out=process.env.STUDENT_VARIANTS_DIRECTORY||'/tmp/asssql-student-variants';
const prefix=process.env.ILIAS_CORPUS_EXAM_PREFIX||'student-matrix-a-';
const start=Number(process.env.STUDENT_VARIANTS_START||0),limit=Number(process.env.STUDENT_VARIANTS_LIMIT||Infinity);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const normalize=s=>s.replace(/\r\n?/g,'\n');
const fold=s=>String(s).replace(/[A-Z]/g,c=>c.toLowerCase());
function legacyPoints(result,metrics){
 if(result.error||result.executed!=='true')return 0;
 const jaccard=(a,b)=>{const x=new Set(a),y=new Set(b),union=new Set([...x,...y]);return union.size?[...x].filter(v=>y.has(v)).length/union.size:1;};
 const fdKey=value=>{const fd=typeof value==='string'?JSON.parse(value):value;return JSON.stringify([[...new Set(fd.determinateAttributes.map(fold))].sort(),[...new Set(fd.dependentAttributes.map(fold))].sort()]);};
 const actual=result.legacy_metrics;
 return (Number(actual.result_lines)===Number(metrics.result_lines.value)?Number(metrics.result_lines.points):0)
  +jaccard(JSON.parse(actual.column_names).map(fold),JSON.parse(metrics.column_names.value).map(fold))*Number(metrics.column_names.points)
  +jaccard(JSON.parse(actual.functional_dependencies).map(fdKey),JSON.parse(metrics.functional_dependencies.value).map(fdKey))*Number(metrics.functional_dependencies.points);
}
async function* lines(file){for await(const line of readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity}))yield JSON.parse(line);}
const same=(a,b)=>!a.error&&!b.error&&a.relation_sha256===b.relation_sha256&&a.state_sha256===b.state_sha256;
async function login(page,account){
 await page.goto(base+'/login.php?client_id=default');
 if(await page.locator('input[type=password]').count()){
  await page.locator('input[name^="login_form/"][type=text]').fill(account.login);await page.locator('input[type=password]').fill(account.password);
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.getByRole('button',{name:/^(Login|Anmelden)$/}).click()]);
 }
}
async function ready(page){await page.waitForFunction(()=>window.editor_sequence_b&&window.EXECUTE_HANDLER&&!window.EXECUTE_HANDLER.running&&getComputedStyle(document.body).pointerEvents!=='none');}
async function identity(page,sequence,row){
 await ready(page);
 const actual=await page.evaluate(()=>{
  const source=[...document.scripts].map(s=>s.textContent).join('\n'),match=source.match(/"autosaveUrl"\s*:\s*("(?:\\.|[^"\\])*")/);
  const autosave=match?new URL(JSON.parse(match[1]),location.href):null;
  return{sequence:Number(new URL(location.href).searchParams.get('sequence')),form_sequence:Number(new URL(document.getElementById('taForm').action,location.href).searchParams.get('sequence')),
  autosave_sequence:autosave?Number(autosave.searchParams.get('sequence')):null,
  reference:QSSShadow.configuration().referenceSql,maxPoints:QSSShadow.configuration().maxPoints,engine:QSSShadow.configuration().engine,
  scale:QSSShadow.configuration().scale,questionText:QSSShadow.configuration().questionText,
  a:EXECUTE_HANDLER.getSequenceA(),c:EXECUTE_HANDLER.getSequenceC()};});
 assert.equal(actual.sequence,sequence);assert.equal(actual.form_sequence,sequence);
 assert.equal(actual.autosave_sequence,sequence);
 assert.equal(normalize(actual.reference),normalize(row.sequences[1]));assert.equal(actual.maxPoints,row.maximum_points);
 assert.equal(hash(actual.a),hash(normalize(row.sequences[0]).replace(/^\n/,'')));assert.equal(hash(actual.c),hash(normalize(row.sequences[2]).replace(/^\n/,'')));
 return actual;
}
async function runStudent(page,spec){
 await page.evaluate(sql=>{
  window.__variantProgress=[];const view=editor_sequence_b.codeMirrorView;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:sql}});
 },spec.sql);
 assert.equal(await page.locator('#sequence_b').inputValue(),spec.sql);
 const began=Date.now();await page.locator('#qpisql-execute-button').click();
 await page.waitForFunction(()=>!window.EXECUTE_HANDLER.running,null,{timeout:0});
 const result=await page.evaluate(async()=>{
  const value=n=>document.querySelector('[name="'+n+'"]')?.value;
  const relation=value('output_relation');
  const relationHash=relation?Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(JSON.parse(relation))))),n=>n.toString(16).padStart(2,'0')).join(''):null;
  return{qss:value('qss_evaluation')?JSON.parse(value('qss_evaluation')):null,error:value('error_bool')==='true'?JSON.parse(value('error')):null,
   executed:value('executed_bool'),output_relation_sha256:relationHash,progress:window.__variantProgress||[],feedback:document.getElementById('qpisql-qss-shadow')?.innerText,
   legacy_metrics:{result_lines:value('value_result_lines'),column_names:value('value_column_names'),functional_dependencies:value('value_functional_dependencies')},
   table_display:document.getElementById('qpisql-output-area-relation')?.style.display,
   next_disabled:document.querySelector('.ilTstNavigationBtn_Next button')?.disabled,
   workers_disposed:EXECUTE_HANDLER.activeRun===null&&EXECUTE_HANDLER.qss.worker===null};
 });
 result.wall_ms=Date.now()-began;
 return result;
}
function gradeFailures(q,spec,maximum,{checkBinding=true}={}){
 const failures=[];
 if(!q||!['exact','score-zero-certified'].includes(q.status))failures.push('QSS did not certify a grade');
 else{
  if(q.version!=='2.1.0'||q.rubric!=='paper-linear-v2')failures.push('Stale QSS model');
  if(checkBinding&&q.answerDigest!==hash(spec.sql))failures.push('Answer binding mismatch');
  if(spec.category==='correct'&&(q.points!==maximum||q.distance!==0))failures.push('Correct answer lost credit');
  if(spec.category==='minor'&&!(q.points>0&&q.points<maximum))failures.push('Local error lacks partial deduction');
  if(spec.category==='major'&&q.points!==0)failures.push('Unrelated answer received credit');
  if(q.status==='exact'&&q.edits.reduce((n,e)=>n+e.cost,0)!==q.distance)failures.push('Edit costs differ from distance');
 }
 return failures;
}
function assess(result,spec,maximum){
 const failures=gradeFailures(result.qss,spec,maximum);
 if(!result.progress.length||!result.progress.every(p=>p.resultHidden&&p.nextDisabled))failures.push('Progress/navigation gate failed');
 if(!result.workers_disposed)failures.push('Worker not disposed');
 if(result.next_disabled)failures.push('Navigation remained blocked');
 return failures;
}
async function main(){
 fs.mkdirSync(out,{recursive:true,mode:0o700});
 const accounts=JSON.parse(fs.readFileSync(process.env.ILIAS_CHROME_STATE||'/tmp/asssql-chrome-accounts.json','utf8'));
 const exam=JSON.parse(fs.readFileSync(path.join(directory,prefix+'exam-state.json'),'utf8'));
 const coverage=await examSourceCoverage(exam),browser=await chromium.connectOverCDP(process.env.CHROME_CDP_URL||'http://localhost:9261');
 const context=await browser.newContext({viewport:{width:1440,height:1050}});context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(60000);
 await context.addInitScript(()=>{
  const Native=window.Worker;window.__variantProgress=[];
  window.Worker=class extends Native{constructor(url,options){super(url,options);if(String(url).includes('/lib/qss/worker.qss.js'))this.addEventListener('message',event=>{
   if(event.data?.type==='progress')window.__variantProgress.push({phase:event.data.phase,visited:event.data.visited,frontier:event.data.frontier,lowerBound:event.data.lowerBound,resultHidden:document.getElementById('qpisql-output-area-relation')?.style.display==='none',nextDisabled:!document.querySelector('.ilTstNavigationBtn_Next button')||document.querySelector('.ilTstNavigationBtn_Next button').disabled});
  });}};
 });
 const page=await context.newPage(),oracle=await context.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 await oracle.route(base+'/__student_variant_oracle__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Student variant oracle</title>'}));
 await oracle.goto(base+'/__student_variant_oracle__');await installOracle(oracle,plugin);
 await login(page,accounts.student);await page.goto(exam.url);
 const launch=page.getByRole('link',{name:/^(Start Test|Resume Test|Start the Test|Continue Test)$/i});
 if(await launch.count())await launch.first().click();else{const button=page.getByRole('button',{name:/^(Start Test|Resume Test|Start the Test|Continue Test)$/i});if(await button.count())await button.first().click();}
 await ready(page);
 // An exploratory/manual abort can leave a native attempt a few pages ahead.
 // Return using the real Previous controls before a fresh frozen rerun.
 while(Number(new URL(page.url()).searchParams.get('sequence'))>start+1)
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('.ilTstNavigationBtn_Prev button').first().click()]);
 while(Number(new URL(page.url()).searchParams.get('sequence'))<start+1)
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('.ilTstNavigationBtn_Next button').first().click()]);
 const userAgent=await page.evaluate(()=>navigator.userAgent);assert.match(userAgent,/HeadlessChrome\//);
 const worker=await context.request.get(base+plugin+'/lib/qss/worker.qss.js');assert.ok(worker.ok());
 const runtime=await context.request.get(base+plugin+'/js/min.js.php');assert.ok(runtime.ok());
 const sqlWorker=await context.request.get(base+plugin+'/lib/sql.js/worker.sql.js');assert.ok(sqlWorker.ok());
 const report={browser:await browser.version(),user_agent:userAgent,headless:true,student_id:accounts.student.id,test_id:exam.test_id,
  qss_worker_sha256:hash(await worker.body()),runtime_sha256:hash(await runtime.body()),sql_worker_sha256:hash(await sqlWorker.body()),
  php_config_sha256:hash(fs.readFileSync(path.join(__dirname,'../../classes/internal/GUI/GUIElements/JsBlockArea/class.JsBlock.php'))),
  coverage,questions:0,cases:0,correct:0,minor:0,major:0,substantive_correct:0,
  failures:[],shortfalls:[],correct_families:{},finished:false,page_errors:pageErrors};
 const reportFile=path.join(out,prefix+'report.json'),recordsFile=path.join(out,prefix+'cases.jsonl');
 if(start){const prior=JSON.parse(fs.readFileSync(reportFile,'utf8'));assert.equal(prior.questions,start);for(const field of ['qss_worker_sha256','runtime_sha256','sql_worker_sha256','php_config_sha256'])assert.equal(prior[field],report[field]);Object.assign(report,prior);}
 const save=()=>fs.writeFileSync(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 const records=fs.createWriteStream(recordsFile,{flags:start?'a':'w',mode:0o600});
 const restoredRecords=fs.createWriteStream(path.join(out,prefix+'restored.jsonl'),{flags:start?'a':'w',mode:0o600});
 const plans=lines(path.join(out,'plans.jsonl'))[Symbol.asyncIterator]();for(let n=0;n<exam.source_start;n++)await plans.next();
 let index=0;
 try{
  for await(const row of lines(path.join(directory,prefix+'exam-runtime.jsonl'))){
   const {value:plan}=await plans.next();assert.equal(plan.key,row.key);index++;if(index<=start)continue;if(report.questions>=limit)break;
   const actual=await identity(page,index,row);console.log('QUESTION',row.original_source_ordinal,'native',row.question_id);
   const {selected,diagnostics,counts}=await selectVariants(oracle,plan,actual);
   if(counts.correct<4||counts.minor<3)report.shortfalls.push({ordinal:row.original_source_ordinal,key:row.key,counts});
   for(const spec of selected){
    console.log('CASE',row.original_source_ordinal,spec.category,spec.name);
    fs.writeFileSync(path.join(out,prefix+'active.json'),JSON.stringify({ordinal:row.original_source_ordinal,name:spec.name,category:spec.category,started:new Date().toISOString()}));
    const result=await runStudent(page,spec),failures=assess(result,spec,row.maximum_points);
    result.legacy_points=legacyPoints(result,row.metrics);
    const record={key:row.key,ordinal:row.original_source_ordinal,question_id:row.question_id,category:spec.category,name:spec.name,family:spec.family,proof:spec.proof,substantive:spec.substantive,
      answer_sha256:hash(spec.sql),answer:spec.sql,observed:spec.observed,catalog_proof:spec.catalogProof,result,failures,
      actual_native_identity:{sequence:actual.sequence,form_sequence:actual.form_sequence,autosave_sequence:actual.autosave_sequence,question_id:row.question_id}};
    records.write(JSON.stringify(record)+'\n');report.cases++;report[spec.category]++;
    if(spec.category==='correct'){if(spec.substantive)report.substantive_correct++;report.correct_families[spec.family]=(report.correct_families[spec.family]||0)+1;}
    if(failures.length)report.failures.push({ordinal:row.original_source_ordinal,name:spec.name,category:spec.category,failures,points:result.qss?.points,maximum:row.maximum_points,distance:result.qss?.distance});save();
   }
   fs.writeFileSync(path.join(out,prefix+'selection-'+row.original_source_ordinal+'.json'),JSON.stringify({key:row.key,counts,diagnostics},null,2),{mode:0o600});
   // Submit the complete correct answer through the native navigation flow.
   const restored=await runStudent(page,{sql:plan.correct[0].sql});assert.deepEqual(assess(restored,{sql:plan.correct[0].sql,category:'correct'},row.maximum_points),[]);
   restored.legacy_points=legacyPoints(restored,row.metrics);
   assert.equal(restored.legacy_points,row.maximum_points,'Original model retains its official metric score');
   assert.equal(restored.output_relation_sha256,hash(JSON.stringify(JSON.parse(plan.metadata.OUTPUT_RELATION))),'Original model output matches the unchanged source relation');
   restoredRecords.write(JSON.stringify({key:row.key,ordinal:row.original_source_ordinal,question_id:row.question_id,answer_sha256:hash(plan.correct[0].sql),result:restored})+'\n');
   if(index<Object.keys(exam.questions).length){await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('.ilTstNavigationBtn_Next button').first().click()]);}
   else{
    await page.getByRole('button',{name:/Finish.*Test/i}).first().click();const dialog=page.getByRole('dialog').filter({hasText:/Finish.*Test/i});await dialog.waitFor({state:'visible'});
    await dialog.getByRole('button',{name:/Finish|Submit|Confirm/i}).first().click();await page.waitForFunction(()=>document.body.innerText.includes('Overview of Test Attempts'));
    report.finished=true;report.result_rows=await page.locator('table').filter({hasText:'Point Score'}).locator('tbody tr').allTextContents();
   }
   report.questions++;report.coverage.completed_questions=report.questions;report.coverage.completed=report.finished&&report.questions===Object.keys(exam.questions).length;save();
   console.log('DONE',row.original_source_ordinal,'cases',report.cases,'failures',report.failures.length);
  }
  const finalWorker=await context.request.get(base+plugin+'/lib/qss/worker.qss.js');assert.equal(hash(await finalWorker.body()),report.qss_worker_sha256,'Worker stays frozen during a matrix segment');
  const finalRuntime=await context.request.get(base+plugin+'/js/min.js.php');assert.equal(hash(await finalRuntime.body()),report.runtime_sha256,'Runtime stays frozen during a matrix segment');
  assert.equal(hash(fs.readFileSync(path.join(__dirname,'../../classes/internal/GUI/GUIElements/JsBlockArea/class.JsBlock.php'))),report.php_config_sha256);
  assert.deepEqual(pageErrors,[]);report.frozen_build_verified=true;
  await page.screenshot({path:path.join(out,prefix+'final.png'),fullPage:true});save();
 }finally{await new Promise(resolve=>records.end(resolve));await new Promise(resolve=>restoredRecords.end(resolve));await context.close();}
 console.log(JSON.stringify({questions:report.questions,cases:report.cases,failures:report.failures.length,shortfalls:report.shortfalls.length,finished:report.finished}));
 if(report.failures.length)process.exitCode=1;
}
if(require.main===module)main().then(()=>process.exit(process.exitCode||0)).catch(e=>{console.error(e);process.exit(1);});
module.exports={assess,gradeFailures,same};
