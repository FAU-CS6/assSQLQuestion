/* Chrome-only development preflight. This is deliberately separate from the
 * native student acceptance: it cannot claim native UI, autosave or submission.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {installOracle,selectVariants}=require('./student-variant-oracle.cjs');
const {gradeFailures}=require('./student-variants.cjs');
const base=process.env.ILIAS_TEST_URL||'http://localhost:8080',plugin='/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion';
const out=process.env.STUDENT_VARIANTS_DIRECTORY||'/tmp/asssql-student-variants';
const start=Number(process.env.STUDENT_VARIANTS_START||0),count=Number(process.env.STUDENT_VARIANTS_LIMIT||699),name=process.env.STUDENT_VARIANTS_NAME||String(start);
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
async function main(){
 const browser=await chromium.connectOverCDP(process.env.CHROME_CDP_URL||'http://localhost:9261'),context=await browser.newContext(),page=await context.newPage();
 await page.route(base+'/__student_variant_preflight__',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Chrome development preflight</title>'}));
 await page.goto(base+'/__student_variant_preflight__');assert.match(await page.evaluate(()=>navigator.userAgent),/HeadlessChrome\//);
 await installOracle(page,plugin);
 const response=await context.request.get(base+plugin+'/lib/qss/worker.qss.js');assert.ok(response.ok());
 const report={kind:'chrome-development-preflight',native_student_ui:false,start,count,questions:0,cases:0,correct:0,minor:0,major:0,substantive_correct:0,
  worker_sha256:hash(await response.body()),browser:await browser.version(),failures:[],shortfalls:[],families:{},finished:false};
 const file=path.join(out,'preflight-'+name+'-report.json'),save=()=>fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 const records=fs.createWriteStream(path.join(out,'preflight-'+name+'-cases.jsonl'),{mode:0o600});
 await page.evaluate(plugin=>{
  let worker=new Worker(plugin+'/lib/qss/worker.qss.js'),id=0,pending;
  worker.onmessage=event=>{if(!pending||pending.id!==event.data.id)return;if(event.data.type==='progress'){window.__preflight.progress=event.data;return;}const job=pending;pending=null;job.resolve(event.data.result);};
  worker.onerror=event=>{event.preventDefault();if(pending){const job=pending;pending=null;job.resolve({status:'error',message:event.message});}};
  window.preflightGrade=request=>new Promise(resolve=>{const job=++id;pending={id:job,resolve};worker.postMessage({...request,type:'evaluate',id:job});});
  window.stopPreflight=()=>worker.terminate();
 },plugin);
 try{
  for await(const line of readline.createInterface({input:fs.createReadStream(path.join(out,'plans.jsonl')),crlfDelay:Infinity})){
   const plan=JSON.parse(line);if(plan.ordinal<=start)continue;if(report.questions>=count)break;
   console.log('SELECT',plan.ordinal);await page.evaluate(ordinal=>window.__preflight={ordinal,stage:'oracle'},plan.ordinal);
   const actual={a:plan.metadata.SEQUENCE_A.replace(/\r\n?/g,'\n').replace(/^\n/,''),c:plan.metadata.SEQUENCE_C.replace(/\r\n?/g,'\n').replace(/^\n/,'')};
   const {selected,diagnostics,counts,reference}=await selectVariants(page,plan,actual);
   const prepared=await page.evaluate(({a,c})=>studentVariantOracle.prepare(a,c),actual);
   const metrics=JSON.parse(plan.metadata.SOLUTION_METRICS).map(v=>typeof v==='string'?JSON.parse(v):v),maximum=metrics.reduce((n,v)=>n+Number(v.points),0);
   if(counts.correct<4||counts.minor<3)report.shortfalls.push({ordinal:plan.ordinal,counts});
   for(const spec of selected){
    console.log('GRADE',plan.ordinal,spec.category,spec.name);await page.evaluate(({ordinal,name})=>window.__preflight={ordinal,name,stage:'QSS'}, {ordinal:plan.ordinal,name:spec.name});
    const began=Date.now(),qss=await page.evaluate(request=>preflightGrade(request),{reference:plan.correct[0].sql,answer:spec.sql,maxPoints:maximum,questionText:plan.question,schema:prepared.schema,
      referenceExecutionValid:true,answerExecutionValid:!spec.observed.error,referenceRows:reference.rows,answerRows:spec.observed.error?null:spec.observed.rows});
    const failures=gradeFailures(qss,spec,maximum,{checkBinding:false});
    records.write(JSON.stringify({ordinal:plan.ordinal,key:plan.key,category:spec.category,name:spec.name,family:spec.family,substantive:spec.substantive,proof:spec.proof,answer:spec.sql,
      answer_sha256:hash(spec.sql),observed:spec.observed,qss,wall_ms:Date.now()-began,failures})+'\n');
    report.cases++;report[spec.category]++;if(spec.substantive&&spec.category==='correct')report.substantive_correct++;
    if(spec.category==='correct')report.families[spec.family]=(report.families[spec.family]||0)+1;
    if(failures.length)report.failures.push({ordinal:plan.ordinal,name:spec.name,category:spec.category,failures,points:qss.points,maximum,distance:qss.distance,status:qss.status,message:qss.message});save();
   }
   fs.writeFileSync(path.join(out,'preflight-'+name+'-selection-'+plan.ordinal+'.json'),JSON.stringify({key:plan.key,counts,diagnostics},null,2),{mode:0o600});
   report.questions++;save();console.log('DONE',plan.ordinal,'failures',report.failures.length);
  }
  report.finished=report.questions===count;const final=await context.request.get(base+plugin+'/lib/qss/worker.qss.js');assert.equal(hash(await final.body()),report.worker_sha256,'Frozen preflight worker');save();
 }finally{await new Promise(resolve=>records.end(resolve));await context.close();}
 console.log(JSON.stringify({questions:report.questions,cases:report.cases,failures:report.failures.length,finished:report.finished}));
}
main().then(()=>process.exit()).catch(e=>{console.error(e);process.exit(1);});
