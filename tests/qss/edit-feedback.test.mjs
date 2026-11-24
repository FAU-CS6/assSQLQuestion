import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate} from '../../lib/qss/src/engine.mjs';
import {parseGraphSql} from '../../lib/qss/src/graph-model.mjs';
import {createEditGraph} from '../../lib/qss/src/graph-edits.mjs';

test('feedback excerpts describe forward SQL edits in the clause actually changed', async () => {
    for (const [answer, reference, beforeSql, afterSql] of [
        ['SELECT x FROM t WHERE y = 4', 'SELECT x FROM t WHERE y = 5', 'WHERE y = 4', 'WHERE y = 5'],
        ['SELECT x FROM t ORDER BY x DESC', 'SELECT x FROM t ORDER BY x', 'ORDER BY x DESC', 'ORDER BY x ASC'],
        ['SELECT * FROM t WHERE x IN (SELECT a FROM z WHERE b = 1)',
            'SELECT * FROM t WHERE x IN (SELECT a FROM z WHERE b = 2)', 'WHERE b = 1', 'WHERE b = 2']
    ]) {
        const result = await evaluate({answer, reference, maxPoints: 5});
        assert.equal(result.status, 'exact');
        assert.equal(result.traceVerified, true);
        assert.ok(result.edits.some(edit => edit.beforeSql === beforeSql && edit.afterSql === afterSql));
    }
});

test('direct probe retains all one-edge witnesses, including repeated occurrences and optional slots', () => {
    for (const [sql, destination, name] of [
        ['SELECT a, a FROM t', 'SELECT a, b FROM t', 'changeColumnReferenceColumn'],
        ['SELECT a, a FROM t', 'SELECT b, a FROM t', 'changeColumnReferenceColumn'],
        ['SELECT a FROM t', 'SELECT a FROM t ORDER BY a', 'restoreMissingOrderByColumn'],
        ['SELECT a FROM t WHERE b', 'SELECT a FROM t', 'removeSelectWhereColumnReference']
    ]) {
        const source = parseGraphSql(sql).root, target = parseGraphSql(destination).root;
        const graph = createEditGraph(target, source);
        const rule = graph.edits.find(e => e.name === name);
        const witnesses = filter => [...rule.apply(source, filter)]
            .filter(edge => graph.key(edge.root) === graph.key(target)).map(edge => edge.operation.path);
        const baseline = witnesses();
        assert.ok(baseline.length > 0, name);
        assert.deepEqual(witnesses(graph.directPaths(source, target)), baseline);
    }
});
