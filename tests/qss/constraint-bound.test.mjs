import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {CONSTRAINT_FEATURES, createConstraintInventory, missingConstraints, constraintIncrease, createConstraintBound} from '../../lib/qss/src/constraint-bound.mjs';

const parse = sql => parseGraphSql(sql).root;
const counts = createConstraintInventory();
const empty = {notNull:0,reference:0,primaryKey:0,unique:0,autoIncrement:0,check:0,default:0};
const strong = 'CREATE TABLE t(id INTEGER PRIMARY KEY,a TEXT NOT NULL,b INT NOT NULL,c INT NOT NULL,f REFERENCES p(id),g REFERENCES q(id))';
const weak = 'CREATE TABLE t(id INTEGER,a TEXT,b INT,c INT,f,g)';

test('constraint inventory distinguishes six missing declarations without counting data types', () => {
    assert.deepEqual(counts(parse(strong)), {...empty,notNull:3,reference:2,primaryKey:1});
    assert.deepEqual(counts(parse(weak)), empty);
    assert.equal(missingConstraints(counts(parse(strong)),counts(parse(weak))),6);
    const ddl=parse('CREATE TABLE t(id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,a TEXT UNIQUE NOT NULL DEFAULT 0 CHECK(length(a)>0),b INT,UNIQUE(b),CHECK(b>0))');
    assert.deepEqual(counts(ddl),{...empty,notNull:1,primaryKey:1,autoIncrement:1,unique:2,default:1,check:2});
    assert.deepEqual(counts(parse('ALTER TABLE t ADD a TEXT NOT NULL DEFAULT 0 CHECK(a>0) REFERENCES p(id)')),
        {...empty,notNull:1,default:1,check:1,reference:1});
});

test('function Default nodes, CAST types and duplicated pure predicates do not create declaration counts', () => {
    for(const sql of ['SELECT length(a) FROM t WHERE CAST(a AS TEXT)>0',
        'SELECT length(a) FROM t WHERE CAST(a AS TEXT)>0 OR CAST(a AS TEXT)>0',
        'CREATE TABLE t(a TEXT CHECK(length(a)>0 OR length(a)>0))']) {
        const result=counts(parse(sql));
        assert.deepEqual(result,{...empty,check:sql.startsWith('CREATE')?1:0});
    }
});

test('inline PK suppression survives datatype/resource changes and counts repeated declarations conservatively', () => {
    for(const type of ['INTEGER','INT','TEXT','']) {
        const root=parse(`CREATE TABLE t(a ${type} PRIMARY KEY NOT NULL)`);
        assert.deepEqual(counts(root),{...empty,primaryKey:1});
        const column=root.slots.statements[0].slots.create_definitions[0];
        const mutated={...column,attrs:{...column.attrs,resource:'CONSTRAINT'}};
        assert.deepEqual(counts(mutated),counts(column));
        const unkeyed={...column,attrs:{...column.attrs,primary_key:null}};
        assert.equal(constraintIncrease(counts(column),counts(unkeyed)),1);
        assert.equal(constraintIncrease(counts(unkeyed),counts(column)),1);
    }
    assert.deepEqual(counts(parse('CREATE TABLE t(a INTEGER CONSTRAINT p PRIMARY KEY CONSTRAINT n NOT NULL CONSTRAINT n2 NOT NULL CONSTRAINT u UNIQUE CONSTRAINT u2 UNIQUE)')),
        {...empty,primaryKey:1,notNull:1,unique:2});
});

test('unknown and custom zero-cost effects disable the certificate, fractional effects round exactly', () => {
    const from=parse(weak),to=parse(strong);
    assert.equal(createConstraintBound(to,[{cost:1,maxNewConstraints:1},{cost:0,maxNewConstraints:0}]).measure(from),6);
    for(const edits of [[{cost:1}],[{cost:0,maxNewConstraints:1}],[{cost:1,maxNewConstraints:Infinity}],[]])
        assert.equal(createConstraintBound(to,edits).measure(from),0);
    const edit={cost:2,maxNewConstraints:3},bound=createConstraintBound(to,[edit]);
    assert.equal(bound.measure(from),4);
    assert.equal(bound.exactRemaining(bound.exactMeasure(from).numerator,edit),2);
    assert.equal(bound.exactRemaining(1n,{maxNewConstraints:0}),1);
    assert.equal(bound.exactRemaining(1n,{}),0);
});

test('constraint certificate is below independent Dijkstra on 12288 directed count-graph paths', () => {
    const n=(kind,attrs={},slots={})=>({kind,attrs,slots});
    const states=Array.from({length:64},(_,mask)=>n('Script',{}, {statements:[n('Create',{}, {
        create_definitions:Array.from({length:6},(_,i)=>i).filter(i=>mask&(1<<i)).map(i=>i<3
            ? n('Definition',{}, {nullable:n('NotNull')})
            : i<5 ? n('Definition',{}, {reference_definition:n('ReferenceDefinition')})
            : n('Definition',{primary_key:'PRIMARY KEY'}))})]}));
    for(const prices of [[1,2,3,1,2,3,1],[7,2,3,7,2,3,4],[0,1,2,0,1,2,1]]) {
        const edits=prices.map((cost,i)=>({cost,maxNewConstraints:i<6?1:2}));
        const bounds=states.map(target=>createConstraintBound(target,edits));
        for(let from=0;from<64;from++) {
            const distance=Array(64).fill(Infinity),remaining=new Set(states.map((_,i)=>i));distance[from]=0;
            while(remaining.size) {
                const at=[...remaining].reduce((best,value)=>distance[value]<distance[best]?value:best);
                remaining.delete(at);
                for(let i=0;i<7;i++) {
                    const to=at^(i<6?1<<i:3);
                    distance[to]=Math.min(distance[to],distance[at]+prices[i]);
                }
            }
            for(let target=0;target<64;target++)assert.ok(bounds[target].measure(states[from])<=distance[target],from+' -> '+target);
        }
    }
    const shared=n('ReferenceDefinition'), twice=n('Script',{}, {statements:[shared,shared]});
    assert.equal(counts(twice).reference,2,'Shared subtree identity must not collapse distinct occurrences');
});

test('integrated search certifies a five-cost cutoff from six missing constraints without expanding a state', async () => {
    const target=parse(strong),from=parse(weak),graph=createEditGraph(target,from);
    const result=await shortestSqlEditPath(target,from,graph,{async tick(){}},{cutoff:5});
    assert.equal(result.capped,true);
    assert.equal(result.distance,5);
    assert.equal(result.visited,0);
    assert.deepEqual(result.edits,[]);
    const a=parse('CREATE TABLE t(a TEXT)'),b=parse('CREATE TABLE t(a TEXT NOT NULL)');
    const free=createEditGraph(b,a,{}, {repairColumnNullable:0});
    assert.equal(createConstraintBound(b,free.edits).measure(a),0);
    const zero=await shortestSqlEditPath(b,a,free,{async tick(){}},{cutoff:5});
    assert.equal(zero.capped,false);
    assert.equal(zero.distance,0);
});

test('actual graph edges preserve all free counts and respect declared effects on DDL and partial states', t => {
    const samples=[
        [weak,strong],
        ['CREATE TABLE t(id INTEGER PRIMARY KEY,a TEXT,b INT REFERENCES p(id))',
         'CREATE TABLE t(id INTEGER PRIMARY KEY NOT NULL,a TEXT UNIQUE NOT NULL DEFAULT 0 CHECK(length(a)>0),b INT,FOREIGN KEY(b) REFERENCES p(id))'],
        ['ALTER TABLE t ADD a TEXT', 'ALTER TABLE t ADD COLUMN a TEXT NOT NULL DEFAULT 0 CHECK(a IN (1,2)) REFERENCES p(id)'],
        ['SELECT length(a) FROM t WHERE CAST(a AS TEXT)>0', 'SELECT length(a) FROM t WHERE CAST(a AS TEXT)>0 OR CAST(a AS TEXT)>0']
    ];
    let checked=0,free=0,partial=0;
    for(const [a,b]of samples)for(const costs of [{},{baseAddComponent:0},{baseSetComponent:0},{repairColumnNullable:0},{baseRemoveComponent:0}]) {
        const from=parse(a),to=parse(b),graph=createEditGraph(to,from,{tables:[{name:'p',columns:[{name:'id',pk:1,type:'INTEGER'}]}]},costs);
        const edits=graph.edits,bound=createConstraintBound(to,edits);
        assert.deepEqual(edits.filter(e=>e.maxNewConstraints===undefined).map(e=>e.name),[],
            'Every current generator needs an explicit audited certificate');
        const states=[from,to];
        // Include incomplete, non-executable search states reached by removing
        // declaration attributes/children, not just valid SQL endpoints.
        for(const edit of edits.filter(e=>/^removeDefinition|^unsetDefinition|^removeAlter/.test(e.name))) {
            let n=0;for(const edge of edit.apply(to)){states.push(edge.root);partial++;if(++n===2)break;}
            if(states.length>=10)break;
        }
        for(const root of states)for(const edit of edits)for(const edge of edit.apply(root)) {
            const before=counts(root),after=counts(edge.root),increase=constraintIncrease(before,after);
            assert.ok(increase<=edit.maxNewConstraints,edit.name+' increases '+increase+' > '+edit.maxNewConstraints);
            if(!Object.keys(costs).length&&edit.cost===0){assert.deepEqual(after,before,edit.name);free++;}
            assert.ok(bound.measure(root)<=edit.cost+bound.measure(edge.root),edit.name+' consistency');
            assert.ok(bound.exactRemaining(bound.exactMeasure(root).numerator,edit)<=bound.measure(edge.root),edit.name+' lazy bound');
            assert.equal(stableKey(replayOperation(root,edge.operation)),stableKey(edge.root));checked++;
        }
        if(!Object.keys(costs).length&&a===weak)assert.equal(bound.measure(from),6);
    }
    t.diagnostic({checked,free,partial,features:CONSTRAINT_FEATURES});
});
