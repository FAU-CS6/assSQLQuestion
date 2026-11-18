/** Cost-partitioned lower bounds; never concrete SQL edits or canonicalization. */
import {createConstraintInventory, missingConstraints} from './constraint-bound.mjs';
import {ceilRatio, minimumEffectRatio} from './integer-bound.mjs';
import {exactInteger,decodedBooleanCase,canonicalCount} from './sql-equivalences.mjs';

export const DDL_WORK_EFFECTS = Object.freeze({constraints:'maxNewConstraints', strings:'maxNewDdlStrings', types:'maxDeclaredTypeWork',check:'maxNewCheckWork'});
export const CHECK_EXPRESSION_BITS=Object.freeze({column:1,literal:2,comparison:4});
const dimensions=Object.keys(DDL_WORK_EFFECTS), roles=['other','default','check'];
const isNode=n=>n&&typeof n.kind==='string'&&n.attrs&&n.slots;
const declaration=n=>['Definition','Alter','ColumnConstraint'].includes(n?.kind);
const numeric=value=>typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim());
const missing=(target,current)=>[...target].reduce((count,value)=>count+Number(!current.has(value)),0);
const popcount=mask=>Number(Boolean(mask&1))+Number(Boolean(mask&2))+Number(Boolean(mask&4));
const literals=new Set(['NumberLiteral','StringLiteral','DoubleQuotedLiteral','NullLiteral','BlobLiteral','BooleanLiteral','BigIntLiteral','SQL:hex_string']);
const comparisons=new Set(['=','==','!=','<>','<','>','<=','>=','IS','IS NOT','LIKE','NOT LIKE','GLOB','NOT GLOB','MATCH','NOT MATCH','REGEXP','NOT REGEXP','IN','NOT IN','BETWEEN','NOT BETWEEN']);

/** Coarse expression features, never a SQL equivalence decision.
 * Decode Boolean CASE with a recursive feature key, not concrete AST equality:
 * a free De Morgan rewrite in just one WHEN must not expose its 0/1/NULL labels.
 * Recognizing extra CASE forms only forgets features. A paid edit that breaks
 * recognition can expose the literal bit; finite-copy certificates include it.
 */
export function createCheckExpressionInventory() {
    const cache=new WeakMap();
    const mask=root=>{
        if(!isNode(root))return 0;
        if(cache.has(root))return cache.get(root);
        const decoded=decodedBooleanCase(root,child=>String(mask(child)));
        let value;
        if(decoded)value=mask(decoded);
        else {
            const count=canonicalCount(root);
            if(count&&root.slots.args.slots.expr?.kind!=='Asterisk')value=mask(count);
            else if(exactInteger(root)!==null)value=CHECK_EXPRESSION_BITS.literal;
            else {
                value=root.kind==='ColumnReference'?CHECK_EXPRESSION_BITS.column:literals.has(root.kind)?CHECK_EXPRESSION_BITS.literal:0;
                if(root.kind==='BinaryExpression'&&comparisons.has(root.attrs.operator))value|=CHECK_EXPRESSION_BITS.comparison;
                for(const entry of Object.values(root.slots))for(const child of Array.isArray(entry)?entry:[entry])value|=mask(child);
            }
        }
        cache.set(root,value);return value;
    };
    return mask;
}

/**
 * DEFAULT and inline CHECK roles depend on structural slots, never mutable
 * constraint_type/resource attributes. In particular a table CHECK stays in
 * the 'other' role: changing its constraint_type must not reclassify arbitrary
 * many strings in one attribute edit. Function-name Default nodes are not SQL
 * DEFAULT clauses. Numeric strings are forgotten for the free TEXT/int edge.
 * CAST DataTypes are excluded; only declaration.definition nodes are counted.
 */
export function createDdlWorkInventory() {
    const cache=new WeakMap(),constraints=createConstraintInventory(),expressionMask=createCheckExpressionInventory();
    const inventory=(root,role='other')=>{
        if(!roles.includes(role))throw new TypeError('Unknown DDL string role.');
        if(!isNode(root))return{constraints:constraints(null),strings:new Set(),typeNames:new Set(),typeCount:0,checkMask:0};
        if(!cache.has(root))cache.set(root,new Map());
        if(cache.get(root).has(role))return cache.get(root).get(role);
        const strings=new Set(),typeNames=new Set();let typeCount=0,checkMask=root.kind==='Check'?expressionMask(root):0;
        const ownRole=root.kind==='Check'?'check':role;
        if(['StringLiteral','DoubleQuotedLiteral'].includes(root.kind)&&typeof root.attrs.value==='string'&&!numeric(root.attrs.value))
            strings.add(JSON.stringify([ownRole,root.attrs.value]));
        if(['Definition','Alter'].includes(root.kind)&&root.slots.definition?.kind==='DataType') {
            typeCount++;
            if(typeof root.slots.definition.attrs.dataType==='string'&&root.slots.definition.attrs.dataType)
                typeNames.add(root.slots.definition.attrs.dataType.toUpperCase());
        }
        for(const [field,value]of Object.entries(root.slots)) {
            const childRole=declaration(root)&&field==='default_val'?'default':declaration(root)&&field==='check'?'check':ownRole;
            for(const child of Array.isArray(value)?value:[value])if(isNode(child)) {
                const part=inventory(child,childRole);
                for(const value of part.strings)strings.add(value);
                for(const value of part.typeNames)typeNames.add(value);
                typeCount+=part.typeCount;
                checkMask|=part.checkMask;
            }
        }
        const result=Object.freeze({constraints:constraints(root),strings,typeNames,typeCount,checkMask});
        cache.get(root).set(role,result);return result;
    };
    inventory.maximumTemplateStrings=root=>Math.max(...roles.map(role=>inventory(root,role).strings.size));
    // The default covers CASE/COUNT recognition breaking at the insertion
    // position. A caller may omit that penalty only after proving its finite
    // graph grammar cannot ever construct either recognized form.
    inventory.maximumTemplateCheckWork=(root,{hiddenLiteralPossible=true}={})=>
        popcount(expressionMask(root)|(hiddenLiteralPossible?CHECK_EXPRESSION_BITS.literal:0));
    return inventory;
}

export function ddlWorkDeficit(target,current) {
    return{constraints:missingConstraints(target.constraints,current.constraints),
        strings:missing(target.strings,current.strings),
        types:missing(target.typeNames,current.typeNames)+Number(current.typeCount>target.typeCount),
        check:popcount(target.checkMask&~current.checkMask)};
}

/**
 * Each dimension first obtains an independent exact cost/effect rate. Of its
 * fifteen possible nonempty subsets, retain only partitions whose weighted sum
 * of effects costs no more than EVERY registered edge. Their maximum is safe;
 * overlap therefore falls back to a certified pair or separate maximum rather
 * than silently charging the same edge twice. Unknown effects zero the affected
 * rate. Free task labels disable string and CHECK-expression guidance entirely.
 */
export function createDdlWorkBound(target,edits,options={}) {
    const inventory=createDdlWorkInventory(),wanted=inventory(target);
    const rates=dimensions.map(name=>['strings','check'].includes(name)&&(options.freeLabels?.length||options.freeDiagnostics)
        ?{numerator:0n,denominator:1n}:minimumEffectRatio(edits,DDL_WORK_EFFECTS[name]));
    const denominator=rates.reduce((product,rate)=>product*rate.denominator,1n);
    const units=rates.map(rate=>rate.numerator*(denominator/rate.denominator)),partitions=[];
    const seen=new Set();
    const effect=(edit,index)=>edit[DDL_WORK_EFFECTS[dimensions[index]]];
    for(let mask=0;mask<1<<dimensions.length;mask++) {
        const weights=units.map((unit,index)=>mask&(1<<index)?unit:0n),key=weights.join(',');
        if(seen.has(key))continue;seen.add(key);
        if(edits.some(edit=>{
            if(!Number.isSafeInteger(edit.cost)||edit.cost<0)return weights.some(weight=>weight>0n);
            let spent=0n;
            for(let i=0;i<dimensions.length;i++)if(weights[i]>0n) {
                const amount=effect(edit,i);
                if(!Number.isSafeInteger(amount)||amount<0)return true;
                spent+=weights[i]*BigInt(amount);
            }
            return spent>BigInt(edit.cost)*denominator;
        }))continue;
        partitions.push(weights);
    }
    const exactMeasure=root=>{
        const work=ddlWorkDeficit(wanted,inventory(root));
        const numerators=partitions.map(weights=>weights.reduce((sum,weight,index)=>sum+weight*BigInt(work[dimensions[index]]),0n));
        return{work,numerators,denominator,bound:Math.max(0,...numerators.map(n=>ceilRatio(n,denominator)))};
    };
    return{inventory,target:wanted,rates,denominator,partitions,exactMeasure,measure:root=>exactMeasure(root).bound,
        exactRemaining(measured,edit) {
            return Math.max(0,...partitions.map((weights,index)=>{
                let remaining=measured.numerators[index];
                for(let i=0;i<dimensions.length;i++)if(weights[i]>0n) {
                    const amount=effect(edit,i);
                    if(!Number.isSafeInteger(amount)||amount<0)return 0;
                    remaining-=weights[i]*BigInt(amount);
                }
                return ceilRatio(remaining>0n?remaining:0n,denominator);
            }));
        }
    };
}
