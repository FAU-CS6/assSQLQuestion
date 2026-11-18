import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';
import {orderedComparisonMask, createOrderedComparisonBound} from '../../lib/qss/src/ordered-comparison-bound.mjs';

const parse = sql => parseGraphSql(sql).root;
const change = cost => ({cost, maxOrderedComparisonChange: 1});
const preserve = cost => ({cost, maxOrderedComparisonChange: 0});

test('ordered comparison masks retain raw NOT groups all CASE branches BETWEEN and incomplete ASTs', () => {
    for (const [sql, expected] of [
        ['SELECT 1', 0], ['SELECT x<1 FROM t', 1], ['SELECT x>1 FROM t', 1],
        ['SELECT x<=1 FROM t', 2], ['SELECT x>=1 FROM t', 2], ['SELECT NOT(x<=1) FROM t', 2],
        ['SELECT x BETWEEN 1 AND 2 FROM t', 2], ['SELECT x NOT BETWEEN 1 AND 2 FROM t', 1],
        ['SELECT CASE WHEN x>1 THEN x<=2 ELSE 0 END FROM t', 3],
        ['SELECT x IN (SELECT y FROM u WHERE y>=1) FROM t', 2]
    ]) assert.equal(orderedComparisonMask(parse(sql)), expected, sql);
    const incomplete = {kind: 'BinaryExpression', attrs: {operator: '<='}, slots: {left: null, right: null}};
    assert.equal(orderedComparisonMask(incomplete), 2);
    assert.equal(orderedComparisonMask({...incomplete, slots: {left: {kind: 'NumberLiteral', attrs: {value: '>'}, slots: {}}}}), 2);
    const caseNode = {kind: 'CaseExpression', attrs: {}, slots: {args: [null, incomplete,
        {kind: 'BinaryExpression', attrs: {operator: '<'}, slots: {left: null}}]}};
    assert.equal(orderedComparisonMask(caseNode), 3);
});

test('binary operator certificate respects costs custom zero and unknown-effect fail-closed behavior', () => {
    const target = parse('SELECT x>1 FROM t'), source = parse('SELECT NOT(x<=1) FROM t');
    const edits = [preserve(0), preserve(1), change(2), change(1)], bound = createOrderedComparisonBound(target, edits);
    assert.equal(bound.measure(source), 1); assert.equal(bound.measure(target), 0);
    assert.equal(bound.remaining(1, edits[1]), 1); assert.equal(bound.decrease(edits[1]), 0);
    assert.equal(bound.remaining(1, edits[2]), 0); assert.equal(bound.decrease(edits[2]), 1);
    for (const cost of [0, 1, 7]) assert.equal(createOrderedComparisonBound(target, [preserve(0), change(cost)]).measure(source), cost);
    for (const invalid of [{cost: 1}, {cost: 1, maxOrderedComparisonChange: 2}, {cost: 1, maxOrderedComparisonChange: -1},
        {cost: 1, maxOrderedComparisonChange: false}, {cost: -1, maxOrderedComparisonChange: 1},
        {cost: 0.5, maxOrderedComparisonChange: 1}]) {
        const disabled = createOrderedComparisonBound(target, [...edits, invalid]);
        assert.equal(disabled.enabled, false); assert.equal(disabled.measure(source), 0);
    }
    assert.equal(createOrderedComparisonBound(target, [preserve(0)]).measure(source), 0);
});

test('all generated free ordinary rewrites preserve the mask when ordered complementation is priced', () => {
    const sqls = [
        'SELECT x FROM t WHERE NOT(x<=1)', 'SELECT x FROM t WHERE NOT(x<=1 AND y>0)',
        'SELECT x FROM t WHERE NOT(x<=1 OR y>0)', 'SELECT x FROM t WHERE x BETWEEN 1 AND 3',
        'SELECT x FROM t WHERE x NOT BETWEEN 1 AND 3', 'SELECT x FROM t WHERE NOT(x BETWEEN 1 AND 3)',
        'SELECT x FROM t WHERE x IN (1,2,3)', 'SELECT x FROM t WHERE x NOT IN (1,2,3)',
        'SELECT x>1 AS answer FROM t', 'SELECT CASE WHEN x>1 THEN 1 WHEN NOT(x>1) THEN 0 ELSE NULL END AS answer FROM t',
        'UPDATE t SET x=4 WHERE NOT(y<=1)', 'DELETE FROM t WHERE x<1; DELETE FROM u WHERE x>=1'
    ];
    for (const sql of sqls) {
        const root = parse(sql), graph = createEditGraph(root, root, {}, {negateComplementaryComparison: 2});
        for (const edit of graph.edits.filter(edit => edit.cost === 0)) for (const edge of edit.apply(root)) {
            assert.equal(orderedComparisonMask(root), orderedComparisonMask(edge.root), edit.name + ' ' + sql);
        }
    }
});

test('question-permitted Boolean group relabeling can change raw groups and must disable the certificate', () => {
    const source = parse("SELECT CASE WHEN x>0 THEN 'yes' WHEN x<=0 THEN 'no' ELSE NULL END AS bucket FROM t GROUP BY bucket");
    const target = parse('SELECT x>0 AS bucket FROM t GROUP BY bucket');
    const graph = createEditGraph(target, source, {}, {negateComplementaryComparison: 2}, {freeLabels: ['bucket']});
    const rule = graph.edits.find(edit => edit.name === 'relabelUnconstrainedBooleanGroups');
    const edge = [...rule.apply(source)].find(edge => stableKey(edge.root) === stableKey(target));
    assert.ok(edge); assert.equal(rule.cost, 0);
    assert.equal(orderedComparisonMask(source), 3); assert.equal(orderedComparisonMask(target), 1);
    assert.equal(createOrderedComparisonBound(target, [change(rule.cost), preserve(1)]).measure(source), 0);
});

test('FK relocation cannot discard an extra CHECK introduced on a partial table-constraint node', () => {
    const source = parse('CREATE TABLE child(id INTEGER CHECK(id>0),parent_id INTEGER,FOREIGN KEY(parent_id) REFERENCES parent(id))');
    const target = parse('CREATE TABLE child(id INTEGER CHECK(id<=0),parent_id INTEGER,FOREIGN KEY(parent_id) REFERENCES parent(id))');
    const graph = createEditGraph(target, source);
    const add = graph.edits.find(edit => edit.name === 'addDefinitionCheckCheck');
    assert.ok(add);
    const wrapper = [...add.apply(source)].find(edge => edge.operation.path.includes(2));
    assert.ok(wrapper);
    const addComparison = graph.edits.find(edit => edit.name === 'addCheckDefinitionBinaryExpression');
    assert.ok(addComparison);
    const partial = [...addComparison.apply(wrapper.root)].find(edge =>
        edge.root.slots.statements[0].slots.create_definitions[2].slots.check.slots.definition
            ?.some(node => node.kind === 'BinaryExpression' && node.attrs.operator === '<='));
    assert.ok(partial, 'actual generic grammar edge must construct the partial CHECK');
    assert.equal(orderedComparisonMask(source), 1); assert.equal(orderedComparisonMask(partial.root), 3);
    const relocate = graph.edits.find(edit => edit.name === 'relocateSingleColumnForeignKey');
    assert.equal([...relocate.apply(partial.root)].length, 0,
        'the reverse equivalence must reject unknown/nonempty FK slots instead of dropping their expressions');
});

test('literal and column replacement families preserve ordered groups after grammar-introduced partial slots', () => {
    const source = parse("SELECT CASE WHEN x<=1 THEN 'a' ELSE 'b' END AS answer,y COLLATE BINARY AS y FROM t WHERE x>0");
    const target = parse("SELECT CASE WHEN y<2 THEN 'c' ELSE 'd' END AS answer,x COLLATE NOCASE AS y FROM t WHERE y>=3");
    const graph = createEditGraph(target, source, {}, {negateComplementaryComparison: 2});
    const partials = new Map([[stableKey(source), source], [stableKey(target), target]]);
    const removals = graph.edits.filter(edit => /^removeBinaryExpression(?:Left|Right)(?:ColumnReference|NumberLiteral|StringLiteral)$/.test(edit.name));
    for (const start of [source, target]) for (const edit of removals) for (const edge of edit.apply(start)) {
        partials.set(stableKey(edge.root), edge.root);
    }
    // These are actual typed grammar constructors, including COLLATE slots and
    // incomplete BinaryExpression operands. No hand-built impossible child is
    // smuggled into a NumberLiteral/ColumnReference to bypass the grammar.
    const additions = graph.edits.filter(edit => /^add(?:ColumnReference|NumberLiteral|StringLiteral)/.test(edit.name)
        || /^addBinaryExpression(?:Left|Right)(?:ColumnReference|NumberLiteral|StringLiteral)$/.test(edit.name));
    for (const start of [...partials.values()]) for (const edit of additions) for (const edge of edit.apply(start)) {
        partials.set(stableKey(edge.root), edge.root);
    }
    assert.ok(partials.size > 2, 'actual partial operands/slots must be included');
    const atoms = graph.edits.filter(edit => ['changeLiteral', 'changeColumnReference'].includes(edit.name)
        || /^(?:set|change|unset)(?:ColumnReference|NumberLiteral|StringLiteral)/.test(edit.name));
    assert.ok(atoms.length > 2);
    for (const root of partials.values()) for (const edit of atoms) for (const edge of edit.apply(root)) {
        assert.equal(orderedComparisonMask(root), orderedComparisonMask(edge.root), edit.name);
    }
});

test('actual whole-catalog zero effect declarations preserve masks on query DML DDL and scoped rewrites', () => {
    const schemaSql = 'CREATE TABLE a(id INTEGER PRIMARY KEY,x INTEGER);CREATE TABLE b(aid INTEGER,flag INTEGER,PRIMARY KEY(aid,flag));';
    const schema = {tables: [{name: 'a', type: 'table', columns: [{name: 'id', type: 'INTEGER', pk: 1}, {name: 'x', type: 'INTEGER', pk: 0}]},
        {name: 'b', type: 'table', columns: [{name: 'aid', type: 'INTEGER', pk: 1}, {name: 'flag', type: 'INTEGER', pk: 2}]}]};
    const pairs = [
        ['SELECT x FROM a WHERE NOT(id<=1)', 'SELECT x FROM a WHERE id>1'],
        ['SELECT a.x AS x FROM a AS a INNER JOIN b AS b ON a.id=b.aid WHERE b.flag=2', 'SELECT a.x FROM b INNER JOIN a ON a.id=b.aid WHERE b.flag=2'],
        ['SELECT x FROM a WHERE id IN (SELECT aid FROM b WHERE flag=2)', 'SELECT a.x FROM a INNER JOIN b ON a.id=b.aid WHERE b.flag=2'],
        ['UPDATE a SET x=4 WHERE id IN (SELECT aid FROM b WHERE flag=2)', 'UPDATE a SET x=5 WHERE id=(SELECT b.aid FROM b AS b WHERE b.flag=2)'],
        ['CREATE TABLE child(id INTEGER CHECK(id>0),parent_id INTEGER,FOREIGN KEY(parent_id) REFERENCES parent(id))',
            'CREATE TABLE child(id INTEGER CHECK(id<=0),parent_id INTEGER REFERENCES parent(id))']
    ];
    for (const [a, b] of pairs) {
        const source = parse(a), target = parse(b), graph = createEditGraph(target, source, schema,
            {negateComplementaryComparison: 2}, {schemaSql});
        for (const edit of graph.edits) assert.ok(edit.maxOrderedComparisonChange === 0 || edit.maxOrderedComparisonChange === 1, edit.name);
        for (const root of [source, target]) for (const edit of graph.edits.filter(edit => edit.maxOrderedComparisonChange === 0)) {
            for (const edge of edit.apply(root)) assert.equal(orderedComparisonMask(root), orderedComparisonMask(edge.root), edit.name);
        }
    }
    const from = parse(pairs[0][0]), to = parse(pairs[0][1]);
    const graph = createEditGraph(to, from, schema, {negateComplementaryComparison: 2}, {schemaSql});
    const bound = createOrderedComparisonBound(to, graph.edits);
    assert.equal(bound.enabled, true); assert.equal(bound.measure(from), 1);
    assert.equal(bound.remaining(1, graph.edits.find(edit => edit.name === 'changeLiteral')), 1);
});

test('independent directed Dijkstra validates all-pairs bounds and per-family lazy decreases', () => {
    const node = (id, mask) => ({kind: 'Script', attrs: {id}, slots: {statements: [
        ...(mask & 1 ? [{kind: 'BinaryExpression', attrs: {operator: '<'}, slots: {}}] : []),
        ...(mask & 2 ? [{kind: 'BinaryExpression', attrs: {operator: '>='}, slots: {}}] : [])]}});
    let seed = 73519; const rand = () => (seed = (seed * 1664525 + 1013904223) >>> 0);
    for (let example = 0; example < 80; example++) {
        const states = Array.from({length: 6}, (_, id) => node(id, rand() % 4));
        const edges = [];
        for (let i = 0; i < states.length; i++) for (let j = 0; j < states.length; j++) if (i !== j && (j === (i + 1) % states.length || rand() % 3 === 0)) {
            const effect = orderedComparisonMask(states[i]) === orderedComparisonMask(states[j]) ? 0 : 1;
            edges.push({from: i, to: j, cost: rand() % 8, maxOrderedComparisonChange: effect});
        }
        for (let target = 0; target < states.length; target++) {
            const bound = createOrderedComparisonBound(states[target], edges);
            for (let start = 0; start < states.length; start++) {
                const distances = new Map([[start, 0]]), queue = [{id: start, distance: 0}];
                while (queue.length) {
                    queue.sort((a, b) => a.distance - b.distance); const item = queue.shift();
                    if (item.distance !== distances.get(item.id)) continue;
                    for (const edge of edges.filter(edge => edge.from === item.id)) {
                        const next = item.distance + edge.cost;
                        if (next < (distances.get(edge.to) ?? Infinity)) { distances.set(edge.to, next); queue.push({id: edge.to, distance: next}); }
                    }
                }
                assert.ok(bound.measure(states[start]) <= distances.get(target));
            }
            for (const edge of edges) {
                const before = bound.measure(states[edge.from]), after = bound.measure(states[edge.to]);
                assert.ok(before <= edge.cost + after); assert.ok(before - after <= bound.decrease(edge));
                assert.ok(bound.remaining(before, edge) <= after);
            }
        }
    }
});
