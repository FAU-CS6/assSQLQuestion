import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';
import {sqlWorkBound} from '../../lib/qss/src/graph-search.mjs';

test('free Boolean duplication can introduce CAST types without paid component work', () => {
    const answer = parseGraphSql('SELECT id FROM sample WHERE CAST(value AS INTEGER)>0').root;
    const target = parseGraphSql('SELECT id FROM sample WHERE CAST(value AS INTEGER)>0 AND CAST(value AS INTEGER)>0').root;
    const graph = createEditGraph(target, answer);
    const edge = [...graph.edits.find(edit => edit.name === 'duplicateBooleanPredicate').apply(answer)]
        .find(edge => stableKey(edge.root) === stableKey(target));
    assert.ok(edge, 'This actual zero-cost edge proves a zero upper bound.');
    assert.equal(edge.operation.cost, 0);
    assert.equal(sqlWorkBound(target, graph, 0).measure(answer, 0), 0);
});

test('custom-priced Boolean duplication can copy arbitrarily many nested CAST types in one edit', () => {
    const predicate = 'CAST(CAST(CAST(value AS INTEGER) AS TEXT) AS NUMERIC)>0';
    const answer = parseGraphSql('SELECT id FROM sample WHERE ' + predicate).root;
    const target = parseGraphSql('SELECT id FROM sample WHERE (' + predicate + ') AND (' + predicate + ')').root;
    const graph = createEditGraph(target, answer, {}, {duplicateBooleanPredicate: 1});
    const edge = [...graph.edits.find(edit => edit.name === 'duplicateBooleanPredicate').apply(answer)]
        .find(edge => stableKey(edge.root) === stableKey(target));
    assert.ok(edge);
    assert.ok(sqlWorkBound(target, graph, 0).measure(answer, 0) <= edge.operation.cost);
});
