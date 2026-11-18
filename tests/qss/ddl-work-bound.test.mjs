import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql,stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph,replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';
import {constraintIncrease} from '../../lib/qss/src/constraint-bound.mjs';
import {createDdlWorkInventory,ddlWorkDeficit,createDdlWorkBound,createCheckExpressionInventory} from '../../lib/qss/src/ddl-work-bound.mjs';
import {encodedBooleanCase,binaryExpression,notExpression} from '../../lib/qss/src/sql-equivalences.mjs';

const parse=sql=>parseGraphSql(sql).root,inventory=createDdlWorkInventory();
const edge=(cost,C=0,S=0,T=0,K=0)=>({cost,maxNewConstraints:C,maxNewDdlStrings:S,maxDeclaredTypeWork:T,maxNewCheckWork:K});
const separate=[edge(1,1),edge(1,0,1),edge(1,0,0,1),edge(0)];

test('DDL work separates default/check literals and declaration types from function names and CASTs',()=>{
    const value=inventory(parse("CREATE TABLE t(a TEXT DEFAULT 'no' CHECK(a IN ('yes','no')))"));
    assert.deepEqual([...value.strings].sort(),[['check','no'],['check','yes'],['default','no']].map(JSON.stringify).sort());
    assert.deepEqual([...value.typeNames],['TEXT']);assert.equal(value.typeCount,1);
    const query=inventory(parse("SELECT length('x'),CAST('no' AS TEXT) WHERE '12' = '0012'"));
    assert.equal(query.typeCount,0);assert.deepEqual([...query.typeNames],[]);
    assert.deepEqual([...query.strings].sort(),[['other','x'],['other','no']].map(JSON.stringify).sort());
    const dqs=inventory(parse('CREATE TABLE t(a TEXT DEFAULT "no" CHECK(a IN ("yes","no")))'));
    assert.deepEqual(dqs.strings,value.strings);
});

test('table CHECK role is invariant under mutable declaration attributes',()=>{
    const root=parse("CREATE TABLE t(a TEXT,CHECK(a IN ('yes','no')))"),check=root.slots.statements[0].slots.create_definitions[1];
    assert.deepEqual(inventory(check).strings,new Set([JSON.stringify(['other','yes']),JSON.stringify(['other','no'])]));
    assert.deepEqual(inventory({...check,attrs:{...check.attrs,constraint_type:'UNIQUE',resource:'COLUMN'}}).strings,inventory(check).strings);
    const shared=parse("SELECT 'x'").slots.statements[0].slots.columns[0].slots.expr;
    assert.equal(inventory.maximumTemplateStrings(shared),1);
});

test('disjoint edge budgets add two missing constraints, one string and one surplus declaration type',()=>{
    const target=parse("CREATE TABLE t(id,a TEXT NOT NULL,b TEXT NOT NULL,c TEXT DEFAULT 'no' CHECK(c IN ('yes','pink')))"),
        from=parse("CREATE TABLE t(id INTEGER,a TEXT,b TEXT,c TEXT DEFAULT 'no' CHECK(c IN ('yes','blue')))");
    assert.deepEqual(ddlWorkDeficit(inventory(target),inventory(from)),{constraints:2,strings:1,types:1,check:0});
    const bound=createDdlWorkBound(target,separate);
    assert.equal(bound.measure(from),4);
    const stringsInPairs=createDdlWorkBound(target,[edge(1,1),edge(1,0,2),edge(1,0,0,1),edge(0)]);
    assert.equal(stringsInPairs.measure(from),4,'ceil(2 + 1/2 + 1), exact rational partition');
    assert.equal(stringsInPairs.exactRemaining(stringsInPairs.exactMeasure(from),edge(1,0,2)),3);
    const otherTarget=parse('CREATE TABLE t(id,a TEXT NOT NULL,b TEXT NOT NULL,c TEXT UNIQUE)'),
        otherFrom=parse('CREATE TABLE t(id INTEGER,a TEXT,b TEXT,c TEXT)');
    assert.deepEqual(ddlWorkDeficit(inventory(otherTarget),inventory(otherFrom)),{constraints:3,strings:0,types:1,check:0});
    assert.equal(createDdlWorkBound(otherTarget,separate).measure(otherFrom),4);
});

test('overlapping costs fall back to certified subsets, unknown effects and free task labels fail closed',()=>{
    const target=parse("CREATE TABLE t(a TEXT NOT NULL DEFAULT 'x')"),from=parse('CREATE TABLE t(a INTEGER,b INTEGER)');
    // C=2 (NOT NULL + DEFAULT), S=1, T=2 (TEXT name + surplus count).
    assert.deepEqual(ddlWorkDeficit(inventory(target),inventory(from)),{constraints:2,strings:1,types:2,check:0});
    const coupled=createDdlWorkBound(target,[edge(1,1,1),edge(1,0,0,1)]);
    assert.equal(coupled.measure(from),4,'C+T is certified, C+S+T would double-charge a shared edit');
    const unannotated=createDdlWorkBound(target,[{cost:1,maxNewConstraints:1}]);
    assert.equal(unannotated.measure(from),2);
    const freeString=createDdlWorkBound(target,[...separate,edge(0,0,1)]);
    assert.equal(freeString.measure(from),4);
    const freeLabels=createDdlWorkBound(target,separate,{freeLabels:['x']});
    assert.equal(freeLabels.measure(from),4);
    assert.equal(createDdlWorkBound(target,[{cost:1}]).measure(from),0);
});

test('cost partitions and lazy remainders remain admissible on independent Dijkstra graphs',()=>{
    const node=(kind,attrs={},slots={})=>({kind,attrs,slots});
    const states=Array.from({length:32},(_,mask)=>node('Script',{}, {statements:[node('Create',{}, {
        create_definitions:[node('Definition',{}, {
            nullable:mask&1?node('NotNull'):null,
            check:mask&2?node('Check'):null,
            default_val:node('Default',{}, {value:mask&4?node('StringLiteral',{value:'x'}):null}),
            definition:mask&8?node('DataType',{dataType:'TEXT'}):null
        }),...(mask&16?[node('Definition',{}, {definition:node('DataType',{dataType:'INTEGER'})})]:[])]})]}));
    let checked=0;
    for(const prices of [[1,1,1,1,1,1],[2,3,1,2,1,2],[0,1,1,1,0,1]]) {
        // The final edge couples the first constraint and the literal.
        const edits=[edge(prices[0],1),edge(prices[1],1),edge(prices[2],0,1),edge(prices[3],0,0,1),edge(prices[4],0,0,1),edge(prices[5],1,1)];
        const flips=[1,2,4,8,16,5],bounds=states.map(target=>createDdlWorkBound(target,edits));
        for(let from=0;from<32;from++) {
            const dist=Array(32).fill(Infinity),pending=new Set(states.map((_,i)=>i));dist[from]=0;
            while(pending.size) {
                const at=[...pending].reduce((a,b)=>dist[a]<dist[b]?a:b);pending.delete(at);
                for(let i=0;i<flips.length;i++){const to=at^flips[i];dist[to]=Math.min(dist[to],dist[at]+prices[i]);}
            }
            for(let target=0;target<32;target++) {
                const bound=bounds[target],measured=bound.exactMeasure(states[from]);
                assert.ok(measured.bound<=dist[target],'partition exceeds Dijkstra');
                for(let i=0;i<flips.length;i++)assert.ok(bound.exactRemaining(measured,edits[i])<=bound.measure(states[from^flips[i]]),'lazy partition overestimate');
                checked++;
            }
        }
    }
    assert.equal(checked,3072);
});

test('actual registry effects cover strings, declaration types and constraints through partial states',t=>{
    const samples=[
        ["CREATE TABLE t(id INTEGER,a TEXT,b TEXT,c TEXT CHECK(c='blue'))",
         "CREATE TABLE t(id,a TEXT NOT NULL,b TEXT NOT NULL,c TEXT CHECK(c='pink'))"],
        ['CREATE TABLE t(id INTEGER,a TEXT,b TEXT,c TEXT)',
         'CREATE TABLE t(id,a TEXT NOT NULL,b TEXT NOT NULL,c TEXT UNIQUE)'],
        ["ALTER TABLE t ADD a TEXT DEFAULT 'yes' CHECK(a IN ('yes','no'))",
         'ALTER TABLE t ADD COLUMN a TEXT NOT NULL DEFAULT "no" CHECK(a="yes" OR a="no") REFERENCES p(id)'],
        ['CREATE TABLE t(id INTEGER PRIMARY KEY,a TEXT,b INT REFERENCES p(id))',
         "CREATE TABLE t(id INTEGER PRIMARY KEY NOT NULL,a TEXT CONSTRAINT u UNIQUE DEFAULT 'a' CHECK(a<>'b'),b INT,FOREIGN KEY(b) REFERENCES p(id),CHECK(a IN ('a','b')))"],
        ["SELECT length(a),CAST('yes' AS TEXT) FROM t WHERE a='no'",
         "SELECT length(a),CAST('yes' AS TEXT) FROM t WHERE a='no' OR a='no'"],
        ["SELECT a FROM t WHERE a BETWEEN 'a' AND 'z'",
         "SELECT a FROM t WHERE a>='a' AND a<='z'"],
        ["SELECT a FROM t WHERE a IN ('yes','no')",
         "SELECT a FROM t WHERE a='yes' OR a='no'"],
        ["CREATE TABLE t(a TEXT CONSTRAINT n NOT NULL CONSTRAINT d DEFAULT 'no')",
         "CREATE TABLE t(a VARCHAR CONSTRAINT n NOT NULL CONSTRAINT c CHECK(a='yes'))"]
    ];
    let checked=0,free=0,partial=0;
    const schema={tables:[{name:'p',type:'table',columns:[{name:'id',pk:1,type:'INTEGER'}]},
        {name:'t',type:'table',columns:[{name:'a',pk:0,type:'TEXT'}]}]};
    for(const [a,b]of samples)for(const costs of [{},{baseAddComponent:0},{baseChangeComponent:0},{repairColumnNullable:0},{baseRemoveComponent:0}]) {
        const from=parse(a),to=parse(b),graph=createEditGraph(to,from,schema,costs),bound=createDdlWorkBound(to,graph.edits,graph.ddlWorkOptions);
        assert.deepEqual(graph.edits.filter(e=>['maxNewConstraints','maxNewDdlStrings','maxDeclaredTypeWork','maxNewCheckWork'].some(k=>!Number.isSafeInteger(e[k])||e[k]<0)).map(e=>e.name),[],
            'Every registered edit requires explicit audited C/S/T/K effects');
        const states=[from,to],seen=new Set(states.map(stableKey));
        for(const edit of graph.edits.filter(e=>/^removeDefinition|^unsetDefinition|^removeAlter|^unsetDataType|^removeCheck|^removeDefault/.test(e.name))) {
            let count=0;for(const change of edit.apply(to)) {
                const key=stableKey(change.root);if(!seen.has(key)){seen.add(key);states.push(change.root);partial++;}
                if(++count===2)break;
            }
            if(states.length>=8)break;
        }
        for(const root of states) {
            const before=inventory(root),measured=bound.exactMeasure(root);
            for(const edit of graph.edits)for(const change of edit.apply(root)) {
                const after=inventory(change.root),next=bound.exactMeasure(change.root);
                const c=constraintIncrease(before.constraints,after.constraints),s=[...after.strings].filter(v=>!before.strings.has(v)).length;
                assert.ok(c<=edit.maxNewConstraints,edit.name+' C '+c+' > '+edit.maxNewConstraints);
                assert.ok(s<=edit.maxNewDdlStrings,edit.name+' S '+s+' > '+edit.maxNewDdlStrings);
                const k=[1,2,4].filter(bit=>(after.checkMask&bit)&&!(before.checkMask&bit)).length;
                assert.ok(k<=edit.maxNewCheckWork,edit.name+' K '+k+' > '+edit.maxNewCheckWork);
                for(const target of [inventory(from),inventory(to)]) {
                    const work=ddlWorkDeficit(target,before),newWork=ddlWorkDeficit(target,after);
                    assert.ok(work.types-newWork.types<=edit.maxDeclaredTypeWork,edit.name+' T '+(work.types-newWork.types)+' > '+edit.maxDeclaredTypeWork);
                }
                if(!Object.keys(costs).length&&edit.cost===0) {
                    assert.deepEqual(after,before,edit.name+' free DDL inventory');free++;
                }
                assert.ok(measured.bound<=edit.cost+next.bound,edit.name+' consistency');
                assert.ok(bound.exactRemaining(measured,edit)<=next.bound,edit.name+' lazy remainder');
                assert.equal(stableKey(replayOperation(root,change.operation)),stableKey(change.root));checked++;
            }
        }
    }
    t.diagnostic({checked,free,partial});
});

test('integrated DDL search certifies four independent repairs before state expansion',async t=>{
    const pairs=[
        ["CREATE TABLE t(id INTEGER,a TEXT,b TEXT,c TEXT CHECK(c='blue'))",
         "CREATE TABLE t(id,a TEXT NOT NULL,b TEXT NOT NULL,c TEXT CHECK(c='pink'))",4],
        ['CREATE TABLE t(id INTEGER,a TEXT,b TEXT,c TEXT)',
         'CREATE TABLE t(id,a TEXT NOT NULL,b TEXT NOT NULL,c TEXT UNIQUE)',4],
        ["ALTER TABLE t ADD a DEFAULT 'other' CHECK(a IN ('other','maybe'))",
         "ALTER TABLE t ADD a TEXT DEFAULT 'no' CHECK(a IN ('yes','no'))",3],
        ['CREATE TABLE t(a)','CREATE TABLE t(a NOT NULL CHECK(a>=0))',4]
    ];
    const observed=[];
    for(const [a,b,expected]of pairs) {
        const from=parse(a),to=parse(b),graph=createEditGraph(to,from),bound=createDdlWorkBound(to,graph.edits,graph.ddlWorkOptions);
        assert.equal(bound.measure(from),expected);
        const result=await shortestSqlEditPath(to,from,graph,{async tick(){}},{cutoff:expected});
        assert.equal(result.capped,true);assert.equal(result.distance,expected);assert.equal(result.visited,0);
        observed.push({expected,work:bound.exactMeasure(from).work,visited:result.visited});
    }
    const from=parse('CREATE TABLE t(a TEXT)'),to=parse('CREATE TABLE t(a TEXT NOT NULL)'),graph=createEditGraph(to,from,{}, {repairColumnNullable:0});
    assert.equal(createDdlWorkBound(to,graph.edits).measure(from),0);
    const zero=await shortestSqlEditPath(to,from,graph,{async tick(){}},{cutoff:5});
    assert.equal(zero.distance,0);assert.equal(zero.capped,false);
    t.diagnostic(observed);
});

test('SQLite quoting PK FK and scoped query free edges preserve every DDL work dimension',t=>{
    const schemaSql='CREATE TABLE parent(id INTEGER PRIMARY KEY,label TEXT);CREATE TABLE child(parent_id INTEGER,flag TEXT,PRIMARY KEY(parent_id,flag));';
    const schema={tables:[
        {name:'parent',type:'table',columns:[{name:'id',type:'INTEGER',pk:1},{name:'label',type:'TEXT',pk:0}]},
        {name:'child',type:'table',columns:[{name:'parent_id',type:'INTEGER',pk:1},{name:'flag',type:'TEXT',pk:2}]}
    ]};
    const pairs=[
        ['CREATE TABLE fresh(id INTEGER PRIMARY KEY NOT NULL,x TEXT DEFAULT "unset",parent_id REFERENCES parent(id))',
         "CREATE TABLE fresh(id INTEGER PRIMARY KEY,x TEXT DEFAULT 'unset',parent_id,FOREIGN KEY(parent_id) REFERENCES parent)"],
        ["ALTER TABLE parent ADD x TEXT DEFAULT 'no' CHECK(x<>'yes')",
         'ALTER TABLE parent ADD COLUMN x TEXT DEFAULT "no" CHECK(x<>"yes")'],
        ["SELECT label FROM parent WHERE id IN (SELECT parent_id FROM child WHERE flag='yes')",
         "SELECT parent.label FROM parent INNER JOIN child ON parent.id=child.parent_id WHERE child.flag='yes'"],
        ["SELECT parent.label,child.flag FROM parent JOIN child ON parent.id=child.parent_id WHERE child.flag='yes'",
         "SELECT parent.label,child.flag FROM child JOIN parent ON parent.id=child.parent_id WHERE child.flag='yes'"],
        ["DELETE FROM parent WHERE id IN (SELECT parent_id FROM child WHERE flag='yes')",
         "DELETE FROM parent WHERE id IN (SELECT child.parent_id FROM child AS child WHERE child.flag='yes')"]
    ];
    let checked=0;const covered=new Set();
    for(const [a,b]of pairs) {
        const from=parse(a),to=parse(b),graph=createEditGraph(to,from,schema,{}, {schemaSql});
        const states=new Map([[stableKey(from),from],[stableKey(to),to]]);
        for(const root of [from,to])for(const edit of graph.edits.filter(e=>e.cost===0))for(const change of edit.apply(root))states.set(stableKey(change.root),change.root);
        for(const root of states.values())for(const edit of graph.edits.filter(e=>e.cost===0))for(const change of edit.apply(root)) {
            assert.deepEqual(inventory(change.root),inventory(root),edit.name);
            assert.equal(edit.maxNewConstraints,0);assert.equal(edit.maxNewDdlStrings,0);assert.equal(edit.maxDeclaredTypeWork,0);
            assert.equal(edit.maxNewCheckWork,0);
            assert.equal(stableKey(replayOperation(root,change.operation)),stableKey(change.root));
            covered.add(edit.name);checked++;
        }
    }
    for(const name of ['quoteUnboundSqliteString','toggleIntegerPrimaryKeyNotNull','toggleExplicitPrimaryKeyReference',
        'toggleAlterAddColumnKeyword','relocateSingleColumnForeignKey','qualifyLocalSubqueryColumn','toggleLocalSubqueryTableAlias'])assert.ok(covered.has(name),name);
    assert.ok([...covered].some(name=>/semijoin/i.test(name)),'new IN/inner join edge');
    assert.ok([...covered].some(name=>/commut.*join|join.*commut/i.test(name)),'new inner join commutation edge');
    t.diagnostic({checked,covered:[...covered].sort()});
});

test('CHECK expression features ignore free CASE labels COUNT spelling and exact integer syntax',()=>{
    const mask=createCheckExpressionInventory(),expr=sql=>parse('SELECT '+sql).slots.statements[0].slots.columns[0].slots.expr;
    assert.equal(mask(expr('a>=0')),7);assert.equal(mask(expr('a+1')),3);
    assert.equal(mask(expr('COUNT(1)')),0);assert.equal(mask(expr('COUNT(*)')),0);
    assert.equal(mask(expr('2-1')),2);assert.equal(mask(expr('1')),2);
    assert.equal(mask(expr('a BETWEEN b AND c')),5);assert.equal(mask(expr('a>=b AND a<=c')),5);
    assert.equal(mask(expr("a NOT IN ('x','y')")),7);assert.equal(mask(expr("a<>'x' AND a<>'y'")),7);
    const predicate=expr('a=b OR c=d'),encoded=encodedBooleanCase(predicate);
    assert.equal(mask(predicate),5);assert.equal(mask(encoded),5);
    const changed={...encoded,slots:{...encoded.slots,args:encoded.slots.args.map((item,i)=>i?item:{...item,slots:{...item.slots,
        cond:notExpression(binaryExpression('AND',notExpression(predicate.slots.left),notExpression(predicate.slots.right)))}})}};
    assert.equal(mask(changed),5,'one-WHEN free De Morgan must not expose CASE literal labels');
    const broken={...encoded,attrs:{unexpected:true}};assert.equal(mask(broken),7,'a paid recognition-breaking attribute can expose the literal bit');
    assert.equal(inventory(parse('SELECT a>=0')).checkMask,0,'features outside Check nodes are not evidence');
    assert.equal(inventory(parse('CREATE TABLE t(a CHECK(a>=0))')).checkMask,7);
    assert.equal(inventory(parse('CREATE TABLE t(a CHECK(a),b CHECK(0))')).checkMask,3,'global presence across checks, no multiplicity');
    const template=binaryExpression('>=',null,expr('0'));
    assert.equal(inventory.maximumTemplateCheckWork(template),2);
    assert.equal(inventory.maximumTemplateCheckWork(binaryExpression('>',null,expr('a'))),3,'copying a column comparison can also break a surrounding partial CASE');
    assert.equal(inventory.maximumTemplateCheckWork(binaryExpression('>',null,expr('a')),{hiddenLiteralPossible:false}),2);
    const count=expr('COUNT(1)'),countArgument=count.slots.args.slots.expr;
    const brokenCount={...count,slots:{...count.slots,args:{...count.slots.args,slots:{...count.slots.args.slots,
        expr:binaryExpression('>=',expr('a'),countArgument)}}}};
    assert.equal(mask(count),0);assert.equal(mask(brokenCount),7,'a two-feature template can expose a third hidden COUNT literal');
    const from=parse('CREATE TABLE t(a)'),to=parse('CREATE TABLE t(a NOT NULL CHECK(a>=0))');
    const bound=createDdlWorkBound(to,[edge(1,1),edge(1,0,0,0,2),edge(0)]);
    assert.deepEqual(bound.exactMeasure(from).work,{constraints:2,strings:0,types:0,check:3});
    assert.equal(bound.measure(from),4);
    assert.equal(bound.exactRemaining(bound.exactMeasure(from),edge(1,0,0,0,2)),3);
});

test('four-dimensional partitions remain below independent CHECK-feature Dijkstra paths',()=>{
    const n=(kind,attrs={},slots={})=>({kind,attrs,slots});
    const states=Array.from({length:16},(_,bits)=>n('Definition',{}, {
        nullable:bits&1?n('NotNull'):null,
        check:n('Check',{}, {expr:n('ExpressionList',{}, {value:[
            ...(bits&2?[n('ColumnReference',{column:'a'})]:[]),
            ...(bits&4?[n('NumberLiteral',{value:'0',storageClass:'integer'})]:[]),
            ...(bits&8?[n('BinaryExpression',{operator:'>='},{left:null,right:null})]:[])
        ]})})}));
    let checked=0;
    for(const prices of [[1,1,1,1,1],[3,2,1,3,2],[0,1,2,1,0]]) {
        const flips=[1,2,4,8,10],edits=prices.map((cost,i)=>edge(cost,i===0?1:0,0,0,i===0?0:i===4?2:1));
        const bounds=states.map(target=>createDdlWorkBound(target,edits));
        for(let from=0;from<16;from++) {
            const dist=Array(16).fill(Infinity),pending=new Set(states.map((_,i)=>i));dist[from]=0;
            while(pending.size) {
                const at=[...pending].reduce((a,b)=>dist[a]<dist[b]?a:b);pending.delete(at);
                for(let i=0;i<flips.length;i++)dist[at^flips[i]]=Math.min(dist[at^flips[i]],dist[at]+prices[i]);
            }
            for(let target=0;target<16;target++) {
                const bound=bounds[target],measured=bound.exactMeasure(states[from]);assert.ok(measured.bound<=dist[target]);
                for(let i=0;i<flips.length;i++)assert.ok(bound.exactRemaining(measured,edits[i])<=bound.measure(states[from^flips[i]]));
                checked++;
            }
        }
    }
    assert.equal(checked,768);
});

test('actual CHECK effects survive CASE COUNT numeric and incomplete constructor states',t=>{
    const samples=[
        ['CREATE TABLE t(a)','CREATE TABLE t(a NOT NULL CHECK(a>=0))'],
        ['CREATE TABLE t(a CHECK(CASE WHEN a=b OR c=d THEN 1 WHEN NOT(a=b OR c=d) THEN 0 ELSE NULL END),b,c,d)',
         'CREATE TABLE t(a CHECK(a=b OR c=d),b,c,d)'],
        ['CREATE TABLE t(a CHECK(COUNT(1)))','CREATE TABLE t(a CHECK(SUM(a>=1)))'],
        ['CREATE TABLE t(a CHECK(a BETWEEN b AND c),b,c)','CREATE TABLE t(a CHECK(a>=b AND a<=c),b,c)'],
        ['CREATE TABLE t(a CHECK(a>=2-1))','CREATE TABLE t(a CHECK(a>=1))'],
        ['CREATE TABLE t(a CHECK(NOT(a=b AND c=d)),b,c,d)','CREATE TABLE t(a CHECK(NOT(a=b) OR NOT(c=d)),b,c,d)']
    ];
    let checked=0,partial=0,free=0;const covered=new Set();
    for(const [a,b]of samples)for(const costs of [{},{baseAddComponent:0},{restoreMissingBinaryTerm:0}]) {
        const from=parse(a),to=parse(b),graph=createEditGraph(to,from,{},costs),bound=createDdlWorkBound(to,graph.edits,graph.ddlWorkOptions);
        const states=new Map([[stableKey(from),from],[stableKey(to),to]]);
        for(const root of [from,to])for(const edit of graph.edits.filter(e=>/^remove|^unset/.test(e.name))) {
            let count=0;for(const change of edit.apply(root)){states.set(stableKey(change.root),change.root);partial++;if(++count===1)break;}
            if(states.size>=12)break;
        }
        for(const root of states.values()) {
            const before=inventory(root),measured=bound.exactMeasure(root);
            for(const edit of graph.edits)for(const change of edit.apply(root)) {
                const after=inventory(change.root),newBits=[1,2,4].filter(bit=>(after.checkMask&bit)&&!(before.checkMask&bit)).length;
                assert.ok(Number.isSafeInteger(edit.maxNewCheckWork),edit.name+' lacks K certificate');
                assert.ok(newBits<=edit.maxNewCheckWork,edit.name+' K '+newBits+' > '+edit.maxNewCheckWork);
                if(!Object.keys(costs).length&&edit.cost===0){assert.equal(after.checkMask,before.checkMask,edit.name+' free K');free++;covered.add(edit.name);}
                const next=bound.exactMeasure(change.root);
                assert.ok(measured.bound<=edit.cost+next.bound,edit.name+' four-dimensional consistency');
                assert.ok(bound.exactRemaining(measured,edit)<=next.bound,edit.name+' four-dimensional lazy remainder');
                assert.equal(stableKey(replayOperation(root,change.operation)),stableKey(change.root));checked++;
            }
        }
        const restore=graph.edits.find(e=>e.name==='restoreMissingBinaryTerm');
        if(a==='CREATE TABLE t(a)')assert.equal(restore.maxNewCheckWork,2,'CASE/COUNT-free constructor domain permits the tight template bound');
        if(a.includes('COUNT'))assert.equal(restore.maxNewCheckWork,3,'COUNT domain must retain hidden-literal penalty');
    }
    for(const name of ['countStarOne','rewriteBetweenRange','rewriteExactIntegerConstant','deMorganBoolean'])assert.ok(covered.has(name),name);
    t.diagnostic({checked,partial,free,covered:[...covered].sort()});
});
