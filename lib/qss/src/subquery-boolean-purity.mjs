/** A narrow proof guard for AND/OR operand commutation with subqueries.
 * This adds no edit and changes neither pureExpression nor SQL graph identity.
 * SQLite AND/OR obey three-valued Boolean commutativity. Here every operand
 * reads fixed ordinary tables, has no side effects or volatile computation,
 * and each subquery is proved uncorrelated. Scalar first-row/empty-NULL and
 * IN/NOT IN NULL semantics remain inside the unchanged subquery expression.
 * https://www.sqlite.org/lang_expr.html#subquery_expressions
 */
import {lex} from './syntax.mjs';
import {fold, clean, empty, plainColumn, locations, ordinaryCatalog, sourceScope} from './sqlite-join-scope.mjs';

const literalKinds = new Set(['NumberLiteral', 'StringLiteral', 'DoubleQuotedLiteral', 'NullLiteral', 'BooleanLiteral', 'BigIntLiteral', 'BlobLiteral']);
const operators = new Set(['AND', 'OR', '=', '==', '!=', '<>', '<', '>', '<=', '>=', 'IS', 'IS NOT',
    'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN', 'LIKE', 'NOT LIKE', '+', '-', '*', '/', '%', '&', '|', '<<', '>>', '||']);
const forbidden = new Set(['CommonTableExpression', 'CompoundSelect', 'Values', 'Explain', 'TableGroup',
    'FunctionExpression', 'AggregateExpression', 'ParameterExpression']);
const wherePrefix = ['slots', 'statements', 0, 'slots', 'where'];

/**
 * Returns (expression, root, path) => boolean. Only a Boolean expression in
 * the outer WHERE of one SELECT/UPDATE/DELETE is covered. Existing expression
 * context/observability guards still apply when the caller generates an edit.
 * Exactly one subquery is admitted, preserving the existing heuristic scope
 * numbering when its operand moves. Query sources and columns require the
 * actual schema plus CREATE provenance.
 * Views, TEMP/attached namespaces, triggers, conflict policies, functions,
 * unknown/correlated columns, nested queries, CTEs, ordering, limits and grouped
 * subqueries are deliberately outside this additional proof.
 */
export function createSubqueryBooleanPurity(schema, options = {}) {
    let catalog = options.preparedOrdinaryCatalog;
    const contexts = new WeakMap();
    let unsafeSetup;
    const unsafeProvenance = () => {
        if (unsafeSetup !== undefined) return unsafeSetup;
        try {
            unsafeSetup = typeof options.schemaSql !== 'string' || lex(options.schemaSql).some(token =>
                token.kind === 'Word' && ['trigger', 'attach', 'detach', 'temp', 'temporary', 'virtual'].includes(fold(token.value)));
        } catch { unsafeSetup = true; }
        return unsafeSetup;
    };

    function context(root) {
        if (!root || typeof root !== 'object') return null;
        if (contexts.has(root)) return contexts.get(root);
        contexts.set(root, null);
        if (options.ambiguousSchemaNamespaces || options.freeLabels?.length || options.freeDiagnostics
            || root.kind !== 'Script' || root.slots.statements?.length !== 1) return null;
        if (unsafeProvenance()) return null;
        if (catalog === undefined) catalog = ordinaryCatalog(schema, options.schemaSql);
        const statement = root.slots.statements[0];
        if (!['Select', 'Update', 'Delete'].includes(statement?.kind) || !statement.slots.where
            || !empty(statement.slots.with) || !empty(statement.slots.limit) || !empty(statement.slots.returning)
            || !empty(statement.attrs.conflict)) return null;
        for (const {node} of locations(statement)) {
            if (forbidden.has(node.kind) || !empty(node.slots.with)) return null;
        }
        const from = statement.kind === 'Update' ? statement.slots.table : statement.slots.from;
        const scope = sourceScope({kind: 'Select', attrs: {}, slots: {from}}, catalog, {max: 1});
        if (!scope || !empty(scope.sources[0].source.attrs.join) || !empty(scope.sources[0].source.slots.on)
            || statement.kind === 'Update' && !empty(statement.slots.from)) return null;
        const aliases = new Set((statement.slots.columns || []).map(item => fold(item?.attrs?.as)).filter(name => typeof name === 'string'));
        const outerColumnsKnown = node => {
            if (!node || node.kind === 'Subquery') return true;
            if (node.kind === 'ColumnReference' && scope.owner(node) !== scope.sources[0]) return false;
            if (node.kind?.startsWith('SQL:')) return false;
            return Object.values(node.slots || {}).every(value => (Array.isArray(value) ? value : [value]).every(outerColumnsKnown));
        };
        if (!outerColumnsKnown(statement)) return null;
        const value = {statement, scope, aliases, queries: new WeakMap()};
        contexts.set(root, value);
        return value;
    }

    function expressionSafe(node, scope, state, allowSubquery) {
        if (!node || typeof node.kind !== 'string') return false;
        if (node.kind === 'ColumnReference') return plainColumn(node) && scope.owner(node) === scope.sources[0];
        if (literalKinds.has(node.kind)) {
            if (!clean(node.attrs, node.kind === 'NumberLiteral' ? ['value', 'storageClass'] : ['value'])
                || !Object.values(node.slots).every(empty)) return false;
            if (node.kind === 'DoubleQuotedLiteral' && scope !== state.scope) {
                // SQLite's DQS fallback can instead resolve an outer column.
                // A locally declared column wins; otherwise forbid outer-name
                // capture before treating an unmatched quoted name as a string.
                const name = fold(node.attrs.value);
                if (!scope.sources[0].table.columns.has(name)
                    && (state.scope.sources[0].table.columns.has(name) || state.aliases.has(name))) return false;
            }
            return true;
        }
        if (node.kind === 'Subquery') return allowSubquery && querySafe(node, state);
        if (node.kind === 'UnaryExpression') return ['NOT', '+', '-', '~'].includes(node.attrs.operator)
            && clean(node.attrs, ['operator']) && clean(node.slots, ['expr'])
            && expressionSafe(node.slots.expr, scope, state, allowSubquery);
        if (node.kind === 'BinaryExpression') return operators.has(node.attrs.operator)
            && clean(node.attrs, ['operator']) && clean(node.slots, ['left', 'right'])
            && expressionSafe(node.slots.left, scope, state, allowSubquery)
            && expressionSafe(node.slots.right, scope, state, allowSubquery);
        if (node.kind === 'ExpressionList') return clean(node.attrs, []) && clean(node.slots, ['value'])
            && Array.isArray(node.slots.value) && node.slots.value.every(child => expressionSafe(child, scope, state, allowSubquery));
        return false;
    }

    function querySafe(wrapper, state) {
        if (state.queries.has(wrapper)) return state.queries.get(wrapper);
        state.queries.set(wrapper, false);
        if (!clean(wrapper.attrs, []) || !clean(wrapper.slots, ['ast'])) return false;
        const query = wrapper.slots.ast;
        if (query?.kind !== 'Select' || query.attrs.distinct || !clean(query.attrs, ['distinct'])
            || !clean(query.slots, ['columns', 'from', 'where'])) return false;
        const scope = sourceScope(query, catalog, {max: 1}), items = query.slots.columns;
        if (!scope || !empty(scope.sources[0].source.attrs.join) || !empty(scope.sources[0].source.slots.on)
            || items?.length !== 1 || items[0]?.kind !== 'SelectItem'
            || !clean(items[0].attrs, []) || !clean(items[0].slots, ['expr'])
            || !plainColumn(items[0].slots.expr) || scope.owner(items[0].slots.expr) !== scope.sources[0]) return false;
        const safe = empty(query.slots.where) || expressionSafe(query.slots.where, scope, state, false);
        state.queries.set(wrapper, safe);
        return safe;
    }

    return (expression, root, path = wherePrefix) => {
        if (expression?.kind !== 'BinaryExpression' || !['AND', 'OR'].includes(expression.attrs.operator)
            || !clean(expression.attrs, ['operator']) || !clean(expression.slots, ['left', 'right'])) return false;
        let subqueries = 0;
        for (const {node} of locations(expression)) if (node.kind === 'Subquery') subqueries++;
        if (subqueries !== 1) return false;
        const state = context(root);
        if (!state || path.length < wherePrefix.length || wherePrefix.some((part, index) => path[index] !== part)) return false;
        let current = root;
        for (const part of path) {
            if (current?.kind === 'Subquery' || current?.kind === 'Select' && current !== state.statement) return false;
            current = current?.[part];
        }
        if (current !== expression) return false;
        // No query outside the expression under consideration can hide an
        // inherited alias/CTE scope or a volatile evaluation context.
        const included = new Set([...locations(expression)].map(entry => entry.node));
        for (const {node} of locations(state.statement)) if (node.kind === 'Subquery' && !included.has(node)) return false;
        return expressionSafe(expression, state.scope, state, true);
    };
}
