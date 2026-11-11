import assert from 'node:assert/strict';
import test from 'node:test';
import catalog from '../../lib/qss/cost-catalog.json' with {type:'json'};
import {parseGraphSql} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';

const parse=sql=>parseGraphSql(sql).root;
const defaults=Object.fromEntries(catalog.steps.map(step=>[step.id,step.defaultCost]));

test('a complete persisted profile accepts known edits absent from this answer pair',()=>{
    const graph=createEditGraph(parse('SELECT 1'),parse('SELECT 2'),{},defaults);
    assert.equal(new Set(catalog.steps.map(step=>step.id)).size,catalog.steps.length);
    for(const edit of graph.edits)if(edit.name in defaults)assert.equal(edit.cost,defaults[edit.name]);
    assert.throws(()=>createEditGraph(parse('SELECT 1'),parse('SELECT 2'),{},{unknownEdit:0}),/Unknown SQL edit/);
    assert.throws(()=>createEditGraph(parse('SELECT 1'),parse('SELECT 2'),{},{restoreTableConstraint:-1}),/costs/);
});

test('generic constructors and attributes receive their persisted category costs',()=>{
    const costs={...defaults,baseAddStructural:9,baseChangeComponent:4,countStarOne:3};
    const graph=createEditGraph(parse('SELECT COUNT(*) FROM sample'),parse('SELECT COUNT(1) FROM sample'),{},costs);
    assert.equal(graph.edits.find(edit=>edit.name==='addScriptStatementsSelect').cost,9);
    assert.equal(graph.edits.find(edit=>edit.name==='changeNumberLiteralValue').cost,4);
    assert.equal(graph.edits.find(edit=>edit.name==='countStarOne').cost,3);
});

test('persisted constraint costs use the actual registered step IDs',()=>{
    const root=parse('CREATE TABLE child(id INTEGER NOT NULL,pid INTEGER REFERENCES parent(id))');
    const graph=createEditGraph(root,root,{}, {...defaults,repairColumnNullable:7,repairColumnReference_definition:8});
    assert.equal(graph.edits.find(edit=>edit.name==='repairColumnNullable').cost,7);
    assert.equal(graph.edits.find(edit=>edit.name==='repairColumnReference_definition').cost,8);
});
