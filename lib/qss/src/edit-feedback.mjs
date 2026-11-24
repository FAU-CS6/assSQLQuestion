// These excerpts describe a replayed edge. They never enter the graph or the score.
// Omit a fragment if its SQL shape is ambiguous or would make the feedback too long.
const clauses = {columns: 'SELECT', where: 'WHERE', having: 'HAVING', orderby: 'ORDER BY',
    groupby: 'GROUP BY', set: 'SET', on: 'ON', returning: 'RETURNING'};
const identifier = value => /^[a-zA-Z_][a-zA-Z_0-9]*$/.test(value) ? value : '"' + value.replaceAll('"', '""') + '"';
// Keep uncommon modifiers and incomplete constructors out of reconstructed SQL.
function hasValuesOutside(record, names) {
    return Object.entries(record).some(([key, value]) => !names.includes(key) && value != null
        && !(Array.isArray(value) && value.length === 0));
}
function fragment(node, depth = 0) {
    if (depth > 8 || !node) return null;
    const child = value => fragment(value, depth + 1);
    if (Array.isArray(node)) {
        if (node.length > 8) return null;
        const items = node.map(child);
        return items.every(Boolean) ? items.join(', ') : null;
    }
    const {kind, attrs: a, slots: s} = node;
    if (!a || !s) return null;
    switch (kind) {
        case 'ColumnReference':
            if (hasValuesOutside(s, []) || hasValuesOutside(a, ['db', 'table', 'column']) || typeof a.column !== 'string') return null;
            if ([a.db, a.table].some(part => part != null && typeof part !== 'string')) return null;
            return [...[a.db, a.table].filter(Boolean).map(identifier), a.column === '*' ? '*' : identifier(a.column)].join('.');
        case 'Asterisk': return '*';
        case 'NumberLiteral': case 'BigIntLiteral': return a.value == null ? null : String(a.value);
        case 'NullLiteral': return 'NULL';
        case 'StringLiteral': return typeof a.value === 'string' ? "'" + a.value.replaceAll("'", "''") + "'" : null;
        case 'SelectItem': {
            const expr = child(s.expr);
            if (a.as != null && typeof a.as !== 'string') return null;
            return expr && (a.as ? expr + ' AS ' + identifier(a.as) : expr);
        }
        case 'OrderByItem': {
            if (hasValuesOutside(s, ['expr']) || hasValuesOutside(a, ['type'])) return null;
            const expr = child(s.expr);
            return expr && ['ASC', 'DESC'].includes(a.type) ? expr + ' ' + a.type : null;
        }
        case 'BinaryExpression': {
            const operand = n => {
                const sql = child(n);
                return sql && n.kind === 'BinaryExpression' ? '(' + sql + ')' : sql;
            };
            const left = operand(s.left), right = operand(s.right);
            return left && right && a.operator ? left + ' ' + a.operator + ' ' + right : null;
        }
        case 'GroupBy': return child(s.columns);
        case 'Assignment': {
            if (hasValuesOutside(s, ['value']) || typeof a.column !== 'string'
                || hasValuesOutside(a, ['column', 'table']) || a.table != null && typeof a.table !== 'string') return null;
            const value = child(s.value), name = (a.table ? identifier(a.table) + '.' : '') + identifier(a.column);
            return value && name + ' = ' + value;
        }
        case 'AggregateArguments': {
            const expr = child(s.expr);
            return expr && (a.distinct ? 'DISTINCT ' + expr : expr);
        }
        case 'AggregateExpression': {
            if (hasValuesOutside(s, ['args']) || hasValuesOutside(a, ['name'])) return null;
            const args = child(s.args);
            return args && a.name && !s.over ? a.name + '(' + args + ')' : null;
        }
        default: return null;
    }
}

export function describeEdit(source, target, path) {
    let before = source, after = target, clause;
    for (let i = 0; i < path.length; i++) {
        const key = path[i];
        if (key === 'slots' && Object.hasOwn(clauses, path[i + 1])) {
            const field = path[i + 1];
            if (field !== 'columns' || before?.kind === 'Select') {
                clause = {field, left: before?.slots?.[field], right: after?.slots?.[field]};
            }
        }
        before = before?.[key];
        after = after?.[key];
    }
    if (clause) {
        const excerpt = value => {
            if (value == null || Array.isArray(value) && !value.length) return '';
            const sql = fragment(value);
            return sql && sql.length <= 220 ? clauses[clause.field] + ' ' + sql : null;
        };
        const beforeSql = excerpt(clause.left), afterSql = excerpt(clause.right);
        if (beforeSql != null && afterSql != null && beforeSql !== afterSql) return {beforeSql, afterSql};
    }
    // A clause can contain a subquery, a DDL constraint or another construct
    // with no concise rendering. Preserve a concrete changed token if present.
    if (path.at(-1) !== 'attrs' || !before || !after) return {};
    const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => before[key] !== after[key]);
    if (fields.length !== 1) return {};
    const field = fields[0];
    const token = value => {
        if (value == null) return '';
        if (!['string', 'number', 'boolean'].includes(typeof value)) return null;
        return String(value).length <= 120 ? String(value) : null;
    };
    const beforeToken = token(before[field]), afterToken = token(after[field]);
    return beforeToken != null && afterToken != null && beforeToken !== afterToken ? {beforeToken, afterToken} : {};
}
