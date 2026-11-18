/** DML target atoms used only for an admissible search lower bound.
 * Never a graph key, SQL equivalence normalizer, edit, or grading rule.
 * Every edit needs an explicit effect certificate; unknown effects disable it. */
import {exactInteger as defaultExactInteger} from './sql-equivalences.mjs';
import {ceilRatio} from './integer-bound.mjs';
const empty = x => x == null || Array.isArray(x) && !x.length;
const fold = x => typeof x === 'string' ? x.replace(/[A-Z]/g,c=>c.toLowerCase()) : x;
const comparison = new Set(['=','==','!=','<>','<','>','<=','>=','IS','IS NOT','LIKE','NOT LIKE','IN','NOT IN','BETWEEN','NOT BETWEEN']);
const numericOperators = new Set(['+','-','*','%','&','|']);
const roles = ['update-set','update-where','delete-where'];
const node = x => x && typeof x.kind === 'string';
const children = x => Object.values(x.slots || {}).flatMap(v=>Array.isArray(v)?v:[v]).filter(node);
const plainColumn = x => x?.kind === 'ColumnReference' && typeof x.attrs?.column === 'string' && x.attrs.column !== '*'
    && Object.values(x.slots || {}).every(empty)
    && Object.entries(x.attrs || {}).every(([k,v])=>['column','table','db'].includes(k)||empty(v));
const key = (role,column,kind,value) => JSON.stringify([role,fold(column),kind,value]);
function literal(value, exactInteger) {
    if (!node(value)) return null;
    const integer = exactInteger(value);
    if (integer !== null) return ['integer',String(integer)];
    if (!Object.values(value.slots || {}).every(empty)) return null;
    if (value.kind === 'NumberLiteral') return ['number',value.attrs?.storageClass ?? null,String(value.attrs?.value)];
    if (['StringLiteral','DoubleQuotedLiteral','NullLiteral','BlobLiteral','BooleanLiteral','BigIntLiteral'].includes(value.kind))
        return [value.kind,value.attrs?.value ?? null];
    return null;
}
function fragmentAtoms(root, role, exactInteger) {
    const result = new Set();
    const add = (column,value) => {const l=literal(value,exactInteger);if(l!==null)result.add(key(role,column.attrs.column,'literal',l));};
    const visit = current => {
        if (!node(current)) return;
        if(current.kind === 'BinaryExpression' && comparison.has(current.attrs?.operator)) {
            const left=current.slots?.left,right=current.slots?.right;
            if(plainColumn(left)) {
                if(right?.kind==='Subquery') result.add(key(role,left.attrs.column,'query','scalar'));
                else if(right?.kind==='ExpressionList' && ['IN','NOT IN','BETWEEN','NOT BETWEEN'].includes(current.attrs.operator)) {
                    // Relax *partial* lists too: each literal independently, and
                    // membership if any direct subquery exists. Deleting another
                    // list member cannot unexpectedly activate many old atoms.
                    for(const item of right.slots?.value || []) add(left,item);
                    if(['IN','NOT IN'].includes(current.attrs.operator) && (right.slots?.value || []).some(x=>x?.kind==='Subquery'))
                        result.add(key(role,left.attrs.column,'query','membership'));
                } else add(left,right);
            }
            // Mirrors intentionally erase operand orientation for column/literal.
            if(plainColumn(right)) add(right,left);
        }
        for(const child of children(current)) visit(child);
    };
    visit(root);return result;
}
export function atomicPredicateFacts(normalizedRoot,{exactInteger=defaultExactInteger}={}) {
    if(typeof exactInteger!=='function')throw new TypeError('Supply the product exactInteger function.');
    const out=new Set();
    if(normalizedRoot?.kind!=='Script')return out;
    for(const statement of normalizedRoot.slots?.statements || []) {
        const fields=statement?.kind==='Update'?[['set','update-set'],['where','update-where']]
            :statement?.kind==='Delete'?[['where','delete-where']]:[];
        for(const [field,role]of fields)for(const part of Array.isArray(statement.slots?.[field])?statement.slots[field]:[statement.slots?.[field]])
            for(const fact of fragmentAtoms(part,role,exactInteger))out.add(fact);
    }
    return out;
}
export function targetAtomicProfile(target) {
    const perRole=new Map(),perRoleColumn=new Map();
    for(const fact of target){const [role,column]=JSON.parse(fact);perRole.set(role,(perRole.get(role)||0)+1);const k=JSON.stringify([role,column]);perRoleColumn.set(k,(perRoleColumn.get(k)||0)+1);}
    return {target,perRole,perRoleColumn,maxRole:Math.max(0,...perRole.values()),maxColumn:Math.max(0,...perRoleColumn.values())};
}
function containsQuery(n){return node(n)&&(['Script','Select','CompoundSelect','Subquery','Values','TableSource','CommonTableExpression','Definition','TriggerBody'].includes(n.kind)||children(n).some(containsQuery));}
/** Explicit descriptors for REVIEWED edit implementations only. In particular
 * `primitive` is not inferred from an arbitrary edit's name or default cost. */
export function proposedAtomicEffect(profile,spec,{exactInteger=defaultExactInteger}={}) {
    if(!spec || typeof exactInteger!=='function')return undefined;
    switch(spec.kind) {
        case 'preserve':case 'outside-dml':return 0;
        case 'literal-leaf':case 'query-mode':return Math.min(1,profile.maxColumn);
        // One AST position; IN/BETWEEN can expose several target atoms for its
        // column. Target-dependent multiplicity is safe; a universal1 is not.
        case 'column-leaf':case 'primitive':return profile.maxColumn;
        case 'binding-in-one-role':return profile.maxRole;
        case 'unknown-context':return undefined;
        case 'template':case 'projection-template': {
            let maximum=0;
            for(const entry of spec.templates || []) {
                const template=entry.template ?? entry;
                if(containsQuery(template))return undefined;
                for(const role of roles) {
                    const inserted=fragmentAtoms(template,role,exactInteger);
                    let count=[...inserted].filter(x=>profile.target.has(x)).length;
                    if(spec.kind==='projection-template') {
                        if(typeof template.attrs?.as==='string') count=Math.max(count,profile.perRole.get(role)||0);
                    } else if(template.kind==='BinaryExpression') {
                        const op=template.attrs?.operator;
                        // A comparison hole may close many IN/BETWEEN atoms;
                        // an arithmetic template may change an enclosing exact
                        // integer literal, e.g.a=2 -> a=(2+3), creatinga=5.
                        if(comparison.has(op)) count+=profile.maxColumn;
                        else if(numericOperators.has(op))count+=Math.min(1,profile.maxColumn);
                    }
                    maximum=Math.max(maximum,Math.min(count,profile.perRole.get(role)||0));
                }
            }
            return maximum;
        }
        default:return undefined;
    }
}
export function createAtomicPredicateBound(reference,graph,{exactInteger=defaultExactInteger,requirements={},effectSpecs}={}) {
    const abstract=root=>graph.abstractRoot?graph.abstractRoot(root):root;
    const factsCache=new WeakMap(),measurementCache=new WeakMap();
    const facts=root=>{
        if(!node(root))return new Set();
        if(!factsCache.has(root))factsCache.set(root,atomicPredicateFacts(abstract(root),{exactInteger}));
        return factsCache.get(root);
    };
    const target=facts(reference);
    const profile=targetAtomicProfile(target),effects=new Map(),unknown=[];
    let numerator=null,denominator=1n;
    for(const edit of graph.edits || []) {
        const effect=effectSpecs ? proposedAtomicEffect(profile,effectSpecs[edit.name],{exactInteger}) : edit.maxNewAtomicPredicates;
        effects.set(edit,effect);
        if(!Number.isSafeInteger(effect)||effect<0||!Number.isSafeInteger(edit.cost)||edit.cost<0){unknown.push(edit.name);continue;}
        if(effect>0 && (numerator===null || BigInt(edit.cost)*denominator<numerator*BigInt(effect))){numerator=BigInt(edit.cost);denominator=BigInt(effect);}
    }
    if(requirements.freeLabels?.length || requirements.freeDiagnostics)unknown.push('contextual-free-label-or-diagnostic-abstraction');
    const enabled=!unknown.length && numerator!==null && numerator>0n;
    const ratio={numerator:enabled?numerator:0n,denominator:enabled?denominator:1n};
    const exactMeasure=root=>{
        if(node(root)&&measurementCache.has(root))return measurementCache.get(root);
        const current=facts(root),missing=[...target].filter(x=>!current.has(x)).length;
        const numerator=BigInt(missing)*ratio.numerator;
        const measured={missing,numerator,denominator:ratio.denominator,bound:ceilRatio(numerator,ratio.denominator)};
        if(node(root))measurementCache.set(root,measured);
        return measured;
    };
    return {enabled,profile,unknown,effects,ratio,facts,exactMeasure,
        missing:root=>exactMeasure(root).missing,
        measure:root=>exactMeasure(root).bound,
        decrease(edit){
            const effect=effects.get(edit);
            return Number.isSafeInteger(effect)&&effect>=0
                ?ceilRatio(BigInt(effect)*ratio.numerator,ratio.denominator):0;
        },
        // Subtract the exact rational effect before rounding. Lazy scheduling
        // can key this certificate by missing-count, since the ratio is fixed.
        exactRemaining(measured,edit){
            const effect=effects.get(edit)??edit?.maxNewAtomicPredicates;
            if(!Number.isSafeInteger(effect)||effect<0||typeof measured?.numerator!=='bigint')return 0;
            const remaining=measured.numerator-BigInt(effect)*ratio.numerator;
            return ceilRatio(remaining>0n?remaining:0n,ratio.denominator);
        }};
}
