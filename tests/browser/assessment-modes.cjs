/* Native author/student acceptance of exclusive result or QSS assessment. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const {chromium}=require('playwright');
const base=process.env.ILIAS_TEST_URL||'http://localhost:8080';
const state=JSON.parse(fs.readFileSync(process.env.ILIAS_ASSESSMENT_STATE||'/tmp/asssql-assessment-fixture.json','utf8'));
const accounts=JSON.parse(fs.readFileSync(process.env.ILIAS_CHROME_ACCOUNTS||'/tmp/asssql-chrome-accounts.json','utf8'));
const phase=process.env.ILIAS_ASSESSMENT_PHASE||'author';
const out=process.env.ILIAS_TEST_ARTIFACTS||path.join(require('node:os').tmpdir(),'asssql-assessment');
const ready=page=>page.waitForFunction(()=>window.editor_sequence_b?.codeMirrorView?.dom.isConnected&&window.EXECUTE_HANDLER&&!EXECUTE_HANDLER.running&&getComputedStyle(document.body).pointerEvents!=='none');
async function identity(page,expected){
 await ready(page);
 const actual=await page.evaluate(()=>({url:Number(new URL(location.href).searchParams.get('sequence')),
  form:Number(new URL(document.getElementById('taForm').action,location.href).searchParams.get('sequence'))}));
 assert.deepEqual(actual,{url:expected,form:expected},'Every answer must execute on its declared native question.');
}
async function login(page,account){
 await page.goto(base+'/login.php?client_id=default');
 if(await page.locator('input[type=password]').count()){
  await page.locator('input[name^="login_form/"][type=text]').fill(account.login);
  await page.locator('input[type=password]').fill(account.password);
  await page.getByRole('button',{name:'Login',exact:true}).click();
 }
}
async function instrument(page){
 await page.evaluate(()=>{
  window.__assessmentWorkers=[];window.__assessmentMetrics=0;
  const Native=window.Worker;window.Worker=class extends Native{constructor(url,options){super(url,options);__assessmentWorkers.push(String(url));}};
  const original=SQLResult.prototype.getAllMinimalFunctionalDependenciesAsJSON;
  SQLResult.prototype.getAllMinimalFunctionalDependenciesAsJSON=function(...args){__assessmentMetrics++;return original.apply(this,args);};
 });
}
async function execute(page,sql){
 if(sql!==undefined)await page.evaluate(value=>{const view=editor_sequence_b.codeMirrorView;view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});},sql);
 await page.locator('#qpisql-execute-button').click();await ready(page);
 return page.evaluate(()=>({mode:EXECUTE_HANDLER.assessmentMode,qss:EXECUTE_HANDLER.qss?.result||null,
  qssWorkers:__assessmentWorkers.filter(url=>new URL(url,location.href).pathname.endsWith('/worker.qss.js')).length,metricCalls:__assessmentMetrics,
  output:document.getElementById('qpisql-output-relation').value}));
}
async function main(){
 fs.mkdirSync(out,{recursive:true,mode:0o700});
 const browser=await chromium.connectOverCDP(process.env.CHROME_CDP_URL||'http://localhost:9291');
 const context=await browser.newContext();context.setDefaultTimeout(0);context.setDefaultNavigationTimeout(0);
 const page=await context.newPage(),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('framenavigated',frame=>{if(frame===page.mainFrame()){const url=new URL(frame.url());console.log('Native page',url.pathname,url.searchParams.get('cmd')||'',url.searchParams.get('sequence')||'');}});
 try{
  await login(page,phase==='student'?accounts.student:accounts.teacher);
  console.log('Signed in for',phase,'acceptance');
  assert.match(await page.evaluate(()=>navigator.userAgent),/HeadlessChrome/);
  if(phase==='author'){
   for(let i=0;i<state.edit_urls.length;i++){
    await page.goto(new URL(state.edit_urls[i],base).href);await ready(page);await instrument(page);
    assert.equal(await page.locator('[name=assessment_mode]').inputValue(),'result');
    if(i){
     await page.locator('[name=assessment_mode]').selectOption('qss');
     assert.equal(await page.locator('[data-qss-cost]').count(),require('../../lib/qss/cost-catalog.json').steps.length);
     await page.locator('[name=qss_maximum_points]').fill('10');await page.locator('[name=qss_maximum_points]').dispatchEvent('change');
     const input=page.locator('[data-qss-cost=negateComplementaryComparison]');
     await input.evaluate(element=>{element.closest('details').open=true;});
     await input.fill('7');await input.dispatchEvent('change');
     await page.locator('#qpisql-costs-reset').click();assert.equal(await input.inputValue(),'0');
     if(i===2){await input.fill('2');await input.dispatchEvent('change');}
    }
    const result=await execute(page);
    if(i){assert.equal(result.qss.points,10);assert.equal(result.qssWorkers,1);assert.equal(result.metricCalls,0);}
    else{assert.equal(result.qss,null);assert.equal(result.qssWorkers,0);assert.ok(result.metricCalls>0);}
    await page.getByRole('button',{name:'Save',exact:true}).first().click();
    await page.goto(new URL(state.edit_urls[i],base).href);await ready(page);
    assert.equal(await page.locator('[name=assessment_mode]').inputValue(),i?'qss':'result','Native Save must persist mode.');
    if(i){assert.equal(await page.locator('[name=qss_maximum_points]').inputValue(),'10');assert.equal(await page.locator('[data-qss-cost=negateComplementaryComparison]').inputValue(),i===2?'2':'0');}
    checks.push({question:i+1,mode:i?'qss':'result',saved:true,inactive_scorer_skipped:true});
   }
  }else if(phase==='transfer'){
   let archive;
   for(let attempt=0;attempt<3&&!archive;attempt++){
    await page.goto(base+'/goto.php/qpl/'+state.pool_ref_id);await page.getByRole('link',{name:'Export',exact:true}).click();
    const names=()=>page.locator('table tbody tr').evaluateAll(rows=>rows.flatMap(row=>row.innerText.match(/\d+__\d+__qpl_\d+\.zip/g)||[]));
    const before=new Set(await names());await new Promise(resolve=>setTimeout(resolve,1100-Date.now()%1000));
    const create=page.getByRole('button',{name:/Create.*Export|Create Export File|Exportieren/i}).first();
    if(await create.count())await create.click();else await page.getByRole('button',{name:/Export.*XML|XML.*Export/i}).first().click();
    await page.getByRole('button',{name:'Actions',exact:true}).first().waitFor({timeout:0});
    const fresh=(await names()).filter(name=>!before.has(name));assert.ok(fresh.length);
    const row=page.locator('table tbody tr').filter({hasText:fresh[0]});await row.getByRole('button',{name:'Actions',exact:true}).click();
    const[file]=await Promise.all([page.waitForEvent('download',{timeout:0}),page.getByRole('button',{name:'Download',exact:true}).filter({visible:true}).first().click()]);
    const filename=path.join(out,file.suggestedFilename());await file.saveAs(filename);fs.chmodSync(filename,0o600);
    const code="import json,sys,zipfile,xml.etree.ElementTree as E\nwith zipfile.ZipFile(sys.argv[1]) as z:\n items=[e for n in z.namelist() if '_qti_' in n.lower() and n.endswith('.xml') for e in E.fromstring(z.read(n)).iter() if e.tag.rsplit('}',1)[-1]=='item']\n print(json.dumps([dict((f.findtext('fieldlabel'),f.findtext('fieldentry')) for f in i.iter('qtimetadatafield')) for i in items]))";
    const items=JSON.parse(execFileSync('python3',['-c',code,filename],{encoding:'utf8'}));
    if(items.length!==3)continue;
    assert.deepEqual(items.map(item=>item.ASSESSMENT_MODE).sort(),['qss','qss','result']);
    const profiles=items.filter(item=>item.ASSESSMENT_MODE==='qss').map(item=>JSON.parse(item.QSS_COSTS).costs.negateComplementaryComparison).sort();
    assert.deepEqual(profiles,[0,2]);archive=filename;
   }
   assert.ok(archive,'Native export must contain all three configured questions.');
   await page.goto(`${base}/ilias.php?baseClass=ilrepositorygui&cmd=create&ref_id=${accounts.category_ref_id}&new_type=qpl`);
   await page.getByRole('textbox',{name:'Title',exact:false}).fill('SQL assessment settings reimport');
   await page.getByRole('button',{name:'Add Question Pool for Tests',exact:true}).click();
   await page.getByRole('button',{name:'Create Question',exact:true}).waitFor();
   const ref=Number(new URL(page.url()).searchParams.get('ref_id'));
   await page.getByRole('button',{name:'Import',exact:true}).click();await page.locator('input[type=file]').setInputFiles(archive);
   await Promise.all([page.waitForURL(url=>url.searchParams.get('fallbackCmd')==='uploadQuestionsImport',{timeout:0}),page.getByRole('button',{name:'Import',exact:true}).last().click()]);
   const choices=page.locator('input[type=checkbox][name^="form/"]');assert.equal(await choices.count(),3);
   for(const choice of await choices.all())if(!await choice.isChecked())await choice.check();
   await page.getByRole('button',{name:'Import',exact:true}).click();await page.getByRole('button',{name:'Create Question',exact:true}).waitFor();
   assert.match(await page.locator('body').innerText(),/Number of Questions\s+3/);
   checks.push({source_pool_ref_id:state.pool_ref_id,reimport_pool_ref_id:ref,questions:3,
    archive_sha256:crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),mode_and_cost_fields_verified:true});
  }else{
   await page.goto(state.url);
   for(let step=0;step<4&&!await page.locator('#sequence_b').count();step++){
    const name=/^(Start Test|Resume Test|Start the Test|Continue Test)$/i;
    const button=page.getByRole('button',{name}),link=page.getByRole('link',{name});
    if(await button.count())await button.first().click();else{assert.ok(await link.count(),'Expected native test start action');await link.first().click();}
    await page.waitForFunction(()=>document.querySelector('#sequence_b')||[...document.querySelectorAll('a,button')].some(element=>/^(Start Test|Resume Test|Start the Test|Continue Test)$/i.test(element.textContent.trim())));
    console.log('Native start step',step+1);
   }
   const answers=['SELECT 99 AS value FROM sample ORDER BY id','SELECT value FROM sample WHERE id>1 ORDER BY id','SELECT value FROM sample WHERE NOT(id<=0) ORDER BY id'];
   for(let i=0;i<answers.length;i++){
    console.log('Checking native question',i+1);
    await identity(page,i+1);await instrument(page);const result=await execute(page,answers[i]);
    if(i){assert.equal(result.qss.points,i===1?8:6);assert.equal(result.qssWorkers,1);assert.equal(result.metricCalls,0);assert.equal(await page.locator('[name=value_result_lines]').count(),0);}
    else{assert.equal(result.qss,null);assert.equal(result.qssWorkers,0);assert.ok(result.metricCalls>0);}
    checks.push({question:i+1,mode:result.mode,points:result.qss?.points??10,inactive_scorer_skipped:true});
    console.log('Completed native question',i+1,'with expected selected score');
    if(i<answers.length-1){
     for(let attempt=0;attempt<2;attempt++){
      await ready(page);
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded'}),page.locator('.ilTstNavigationBtn_Next button').first().click()]);
      await ready(page);
      const sequence=Number(new URL(page.url()).searchParams.get('sequence'));
      if(sequence===i+2)break;
      assert.equal(sequence,i+1,'Native navigation must not skip a question.');
      console.log('Native Next stayed on the current question; repeating only that UI action');
     }
     await identity(page,i+2);
    }
   }
   console.log('Opening native finish confirmation');
   await page.getByRole('button',{name:/Finish.*Test/i}).first().click();
   const dialog=page.getByRole('dialog').filter({hasText:/Finish.*Test/i});await dialog.waitFor({state:'visible'});
   console.log('Confirming native test finish');
   await dialog.getByRole('button',{name:/Finish|Submit|Confirm/i}).first().click();
   await page.waitForFunction(()=>document.body.innerText.includes('Overview of Test Attempts'));
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,phase+'-report.json'),JSON.stringify({phase,checks,page_errors:errors,headless:true,passed:true},null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify({phase,questions:checks.length,passed:true}));
 }catch(error){
  fs.writeFileSync(path.join(out,phase+'-failure-state.json'),JSON.stringify(await page.evaluate(()=>({title:document.title,text:document.body.innerText})),null,2),{mode:0o600});
  throw error;
 }finally{await context.close();}
}
main().then(()=>process.exit(0)).catch(error=>{console.error(error.message);process.exit(1);});
