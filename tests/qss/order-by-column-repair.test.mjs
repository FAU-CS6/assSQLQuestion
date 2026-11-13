import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {parseGraphSql, stableKey, walkNodes} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph, replayOperation} from '../../lib/qss/src/graph-edits.mjs';
import {registerOrderByColumnRepair, ORDER_BY_COLUMN_REPAIR} from '../../lib/qss/src/order-by-column-repair.mjs';
import {symbolFacts} from '../../lib/qss/src/graph-features.mjs';
import {shortestSqlEditPath, heuristicCertificate, sqlWorkBound} from '../../lib/qss/src/graph-search.mjs';

const ast = sql => parseGraphSql(sql).root;
const context = () => ({visited: 0, async tick() {}});
function graphFor(to, from, cost = 1, requirements = {}) {
    const graph = createEditGraph(to, from, {}, {}, requirements);
    // The dedicated module can be checked before integration. Once the central
    // registry contains it, exercise that exact production registration instead.
    if (graph.edits.some(edit => edit.name === ORDER_BY_COLUMN_REPAIR.id)) return createEditGraph(to, from, {}, {[ORDER_BY_COLUMN_REPAIR.id]: cost}, requirements);
    registerOrderByColumnRepair((name, description, defaultCost, generate, annotations) => {
        graph.edits.push({name, description, cost, maxNewPredicates: 1, preservesSymbolSet: false,
            statementOperation: null, statementKind: null, ...annotations,
            *apply(root) {
                const seen = new Set();
                for (const change of generate(root)) {
                    const operation = {name, cost, type: 'sql-edit', path: change.path,
                        before: change.path.reduce((node, field) => node?.[field], root), after: change.after};
                    const next = replayOperation(root, operation), key = graph.key(next);
                    if (seen.has(key) || !graph.bounded(next)) continue;
                    seen.add(key); yield {root: next, operation};
                }
            }});
    }, to, from, {...requirements, maxNodes: graph.limits.maxNodes});
    return graph;
}
const repair = graph => graph.edits.find(edit => edit.name === ORDER_BY_COLUMN_REPAIR.id);
const find = (edit, from, to) => [...edit.apply(from)].find(edge => stableKey(edge.root) === stableKey(to));
const count = (root, kind) => [...walkNodes(root)].filter(({node}) => node.kind === kind).length;

test('missing ORDER BY columns have a paid concrete inverse of item removal', () => {
    for (const [a, b] of [
        ['SELECT x FROM sample', 'SELECT x FROM sample ORDER BY x'],
        ['SELECT x FROM sample', 'SELECT x FROM sample ORDER BY sample.x DESC'],
        ['SELECT x FROM sample UNION SELECT x FROM other', 'SELECT x FROM sample UNION SELECT x FROM other ORDER BY x DESC']
    ]) {
        const from = ast(a), to = ast(b), graph = graphFor(to, from), before = stableKey(from);
        const edge = find(repair(graph), from, to); assert.ok(edge, b); assert.equal(edge.operation.cost, 1);
        assert.equal(stableKey(replayOperation(from, edge.operation)), stableKey(to));
        assert.ok(graph.edits.some(edit => /^remove.*OrderbyOrderByItem$/.test(edit.name) && find(edit, to, from)));
        assert.equal(stableKey(from), before);
    }
});

test('ORDER BY repair uses both finite input domains at every insertion position', () => {
    const from = ast('SELECT x,y FROM sample ORDER BY x'), to = ast('SELECT x,y FROM sample ORDER BY x,y DESC');
    const graph = graphFor(to, from), edit = repair(graph);
    assert.ok(find(edit, from, to));
    assert.ok(find(edit, from, ast('SELECT x,y FROM sample ORDER BY y DESC,x')));
    assert.ok(find(edit, from, ast('SELECT x,y FROM sample ORDER BY x,x')));
    assert.ok(!find(edit, from, ast('SELECT x,y FROM sample ORDER BY x,y ASC')), 'Do not invent an unobserved column/direction pair.');
});

test('ORDER BY repair excludes expressions queries collations positional integers and wildcards', () => {
    const from = ast('SELECT x FROM sample');
    for (const sql of ['SELECT x FROM sample ORDER BY x+1', 'SELECT x FROM sample ORDER BY MAX(x)',
        'SELECT x FROM sample ORDER BY x COLLATE NOCASE', 'SELECT x FROM sample ORDER BY 1',
        'SELECT x FROM sample ORDER BY (SELECT y FROM other)']) {
        const graph = graphFor(ast(sql), from); assert.equal([...repair(graph).apply(from)].length, 0, sql);
    }
});

test('ORDER BY repair annotations count exactly one work component and at most one symbol', () => {
    const from = ast('SELECT x FROM sample'), to = ast('SELECT x FROM sample ORDER BY y DESC');
    const graph = graphFor(to, from), edit = repair(graph), have = symbolFacts(graph.abstractRoot(from));
    assert.equal(edit.maxNewSymbols, 1); assert.equal(edit.introducedComponent, 'OrderByItem');
    const certificate = heuristicCertificate(graph.edits), work = sqlWorkBound(to, graph, certificate.unit);
    assert.ok(work.decrease(edit) <= edit.cost, 'Overlapping symbol and component work is not double-charged.');
    for (const edge of edit.apply(from)) {
        assert.equal(count(edge.root, 'OrderByItem') - count(from, 'OrderByItem'), 1);
        for (const kind of ['Select', 'CompoundSelect', 'TableSource', 'Definition', 'DataType', 'SelectItem']) assert.equal(count(edge.root, kind), count(from, kind));
        assert.ok([...symbolFacts(graph.abstractRoot(edge.root))].filter(fact => !have.has(fact)).length <= 1);
        assert.equal(stableKey(replayOperation(from, edge.operation)), stableKey(edge.root));
    }
});

test('ORDER BY restoration is individually priced including zero and seven', async () => {
    const from = ast('SELECT x FROM sample'), to = ast('SELECT x FROM sample ORDER BY x DESC');
    for (const cost of [0, 1, 7]) {
        const full = graphFor(to, from, cost), graph = {...full, edits: [repair(full)]};
        const result = await shortestSqlEditPath(to, from, graph, context(), {cutoff: cost + 1});
        assert.equal(result.distance, cost); assert.equal(result.capped, false);
        let current = from; for (const step of result.edits) current = replayOperation(current, step.operation);
        assert.equal(stableKey(current), stableKey(to));
    }
});

test('ordering by a free group label conservatively accounts for newly exposed old symbols', async () => {
    const sql = "SELECT CASE WHEN x>0 THEN 'positive' WHEN NOT(x>0) THEN 'negative' ELSE NULL END AS label FROM sample GROUP BY label";
    const from = ast(sql), to = ast(sql + ' ORDER BY label'), requirements = {freeLabels: ['label']};
    for (const cost of [0, 1, 7]) {
        const full = graphFor(to, from, cost, requirements), edit = repair(full);
        const edge = find(edit, from, to); assert.ok(edge);
        const before = symbolFacts(full.abstractRoot(from)), after = symbolFacts(full.abstractRoot(edge.root));
        const introduced = [...after].filter(fact => !before.has(fact)).length;
        assert.ok(introduced > 1, 'The contextual abstraction exposes old string labels as well as the new ORDER BY column.');
        assert.ok(introduced <= edit.maxNewSymbols);
        assert.equal(edit.maxNewSymbols, full.limits.maxNodes);
        const graph = {...full, edits: [edit]}, result = await shortestSqlEditPath(to, from, graph, context());
        assert.equal(result.distance, cost); assert.equal(result.capped, false);
        assert.equal(stableKey(replayOperation(from, result.edits[0].operation)), stableKey(to));
    }
    let annotations;
    registerOrderByColumnRepair((name, description, cost, generate, declared) => { annotations = declared; }, to, from, requirements);
    assert.equal(heuristicCertificate([{cost: 1, ...annotations}]).enabled, false, 'Unknown structural bounds fail closed.');
});

test('exact searches match independent Dijkstra on complete finite SQL ordering graphs', async () => {
    const source = ast('SELECT x,y FROM sample'), target = ast('SELECT x,y FROM sample ORDER BY x,y DESC');
    for (const cost of [0, 1, 7]) {
        const full = graphFor(target, source, cost), graph = {...full,
            edits: full.edits.filter(edit => edit.name === ORDER_BY_COLUMN_REPAIR.id || /^remove.*OrderbyOrderByItem$/.test(edit.name))};
        const nodes = [source], indexes = new Map([[stableKey(source), 0]]), edges = [];
        for (let index = 0; index < nodes.length; index++) for (const edit of graph.edits) for (const edge of edit.apply(nodes[index])) {
            const key = stableKey(edge.root);
            if (!indexes.has(key)) { indexes.set(key, nodes.length); nodes.push(edge.root); }
            edges.push({from: index, to: indexes.get(key), cost: edit.cost});
        }
        const goal = indexes.get(stableKey(target)); assert.ok(goal !== undefined); assert.ok(nodes.length > 10);
        const dijkstra = start => {
            const distances = nodes.map(() => Infinity), pending = new Set([start]); distances[start] = 0;
            while (pending.size) {
                const at = [...pending].sort((a, b) => distances[a] - distances[b])[0]; pending.delete(at);
                if (at === goal) return distances[at];
                for (const edge of edges) if (edge.from === at && distances[at] + edge.cost < distances[edge.to]) {
                    distances[edge.to] = distances[at] + edge.cost; pending.add(edge.to);
                }
            }
            return Infinity;
        };
        for (let index = 0; index < nodes.length; index++) {
            const result = await shortestSqlEditPath(target, nodes[index], graph, context());
            assert.equal(result.distance, dijkstra(index)); assert.equal(result.capped, false);
            let current = nodes[index]; for (const step of result.edits) current = replayOperation(current, step.operation);
            assert.equal(stableKey(current), stableKey(target));
        }
    }
});

test('a missing ORDER BY is a semantic repair rather than a free identity', () => {
    const db = new DatabaseSync(':memory:');
    try {
        db.exec('CREATE TABLE sample(x); INSERT INTO sample VALUES(2),(1)');
        assert.notDeepEqual(db.prepare('SELECT x FROM sample LIMIT 1').all(), db.prepare('SELECT x FROM sample ORDER BY x LIMIT 1').all());
    } finally { db.close(); }
});
