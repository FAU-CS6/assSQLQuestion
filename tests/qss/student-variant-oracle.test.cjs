'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {installOracle,selectVariants}=require('../browser/student-variant-oracle.cjs');
async function fixture(failingWorker){
 const workers=[];
 class Worker{
  constructor(){this.index=workers.length;this.messages=[];workers.push(this);}
  terminate(){this.terminated=true;}
  postMessage(data){
   this.messages.push(data);
   queueMicrotask(()=>{
    if(this.index===failingWorker&&data.action==='open'){this.onerror?.({message:'anonymous worker loading failure',preventDefault(){}});return;}
    let result={id:data.id,results:[]};
    if(data.action==='open')result.ready=true;
    if(data.action==='export')result.buffer=new ArrayBuffer(8);
    if(data.sql?.startsWith('PRAGMA foreign_keys'))result.results=[{values:[[0]]}];
    if(data.sql==='invalid-anonymous-answer')result.error='anonymous SQLite syntax error';
    if(data.sql==='uncaught-sqlite-error'){this.onerror?.({message:'Uncaught Error: near "*": syntax error',preventDefault(){}});return;}
    this.onmessage?.({data:result});
   });
  }
 }
 const context={Worker,performance,crypto,TextEncoder,ArrayBuffer};context.window=context;vm.createContext(context);
 const page={evaluate:(fn,arg)=>vm.runInContext('('+fn.toString()+')',context)(arg)};
 await installOracle(page,'/anonymous-plugin');return{page,workers,oracle:context.studentVariantOracle};
}
test('oracle reports worker-open failure without sending a second request to the failed worker',async()=>{
 const f=await fixture(1);await f.oracle.prepare('','');const result=await f.oracle.run('anonymous answer');
 assert.equal(result.transport_error,true);assert.equal(result.phase,'open');assert.equal(f.workers[1].messages.length,1);
});
test('oracle preparation fails explicitly when its SQL worker cannot load',async()=>{
 const f=await fixture(0);await assert.rejects(f.oracle.prepare('',''),/Oracle opening: anonymous worker loading failure/);
 assert.equal(f.workers[0].messages.length,1);
});
test('worker failure aborts independent selection; an ordinary SQLite error remains an answer error',async()=>{
 const f=await fixture(1);
 await assert.rejects(selectVariants(f.page,{metadata:{SEQUENCE_B:'SELECT 1'},requirements:{freeLabelColumns:[]},correct:[{name:'model-answer',sql:'SELECT 1'}]}, {a:'',c:''}),/Independent Chrome SQL worker unavailable/);
 const valid=await fixture(-1);await valid.oracle.prepare('','');const result=await valid.oracle.run('invalid-anonymous-answer');
 assert.equal(result.phase,'B');assert.equal(result.transport_error,false);
 const uncaught=await valid.oracle.run('uncaught-sqlite-error');assert.equal(uncaught.phase,'B');assert.equal(uncaught.transport_error,false);
});
