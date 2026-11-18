import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql,stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph,replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {createStatementBound} from '../../lib/qss/src/statement-bound.mjs';
import {shortestSqlEditPath} from '../../lib/qss/src/graph-search.mjs';

const parse=sql=>parseGraphSql(sql).root;
const schemaSql='CREATE TABLE sample(id INTEGER PRIMARY KEY,value INTEGER,label TEXT);CREATE TABLE other(link INTEGER,label TEXT);';
const schema={tables:[{name:'sample',type:'table',columns:[{name:'id',pk:1,type:'INTEGER'},{name:'value',type:'INTEGER'},{name:'label',type:'TEXT'}]},
    {name:'other',type:'table',columns:[{name:'link',type:'INTEGER'},{name:'label',type:'TEXT'}]}]};
const context=()=>({async tick(){}});

test('changed projected aggregate and missing root ordering have exact independent cost two',async()=>{
    const from=parse('SELECT MIN(value) FROM sample'),to=parse('SELECT MAX(value) FROM sample ORDER BY value');
    const graph=createEditGraph(to,from,schema,{}, {schemaSql}),bound=createStatementBound(to,graph);
    assert.equal(bound.measure(from),2);
    const result=await shortestSqlEditPath(to,from,graph,context(),{cutoff:5});
    assert.equal(result.distance,2);assert.equal(result.capped,false);assert.equal(result.visited,0);
    assert.equal(stableKey(result.edits.reduce((root,edge)=>replayOperation(root,edge.operation),from)),stableKey(to));
    const distinct=parse('SELECT DISTINCT MAX(value) FROM sample ORDER BY value');
    assert.equal(createStatementBound(distinct,createEditGraph(distinct,from,schema,{}, {schemaSql})).measure(from),4);
    for(const options of [{freeLabels:['result']},{freeDiagnostics:true}]) {
        const relaxed=createEditGraph(to,from,schema,{}, {...options,schemaSql});
        assert.ok(createStatementBound(to,relaxed).measure(from)<=1,'task-specific label/diagnostic permissions disable aggregate/order partition');
    }
});

test('all registry edges respect aggregate/order alignment through aliases and partial statements',t=>{
    const pairs=[
        ['SELECT MIN(value) FROM sample','SELECT MAX(value) FROM sample ORDER BY value'],
        ['SELECT DISTINCT MIN(value) FROM sample','SELECT MAX(value) FROM sample ORDER BY value'],
        ['SELECT MIN(s.value) AS low FROM sample s','SELECT MAX(q.value) AS high FROM sample q ORDER BY high'],
        ['SELECT MIN(s.value),o.label FROM sample s JOIN other o ON s.id=o.link WHERE s.value>0',
         'SELECT MAX(s.value),o.label FROM other o JOIN sample s ON s.id=o.link WHERE s.value>0 ORDER BY o.label'],
        ['SELECT (SELECT MIN(value) FROM sample) AS result FROM other',
         'SELECT (SELECT MAX(value) FROM sample ORDER BY value) AS result FROM other ORDER BY link'],
        ['SELECT COUNT(1) AS result FROM sample','SELECT COUNT(*) AS result FROM sample ORDER BY id'],
        ['SELECT MIN(value) FROM sample;SELECT MAX(value) FROM sample ORDER BY value',
         'SELECT MAX(value) FROM sample ORDER BY value;SELECT MIN(value) FROM sample'],
        ['SELECT value FROM sample WHERE label="result" ORDER BY "result"',
         'SELECT MAX(value) AS result FROM sample WHERE label=result ORDER BY result']
    ];
    const profiles=[{}, {baseChangeComponent:0},{baseAddStructural:1,baseRemoveStructural:1},
        {baseAddStructural:0},{baseRemoveStructural:0},{baseChangeDistinct:0}];
    let checked=0,partial=0,free=0;
    for(const [a,b]of pairs)for(const costs of profiles) {
        const from=parse(a),to=parse(b),graph=createEditGraph(to,from,schema,costs,{schemaSql}),bound=createStatementBound(to,graph);
        const states=new Map([[stableKey(from),from],[stableKey(to),to]]);
        for(const root of [from,to])for(const edit of graph.edits.filter(edit=>/^removeSelect|^removeScript|^unsetSelect|^unsetAggregate/.test(edit.name))) {
            let count=0;for(const edge of edit.apply(root)){states.set(stableKey(edge.root),edge.root);partial++;if(++count===1)break;}
            if(states.size>=10)break;
        }
        for(const root of states.values()) {
            const before=bound.measure(root);
            for(const edit of graph.edits)for(const edge of edit.apply(root)) {
                const after=bound.measure(edge.root),label=edit.name+' '+JSON.stringify(costs);
                assert.ok(before<=edit.cost+after,label+' consistency '+before+' > '+edit.cost+' + '+after);
                assert.ok(before-after<=bound.decrease(edit),label+' lazy decrease '+(before-after)+' > '+bound.decrease(edit));
                if(!Object.keys(costs).length&&edit.cost===0){assert.equal(before,after,label+' free invariant');free++;}
                assert.equal(stableKey(replayOperation(root,edge.operation)),stableKey(edge.root));checked++;
            }
        }
    }
    t.diagnostic({checked,partial,free});
});

test('statement aggregate/order bound is below independent directed registry Dijkstra distances',t=>{
    const roots=[];
    for(const aggregate of ['MIN','MAX'])for(const ordered of [false,true])for(const distinct of [false,true]) {
        const root=parse(`SELECT ${distinct?'DISTINCT ':''}${aggregate}(value) FROM sample${ordered?' ORDER BY value':''}`);
        roots.push(root);
        if(aggregate==='MIN')roots.push({...root,slots:{...root.slots,statements:root.slots.statements.map(statement=>({...statement,slots:{...statement.slots,columns:[]}}))}});
    }
    const empty={kind:'Script',attrs:{},slots:{statements:[]}};roots.push(empty);
    const states=[...new Map(roots.map(root=>[stableKey(root),root])).values()],indices=new Map(states.map((root,index)=>[stableKey(root),index]));
    let pairs=0,edges=0;
    for(const costs of [{},{changeAggregateType:0},{baseChangeComponent:0},{baseAddStructural:1,baseRemoveStructural:1}]) {
        const base=createEditGraph(states.at(-2),states[0],schema,costs,{schemaSql});
        // Actual one-hop registry edges define this finite directed graph.
        // Its Dijkstra implementation is independent of production search.
        const adjacency=states.map(root=>base.edits.flatMap(edit=>[...edit.apply(root)].map(edge=>({to:indices.get(stableKey(edge.root)),cost:edit.cost})).filter(edge=>edge.to!==undefined)));
        edges+=adjacency.reduce((sum,list)=>sum+list.length,0);
        for(let start=0;start<states.length;start++) {
            const distance=states.map(()=>Infinity),pending=new Set(states.map((_,i)=>i));distance[start]=0;
            while(pending.size) {
                const at=[...pending].reduce((a,b)=>distance[a]<distance[b]?a:b);pending.delete(at);
                for(const edge of adjacency[at])distance[edge.to]=Math.min(distance[edge.to],distance[at]+edge.cost);
            }
            for(let target=0;target<states.length;target++)if(Number.isFinite(distance[target])) {
                const graph=createEditGraph(states[target],states[start],schema,costs,{schemaSql}),bound=createStatementBound(states[target],graph);
                assert.ok(bound.measure(states[start])<=distance[target],start+' -> '+target+' '+JSON.stringify(costs));pairs++;
            }
        }
    }
    assert.ok(pairs>100&&edges>100);t.diagnostic({pairs,edges,states:states.length});
});
