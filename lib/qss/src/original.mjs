import {Query, Schema, MetaInfo, Asterisk, ColumnReference, Literal, Not, AggregationFunction, AggregationType, BinaryExpression, OperatorType, SelectElement, FromElement, JoinType, OrderBy} from '../upstream/sql-query-distance/sql.ts';
import {createDefaultConfig} from '../upstream/sql-query-distance/config.ts';
import {lex, parserSql, parseAst, schemaTables, Unsupported} from './syntax.mjs';

function expression(x) {
    if (!x) return null;
    if (x.type === 'column_ref' && !x.collate) return x.column === '*' ? new Asterisk(x.table) : new ColumnReference(x.column, x.table);
    if (x.type === 'number') return new Literal(Number(x.value));
    if (['string', 'single_quote_string'].includes(x.type)) return new Literal(x.value);
    if (x.type === 'star') return Asterisk.baseAsterisk;
    if (x.type === 'binary_expr' && ['=', 'AND', 'OR', '<', '>'].includes(x.operator)) {
        const op = {'=': OperatorType.EQUALS, AND: OperatorType.AND, OR: OperatorType.OR, '<': OperatorType.LESS, '>': OperatorType.GREATER}[x.operator];
        return new BinaryExpression(op, expression(x.left), expression(x.right));
    }
    if (x.type === 'unary_expr' && x.operator === 'NOT') return new Not(expression(x.expr));
    if (x.type === 'function' && x.name?.name?.[0]?.value === 'NOT' && x.args?.value?.length === 1) return new Not(expression(x.args.value[0]));
    if (x.type === 'aggr_func' && !x.over && Object.hasOwn(AggregationType, x.name)) return new AggregationFunction(AggregationType[x.name], Boolean(x.args.distinct), x.name === 'COUNT' && x.args.expr?.type === 'star' ? null : expression(x.args.expr));
    throw new Unsupported('original-expression', 'This expression is outside the original Graph-QSS edit model.');
}
export function originalQuery(sql, allowEmpty = false) {
    const tokens = lex(sql);
    if (!tokens.length && allowEmpty) return new Query();
    let ast;
    try { ast = parseAst(parserSql(tokens)); } catch { throw new Unsupported('original-syntax', 'The SQL cannot be parsed by the original Graph-QSS adapter.'); }
    if (Array.isArray(ast)) { if (ast.length !== 1) throw new Unsupported('original-script', 'Original Graph-QSS supports one SELECT only.'); ast = ast[0]; }
    if (!ast || ast.type !== 'select' || ast.with || ast.options || ast.limit || ast._next || ast.set_op || ast.for_update) throw new Unsupported('original-statement', 'Original Graph-QSS supports a restricted single SELECT only.');
    const from = (ast.from || []).map(f => {
        const joins = {'INNER JOIN': JoinType.INNER, 'LEFT JOIN': JoinType.LEFT_OUTER, 'RIGHT JOIN': JoinType.RIGHT_OUTER, 'FULL JOIN': JoinType.FULL_OUTER};
        if (!f.table || f.db || f.expr || f.using || f.join && !Object.hasOwn(joins, f.join)) throw new Unsupported('original-from', 'The FROM clause is outside the original edit model.');
        return new FromElement(f.table, f.join ? joins[f.join] : null, expression(f.on), f.as);
    });
    return new Query(ast.distinct?.type === 'DISTINCT' || ast.distinct === 'DISTINCT',
        (ast.columns === '*' ? [{expr: {type: 'star'}}] : ast.columns || []).map(c => new SelectElement(expression(c.expr), c.as)),
        from, expression(ast.where), (ast.groupby?.columns || ast.groupby || []).map(expression), expression(ast.having),
        (ast.orderby || []).map(o => new OrderBy(o.type === 'DESC', expression(o.expr))));
}
export function originalSchema(reference, supplied) {
    const tables = schemaTables(supplied);
    if (!tables.size) return Schema.deduceSchema(reference);
    const schema = new Schema();
    for (const [name, columns] of tables) schema.set(name, Object.assign(new Map([...columns.keys()].map(name => [name, {name}])), {name}));
    return schema;
}

class Heap {
    values = [];
    push(item) { const a = this.values; a.push(item); let i = a.length - 1; while (i) { const p = (i - 1) >> 1; if (a[p].priority <= item.priority) break; a[i] = a[p]; i = p; } a[i] = item; }
    pop() { const a = this.values, first = a[0], last = a.pop(); if (a.length) { let i = 0; while (i * 2 + 1 < a.length) { let c = i * 2 + 1; if (c + 1 < a.length && a[c + 1].priority < a[c].priority) ++c; if (a[c].priority >= last.priority) break; a[i] = a[c]; i = c; } a[i] = last; } return first; }
    get length() { return this.values.length; }
}

/** Isolated lazy uniform-cost search. No timeout, no cost-gap scan, no global cancel. */
export function originalConfig(costs) {
    const config = createDefaultConfig();
    for (const [name, cost] of Object.entries(costs || {})) {
        if (!config.has(name)) throw new Unsupported('original-edit', 'Unknown original edit configuration.');
        config.get(name).cost = cost;
    }
    const edits = [...config.values()].sort((a, b) => a.cost - b.cost);
    if (!edits.length || edits.some(e => !Number.isSafeInteger(e.cost) || e.cost < 0)) throw new Unsupported('invalid-costs', 'Edit costs must be finite nonnegative safe integers.');
    return {config, edits};
}
export async function originalDistance(reference, answer, schema, context, {cutoff = Infinity, costs} = {}) {
    const {config, edits} = originalConfig(costs);
    if (reference.equals(answer)) return {distance: 0, edits: [], visited: 1, capped: false};
    const meta = new MetaInfo(reference, schema), visited = new Map(), queue = new Heap();
    // Upstream FROM hashes omit table names: all n! table permutations otherwise
    // collide. Include ordered table identities, preserving alias-insensitive equality.
    const bucketKey = query => JSON.stringify([query.hash, query.copyFrom().map(f => f.table)]);
    const remember = node => { const key = bucketKey(node.query); if (!visited.has(key)) visited.set(key, []); visited.get(key).push(node); };
    const enqueue = (node, priority) => {
        if (!Number.isSafeInteger(priority)) throw new Unsupported('distance-overflow', 'The edit distance exceeds exact integer precision.');
        queue.push({node, priority});
    };
    const initial = {query: answer, distance: 0, previous: null, step: null, nextEdit: 0};
    remember(initial); enqueue(initial, edits[0].cost);
    while (queue.length) {
        const {node, priority} = queue.pop();
        context.frontier = queue.length + 1; context.lowerBound = priority;
        await context.tick();
        if (priority >= cutoff) return {distance: cutoff, edits: [], visited: context.visited, capped: true};
        const edit = edits[node.nextEdit], neighbors = [];
        edit.perform(node.query, schema, meta, neighbors);
        for (const query of neighbors) {
            await context.tick();
            if ((visited.get(bucketKey(query)) || []).some(n => query.equals(n.query))) continue;
            const next = {query, distance: priority, previous: node, step: edit.name, nextEdit: 0};
            if (reference.equals(query)) {
                const path = [];
                for (let n = next; n.previous; n = n.previous) path.push({type: 'original-edit', name: n.step, cost: config.get(n.step).cost});
                return {distance: priority, edits: path.reverse(), visited: context.visited, capped: false};
            }
            remember(next); enqueue(next, priority + edits[0].cost);
        }
        if (++node.nextEdit < edits.length) enqueue(node, node.distance + edits[node.nextEdit].cost);
    }
    throw new Unsupported('original-unreachable', 'The original edit graph could not reach the model query.');
}
