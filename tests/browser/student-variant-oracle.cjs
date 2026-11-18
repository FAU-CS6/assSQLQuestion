/* Independent observation of candidate answers in Chrome's SQLite worker.
 * This oracle never calls QSS and never treats a matching finite result as a
 * general proof of SQL equivalence. Correct candidates additionally need a
 * guarded transformation proof supplied by the answer-plan generator.
 */
'use strict';
const {nullDefaultCatalogOracle}=require('../qss/fixture-mutations.cjs');
const {tokens}=require('../qss/fixture-mutations.cjs');
function diagnosticTuple(sql){
 const all=tokens(sql).filter(t=>t.type!=='comment'&&t.value!==';');
 const at=all.findLastIndex(t=>t.upper==='SELECT');if(at<1||all[at-1]?.upper!=='UNION')return null;
 const values=[];let i=at+1;
 while(i<all.length){
  let sign=1;if(['-','+'].includes(all[i]?.value)){sign=all[i].value==='-'?-1:1;i++;}
  const token=all[i++];if(!token)return null;
  if(token.type==='number'&&Number.isSafeInteger(Number(token.value)*sign))values.push(Number(token.value)*sign);
  else if(sign===1&&token.type==='string')values.push(token.value.slice(1,-1).replaceAll("''","'"));
  else if(sign===1&&token.upper==='NULL')values.push(null);else return null;
  if(i===all.length)return values;if(all[i++]?.value!==',')return null;
 }return null;
}
const same=(a,b)=>!a.error&&!b.error&&a.relation_sha256===b.relation_sha256&&a.state_sha256===b.state_sha256;
async function installOracle(page,plugin){
 await page.evaluate(({plugin})=>{
  const canonical=JSON.stringify;
  const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(value)))),n=>n.toString(16).padStart(2,'0')).join('');
  const identifier=s=>'"'+String(s).replaceAll('"','""')+'"';
  const literal=s=>"'"+String(s).replaceAll("'","''")+"'";
  const fold=s=>String(s).replace(/[A-Z]/g,c=>c.toLowerCase());
  let worker=null,pending=null,serial=0,prepared=null,transportFailure=null;
  function failTransport(message){
   transportFailure=String(message||'The independent SQL worker failed.');
   if(pending){const job=pending;pending=null;job.resolve({error:transportFailure,transport_error:true});}
  }
  function fresh(){
   if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();}
   transportFailure=null;worker=new Worker(plugin+'/lib/sql.js/worker.sql.js');
   worker.onmessage=event=>{if(!pending||pending.id!==event.data.id)return;const job=pending;pending=null;job.resolve(event.data);};
   worker.onerror=event=>{
    event.preventDefault();
    // The legacy SQL worker reports SQLite db.exec exceptions as Worker error
    // events. A loaded worker's SQL failure is an answer/runtime error; failure
    // to open/load the worker is an infrastructure failure.
    if(pending?.action==='exec'){const job=pending;pending=null;job.resolve({error:String(event.message||'SQL execution failed')});}
    else failTransport(event.message);
   };
  }
  function call(data){
   if(transportFailure)return Promise.resolve({error:transportFailure,transport_error:true});
   return new Promise(resolve=>{if(pending)throw new Error('Concurrent oracle request');const id=++serial;pending={id,resolve,action:data.action};
    try{worker.postMessage({...data,id});}catch(error){failTransport(error.message);}
   });
  }
  const exec=sql=>sql.trim()?call({action:'exec',sql}):Promise.resolve({results:[]});
  const last=response=>response.results?.at(-1)||null;
  const rows=async sql=>{const value=await exec(sql);if(value.error)throw new Error(value.error);return last(value)?.values||[];};
  async function state(){
   const tables=[];
   for(const [name,type]of await rows("SELECT name,type FROM sqlite_master WHERE type IN('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")){
    let info;try{info=await rows('PRAGMA table_info('+identifier(name)+')');}
    catch(error){tables.push({name,type,catalog_error:String(error.message)});continue;}
    // Only the lexical spelling of a closed literal default is normalized.
    for(const column of info)if(typeof column[4]==='string'&&/^\s*\(?\s*(?:NULL|[+-]?\d+(?:\.\d+)?|'(?:[^']|'')*')\s*\)?\s*$/i.test(column[4])){
     const value=await rows('SELECT typeof(('+column[4]+')),quote(('+column[4]+'))');column[4]={literal:value[0]};
    }
    const fks=await rows('PRAGMA foreign_key_list('+identifier(name)+')');
    const groups=new Map();for(const fk of fks){const [id,...content]=fk;if(!groups.has(id))groups.set(id,[]);groups.get(id).push(content);}
    const foreignKeys=[...groups.values()].map(v=>v.sort((a,b)=>a[0]-b[0])).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
    const indexes=[];for(const index of await rows('PRAGMA index_list('+identifier(name)+')')){
     const columns=await rows('PRAGMA index_info('+identifier(index[1])+')');indexes.push({unique:index[2],origin:index[3],partial:index[4],columns});
    }
    indexes.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
    const values=type==='table'?(await rows('SELECT * FROM '+identifier(name))).map(canonical).sort():[];
    tables.push({name,type,info,foreignKeys,indexes,values});
   }
   return digest(tables);
  }
  window.studentVariantOracle={
   async prepare(a,c,{ordered=false,observeState=false,freeLabels=[]}={}){
    fresh();const opened=await call({action:'open'});if(opened.error)throw new Error('Oracle opening: '+opened.error);
    const result=await exec(a);if(result.error)throw new Error('Sequence A: '+result.error);
    const fk=(await rows('PRAGMA foreign_keys'))[0]?.[0]||0;
    const snapshot=await call({action:'export'});if(!snapshot.buffer)throw new Error('No SQLite snapshot');
    const tables=[];for(const [name,type]of await rows("SELECT name,type FROM sqlite_master WHERE type IN('table','view') AND name NOT LIKE 'sqlite_%'")){
     const info=await rows('PRAGMA table_info('+identifier(name)+')');tables.push({name,type,columns:info.map(v=>({name:v[1],type:v[2],notnull:!!v[3],pk:Number(v[5])}))});
    }
    prepared={buffer:snapshot.buffer,fk,c,ordered,observeState,freeLabels};return{schema:{tables}};
   },
   async run(b,options={}){
    if(!prepared)throw new Error('Oracle preparation missing');const began=performance.now();
    window.__oracleState={answer:b,phase:'open'};
    fresh();const opened=await call({action:'open',buffer:prepared.buffer});
    if(opened.error)return{error:opened.error,transport_error:true,phase:'open',ms:performance.now()-began};
    const fk=await exec('PRAGMA foreign_keys='+(prepared.fk?1:0));
    if(fk.error)return{error:fk.error,transport_error:true,phase:'setup',ms:performance.now()-began};
    window.__oracleState.phase='B';const br=await exec(b);if(br.error)return{error:br.error,transport_error:!!br.transport_error,phase:'B',ms:performance.now()-began};
    const stateHash=prepared.observeState?await state():null;
    window.__oracleState.phase='C';const cr=await exec(prepared.c);if(cr.error)return{error:cr.error,transport_error:!!cr.transport_error,phase:'C',state_sha256:stateHash,ms:performance.now()-began};
    const result=last(cr)||last(br);
    if(!result)return{error:'No visible result',phase:'result',state_sha256:stateHash,ms:performance.now()-began};
    const values=result.values.map(canonical);if(!prepared.ordered)values.sort();
    const labelIndexes=result.columns.map((name,i)=>prepared.freeLabels.includes(fold(name))?i:-1).filter(i=>i>=0);
    let taskRows=result.values,diagnosticRemoved=false;
    if(options.diagnosticTuple){const at=taskRows.findIndex(row=>canonical(row)===canonical(options.diagnosticTuple));if(at>=0){taskRows=taskRows.filter((row,i)=>i!==at);diagnosticRemoved=true;}}
    const taskValues=taskRows.map(row=>canonical(row.filter((v,i)=>!labelIndexes.includes(i))));if(!prepared.ordered)taskValues.sort();
    return{relation_sha256:await digest({columns:result.columns.map(fold),values}),
      task_relation_sha256:await digest({columns:result.columns.map(fold),values:taskValues}),
      diagnostic_removed:diagnosticRemoved,
      state_sha256:stateHash,columns:result.columns,rows:result.values.length,ms:performance.now()-began};
   },
   dispose(){worker?.terminate();worker=null;prepared=null;}
  };
 },{plugin});
}
async function selectVariants(oracle,plan,actual){
   const sameTask=(a,b)=>!a.error&&!b.error&&a.state_sha256===b.state_sha256
       &&(!plan.requirements.freeDiagnosticTuple||a.rows===b.rows&&a.diagnostic_removed&&b.diagnostic_removed)
       &&(plan.requirements.freeLabelColumns.length?a.task_relation_sha256===b.task_relation_sha256:a.relation_sha256===b.relation_sha256);
   const observe=async sql=>{
    const result=await oracle.evaluate(({b,options})=>studentVariantOracle.run(b,options),{b:sql,options:{diagnosticTuple:plan.requirements.freeDiagnosticTuple?diagnosticTuple(sql):null}});
    if(result.transport_error)throw new Error('Independent Chrome SQL worker unavailable: '+result.error);
    return result;
   };
   const stripped=plan.metadata.SEQUENCE_B.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g,'').trim();
   await oracle.evaluate(({a,c,options})=>studentVariantOracle.prepare(a,c,options),{a:actual.a,c:actual.c,options:{ordered:/\bORDER\s+BY\b/i.test(stripped),observeState:! /^(SELECT|WITH|EXPLAIN)\b/i.test(stripped),freeLabels:plan.requirements.freeLabelColumns}});
   const reference=await observe(plan.correct[0].sql);if(reference.error)throw new Error('Reference must execute: '+reference.error);
   const selected=[],diagnostics=[],counts={correct:0,minor:0,major:0},families=new Set();
   for(const spec of plan.correct){
    if(counts.correct>=4)break;
    const observed=spec.name==='model-answer'?reference:await observe(spec.sql);
    let equivalent=sameTask(reference,observed),catalogProof=null;
    if(!equivalent&&!observed.error&&reference.state_sha256&&reference.state_sha256===observed.state_sha256){
     const control=nullDefaultCatalogOracle(actual.c);
     if(control){
      await oracle.evaluate(({a,c,options})=>studentVariantOracle.prepare(a,c,options),{a:actual.a,c:control.sql,options:{ordered:/\bORDER\s+BY\b/i.test(stripped),observeState:true}});
      const x=await oracle.evaluate(b=>studentVariantOracle.run(b),plan.correct[0].sql),y=await oracle.evaluate(b=>studentVariantOracle.run(b),spec.sql);
      if(x.transport_error||y.transport_error)throw new Error('Independent Chrome catalog worker unavailable');
      catalogProof=same(x,y)&&same(reference,x);equivalent=catalogProof;
      await oracle.evaluate(({a,c,options})=>studentVariantOracle.prepare(a,c,options),{a:actual.a,c:actual.c,options:{ordered:/\bORDER\s+BY\b/i.test(stripped),observeState:true}});
     }
    }
    if(equivalent){selected.push({...spec,category:'correct',observed,catalogProof});counts.correct++;families.add(spec.family);}
    else diagnostics.push({name:spec.name,category:'correct',reason:'Candidate changed independently observed behavior',observed});
   }
   // Execution exposes local errors independently of the metric under test.
   // Never inspect QSS points while choosing a test case.
   // Prefer distinct error families before trying additional members of an
   // already witnessed family. The selection uses only the independent SQL
   // observations, never QSS points. Do not execute six redundant candidates
   // just to choose three; some valid SQLite projection rewrites have very
   // different query plans on the original data.
   const minorFamilies=new Set(),tested=new Set();
   for(const distinct of [true,false])for(const spec of plan.minor){
    if(counts.minor>=3)break;
    if(tested.has(spec.name)||distinct&&minorFamilies.has(spec.family))continue;
    tested.add(spec.name);const observed=await observe(spec.sql);
    if(observed.phase==='B'||sameTask(reference,observed)){diagnostics.push({name:spec.name,category:'minor',reason:observed.phase==='B'?'Invalid B candidate':'No observed counterexample',observed});continue;}
    selected.push({...spec,category:'minor',observed});counts.minor++;minorFamilies.add(spec.family);
   }
   const majors=[...plan.major.filter(s=>s.preferred),...plan.major.filter(s=>!s.preferred)];
   for(const spec of majors){if(counts.major>=3)break;const observed=await observe(spec.sql);selected.push({...spec,category:'major',observed});counts.major++;}

 return{selected,diagnostics,counts,reference};
}
module.exports={installOracle,selectVariants};
