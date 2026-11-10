/* Student-like answer candidates. Private SQL is supplied only at runtime.
 * Proof labels describe the transformation; execution alone never proves a
 * candidate generally equivalent. Keep unsupported candidates as diagnostics.
 */
'use strict';
const {Parser} = require('../../lib/qss/node_modules/node-sql-parser/build/sqlite.js');
const {tokens, equivalentFormatting, errorCandidates} = require('./fixture-mutations.cjs');
const parser = new Parser();
const copy = x => JSON.parse(JSON.stringify(x));
const fold = x => String(x).replace(/[A-Z]/g, c => c.toLowerCase());
const maxInteger = 9223372036854775807n;
const minInteger = -9223372036854775808n;

function requirements(text) {
  text = String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  const result = {forbidden: [], required: [], freeLabelColumns: []};
  if (/\bohne\s+(?:eine?\s+)?join(?:[-\s]operation(?:en)?)?\b/i.test(text)) result.forbidden.push('join');
  if (/durch.{0,100}(?:zwei|vereinigte).{0,100}left\s+(?:outer\s+)?join.{0,100}nachbauen/i.test(text)) result.required.push('left-join', 'union');
  const label = text.match(/welche\s+werte.{0,40}\bin\s+([\wäöüÄÖÜ]+).{0,30}unerheblich/i);
  if (label) result.freeLabelColumns.push(fold(label[1]));
  result.freeDiagnosticTuple=result.freeLabelColumns.length>0&&/drittes\s+tupel.{0,160}(?:z\.?\s*b\.?|zum beispiel).{0,80}union\s+select/i.test(text);
  return result;
}

function walk(root, path = [], ancestors = []) {
  if (!root || typeof root !== 'object') return [];
  const result = [{node: root, path, ancestors}];
  for (const [key, value] of Object.entries(root)) {
    if (Array.isArray(value)) value.forEach((child, i) => result.push(...walk(child, [...path, key, i], [...ancestors, {node: root, field: key}])));
    else if (value && typeof value === 'object') result.push(...walk(value, [...path, key], [...ancestors, {node: root, field: key}]));
  }
  return result;
}
function replaced(root, path, value) {
  if (!path.length) return value;
  const [key, ...tail] = path, result = Array.isArray(root) ? root.slice() : {...root};
  result[key] = replaced(root[key], tail, value); return result;
}
const grouped=n=>n&&['binary_expr','unary_expr'].includes(n.type)?{...n,parentheses:true}:n;
const binary = (operator, left, right) => ({type: 'binary_expr', operator, left:grouped(left), right:grouped(right)});
const unary = (operator, expr) => ({type: 'unary_expr', operator, expr:grouped(expr)});
const number = value => ({type: 'number', value});
const bool = n => n?.type==='bool'||n?.type==='binary_expr'&&['AND','OR','=','==','<>','!=','>','<','>=','<=','IS','IS NOT','IN','NOT IN','LIKE','NOT LIKE'].includes(n.operator)||n?.type==='unary_expr'&&n.operator==='NOT';
const pure = n => n && (['column_ref', 'number', 'single_quote_string', 'string', 'null', 'bool'].includes(n.type)
  || n.type === 'binary_expr' && !n.collate && pure(n.left) && pure(n.right)
  || n.type === 'unary_expr' && ['NOT', '+', '-', '~'].includes(n.operator) && pure(n.expr));
function integer(value) {
  try { if (!/^(?:0[xX][0-9a-fA-F]+|\d+)$/.test(String(value))) return null;
    const n = BigInt(value); return n >= minInteger && n <= maxInteger ? n : null;
  } catch { return null; }
}

// Native sqlify is used only for candidate generation, not as a grading model.
// Mask literal tokens so its numeric rounding and backslash handling cannot
// silently alter the student's otherwise unchanged SQL.
function parsed(sql) {
  const all = tokens(sql), raw = new Map(), integerValues = new Map();
  const used = new Set(all.map(t => t.value)); let serial = 0;
  let masked = sql;
  for (const token of all.slice().reverse()) {
    if (!['number', 'string'].includes(token.type)) continue;
    let marker;
    if (token.type === 'number') {
      do { marker = String(74000000000000 + serial++); } while (used.has(marker));
      const value = integer(token.value); if (value !== null) integerValues.set(marker, value);
    } else {
      do { marker = '__student_literal_' + serial++ + '__'; } while (sql.includes(marker));
    }
    const replacement = token.type === 'number' ? marker : "'" + marker + "'";
    raw.set(marker, token.value);
    masked = masked.slice(0, token.start) + replacement + masked.slice(token.end);
  }
  const ast = parser.astify(masked, {database: 'sqlite'});
  const comparable=value=>{
    if(value==null)return null;if(Array.isArray(value))return value.map(comparable);
    if(typeof value!=='object')return value;
    if(value.type==='function'&&value.name?.name?.[0]?.value?.toUpperCase()==='NOT'&&value.args?.value?.length===1)
      return comparable({type:'unary_expr',operator:'NOT',expr:value.args.value[0]});
    const out={};
    for(const key of Object.keys(value).sort()){
      if(['parentheses','parentheses_symbol','loc','tableList','columnList'].includes(key)||value[key]==null||Array.isArray(value[key])&&!value[key].length)continue;
      let v=comparable(value[key]);
      if(key==='type'&&['single_quote_string','string'].includes(v))v='string';
      if(key==='value'&&value.type==='number')v=String(v);
      if(['operator','join','dataType','resource','keyword','constraint_type','primary_key','action'].includes(key)&&typeof v==='string')v=v.toUpperCase();
      out[key]=v;
    }
    if(Object.hasOwn(value,'type')&&value.expr&&[null,'ASC','DESC'].includes(value.type))out.type=value.type||'ASC';
    return out;
  };
  function render(node) {
    // Upstream sqlify mutates some subquery wrappers. Keep the intended tree
    // immutable so later variants cannot inherit those serializer artefacts.
    let out = parser.sqlify(copy(node), {database: 'sqlite'});
    const roundtrip=parser.astify(out,{database:'sqlite'});
    const list=n=>Array.isArray(n)?n:[n];
    const expected=comparable(list(node)),actual=comparable(list(roundtrip));
    const quoteOrigins=(a,e)=>{
      if(!a||typeof a!=='object')return a;
      if(e?.type==='column_ref'&&a.type==='double_quote_string'&&e.table==null&&e.column===a.value
          &&Object.keys(a).every(k=>['type','value'].includes(k)))return{column:a.value,type:'column_ref'};
      return Array.isArray(a)?a.map((v,i)=>quoteOrigins(v,e?.[i])):Object.fromEntries(Object.keys(a).sort().map(k=>[k,quoteOrigins(a[k],e?.[k])]));
    };
    if(JSON.stringify(expected)!==JSON.stringify(quoteOrigins(actual,expected))){
      const error=new Error('Candidate serializer changed the intended AST');error.expected=expected;error.actual=actual;throw error;
    }
    for (const token of tokens(out).reverse()) {
      const marker = token.type === 'string' ? token.value.slice(1, -1) : token.value;
      if (raw.has(marker)) out = out.slice(0, token.start) + raw.get(marker) + out.slice(token.end);
    }
    return out;
  }
  return {ast, render, integerValues};
}

function constructs(sql) {
  const all = tokens(sql).filter(t => t.type === 'word');
  const words = all.map(t => t.upper);
  let commaJoin=false;try{commaJoin=walk(parser.astify(sql,{database:'sqlite'})).some(({node})=>node.type==='select'&&node.from?.length>1);}catch{}
  return {join: words.includes('JOIN')||commaJoin, 'left-join': words.some((w,i) => w === 'LEFT' && ['JOIN','OUTER'].includes(words[i+1])), union: words.includes('UNION')};
}
function complies(sql, policy) {
  const used = constructs(sql);
  return policy.forbidden.every(name => !used[name]) && policy.required.every(name => used[name]);
}

function candidates(source) {
  const sql = source.metadata.SEQUENCE_B.replace(/\r\n?/g, '\n');
  const policy = requirements(source.question);
  const correct = [], minor = [], major = [], diagnostics = [];
  const seen = new Set();
  const add = (group, spec) => {
    if (typeof spec.sql !== 'string' || seen.has(spec.sql)) return;
    if (group === correct && !complies(spec.sql, policy)) return;
    seen.add(spec.sql); group.push(spec);
  };
  add(correct, {name: 'model-answer', sql, family: 'reference', proof: 'given-reference', substantive: false});
  // Token-preserving alternative also covers SQLite's omitted referenced PK
  // column list, which the upstream candidate serializer cannot yet parse.
  const lexical=tokens(sql).filter(t=>t.type!=='comment');
  for(let start=0;start<lexical.length;start++)if(lexical[start].upper==='CREATE'){
    const open=lexical.findIndex((t,i)=>i>start&&t.value==='(');if(open<0)continue;
    let depth=1,last=open+1,close=-1;const parts=[];
    for(let i=open+1;i<lexical.length;i++){
      if(lexical[i].value==='(')depth++;if(lexical[i].value===')')depth--;
      if(depth===1&&lexical[i].value===','||depth===0){parts.push(lexical.slice(last,i));last=i+1;}
      if(depth===0){close=i;break;}
    }
    if(close<0)continue;
    for(const fragment of parts){
      if(!fragment.length||['CONSTRAINT','PRIMARY','FOREIGN','UNIQUE','CHECK'].includes(fragment[0].upper))continue;
      const at=fragment.findIndex(t=>t.upper==='REFERENCES');if(at<1)continue;
      // SQLite FK action order can affect CASCADE/SET NULL interactions. Moving
      // the last declared FK preserves its order relative to every other FK.
      if(parts.slice(parts.indexOf(fragment)+1).some(p=>p.some(t=>t.upper==='REFERENCES')))continue;
      if(fragment.some(t=>t.upper==='CONSTRAINT')||fragment.slice(at+1).some(t=>['DEFAULT','UNIQUE','CHECK','PRIMARY'].includes(t.upper)))continue;
      const refStart=fragment[at].start,refEnd=fragment.at(-1).end;
      const suffix='FOREIGN KEY ('+fragment[0].value+') '+sql.slice(refStart,refEnd);
      const answer=sql.slice(0,refStart)+sql.slice(refEnd,lexical[close].start)+', '+suffix+sql.slice(lexical[close].start);
      add(correct,{name:'foreign-key-layout-'+correct.length,sql:answer,family:'foreign-key-layout',proof:'same-single-column-reference-and-actions',substantive:true});
    }
    start=close;
  }
  let p;
  try {
    p = parsed(sql);
    const emitMinor=(path,replacement,name,family)=>{
      try{add(minor,{name:name+'-'+minor.length,sql:p.render(replaced(p.ast,path,replacement)),family,proof:'requires-independent-semantic-counterexample',substantive:true});}catch{}
    };
    try{add(correct, {name: 'quoted-identifiers', sql: p.render(p.ast), family: 'representation', proof: 'literal-preserving-sqlify', substantive: false});}
    catch{diagnostics.push({kind:'serializer',family:'representation'});}
    let index = 0;
    const emit = (node, path, replacement, name, proof, family = name) => {
      try { add(correct, {name: name + '-' + index++, sql: p.render(replaced(p.ast, path, replacement)), family, proof, substantive: true}); }
      catch { diagnostics.push({kind: 'serializer', family}); }
    };
    const complement = {'=':'<>','==':'<>','<>':'=','!=':'=','>':'<=','<':'>=','>=':'<','<=':'>'};
    const mirror = {'=':'=','==':'==','<>':'<>','!=':'!=','>':'<','<':'>','>=':'<=','<=':'>='};
    for (const {node, path, ancestors} of walk(p.ast)) {
      if(node.resource==='column'){
        if(node.column?.column){const n=copy(node);n.column.column+='__typo';emitMinor(path,n,'column-name-typo','column');}
        if(node.nullable){const n=copy(node);delete n.nullable;emitMinor(path,n,'missing-not-null','constraint');}
        if(node.unique){const n=copy(node);delete n.unique;emitMinor(path,n,'missing-unique','constraint');}
        if(node.primary_key){const n=copy(node);delete n.primary_key;delete n.auto_increment;emitMinor(path,n,'missing-primary-key','constraint');}
        if(node.reference_definition){const n=copy(node);delete n.reference_definition;emitMinor(path,n,'missing-foreign-key','constraint');}
      }
      if(node.type==='create'&&node.keyword==='table'&&Array.isArray(node.create_definitions)){
        node.create_definitions.forEach((d,i)=>{
          if(d.resource==='constraint'){
            const defs=node.create_definitions.slice();defs.splice(i,1);
            emitMinor(path,{...node,create_definitions:defs},'missing-table-constraint','constraint');
          }
        });
      }
      if(node.type==='aggr_func'&&['COUNT','SUM','AVG','MIN','MAX'].includes(node.name)){
        for(const name of ['COUNT','SUM','AVG','MIN','MAX'].filter(v=>v!==node.name))emitMinor(path,{...node,name},'aggregate-choice','aggregate');
        if(node.name==='COUNT'&&!node.args?.distinct){
          const projection=ancestors.findLast(a=>a.node?.expr&&Object.hasOwn(a.node,'as'));
          if(!projection||projection.node.as!=null){
            if(node.args?.expr?.type==='star')emit(node,path,{...node,args:{...node.args,expr:number(1)}},'count-row-constant','count-star-equals-nonnull-one');
            if(node.args?.expr?.type==='number'&&p.integerValues.get(String(node.args.expr.value))===1n)
              emit(node,path,{...node,args:{...node.args,expr:{type:'star',value:'*'}}},'count-row-star','count-one-equals-star');
          }
        }
      }
      if(node.type==='select'&&Array.isArray(node.columns)&&node.columns.length){
        for(let item=0;item<Math.min(2,node.columns.length);item++){
          const column=node.columns[item];if(!column.expr)continue;
          if(!(column.expr.type==='star'||column.expr.type==='column_ref'&&column.expr.column==='*')){
            for(const op of ['+','-','||']){
              const cols=node.columns.slice();cols[item]={...column,expr:binary(op,column.expr,op==='||'?{type:'single_quote_string',value:'?'}:number(1))};
              emitMinor(path,{...node,columns:cols},'projection-slip','projection_expression');
            }
          }
          if(node.columns.length>1){const cols=node.columns.slice();cols.splice(item,1);emitMinor(path,{...node,columns:cols},'missing-output-column','projection_omission');}
        }
        const extra={expr:number(1),as:'__extra_student_column'};
        emitMinor(path,{...node,columns:[...node.columns,extra]},'extra-output-column','projection_extra');
      }
      if (node.type === 'binary_expr') {
        const output=ancestors.findLast(a=>a.node?.expr&&Object.hasOwn(a.node,'as'));
        if(output&&output.node.as==null)continue;
        const hiddenJoin=ancestors.some(a=>a.node.type==='select')&&walk(node).some(({node:n})=>n.type==='binary_expr'&&n.operator==='='&&n.left?.type==='column_ref'&&n.right?.type==='column_ref');
        if (['AND','OR'].includes(node.operator) && pure(node)) {
          emit(node,path,{...node,left:node.right,right:node.left},'commute-boolean','pure-three-valued-commutativity');
          if(!hiddenJoin&&bool(node.left)&&bool(node.right))emit(node,path,unary('NOT',binary(node.operator==='AND'?'OR':'AND',unary('NOT',node.left),unary('NOT',node.right))), 'de-morgan','pure-three-valued-de-morgan');
        }
        if (!hiddenJoin&&complement[node.operator] && pure(node)) {
          emit(node,path,unary('NOT',{...node,operator:complement[node.operator]}),'negated-complement','three-valued-comparison-complement');
        }
        if (mirror[node.operator] && !JSON.stringify(node).toLowerCase().includes('collate":{')
            && (node.left?.type==='column_ref' && ['number','single_quote_string','string','null'].includes(node.right?.type)
            || node.right?.type==='column_ref' && ['number','single_quote_string','string','null'].includes(node.left?.type))) {
          emit(node,path,{...node,operator:mirror[node.operator],left:node.right,right:node.left},'mirror-comparison','sqlite-column-literal-affinity-mirror');
        }
      }
      if(node.expr&&Object.hasOwn(node,'as')&&node.as!=null&&bool(node.expr)&&pure(node.expr)){
        const when=(cond,result)=>({type:'when',cond,result});
        const expr={type:'case',expr:null,args:[when(node.expr,number(1)),when(unary('NOT',node.expr),number(0)),{type:'else',result:{type:'null',value:null}}]};
        emit(node,path,{...node,expr},'boolean-case','three-valued-boolean-case-encoding');
        if(policy.freeLabelColumns.includes(fold(node.as))){
          const named={...expr,args:[when(node.expr,{type:'single_quote_string',value:'W>M'}),when(unary('NOT',node.expr),{type:'single_quote_string',value:'M>W'}),{type:'else',result:{type:'null',value:null}}]};
          emit(node,path,{...node,expr:named},'free-group-labels','explicitly-unconstrained-partition-labels');
          emit(node,path,{...node,expr:unary('NOT',node.expr)},'inverse-group-labels','explicitly-unconstrained-partition-labels');
        }
      }
      if (node.type === 'number' && p.integerValues.has(String(node.value))) {
        // Do not turn a length/precision/LIMIT token into an expression, and
        // preserve unaliased projection captions rather than relabelling them.
        const projection = ancestors.findLast(a => a.node?.expr && Object.hasOwn(a.node,'as'));
        if (projection && projection.node.as == null) continue;
        const n = p.integerValues.get(String(node.value));
        emit(node,path,binary('*',node,number(1)),'integer-identity','exact-int64-multiply-by-one');
        emit(node,path,binary('+',node,number(0)),'integer-identity','exact-int64-add-zero','integer-identity');
        if (n > 0n && n < maxInteger) {
          // The generated decimal operand is an exact string, not a JS float.
          emit(node,path,binary('+',number(String(n-1n)),number(1)),'integer-decomposition','checked-int64-constant-evaluation');
        }
      }
      if (node.type === 'select' && Array.isArray(node.from) && node.from.length>1 && !node.with) {
        if (node.from.every(t=>!t.expr && !t.using && !t.natural && (!t.join || t.join==='INNER JOIN'))) {
          const from=copy(node.from);let where=node.where, changed=false;
          for(let i=1;i<from.length;i++)if(from[i].join==='INNER JOIN'&&pure(from[i].on)){
            where=where?binary('AND',where,from[i].on):from[i].on;delete from[i].join;delete from[i].on;changed=true;
          }
          if(changed)emit(node,path,{...node,from,where},'inner-join-to-filter','same-source-order-inner-join-filter');
        }
      }
    }
  } catch (error) { diagnostics.push({kind:'parser',message:String(error.message).slice(0,160)}); }

  // Formatting is an explicitly labelled fallback, never counted as a new
  // semantic strategy. The suite reports where fewer distinct routes exist.
  add(correct,{name:'keyword-formatting',sql:equivalentFormatting(sql),family:'representation',proof:'lexically-inert-formatting',substantive:false});
  add(correct,{name:'commented-answer',sql:sql+'\n/* independently entered student answer */\n',family:'representation',proof:'inert-trailing-comment',substantive:false});
  if(policy.freeDiagnosticTuple){
    const tuple=sql.match(/\bUNION\s+SELECT\s+0\s*,\s*0\s*;?\s*$/i);
    if(tuple)add(correct,{name:'free-diagnostic-tuple',sql:sql.slice(0,tuple.index)+'UNION SELECT -1, -1;',family:'free-diagnostic-tuple',proof:'explicitly-unconstrained-diagnostic-row',substantive:true});
  }
  for(const value of errorCandidates(sql)) {
    if(['replaced_statement','omitted_statement','empty_answer','column'].includes(value.kind))continue;
    add(minor,{name:'local-'+value.kind+'-'+minor.length,sql:value.answer,family:value.kind,proof:'requires-independent-semantic-counterexample',substantive:true});
  }
  // Accidental output truncation is a local clause error. Use the teacher's
  // known result size, then let the independent worker expose the missing rows.
  if(tokens(sql).find(t=>t.type!=='comment')?.upper?.match(/^(SELECT|WITH)$/)
      &&!tokens(sql).some(t=>t.type==='word'&&t.upper==='LIMIT')
      &&!tokens(source.metadata.SEQUENCE_C||'').some(t=>t.type!=='comment')){
    let rows=0;try{rows=JSON.parse(source.metadata.OUTPUT_RELATION).values.length;}catch{}
    const last=tokens(sql).filter(t=>t.type!=='comment').at(-1);
    const limited=last?.value===';'?sql.slice(0,last.start)+sql.slice(last.end):sql;
    for(const limit of [...new Set([rows-1,rows-2,rows-3].filter(n=>n>=0))])
      add(minor,{name:'truncated-result-'+limit,sql:limited+'\nLIMIT '+limit+';',family:'row-limit',proof:'requires-independent-semantic-counterexample',substantive:true});
  }
  // Further one-token student errors, including short textual typos and
  // boundary errors, remain candidates until actual execution distinguishes them.
  for(const token of tokens(sql).filter(t=>t.type==='string').slice(0,8)) {
    const raw=token.value.slice(1,-1); if(!raw.length)continue;
    add(minor,{name:'string-typo-'+minor.length,sql:sql.slice(0,token.start)+"'"+raw+"__typo'"+sql.slice(token.end),family:'literal',proof:'requires-independent-semantic-counterexample',substantive:true});
  }
  const datatypeChoices={INTEGER:['REAL','TEXT','BLOB'],INT:['REAL','TEXT','BLOB'],REAL:['INTEGER','TEXT','BLOB'],TEXT:['INTEGER','REAL','BLOB'],BLOB:['TEXT','REAL','INTEGER'],VARCHAR:['CHAR','NVARCHAR','NCHAR'],CHAR:['VARCHAR','NVARCHAR','NCHAR'],NUMERIC:['DECIMAL','FLOAT','NUMBER']};
  if(/^\s*(?:CREATE|ALTER)\b/i.test(sql))for(const token of tokens(sql).filter(t=>t.type==='word'&&datatypeChoices[t.upper]
      &&(new RegExp('\\b'+t.upper+'\\b','i').test(String(source.question))||/inkrement|nur zahlen/i.test(String(source.question)))).slice(0,3)){
    for(const value of datatypeChoices[token.upper])add(minor,{name:'datatype-slip-'+minor.length,sql:sql.slice(0,token.start)+value+sql.slice(token.end),family:'datatype',proof:'different-declared-column-type',substantive:true});
  }
  // A nearly complete DELETE can leave one unintended row. It is not conflated
  // with dropping a different table or deleting nothing at all.
  const deletion=sql.match(/^\s*DELETE\s+FROM\s+([\w"`\[\]]+)\s*;?\s*$/i);
  if(deletion)for(const aggregate of ['MIN','MAX'])add(minor,{name:'one-row-not-deleted-'+aggregate,sql:'DELETE FROM '+deletion[1]+' WHERE rowid <> (SELECT '+aggregate+'(rowid) FROM '+deletion[1]+');',family:'one-row-omission',proof:'requires-independent-semantic-counterexample',substantive:true});
  if(deletion)add(minor,{name:'two-rows-not-deleted',sql:'DELETE FROM '+deletion[1]+' WHERE rowid NOT IN (SELECT rowid FROM '+deletion[1]+' ORDER BY rowid LIMIT 2);',family:'one-row-omission',proof:'requires-independent-semantic-counterexample',substantive:true});
  add(major,{name:'empty-answer',sql:'',family:'absent-answer',proof:'required-operation-absent',substantive:true});
  add(major,{name:'unrelated-constant',sql:'SELECT 123456789 AS unrelated_answer;',family:'unrelated-result',proof:'required-relations-and-operation-absent',substantive:true});
  add(major,{name:'unrelated-schema-operation',sql:'CREATE TABLE __student_unrelated_table(unrelated_column TEXT);',family:'unrelated-operation',proof:'required-relations-and-operation-absent',substantive:true});
  // Omitting a DELETE can make a separate unconditional control JOIN produce
  // millions of rows. Prefer other gross student mistakes for those exercises;
  // this changes test-case selection, never SQL execution or grading limits.
  // Retain the original candidates as diagnostics and provenance for old runs.
  const controlWords=new Set(tokens(source.metadata.SEQUENCE_C||'').filter(t=>t.type==='word').map(t=>t.upper));
  if(deletion&&controlWords.has('JOIN')&&!controlWords.has('ON')&&!controlWords.has('USING')){
    let missing='__student_missing_relation';
    while([sql,source.metadata.SEQUENCE_A||'',source.metadata.SEQUENCE_C||''].some(s=>s.includes(missing)))missing+='_';
    add(major,{name:'drop-instead-of-delete',sql:'DROP TABLE '+deletion[1]+';',family:'wrong-operation',proof:'required-row-deletion-replaced-by-table-drop',substantive:true,preferred:true});
    add(major,{name:'select-missing-source',sql:'SELECT * FROM '+missing+';',family:'wrong-operation-and-source',proof:'required-operation-and-source-absent',substantive:true,preferred:true});
    add(major,{name:'delete-wrong-source',sql:'DELETE FROM '+missing+';',family:'wrong-source',proof:'wrong-delete-target',substantive:true,preferred:true});
  }
  const families = new Set(); const preferred = [];
  for(const spec of correct)if(spec.substantive&&!families.has(spec.family)){families.add(spec.family);preferred.push(spec);}
  if(policy.freeDiagnosticTuple){const priority={'free-group-labels':0,'inverse-group-labels':1,'free-diagnostic-tuple':2};preferred.sort((a,b)=>(priority[a.family]??10)-(priority[b.family]??10));}
  return {requirements:policy,correct:[correct[0],...preferred,...correct.filter(x=>!preferred.includes(x)&&x!==correct[0])],minor,major,diagnostics};
}

module.exports={candidates,requirements,constructs,complies,parsed,walk,integer};
