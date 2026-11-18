import assert from 'node:assert/strict';
import test from 'node:test';
import {ceilRatio, minimumEffectRatio, ceilEffect} from '../../lib/qss/src/integer-bound.mjs';
import {shortestSqlEditPath, sqlWorkBound, symbolFacts} from '../../lib/qss/src/graph-search.mjs';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';

const context = () => ({async tick() {}});
const state = mask => ({kind: 'Script', attrs: {}, slots: {statements: Array.from({length: 8}, (_, i) => i)
    .filter(i => mask & (1 << i)).map(i => ({kind: 'StringLiteral', attrs: {value: String(i)}, slots: {}}))}});

test('integer bounds use exact division at representational boundaries', () => {
    const huge = 1n << 60n;
    assert.equal(ceilRatio(huge + 1n, huge), 2);
    assert.equal(ceilRatio(huge, huge), 1);
    assert.equal(ceilRatio(huge - 1n, huge), 1);
    assert.equal(ceilRatio(0n, 7n), 0);
    assert.equal(ceilRatio(huge, 1n), Number.MAX_SAFE_INTEGER);
    for (let denominator = 1; denominator <= 83; denominator++) {
        const ratio = minimumEffectRatio([{cost: 1, maxNewSymbols: denominator}], 'maxNewSymbols');
        assert.equal(ceilEffect(ratio, denominator), 1);
        assert.equal(ceilEffect(ratio, denominator + 1), 2);
    }
});

test('free effects and incomplete annotations conservatively disable the exact ratio', () => {
    for (const edits of [[{cost: 0, maxNewSymbols: 3}], [{cost: 1}], [{cost: 1, maxNewSymbols: 1.5}], []]) {
        assert.equal(ceilEffect(minimumEffectRatio(edits, 'maxNewSymbols'), 5), 0);
    }
    const ratio = minimumEffectRatio([{cost: 2, maxNewSymbols: 3}, {cost: 3, maxNewSymbols: 5}], 'maxNewSymbols');
    assert.equal(ceilEffect(ratio, 8), 5);
});

test('a 4.8 rational work bound certifies the five-cost score cutoff without generating any edits', async () => {
    const graph = {edits: [{cost: 3, maxNewSymbols: 5,
        *apply() {throw new Error('Integer lower bound already excludes every positive score.');}}]};
    const result = await shortestSqlEditPath(state(255), state(0), graph, context(), {cutoff: 5});
    assert.equal(result.capped, true);
    assert.equal(result.distance, 5);
    assert.equal(result.visited, 0);
    assert.deepEqual(result.edits, []);
});

test('lazy families subtract exact fractions before rounding the remaining work', () => {
    const fractional = {cost: 1, maxNewSymbols: 5, maxNewDistinct: 0,
        statementOperation: null, introducedComponent: null};
    const work = sqlWorkBound(state(255), {edits: [fractional]}, 0.2);
    const bound = work.exactMeasure(state(0), 8);
    assert.equal(bound.bound, 2);
    assert.equal(work.exactRemaining(bound.numerator, fractional), 1);
    // A family that can introduce only one symbol drops 1/5, not a full unit.
    const small = {...fractional, maxNewSymbols: 1};
    const combined = sqlWorkBound(state(255), {edits: [fractional, small]}, 0.2);
    const remaining = combined.exactRemaining(combined.exactMeasure(state(0), 8).numerator, small);
    assert.equal(remaining, 2, 'ceil(8/5 - 1/5), not ceil(8/5) - ceil(1/5)');
});

test('rounded lazy work bounds match independent Dijkstra on 576 directed integer-cost cases', async () => {
    for (const prices of [[1, 2, 3], [0, 1, 2], [7, 2, 1]]) {
        const nodes = Array.from({length: 8}, (_, mask) => state(mask));
        const ids = new Map(nodes.map((node, id) => [stableKey(node), id]));
        const edits = prices.map((cost, bit) => ({name: 'toggle' + bit, description: 'toggle', cost, maxNewSymbols: 3,
            *apply(root) {
                const next = nodes[ids.get(stableKey(root)) ^ (1 << bit)];
                yield {root: next, operation: {type: 'sql-edit', path: [], before: root, after: next}};
            }}));
        for (let from = 0; from < 8; from++) {
            const distance = Array(8).fill(Infinity), pending = new Set(nodes.map((_, i) => i));
            distance[from] = 0;
            while (pending.size) {
                const at = [...pending].sort((a, b) => distance[a] - distance[b])[0];
                pending.delete(at);
                for (let bit = 0; bit < 3; bit++) {
                    const to = at ^ (1 << bit);
                    distance[to] = Math.min(distance[to], distance[at] + prices[bit]);
                }
            }
            for (let to = 0; to < 8; to++) for (const cutoff of [2, 4.5, Infinity]) {
                const result = await shortestSqlEditPath(nodes[to], nodes[from], {edits}, context(), {cutoff});
                assert.equal(result.distance, Math.min(distance[to], cutoff));
                assert.equal(result.capped, distance[to] >= cutoff);
                if (!result.capped) {
                    let replay = nodes[from];
                    for (const edge of result.edits) replay = replayOperation(replay, edge.operation);
                    assert.equal(stableKey(replay), stableKey(nodes[to]));
                }
            }
        }
    }
});

test('integer SQL work and lazy decrease remain admissible on actual SQL edges and custom free effects', () => {
    const answer = parseGraphSql('SELECT id FROM sample').root;
    const target = parseGraphSql('SELECT DISTINCT value, id FROM sample').root;
    for (const costs of [{}, {changeLiteral: 0}, {baseAddComponent: 0}, {baseSetDistinct: 0}]) {
        const graph = createEditGraph(target, answer, {}, costs);
        const ratio = minimumEffectRatio(graph.edits, 'maxNewSymbols');
        const unit = Number(ratio.numerator) / Number(ratio.denominator);
        const work = sqlWorkBound(target, graph, unit), destination = symbolFacts(target);
        const measure = root => {
            const have = symbolFacts(root);
            return work.integerMeasure(root, [...destination].filter(fact => !have.has(fact)).length);
        };
        assert.equal(measure(target), 0);
        for (const edit of graph.edits) for (const edge of edit.apply(answer)) {
            assert.ok(measure(answer) <= edit.cost + measure(edge.root), edit.name);
            assert.ok(measure(answer) - measure(edge.root) <= work.integerDecrease(edit), edit.name);
            const have = symbolFacts(answer), count = [...destination].filter(fact => !have.has(fact)).length;
            assert.ok(work.exactRemaining(work.exactMeasure(answer, count).numerator, edit) <= measure(edge.root), edit.name);
        }
    }
});
