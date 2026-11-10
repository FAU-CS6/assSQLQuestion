/** Small, proof-oriented SQL equivalences. No SQL/result similarity scoring. */
import {stableKey} from './graph-model.mjs';
const MAX = 9223372036854775807n, MIN = -9223372036854775808n;
export const comparisonComplements = {'=':'!=','==':'!=','!=':'=','<>':'=','>':'<=','<':'>=','>=':'<','<=':'>'};
export const boolExpression = n => n?.kind === 'BooleanLiteral'
    || n?.kind === 'BinaryExpression' && ['=','==','!=','<>','>','<','>=','<=','IS','IS NOT','AND','OR','LIKE','NOT LIKE','IN','NOT IN'].includes(n.attrs.operator)
    || n?.kind === 'UnaryExpression' && n.attrs.operator === 'NOT';
export const binaryExpression = (operator,left,right) => ({kind:'BinaryExpression',attrs:{operator},slots:{left,right}});
export const notExpression = expr => ({kind:'UnaryExpression',attrs:{operator:'NOT'},slots:{expr}});
const deterministicNames=new Set(['STDEV','VARIANCE','ROUND','ABS','LENGTH','LOWER','UPPER','COALESCE','IFNULL','NULLIF',
    'TRIM','LTRIM','RTRIM','SUBSTR','SUBSTRING','INSTR','HEX','QUOTE','TYPEOF','UNICODE','CHAR','REPLACE']);
export function deterministicFunction(node){
    const parts=node?.slots?.name?.slots?.name;
    return node?.kind==='FunctionExpression'&&parts?.length===1&&typeof parts[0].attrs.value==='string'
        &&deterministicNames.has(parts[0].attrs.value.toUpperCase());
}
/** Deterministic scalar forms; calls, queries and opaque origins stay excluded. */
export function pureExpression(n){
    if(!n)return false;
    if(['NumberLiteral','StringLiteral','NullLiteral','BooleanLiteral','BigIntLiteral','ColumnReference'].includes(n.kind))return true;
    if(n.kind==='UnaryExpression')return ['NOT','+','-','~'].includes(n.attrs.operator)&&pureExpression(n.slots.expr);
    if(n.kind==='BinaryExpression')return !n.attrs.collate&&pureExpression(n.slots.left)&&pureExpression(n.slots.right);
    if(n.kind==='ExpressionList')return (n.slots.value||[]).every(pureExpression);
    if(n.kind==='CaseExpression')return (n.slots.expr==null||pureExpression(n.slots.expr))&&(n.slots.args||[]).every(pureExpression);
    if(n.kind==='WhenExpression')return pureExpression(n.slots.cond)&&pureExpression(n.slots.result);
    if(n.kind==='SQL:else')return pureExpression(n.slots.result);
    if(n.kind==='CastExpression')return pureExpression(n.slots.expr);
    return false;
}
const cleanSlots = (n, fields) => Object.entries(n.slots).every(([k,v]) => fields.includes(k) || v == null || Array.isArray(v) && !v.length);
const cleanAttrs = (n,fields) => Object.entries(n.attrs).every(([k,v]) => fields.includes(k) || v == null);

export function exactInteger(node) {
    if (!node) return null;
    if (node.kind === 'NumberLiteral' && node.attrs.storageClass === 'integer'
        && cleanAttrs(node,['value','storageClass']) && cleanSlots(node,[])) {
        try {
            const text=String(node.attrs.value);
            if (!/^(?:0[xX][0-9a-fA-F]+|\d+)$/.test(text)) return null;
            let n=BigInt(text);
            if (/^0x/i.test(text)) { if(n>18446744073709551615n)return null; n=BigInt.asIntN(64,n); }
            return n>=MIN && n<=MAX ? n : null;
        } catch { return null; }
    }
    if (node.kind === 'UnaryExpression' && ['+','-','~'].includes(node.attrs.operator)
        && cleanAttrs(node,['operator']) && cleanSlots(node,['expr'])) {
        const a=exactInteger(node.slots.expr);if(a===null)return null;
        const n=node.attrs.operator==='-'?-a:node.attrs.operator==='~'?~a:a;
        return n>=MIN&&n<=MAX?n:null;
    }
    if (node.kind !== 'BinaryExpression' || !['+','-','*','%','&','|'].includes(node.attrs.operator)
        || !cleanAttrs(node,['operator']) || !cleanSlots(node,['left','right'])) return null;
    const a=exactInteger(node.slots.left),b=exactInteger(node.slots.right);if(a===null||b===null)return null;
    let n;
    switch(node.attrs.operator){case'+':n=a+b;break;case'-':n=a-b;break;case'*':n=a*b;break;
        case'%':if(b===0n)return null;n=a%b;break;case'&':n=a&b;break;case'|':n=a|b;break;}
    // SQLite promotes overflowing integer arithmetic to REAL. Never fold that
    // promotion or turn a division-by-zero NULL into a numeric constant.
    return n>=MIN&&n<=MAX?n:null;
}

export function decodedBooleanCase(n, key=stableKey) {
    if(n?.kind!=='CaseExpression'||n.slots.expr!=null||!cleanAttrs(n,[])||!cleanSlots(n,['expr','args']))return null;
    const a=n.slots.args;if(!Array.isArray(a)||a.length!==3)return null;
    const first=a[0],second=a[1],last=a[2];
    if(first?.kind!=='WhenExpression'||second?.kind!=='WhenExpression'||last?.kind!=='SQL:else'
        ||!cleanAttrs(first,[])||!cleanAttrs(second,[])||!cleanAttrs(last,[])
        ||!cleanSlots(first,['cond','result'])||!cleanSlots(second,['cond','result'])||!cleanSlots(last,['result'])
        ||exactInteger(first.slots.result)!==1n||exactInteger(second.slots.result)!==0n
        ||last.slots.result?.kind!=='NullLiteral'||!boolExpression(first.slots.cond)
        ||key(second.slots.cond)!==key(notExpression(first.slots.cond)))return null;
    return first.slots.cond;
}

export function canonicalCount(node) {
    if(node?.kind!=='AggregateExpression'||node.attrs.name!=='COUNT'||!node.slots.args?.slots||node.slots.args.attrs?.distinct)return null;
    const arg=node.slots.args.slots.expr;
    if(arg?.kind!=='Asterisk'&&exactInteger(arg)!==1n)return null;
    return {...node,slots:{...node.slots,args:{...node.slots.args,slots:{...node.slots.args.slots,
        expr:{kind:'Asterisk',attrs:{value:'*'},slots:{}}}}}};
}

export function encodedBooleanCase(n) {
    const num=value=>({kind:'NumberLiteral',attrs:{value:String(value),storageClass:'integer'},slots:{}});
    const when=(cond,result)=>({kind:'WhenExpression',attrs:{},slots:{cond,result}});
    return {kind:'CaseExpression',attrs:{},slots:{expr:null,args:[when(n,num(1)),when(notExpression(n),num(0)),
        {kind:'SQL:else',attrs:{},slots:{result:{kind:'NullLiteral',attrs:{value:null},slots:{}}}}]}};
}
