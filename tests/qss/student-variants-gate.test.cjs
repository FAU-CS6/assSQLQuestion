'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {checkCase}=require('./verify-student-variants.cjs');
const digest=crypto.createHash('sha256').update('SELECT 1').digest('hex');
const expected={maximum:2,answer_sha256:digest};
const fixture=()=>({answer:'SELECT 1',answer_sha256:digest,category:'correct',proof:'anonymous-gate-fixture',failures:[],result:{
 error:null,workers_disposed:true,next_disabled:false,progress:[{resultHidden:true,nextDisabled:true}],
 qss:{engine:'graph-qss-sqlite-v2',version:require('../../lib/qss/cost-catalog.json').modelVersion,modelVersion:require('../../lib/qss/cost-catalog.json').modelVersion,rubric:'paper-linear-v2',provisionalRubric:true,scale:.4,maxPoints:2,points:2,
  answerDigest:digest,referenceRevision:'a'.repeat(64),formula:'max(maxPoints - distance * scale, 0)',scoreCertifiedWithinModel:true,status:'exact',
  exactWithinModel:true,distance:0,edits:[],editsTruncated:false}}});
test('native matrix gate accepts its anonymous sidecar fixture and restored digest without SQL execution',()=>{
 checkCase(fixture(),expected);const restored=fixture();delete restored.answer;checkCase(restored,expected);
});
test('last native question may omit Next when the finished-attempt gate is required',()=>{
 const record=fixture();delete record.result.next_disabled;checkCase(record,{...expected,isFinalQuestion:true});
});
test('missing Next is rejected before the last native question',()=>{
 const record=fixture();delete record.result.next_disabled;assert.throws(()=>checkCase(record,expected));
});
test('a present but blocked Next is rejected even on the last native question',()=>{
 const record=fixture();record.result.next_disabled=true;assert.throws(()=>checkCase(record,{...expected,isFinalQuestion:true}));
});
test('phase measurements are mandatory for the new latency matrix',()=>{
 assert.throws(()=>checkCase(fixture(),{...expected,requirePhaseTimings:true}));
});
test('finite independent phase measurements pass without changing the certified grade',()=>{
 const record=fixture();record.result.timings={sql_pipeline_ms:200,qss_ms:30,official_metrics_ms:0,browser_total_ms:250};
 checkCase(record,{...expected,requirePhaseTimings:true});
});
for(const [name,mutate]of[
 ['stale model',r=>{r.result.qss.version='2.0.1';}],
 ['wrong answer binding',r=>{r.result.qss.answerDigest='0'.repeat(64);}],
 ['missing navigation barrier',r=>{r.result.progress[0].nextDisabled=false;}],
 ['incorrect full-credit claim',r=>{r.result.qss.points=1.6;}],
 ['unrelated answer awarded credit',r=>{r.category='major';}],
 ['SQL runtime failure labelled correct',r=>{r.result.error={message:'fixture failure'};}],
 ['truncated edit evidence',r=>{r.result.qss.editsTruncated=true;}]
])test('native matrix gate rejects '+name,()=>{const record=fixture();mutate(record);assert.throws(()=>checkCase(record,expected));});
