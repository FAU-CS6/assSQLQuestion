import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey, walkNodes} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';
import {evaluate} from '../../lib/qss/src/engine.mjs';
import {atomicPredicateFacts, targetAtomicProfile, proposedAtomicEffect, createAtomicPredicateBound} from '../../lib/qss/src/atomic-predicate-bound.mjs';

const ast = sql => parseGraphSql(sql).root;
const clone = value => JSON.parse(JSON.stringify(value));
const facts = (graph, root) => atomicPredicateFacts(graph.abstractRoot(root));
const sorted = set => [...set].sort();
const increase = (after, before) => [...after].filter(value => !before.has(value)).length;
const where = root => root.slots.statements[0].slots.where;
const wrap = value => ({kind: 'Script', attrs: {}, slots: {statements: [{kind: 'Delete', attrs: {}, slots: {where: value}}]}});
const binary = (operator, left, right) => ({kind: 'BinaryExpression', attrs: {operator}, slots: {left, right}});
const column = name => ({kind: 'ColumnReference', attrs: {column: name}, slots: {}});
const number = value => ({kind: 'NumberLiteral', attrs: {value: String(value), storageClass: 'integer'}, slots: {}});
function distances(states, edges, target) {
    const result = states.map(() => Infinity), remaining = new Set(states.map((_, i) => i));
    result[target] = 0;
    while (remaining.size) {
        const at = [...remaining].sort((a, b) => result[a] - result[b])[0];
        remaining.delete(at);
        for (const edge of edges) if (edge.to === at) result[edge.from] = Math.min(result[edge.from], result[at] + edge.cost);
    }
    return result;
}
function checkReducedGraph(states, names, expected) {
    const target = states.at(-1), graph = createEditGraph(target, states[0]);
    const edits = graph.edits.filter(edit => names.includes(edit.name));
    const keys = states.map(stableKey), edges = [];
    for (let from = 0; from < states.length; from++) for (const edit of edits) for (const edge of edit.apply(states[from])) {
        const to = keys.indexOf(stableKey(edge.root));
        if (to >= 0) edges.push({from, to, cost: edit.cost});
    }
    const bound = createAtomicPredicateBound(target, {...graph, edits}), exact = distances(states, edges, states.length - 1);
    assert.equal(exact[0], expected);
    assert.equal(bound.measure(states[0]), expected);
    for (let i = 0; i < states.length; i++) assert.ok(bound.measure(states[i]) <= exact[i]);
    for (const edge of edges) {
        assert.ok(bound.measure(states[edge.from]) <= edge.cost + bound.measure(states[edge.to]));
        assert.ok(bound.exactRemaining(bound.exactMeasure(states[edge.from]), edits.find(edit => edit.cost === edge.cost)) <= bound.measure(states[edge.to]));
    }
}

test('atomic facts preserve free comparison rewrites without preserving SELECT scope or qualifiers', () => {
    for (const [left, right] of [
        ['a BETWEEN 1 AND 2', 'a>=1 AND a<=2'], ['a NOT BETWEEN 1 AND 2', 'a<1 OR a>2'],
        ['a IN(1,2,3)', 'a=1 OR a=2 OR a=3'], ['a NOT IN(1,2)', 'a<>1 AND a<>2'],
        ['a=1', '1=a'], ['NOT(a<=2)', 'a>2'], ['NOT NOT(a=1)', 'a=1'],
        ['a=1', 'a=1 OR a=1'], ['a=5', 'a=(2+3)'], ['a=5', 'a=(10-5)'], ['a=1', 'T.A=1']
    ]) {
        const from = ast('DELETE FROM t WHERE ' + left), target = ast('DELETE FROM t WHERE ' + right), graph = createEditGraph(target, from);
        assert.deepEqual(sorted(facts(graph, from)), sorted(facts(graph, target)), left + ' / ' + right);
    }
    assert.equal(atomicPredicateFacts(ast('SELECT a FROM t WHERE a=1')).size, 0);
});

test('outer UPDATE SET and WHERE distinguish repeated nested query predicates', () => {
    const root = ast("UPDATE t SET a=(SELECT id FROM q WHERE name='same') WHERE a=(SELECT id FROM q WHERE name='same')");
    const target = atomicPredicateFacts(root);
    assert.equal(target.size, 3, 'One SET literal, one WHERE literal, one scalar query boundary.');
    assert.equal(targetAtomicProfile(target).maxColumn, 1);
});

test('one column edit may introduce several BETWEEN or IN target atoms', () => {
    for (const [predicate, count] of [['BETWEEN 1 AND 2', 2], ['IN(1,2,3)', 3]]) {
        const from = ast('DELETE FROM t WHERE a ' + predicate), target = ast('DELETE FROM t WHERE b ' + predicate);
        const graph = createEditGraph(target, from), edit = graph.edits.find(edit => edit.name === 'changeColumnReference');
        assert.ok([...edit.apply(from)].some(edge => stableKey(edge.root) === stableKey(target)));
        const profile = targetAtomicProfile(facts(graph, target));
        assert.equal(increase(facts(graph, target), facts(graph, from)), count);
        assert.equal(proposedAtomicEffect(profile, {kind: 'column-leaf'}), count);
    }
});

test('partial and mixed lists expose atoms independently of unrelated list entries', () => {
    const query = ast('DELETE FROM t WHERE a IN(SELECT b FROM q)'), mixed = clone(query);
    where(mixed).slots.right.slots.value.push(number(3));
    assert.equal(increase(atomicPredicateFacts(query), atomicPredicateFacts(mixed)), 0);
    const target = ast('DELETE FROM t WHERE a IN(1,2)'), partial = clone(target);
    where(partial).slots.right.slots.value.push(column('other'));
    assert.equal(increase(atomicPredicateFacts(target), atomicPredicateFacts(partial)), 0);
    where(partial).slots.left = null;
    assert.equal(increase(atomicPredicateFacts(target), atomicPredicateFacts(partial)), 2);
});

test('missing-term effects include a surrounding exact-integer comparison and exclude query templates', () => {
    const from = ast('DELETE FROM t WHERE a=2'), target = ast('DELETE FROM t WHERE a=(2+3)'), graph = createEditGraph(target, from);
    assert.ok([...graph.edits.find(edit => edit.name === 'restoreMissingBinaryTerm').apply(from)].some(edge => stableKey(edge.root) === stableKey(target)));
    const template = clone(where(target).slots.right); template.slots.left = null;
    const profile = targetAtomicProfile(facts(graph, target));
    assert.equal(atomicPredicateFacts(wrap(template)).size, 0);
    assert.equal(proposedAtomicEffect(profile, {kind: 'template', templates: [{retained: 'left', template}]}), 1);
    const combined = ast('DELETE FROM t WHERE a=2 AND term=3'), andTemplate = clone(where(combined)); andTemplate.slots.left = null;
    assert.equal(proposedAtomicEffect(targetAtomicProfile(atomicPredicateFacts(combined)), {kind: 'template', templates: [andTemplate]}), 1);
    assert.equal(proposedAtomicEffect(profile, {kind: 'template', templates: [where(ast('DELETE FROM t WHERE a=(SELECT b FROM q)'))]}), undefined);
});

test('a projected AS alias can bind several quoted predicates in one edit', () => {
    const from = ast('DELETE FROM t WHERE a IN(SELECT id FROM q WHERE "x"=1 OR "x"=2)');
    const target = ast('DELETE FROM t WHERE a IN(SELECT id,1 AS x FROM q WHERE x=1 OR x=2)');
    const graph = createEditGraph(target, from), profile = targetAtomicProfile(facts(graph, target));
    let actual = 0;
    for (const edge of graph.edits.find(edit => edit.name === 'insertProjectedExpression').apply(from)) {
        actual = Math.max(actual, increase(new Set([...facts(graph, edge.root)].filter(atom => profile.target.has(atom))), facts(graph, from)));
    }
    assert.ok(actual >= 2);
    const item = [...walkNodes(target)].find(({node}) => node.kind === 'SelectItem' && node.attrs.as === 'x').node;
    assert.ok(proposedAtomicEffect(profile, {kind: 'projection-template', templates: [item]}) >= actual);
    const withoutAlias = clone(item); withoutAlias.attrs.as = null;
    assert.equal(proposedAtomicEffect(profile, {kind: 'projection-template', templates: [withoutAlias]}), 0);
});

test('unknown metadata custom free repairs and contextual label abstractions disable atomic bounds', () => {
    const target = ast('DELETE FROM t WHERE a=1'), from = ast('DELETE FROM t');
    const edit = {name: 'known', cost: 1, maxNewAtomicPredicates: 1};
    assert.equal(createAtomicPredicateBound(target, {edits: [edit]}).measure(from), 1);
    for (const edits of [[{name: 'unknown', cost: 1}], [{...edit, maxNewAtomicPredicates: 1.5}], [{...edit, cost: 0}]]) {
        assert.equal(createAtomicPredicateBound(target, {edits}).enabled, false);
    }
    for (const requirements of [{freeLabels: ['label']}, {freeDiagnostics: true}]) {
        assert.equal(createAtomicPredicateBound(target, {edits: [edit]}, {requirements}).enabled, false);
    }
});

test('atomic lazy bounds subtract exact fractions before rounding and cache by root identity', () => {
    const target = ast('DELETE FROM t WHERE a IN(1,2,3,4,5,6,7,8)'), from = ast('DELETE FROM t');
    const large = {name: 'large', cost: 1, maxNewAtomicPredicates: 5}, small = {name: 'small', cost: 1, maxNewAtomicPredicates: 1};
    let abstractions = 0;
    const bound = createAtomicPredicateBound(target, {edits: [large, small], abstractRoot: root => {abstractions++; return root;}});
    const measured = bound.exactMeasure(from);
    assert.equal(measured.missing, 8);
    assert.equal(measured.numerator, 8n);
    assert.equal(measured.denominator, 5n);
    assert.equal(measured.bound, 2);
    assert.equal(bound.exactRemaining(measured, small), 2, 'ceil(8/5-1/5), not ceil(8/5)-ceil(1/5).');
    assert.equal(bound.exactRemaining(measured, large), 1);
    assert.equal(bound.exactRemaining(measured, {}), 0);
    assert.equal(bound.exactMeasure(from), measured);
    assert.equal(bound.facts(from), bound.facts(from));
    assert.equal(abstractions, 2, 'Each immutable root is abstracted once per bound.');
    const expensive = {name: 'huge', cost: Number.MAX_SAFE_INTEGER, maxNewAtomicPredicates: 3};
    const exact = createAtomicPredicateBound(target, {edits: [expensive]}).exactMeasure(from);
    assert.equal(exact.numerator, 8n * BigInt(Number.MAX_SAFE_INTEGER));
    assert.equal(exact.bound, Number.MAX_SAFE_INTEGER, 'Saturation rounds downward, retaining admissibility.');
});

test('two independent DELETE repairs agree with Dijkstra on actual selected edit edges', () => {
    const sql = (scalar, term) => `DELETE FROM mapping WHERE key ${scalar ? '=' : 'IN'} (SELECT id FROM source WHERE name='unit')${term ? ' AND term=3' : ''}`;
    checkReducedGraph([ast(sql(false, false)), ast(sql(true, false)), ast(sql(false, true)), ast(sql(true, true))],
        ['changeSubqueryComparison', 'restoreMissingBinaryTerm'], 2);
});

test('three independent UPDATE repairs agree with Dijkstra on actual selected edit edges', () => {
    const sql = (setValue, whereValue, scalar) => `UPDATE item SET key=(SELECT id FROM source WHERE name='${setValue ? 'target' : 'old'}') WHERE key=(SELECT id FROM source WHERE name='${whereValue ? 'old' : 'target'}') AND owner ${scalar ? '=' : 'IN'} (SELECT id FROM person WHERE owner_name='owner')`;
    checkReducedGraph(Array.from({length: 8}, (_, index) => ast(sql(index & 1, index & 2, index & 4))),
        ['changeSubqueryComparison', 'changeLiteral'], 3);
});

test('binary reassociation can introduce target atoms for only one column in one outer role', () => {
    // In (L op M) op R -> L op (M op R), internal atoms of L/M/R remain.
    // The new inner pair can create atoms, OR an exact-integer inner/whole
    // expression can create an enclosing literal atom. Exact integer trees
    // have no column/query predicates, so these possibilities cannot overlap.
    const subquery = where(ast('DELETE FROM t WHERE a=(SELECT id FROM q WHERE x=1)')).slots.right;
    const list = {kind: 'ExpressionList', attrs: {}, slots: {value: [number(1), number(2)]}};
    const leaves = [null, column('a'), column('b'), number(1), number(2), subquery, list];
    const operators = ['AND', 'OR', '=', '<', '+', '-', 'IN', 'BETWEEN'];
    let checked = 0;
    for (const left of leaves) for (const middle of leaves) for (const right of leaves) {
        for (const a of operators) for (const b of operators) {
            const before = binary(b, binary(a, left, middle), right), after = binary(a, left, binary(b, middle, right));
            for (const context of [value => wrap(value), value => wrap(binary('=', column('outer'), value))]) {
                for (const [source, target] of [[context(before), context(after)], [context(after), context(before)]]) {
                    const wanted = atomicPredicateFacts(target), profile = targetAtomicProfile(wanted);
                    assert.ok(increase(wanted, atomicPredicateFacts(source)) <= profile.maxColumn, 'One reassociation exceeded the target column cap.');
                    checked++;
                }
            }
        }
    }
    assert.equal(checked, 87808);
    const from = ast('UPDATE t SET x=1 WHERE (a=1) AND (b=2)'), graph = createEditGraph(from, from);
    const edit = graph.edits.find(edit => edit.name === 'reassociateBinaryOperands');
    assert.ok([...edit.apply(from)].length > 0);
    for (const edge of edit.apply(from)) {
        const wanted = facts(graph, edge.root), profile = targetAtomicProfile(wanted);
        assert.ok(increase(wanted, facts(graph, from)) <= profile.maxColumn);
        assert.deepEqual(sorted(new Set([...wanted].filter(value => value.includes('update-set')))),
            sorted(new Set([...facts(graph, from)].filter(value => value.includes('update-set')))));
    }
});

function partialStates(root) {
    const result = [root];
    for (const {node, path} of walkNodes(root)) {
        if (node.kind !== 'BinaryExpression') continue;
        for (const field of ['left', 'right']) {
            const copy = clone(root), parent = path.reduce((value, key) => typeof key === 'number' ? value[key] : value.slots[key], copy);
            parent.slots[field] = null;
            result.push(copy);
        }
    }
    return result;
}

const auditPairs = [
    ["DELETE FROM mapping WHERE key IN(SELECT id FROM source WHERE name='unit')",
        "DELETE FROM mapping WHERE key=(SELECT id FROM source WHERE name='unit') AND term=3"],
    ["UPDATE item SET key=(SELECT id FROM source WHERE name='old') WHERE key=(SELECT id FROM source WHERE name='target') AND owner IN(SELECT id FROM person WHERE owner_name='owner')",
        "UPDATE item SET key=(SELECT id FROM source WHERE name='target') WHERE key=(SELECT id FROM source WHERE name='old') AND owner=(SELECT id FROM person WHERE owner_name='owner')"],
    ['DELETE FROM t WHERE a IN(1,2,3)', 'DELETE FROM t WHERE b BETWEEN 1 AND 2'],
    ['DELETE FROM t WHERE a IN(SELECT id FROM q WHERE "x"=1 OR "x"=2)',
        'DELETE FROM t WHERE a IN(SELECT id,1 AS x FROM q WHERE x=1 OR x=2)'],
    ['UPDATE t SET a=(SELECT v>1 AS flag FROM q) WHERE NOT(a=1 AND b=2)',
        'UPDATE t SET a=(SELECT NOT(v<=1) AS flag FROM q) WHERE NOT(a=1) OR NOT(b=2)']
];

test('whole SQL catalogue atomic effects and lazy bounds cover complete and partial AST edges', () => {
    let checked = 0, free = 0, states = 0;
    const families = new Set();
    for (const [answer, reference] of auditPairs) {
        const from = ast(answer), target = ast(reference), graph = createEditGraph(target, from);
        const bound = createAtomicPredicateBound(target, graph, {requirements: graph.ddlWorkOptions});
        assert.deepEqual(bound.unknown, [], 'Every current edit has an explicit atomic effect.');
        for (const root of [...partialStates(from), ...partialStates(target)]) {
            states++;
            const before = bound.facts(root), measured = bound.exactMeasure(root);
            for (const edit of graph.edits) for (const edge of edit.apply(root)) {
                const after = bound.facts(edge.root), next = bound.exactMeasure(edge.root);
                const added = increase(new Set([...after].filter(atom => bound.profile.target.has(atom))), before);
                assert.ok(added <= edit.maxNewAtomicPredicates, edit.name + ' atomic effect ' + added + '>' + edit.maxNewAtomicPredicates);
                assert.ok(measured.bound <= edit.cost + next.bound, edit.name + ' inconsistent bound');
                assert.ok(bound.exactRemaining(measured, edit) <= next.bound, edit.name + ' lazy overestimate');
                if (edit.cost === 0) {
                    assert.deepEqual(sorted(before), sorted(after), edit.name + ' free atomic-set change');
                    free++;
                }
                checked++; families.add(edit.name);
            }
        }
    }
    assert.ok(checked > 10000);
    assert.ok(free > 100);
    globalThis.__atomicAuditStats?.({checked, free, states, families: families.size});
});

test('whole-catalogue custom zero costs and one unknown effect disable safely', () => {
    const [answer, reference] = auditPairs[0], from = ast(answer), target = ast(reference);
    for (const costs of [{changeLiteral: 0}, {changeSubqueryComparison: 0}, {restoreMissingBinaryTerm: 0}, {baseAddComponent: 0}]) {
        const graph = createEditGraph(target, from, {}, costs), bound = createAtomicPredicateBound(target, graph);
        assert.equal(bound.enabled, false);
        assert.equal(bound.measure(from), 0);
        for (const edit of graph.edits) assert.equal(bound.exactRemaining(bound.exactMeasure(from), edit), 0);
    }
    const full = createEditGraph(target, from);
    for (const effect of [undefined, Infinity, -1, 0.5]) {
        const unknown = {...full.edits[0], maxNewAtomicPredicates: effect};
        const graph = {...full, edits: [unknown, ...full.edits.slice(1)]}, bound = createAtomicPredicateBound(target, graph);
        assert.equal(bound.enabled, false);
        assert.equal(bound.measure(from), 0);
        assert.equal(bound.decrease(unknown), 0);
        assert.equal(bound.exactRemaining(bound.exactMeasure(from), unknown), 0);
    }
});

test('free De Morgan CASE encoding and reverse idempotence preserve DML atoms on actual edges', () => {
    const from = ast('UPDATE t SET a=(SELECT (x=1 AND y=2) AS flag FROM q) WHERE NOT(x=1 AND y=2)');
    const encoded = ast('UPDATE t SET a=(SELECT CASE WHEN x=1 AND y=2 THEN 1 WHEN NOT(x=1 AND y=2) THEN 0 ELSE NULL END AS flag FROM q) WHERE NOT(x=1 AND y=2)');
    const graph = createEditGraph(encoded, from);
    const names = ['deMorganBoolean', 'booleanCaseEncoding', 'duplicateBooleanPredicate', 'collapseDuplicateBooleanPredicate'];
    const roots = [from], exercised = new Set();
    for (const name of names) {
        const edit = graph.edits.find(edit => edit.name === name);
        for (const root of roots.slice()) for (const edge of edit.apply(root)) {
            assert.deepEqual(sorted(facts(graph, root)), sorted(facts(graph, edge.root)), name);
            exercised.add(name);
            // Retain one representative for reverse encoding/idempotence.
            if (roots.length < 8) roots.push(edge.root);
        }
    }
    for (const name of names) assert.ok(exercised.has(name), 'Actual edge exercised: ' + name);
});

test('integrated full engine proves synthetic two-error and three-error DML paths', async () => {
    const records = [];
    for (const [index, expected] of [[0, 2], [1, 3]]) {
        const [answer, reference] = auditPairs[index], from = ast(answer), target = ast(reference), graph = createEditGraph(target, from);
        const bound = createAtomicPredicateBound(target, graph);
        assert.equal(bound.enabled, true);
        assert.equal(bound.measure(from), expected);
        const result = await evaluate({reference, answer, maxPoints: 5, scale: 1});
        assert.equal(result.status, 'exact');
        assert.equal(result.distance, expected);
        assert.equal(result.edits.reduce((sum, edit) => sum + edit.cost, 0), expected);
        assert.equal(result.traceVerified, true);
        records.push({distance: result.distance, visited: result.visited, edits: result.edits.map(edit => ({name: edit.name, cost: edit.cost}))});
    }
    globalThis.__atomicAuditStats?.({integratedEngine: records});
});
