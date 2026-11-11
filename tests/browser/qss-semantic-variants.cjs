/* Held-out anonymous answer matrix, entirely in isolated installed Chrome.
 * No corpus edits, scoring-based selection, execution deadlines or Node SQL. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require('playwright');
const {installOracle}=require('./student-variant-oracle.cjs');
const {cases,datasets}=require('../qss/semantic-answer-cases.cjs');
const costCatalog=require('../../lib/qss/cost-catalog.json');
const defaultCosts=Object.fromEntries(costCatalog.steps.map(step=>[step.id,step.defaultCost]));
const base=process.env.ILIAS_TEST_URL||'http://localhost:8080',plugin='/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion';
const out=process.env.QSS_SEMANTIC_OUTPUT;assert.ok(out,'Use a private output directory outside the repository.');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const same=(a,b)=>!a.error&&!b.error&&a.relation_sha256===b.relation_sha256&&a.state_sha256===b.state_sha256;
// This legacy SQLite worker omits column metadata for zero-row SELECT results.
// A successful empty result is not an SQL exception. Its column names remain
// unobserved; the separately declared transformation proof must preserve them.
const emptyResult=value=>value.phase==='result'&&value.error==='No visible result'
 ?{...value,error:null,empty_result:true,columns_observed:false,relation_sha256:digest('successful-empty-result-without-column-metadata')}:value;
async function main(){
 fs.mkdirSync(out,{recursive:true,mode:0o700});const browser=await chromium.connectOverCDP(process.env.CHROME_CDP_URL);
 const context=await browser.newContext();context.setDefaultTimeout(0);context.setDefaultNavigationTimeout(0);
 const report={headless:true,browser:await browser.version(),model_version:'2.1.1',cost_profile_version:costCatalog.version,configured_costs:Object.keys(defaultCosts).length,native_student_ui:false,cases:0,correct:0,wrong:0,failures:[],observations:[],finished:false};
 const variants=cases(),inputs=datasets(),witnesses=new Set(),times=[];let next=0;
 const jobs=variants.flatMap(spec=>inputs.map(data=>({spec,data})));const save=()=>fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});
 try{
  const response=await context.request.get(base+plugin+'/lib/qss/worker.qss.js');assert.ok(response.ok());report.worker_sha256=digest(await response.body());
  async function run(){
   const page=await context.newPage();await page.route(base+'/__semantic_variants__',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Anonymous semantic answers</title>'}));await page.goto(base+'/__semantic_variants__');assert.match(await page.evaluate(()=>navigator.userAgent),/HeadlessChrome/);await installOracle(page,plugin);
   while(next<jobs.length){
    const {spec,data}=jobs[next++];const failures=[];
    await page.evaluate(value=>window.__semanticCase=value,{id:spec.id,dataset:data.id,phase:'independent-sql'});
    const prepared=await page.evaluate(({setup,control})=>studentVariantOracle.prepare(setup,control,{ordered:true,observeState:true}),{setup:data.setup,control:spec.control});
    const reference=emptyResult(await page.evaluate(sql=>studentVariantOracle.run(sql),spec.reference)),answer=emptyResult(await page.evaluate(sql=>studentVariantOracle.run(sql),spec.answer));
    if(reference.error||answer.error)failures.push('Anonymous fixture SQL failed');
    const equal=same(reference,answer);if(!equal&&!reference.error&&!answer.error)witnesses.add(spec.id);
    if(spec.equivalent&&!equal)failures.push('Declared equivalence changed independent SQL behavior');
    const result=await page.evaluate(({request,plugin})=>new Promise(resolve=>{
     const began=performance.now(),worker=new Worker(plugin+'/lib/qss/worker.qss.js');window.__semanticCase.phase='qss';worker.onmessage=({data})=>{if(data.type==='progress'){window.__semanticCase.progress=data;return;}if(data.type!=='result')return;worker.terminate();resolve({qss:data.result,wall_ms:performance.now()-began});};worker.onerror=event=>{event.preventDefault();worker.terminate();resolve({qss:{status:'error'},wall_ms:performance.now()-began});};worker.postMessage({type:'evaluate',id:1,...request});
    }),{plugin,request:{reference:spec.reference,answer:spec.answer,schema:prepared.schema,maxPoints:5,costs:defaultCosts,referenceExecutionValid:!reference.error,answerExecutionValid:!answer.error}});
    const q=result.qss;if(!['exact','score-zero-certified'].includes(q.status))failures.push('Valid SQL did not receive a certified QSS result');
    if(q.version!==report.model_version)failures.push('Unexpected QSS model version');
    if(spec.equivalent&&(q.distance!==0||q.points!==5))failures.push('Correct alternative lost points');
    if(!spec.equivalent&&!(q.points<5))failures.push('Non-equivalent answer received full points');
    report.cases++;report[spec.equivalent?'correct':'wrong']++;times.push(result.wall_ms);
    const row={id:spec.id,family:spec.family,dataset:data.id,equivalent:spec.equivalent,proof:spec.proof,independent_equal:equal,
     empty_result:!!(reference.empty_result||answer.empty_result),columns_observed:reference.columns_observed!==false&&answer.columns_observed!==false,
     status:q.status,distance:q.distance,points:q.points,visited:q.visited,wall_ms:result.wall_ms,failures};
    report.observations.push(row);if(failures.length)report.failures.push(row);save();console.log(JSON.stringify({case:report.cases,id:spec.id,dataset:data.id,failures:failures.length}));
   }
   await page.evaluate(()=>studentVariantOracle.dispose());await page.close();
  }
  await Promise.all(Array.from({length:4},run));
  for(const spec of variants)if(!spec.equivalent&&!witnesses.has(spec.id))report.failures.push({id:spec.id,failures:['No independent SQL counterexample across the predeclared datasets']});
  const finalResponse=await context.request.get(base+plugin+'/lib/qss/worker.qss.js');assert.equal(digest(await finalResponse.body()),report.worker_sha256,'Worker changed during the matrix');
  times.sort((a,b)=>a-b);report.worker_ms={median:times[Math.floor(times.length/2)],p95:times[Math.ceil(times.length*.95)-1],maximum:times.at(-1)};
  report.families=[...new Set(variants.map(v=>v.family))];report.finished=report.cases===jobs.length;save();
 }finally{await context.close();}
 console.log(JSON.stringify({cases:report.cases,correct:report.correct,wrong:report.wrong,failures:report.failures.length,finished:report.finished,worker_ms:report.worker_ms}));
 assert.equal(report.finished,true);assert.deepEqual(report.failures,[]);
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1);});
