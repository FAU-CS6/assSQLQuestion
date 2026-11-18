/** Small, proof-oriented SQL equivalences. No SQL/result similarity scoring. */
import {stableKey} from './graph-model.mjs';
const MAX = 9223372036854775807n, MIN = -9223372036854775808n;
export const comparisonComplements = {'=':'!=','==':'!=','!=':'=','<>':'=','>':'<=','<':'>=','>=':'<','<=':'>'};
export const boolExpression = n => n?.kind === 'BooleanLiteral'
    || n?.kind === 'BinaryExpression' && ['=','==','!=','<>','>','<','>=','<=','IS','IS NOT','AND','OR','LIKE','NOT LIKE','IN','NOT IN'].includes(n.attrs.operator)
    || expandedBetween(n) !== null
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

// SQLite specifies BETWEEN as these same two comparisons, retaining the
// affinity/collation of each operand and evaluating the tested value only
// once. Duplication is therefore safe only for pure, context-safe operands.
// The graph edit additionally checks lexical provenance and output names.
// https://www.sqlite.org/lang_expr.html#the_between_operator
// https://www.sqlite.org/datatype3.html#type_conversions_prior_to_comparison
function betweenOperand(n) {
    if (!pureExpression(n)) return false;
    const visit = current => {
        if (!current || typeof current.kind !== 'string') return true;
        const collationSuffix = current.kind === 'Suffix' && cleanAttrs(current, []) && cleanSlots(current, ['collate']);
        if (!pureExpression(current) && !collationSuffix && !['DataType', 'Target', 'SQL:collate', 'Collate'].includes(current.kind)) return false;
        // Extra syntax cannot be silently dropped by treating a partial or
        // window expression as one of the supported scalar forms.
        if (current.slots.over || current.slots.filter) return false;
        if (current.kind === 'BinaryExpression' && current.attrs.separator != null) return false;
        return Object.values(current.slots).every(value => (Array.isArray(value) ? value : [value]).every(visit));
    };
    return visit(n);
}
const plainBinary = (n, operator) => n?.kind === 'BinaryExpression' && n.attrs.operator === operator
    && cleanAttrs(n, ['operator']) && cleanSlots(n, ['left', 'right']);

/** Return the equivalent range expression, never a concrete AST canonicalizer. */
export function expandedBetween(n) {
    if (!n || !['BETWEEN', 'NOT BETWEEN'].includes(n.attrs?.operator) || !plainBinary(n, n.attrs.operator)) return null;
    const range = n.slots.right;
    if (range?.kind !== 'ExpressionList' || !cleanAttrs(range, []) || !cleanSlots(range, ['value'])
        || range.slots.value?.length !== 2 || !betweenOperand(n.slots.left)
        || !range.slots.value.every(betweenOperand)) return null;
    const [lower, upper] = range.slots.value, negated = n.attrs.operator === 'NOT BETWEEN';
    return binaryExpression(negated ? 'OR' : 'AND',
        binaryExpression(negated ? '<' : '>=', n.slots.left, lower),
        binaryExpression(negated ? '>' : '<=', n.slots.left, upper));
}

/** One named, reversible edge; conjunction reordering remains a separate edit. */
export function betweenRangeEquivalent(n, key = stableKey) {
    const expanded = expandedBetween(n);
    if (expanded) return expanded;
    const negated = n?.attrs?.operator === 'OR';
    if (!plainBinary(n, negated ? 'OR' : 'AND')) return null;
    const left = n.slots.left, right = n.slots.right;
    if (!plainBinary(left, negated ? '<' : '>=') || !plainBinary(right, negated ? '>' : '<=')
        || !betweenOperand(left.slots.left) || !betweenOperand(right.slots.left)
        || key(left.slots.left) !== key(right.slots.left)
        || !betweenOperand(left.slots.right) || !betweenOperand(right.slots.right)) return null;
    return binaryExpression(negated ? 'NOT BETWEEN' : 'BETWEEN', left.slots.left,
        {kind: 'ExpressionList', attrs: {}, slots: {value: [left.slots.right, right.slots.right]}});
}

// SQLite IN-lists strip affinity from RHS values and use only the LHS
// collation. Naked literals have no affinity/collation to strip. A column,
// CAST, collated literal or DQS name is deliberately not covered here.
// https://www.sqlite.org/datatype3.html#type_conversions_prior_to_comparison
const bareInLiteral = n => n && cleanSlots(n, []) && (
    ['NumberLiteral', 'StringLiteral', 'NullLiteral', 'BlobLiteral', 'BigIntLiteral'].includes(n.kind)
        && cleanAttrs(n, n.kind === 'NumberLiteral' ? ['value', 'storageClass'] : ['value'])
    || n.kind === 'SQL:hex_string' && n.attrs.prefix == null && cleanAttrs(n, ['value', 'prefix'])
        && typeof n.attrs.value === 'string' && /^(?:[0-9a-f]{2})*$/i.test(n.attrs.value));
const repeatableInLeft = n => n?.kind !== 'ExpressionList' && betweenOperand(n);

/** Expand only nonempty, scalar literal lists, preserving operand orientation. */
export function expandedLiteralIn(n) {
    if (!n || !['IN', 'NOT IN'].includes(n.attrs?.operator) || !plainBinary(n, n.attrs.operator)
        || !repeatableInLeft(n.slots.left)) return null;
    const list = n.slots.right;
    if (list?.kind !== 'ExpressionList' || !cleanAttrs(list, []) || !cleanSlots(list, ['value'])
        || !Array.isArray(list.slots.value) || !list.slots.value.length || !list.slots.value.every(bareInLiteral)) return null;
    const negated = n.attrs.operator === 'NOT IN', terms = list.slots.value.map(value =>
        binaryExpression(negated ? '<>' : '=', n.slots.left, value));
    return terms.reduce((left, right) => binaryExpression(negated ? 'AND' : 'OR', left, right));
}

/** A reversible edit; equality branches must share the exact same scalar LHS. */
export function literalInEquivalent(n, key = stableKey) {
    const expanded = expandedLiteralIn(n);
    if (expanded) return expanded;
    const negated = ['AND', '!=', '<>'].includes(n?.attrs?.operator), connective = negated ? 'AND' : 'OR';
    const terms = [];
    const flatten = current => {
        if (plainBinary(current, connective)) { flatten(current.slots.left); flatten(current.slots.right); }
        else terms.push(current);
    };
    flatten(n);
    const first = terms[0];
    if (!first || !repeatableInLeft(first.slots?.left)) return null;
    const leftKey = key(first.slots.left);
    if (!terms.every(term => (negated ? plainBinary(term, '!=') || plainBinary(term, '<>') : plainBinary(term, '='))
        && repeatableInLeft(term.slots.left) && key(term.slots.left) === leftKey && bareInLiteral(term.slots.right))) return null;
    return binaryExpression(negated ? 'NOT IN' : 'IN', first.slots.left,
        {kind: 'ExpressionList', attrs: {}, slots: {value: terms.map(term => term.slots.right)}});
}

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
