import assert from 'node:assert/strict';
import test from 'node:test';
import {internGraphKey} from '../../lib/qss/src/graph-key.mjs';
import {stableKey, graphKey} from '../../lib/qss/src/graph-model.mjs';
export async function runInternKeyTests(oldStableKey, oldGraphKey) {
    const fail = message => {throw new Error(message);};
    const assert = (value, message) => {if(!value) fail(message);};
    const key=internGraphKey(), values=[], labels=[];
    const add=(label,value)=>{labels.push(label);values.push(value);return value;};
    const n=(attrs={},slots={})=>({kind:'Node',attrs,slots});
    for (const [label,v] of [
        ['undefined',undefined],['null',null],['false',false],['true',true],['zero',0],['minus zero',-0],['nan',NaN],['infinity',Infinity],['negative infinity',-Infinity],
        ['empty string',''],['undefined string','undefined'],['null string','null'],['JSON punctuation','[,,]{"x":undefined}'],['unicode','ü😀\ud800'],
        ['function',function(){}],['symbol',Symbol('x')],['empty array',[]],['undefined array',[undefined]],['hole array',new Array(1)],['double hole',new Array(2)],['double undefined',[undefined,undefined]],['null array',[null]],
        ['undefined then null',[undefined,null]],['null then undefined',[null,undefined]],['nested empty',[[]]],['nested undefined',[[undefined]]],
        ['empty object',{}],['undefined property',{a:undefined}],['function property',{a:()=>{}}],['null property',{a:null}],['object order1',{a:1,b:2}],['object order2',{b:2,a:1}],
        ['node plain',n()],['node null attrs',n({a:null})],['node undefined attrs',n({a:undefined})],['node false distinct',n({distinct:false})],['node zero distinct',n({distinct:0})],
        ['node null slot',n({}, {a:null})],['node undefined slot',n({}, {a:undefined})],['node empty slot',n({}, {a:[]})],['node undefined array slot',n({}, {a:[undefined]})],['node hole slot',n({}, {a:new Array(1)})],
        ['node false slot',n({}, {a:false})],['node extra property',{...n(),extra:'ignored'}],['node truthy nonobject attrs',{kind:'Node',attrs:2,slots:[]}],
        ['non-node null attrs',{kind:'Node',attrs:null,slots:{}}],['non-node missing slots',{kind:'Node',attrs:{}}],['non-node number kind',{kind:7,attrs:{},slots:{}}],
        ['normalization inside attrs',n({kind:'Inner',attrs:{distinct:false},slots:{empty:[]},ignored:'gone'})],
        ['normalization inside slots',n({}, {kind:'Inner',attrs:{distinct:false},slots:{empty:[]},ignored:'gone'})],
        ['date object',new Date('2020-01-01')],['boxed number',new Number(4)],['typed array',new Uint8Array([1,2])]
    ])add(label,v);
    for(const [label,result] of [['function JSON object',{a:1,b:2}],['function JSON ordered object',{b:2,a:1}],['function JSON array',[undefined]],['function JSON semantic node',n({distinct:false})]]){const fn=function(){};fn.toJSON=()=>result;add(label,fn);}
    const inherited=Object.create({a:1}); inherited.b=2;add('inherited object',inherited);add('own counterpart',{b:2});
    const sparseInherited=[];sparseInherited.length=1;const ap=Object.create(Array.prototype);ap[0]=undefined;Object.setPrototypeOf(sparseInherited,ap);add('inherited array element',sparseInherited);
    const leaf=n({value:'x'},{});add('shared',n({}, {children:[leaf,leaf]}));add('unshared',n({}, {children:[n({value:'x'}),n({value:'x'})]}));
    const undefinedObject={};Object.defineProperty(undefinedObject,'skip',{value:3,enumerable:false});undefinedObject[Symbol('skip')]=4;add('nonenumerable/symbol properties',undefinedObject);
    let seed=0x91ab32;const rand=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed>>>0;};
    const primitive=()=>[undefined,null,false,true,0,-0,NaN,Infinity,'',String(rand()%17),'é',rand()%101][rand()%12];
    const randomValue=depth=>{
        if(!depth || rand()%4===0)return primitive();
        const type=rand()%4;
        if(type===0){const a=[];a.length=rand()%5;for(let i=0;i<a.length;i++)if(rand()%3)a[i]=randomValue(depth-1);return a;}
        const o={};for(let i=0,k=rand()%5;i<k;i++)o['p'+(rand()%7)]=randomValue(depth-1);
        if(type===1)return o;
        return n(o,{a:randomValue(depth-1),b:rand()%3===0?[]:randomValue(depth-1)});
    };
    for(let i=0;i<3000;i++)add('random '+i,randomValue(3));
    // Two-way maps verify both implications of equality without O(n²) work.
    const oldToId=new Map(),idToOld=new Map(),legacyMemo=oldGraphKey();
    for(let i=0;i<values.length;i++){
        const old=oldStableKey(values[i]),id=key(values[i]);
        assert(Object.is(legacyMemo(values[i]),old),'old memo differs '+labels[i]);
        if(oldToId.has(old))assert(oldToId.get(old)===id,'same old key, different IDs '+labels[i]);
        if(idToOld.has(id))assert(Object.is(idToOld.get(id),old),'same ID, different old keys '+labels[i]);
        oldToId.set(old,id);idToOld.set(id,old);
    }
    for(let i=0;i<values.length;i++)for(let j=0;j<Math.min(values.length,64);j++)assert((oldStableKey(values[i])===oldStableKey(values[j]))===(key(values[i])===key(values[j])),`pair mismatch ${labels[i]} / ${labels[j]}`);
    for(const bigint of [1n,{a:1n},[1n]]){
        let oldError=false,newError=false;try{oldStableKey(bigint);}catch(e){oldError=e instanceof TypeError;}try{key(bigint);}catch(e){newError=e instanceof TypeError;}
        assert(oldError&&newError,'BigInt behavior differs');
    }
    // Small persistent AST workload, not a graph search: represent two thousand
    // one-leaf variants while retaining roots, just as a search frontier does.
    const workloadKey=internGraphKey(),oldKey=oldGraphKey(),roots=[];
    const columns=Array.from({length:40},(_,i)=>({kind:'SelectItem',attrs:{as:'c'+i},slots:{expr:{kind:'ColumnReference',attrs:{table:'t',column:'c'+i},slots:{collate:null}}}}));
    let root={kind:'Script',attrs:{},slots:{statements:[{kind:'Select',attrs:{distinct:false},slots:{columns,from:[],where:null}}]}};
    let rootStringCharacters=0;const started=performance.now();
    for(let i=0;i<2000;i++){
        const select=root.slots.statements[0],at=i%40,cs=select.slots.columns.slice(),item=cs[at];
        cs[at]={...item,slots:{...item.slots,expr:{kind:'NumberLiteral',attrs:{value:String(i),storageClass:'integer'},slots:{}}}};
        root={...root,slots:{statements:[{...select,slots:{...select.slots,columns:cs}}]}};roots.push(root);
        const old=oldKey(root),id=workloadKey(root);rootStringCharacters+=old.length;
        assert(typeof id==='number','key is not numeric');
    }
    return {passed:true,values:values.length,equalityClasses:oldToId.size,pairChecks:values.length*64,stats:key.stats(),workload:{roots:roots.length,oldRootKeyCharacters:rootStringCharacters,newSignatureCharacters:workloadKey.stats().signatureCharacters,internedSignatures:workloadKey.stats().internedSignatures,elapsedMs:Math.round(performance.now()-started)}};
}


test('compact graph IDs preserve the canonical equality relation and share persistent subtrees', async () => {
    const result = await runInternKeyTests(stableKey, graphKey);
    assert.equal(result.passed, true);
    assert.ok(result.workload.newSignatureCharacters < result.workload.oldRootKeyCharacters);
});

test('cached semantic views preserve raw objects and all shared attrs slots equality classes', () => {
    const key = internGraphKey(), oldToNew = new Map(), newToOld = new Map();
    const attrs = Array.from({length: 40}, (_, i) => Object.freeze({value: String(i % 7),
        distinct: [false, null, undefined, 0, true][i % 5], optional: i % 2 ? undefined : null}));
    const slots = Array.from({length: 40}, (_, i) => Object.freeze({empty: Object.freeze([]),
        absent: i % 2 ? null : undefined,
        child: Object.freeze({kind: 'Leaf', attrs: attrs[i], slots: Object.freeze({})})}));
    const check = value => {
        const old = stableKey(value), actual = key(value);
        if (oldToNew.has(old)) assert.equal(actual, oldToNew.get(old));
        if (newToOld.has(actual)) assert.equal(old, newToOld.get(actual));
        oldToNew.set(old, actual); newToOld.set(actual, old);
    };
    // Raw objects must not acquire semantic-node field filtering from a cache.
    for (const value of [...attrs, ...slots]) check(value);
    for (const a of attrs) for (const s of slots) {
        check(Object.freeze({kind: 'Node', attrs: a, slots: s}));
        check({kind: 'Node', attrs: {...a}, slots: {...s}});
    }
    for (const value of [...attrs, ...slots]) check(value);
    const a = {kind: 'Node', attrs: {distinct: false}, slots: {empty: []}};
    assert.equal(key(a), key({kind: 'Node', attrs: {}, slots: {}}));
    assert.notEqual(key(a.attrs), key({}));
    assert.notEqual(key(a.slots), key({}));
});
