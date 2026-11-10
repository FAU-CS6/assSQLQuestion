/** Explicit question-relative equivalences. They are not universal SQL laws:
 * a question can permit arbitrary distinct labels for Boolean result groups.
 * The AST remains concrete; only the admissible fact abstraction forgets labels.
 */
import {stableKey} from './graph-model.mjs';
import {predicateFacts} from './graph-features.mjs';
import {pureExpression,boolExpression,exactInteger,notExpression,encodedBooleanCase} from './sql-equivalences.mjs';
const fold=s=>typeof s==='string'?s.replace(/[A-Z]/g,c=>c.toLowerCase()):s;
const keyCache=new WeakMap();
function expressionKey(expr){
    if(!expr?.kind)return stableKey(expr);
    if(keyCache.has(expr))return keyCache.get(expr);
    const root={kind:'Select',attrs:{},slots:{columns:[{kind:'SelectItem',attrs:{as:'label'},slots:{expr}}],from:[]}};
    const key=stableKey([...predicateFacts(root)].sort());keyCache.set(expr,key);return key;
}
function labelKey(node){
    if(node?.kind==='StringLiteral'&&typeof node.attrs.value==='string'&&Object.keys(node.attrs).every(k=>k==='value'||node.attrs[k]==null)
        &&Object.values(node.slots).every(v=>v==null||Array.isArray(v)&&!v.length))return 'string:'+node.attrs.value;
    const value=exactInteger(node);return value===null?null:'integer:'+String(value);
}
export function partitionCase(node){
    const clean=(n,slots)=>n&&Object.values(n.attrs).every(v=>v==null)
        &&Object.entries(n.slots).every(([k,v])=>slots.includes(k)||v==null||Array.isArray(v)&&!v.length);
    if(node?.kind!=='CaseExpression'||node.slots.expr!=null||!clean(node,['expr','args']))return null;
    const [yes,no,otherwise,...rest]=node.slots.args||[];
    if(rest.length||yes?.kind!=='WhenExpression'||no?.kind!=='WhenExpression'||otherwise?.kind!=='SQL:else'
        ||!clean(yes,['cond','result'])||!clean(no,['cond','result'])||!clean(otherwise,['result'])
        ||otherwise.slots.result?.kind!=='NullLiteral'||!clean(otherwise.slots.result,[])||!boolExpression(yes.slots.cond)||!pureExpression(yes.slots.cond))return null;
    const a=labelKey(yes.slots.result),b=labelKey(no.slots.result);
    if(a===null||b===null||a===b||expressionKey(no.slots.cond)!==expressionKey(notExpression(yes.slots.cond)))return null;
    return {predicate:yes.slots.cond,yes:yes.slots.result,no:no.slots.result};
}
export function partitionExpression(node){
    const decoded=partitionCase(node);
    if(decoded)return{...decoded,build:p=>labelledCase(p,decoded.yes,decoded.no)};
    if(boolExpression(node)&&pureExpression(node))return{predicate:node,build:p=>p,identity:true};
    if(node?.kind!=='BinaryExpression'||!['+','-','*','||'].includes(node.attrs.operator)||node.attrs.collate)return null;
    for(const [field,other]of [['left','right'],['right','left']]){
        const p=node.slots[field],constant=node.slots[other];if(!boolExpression(p)||!pureExpression(p))continue;
        if(node.attrs.operator==='||'){
            if(constant?.kind!=='StringLiteral'||labelKey(constant)===null)continue;
        }else{
            const n=exactInteger(constant);if(n===null)continue;
            const apply=x=>node.attrs.operator==='+'?x+n:node.attrs.operator==='*'?x*n:field==='left'?x-n:n-x;
            const a=apply(0n),b=apply(1n);if(a===b||[a,b].some(v=>v < -9223372036854775808n||v>9223372036854775807n))continue;
        }
        return{predicate:p,build:value=>({...node,slots:{...node.slots,[field]:value}})};
    }
    return null;
}
export function labelledCase(predicate,yes,no){
    const result=encodedBooleanCase(predicate);
    result.slots.args[0].slots.result=yes;result.slots.args[1].slots.result=no;return result;
}
function* locations(node,path=[]){
    if(!node?.kind)return;yield{node,path};
    for(const [field,v]of Object.entries(node.slots))if(Array.isArray(v)){
        for(let i=0;i<v.length;i++)yield*locations(v[i],[...path,'slots',field,i]);
    }else yield*locations(v,[...path,'slots',field]);
}
export function* freeLabelEntries(root,names){
    const allowed=new Set(names);
    for(const {node:select,path}of locations(root))if(select.kind==='Select'){
        const columns=select.slots.columns||[],groups=select.slots.groupby?.slots.columns||[];
        for(let i=0;i<columns.length;i++){
            const item=columns[i],name=fold(item.attrs.as);
            if(!allowed.has(name)||columns.filter(c=>fold(c.attrs.as)===name).length!==1
                ||!groups.some(c=>c.kind==='ColumnReference'&&c.attrs.table==null&&fold(c.attrs.column)===name))continue;
            // A classifier used to filter or order rows is not merely a label.
            if(['where','having','orderby','from'].some(field=>{
                const v=select.slots[field];return (Array.isArray(v)?v:[v]).some(n=>[...locations(n)].some(({node:c})=>c.kind==='ColumnReference'&&c.attrs.table==null&&fold(c.attrs.column)===name));
            }))continue;
            yield{item,select,path:[...path,'slots','columns',i,'slots','expr']};
        }
    }
}
export function* freeDiagnosticEntries(root,names){
    for(const {node,path}of locations(root))if(node.kind==='CompoundSelect'&&node.attrs.operator==='UNION'
        &&!node.slots.limit&&!(node.slots.orderby||[]).length&&[...freeLabelEntries(node.slots.left,names)].length){
        const row=node.slots.right;if(row?.kind!=='Select'||(row.slots.from||[]).length||row.attrs.distinct
            ||Object.entries(row.slots).some(([k,v])=>k!=='columns'&&v!=null&&(!Array.isArray(v)||v.length)))continue;
        const columns=row.slots.columns||[];
        const constant=n=>n?.kind==='NullLiteral'||labelKey(n)!==null;
        if(!columns.length||columns.some(c=>c.attrs.as!=null||!constant(c.slots.expr)))continue;
        yield{select:row,path:[...path,'slots','right','slots','columns'],columns};
    }
}
export function abstractGroupLabels(root,names,freeDiagnostics=false){
    if(!names?.length)return root;
    const substitutions=new Map();for(const {item,path}of freeLabelEntries(root,names)){
        const decoded=partitionExpression(item.slots.expr);if(decoded){
            const p=decoded.predicate,inverse=notExpression(p);
            substitutions.set(JSON.stringify(path),expressionKey(p)<=expressionKey(inverse)?p:inverse);
        }
    }
    if(freeDiagnostics)for(const {columns,path}of freeDiagnosticEntries(root,names))for(let i=0;i<columns.length;i++)
        substitutions.set(JSON.stringify([...path,i,'slots','expr']),{kind:'NumberLiteral',attrs:{value:'0',storageClass:'integer'},slots:{}});
    if(!substitutions.size)return root;
    const visit=(node,path=[])=>{
        if(!node?.kind)return node;
        const replacement=substitutions.get(JSON.stringify(path));if(replacement)return replacement;
        return{...node,slots:Object.fromEntries(Object.entries(node.slots).map(([field,v])=>[field,Array.isArray(v)?v.map((c,i)=>visit(c,[...path,'slots',field,i])):visit(v,[...path,'slots',field])]))};
    };return visit(root);
}
