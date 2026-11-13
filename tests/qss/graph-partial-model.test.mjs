import assert from 'node:assert/strict';
import test from 'node:test';
import {parseGraphSql, stableKey, walkNodes} from '../../lib/qss/src/graph-model.mjs';

const parse = sql => parseGraphSql(sql).root;
const nodes = (root, kind) => [...walkNodes(root)].filter(entry => entry.node.kind === kind).map(entry => entry.node);

test('an invalid BETWEEN separator is an explicit partial AST requiring an edit', () => {
    const result = parseGraphSql("DELETE FROM item WHERE value BETWEEN 'a' OR 'z'");
    assert.equal(result.validation, 'partial-sql-ast');
    const between = nodes(result.root, 'BinaryExpression').find(node => node.attrs.operator === 'BETWEEN');
    assert.equal(between.attrs.separator, 'OR');
    assert.deepEqual(nodes(between, 'StringLiteral').map(node => node.attrs.value), ['a', 'z']);
    assert.notEqual(stableKey(result.root), stableKey(parse("DELETE FROM item WHERE value BETWEEN 'a' AND 'z'")));
    assert.throws(() => parseGraphSql("DELETE FROM item WHERE value BETWEEN 'a' OR 'z'", {allowPartial: false}));
    assert.throws(() => parseGraphSql('SELECT AVG() FROM item', {allowPartial: false}));
});

test('valid BETWEEN expressions and ordinary OR predicates retain their existing AST', () => {
    assert.equal(parseGraphSql('SELECT * FROM t WHERE x BETWEEN 1 AND 3 OR y=2').validation, 'strict-sql-ast');
    assert.ok(nodes(parse('SELECT * FROM t WHERE x BETWEEN 1 AND 3 OR y=2'), 'BinaryExpression').every(node => node.attrs.separator == null));
});
