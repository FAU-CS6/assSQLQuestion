/* Stream private originals into a private, reproducible student-answer plan. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline'),crypto=require('node:crypto');
const {candidates}=require('./student-variants.cjs');
async function main(){
 const directory=path.resolve(process.env.ILIAS_CORPUS_DIRECTORY||'/corpus');
 const output=path.resolve(process.env.STUDENT_VARIANTS_DIRECTORY||path.join(require('node:os').tmpdir(),'asssql-private-artifacts','student-variants'));
 fs.mkdirSync(output,{recursive:true,mode:0o700});
 const stream=fs.createReadStream(path.join(directory,'questions.jsonl')),digest=crypto.createHash('sha256');stream.on('data',d=>digest.update(d));
 const writer=fs.createWriteStream(path.join(output,'plans.jsonl'),{mode:0o600});
 const report={questions:0,correct_candidates:0,substantive_candidates:0,minor_candidates:0,major_candidates:0,explicit_constraints:0,parser_gaps:0,families:{}};
 for await(const line of readline.createInterface({input:stream,crlfDelay:Infinity})){
  const source=JSON.parse(line),plan=candidates(source);report.questions++;
  plan.correct=plan.correct.slice(0,16);plan.minor=plan.minor.slice(0,40);
  report.correct_candidates+=plan.correct.length;report.minor_candidates+=plan.minor.length;report.major_candidates+=plan.major.length;
  report.explicit_constraints+=Number(plan.requirements.required.length+plan.requirements.forbidden.length>0);
  report.parser_gaps+=Number(plan.diagnostics.some(d=>d.kind==='parser'));
  for(const c of plan.correct){if(c.substantive)report.substantive_candidates++;report.families[c.family]=(report.families[c.family]||0)+1;}
  writer.write(JSON.stringify({key:source.key,ordinal:report.questions,question:source.question,metadata:source.metadata,...plan})+'\n');
  if(report.questions%100===0)console.log('Prepared',report.questions);
 }
 await new Promise(r=>writer.end(r));report.source_sha256=digest.digest('hex');
 fs.writeFileSync(path.join(output,'generation-report.json'),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
