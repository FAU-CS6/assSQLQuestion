/**
 * Abstract facts for admissible search bounds. They are never graph nodes,
 * grades, a query-equivalence decision, or a replacement for SQL edit paths.
 * Zero-priced graph edges preserve both sets. Predicate/expression facts need
 * a BINARY missing-fact bound: one paid binding edit can change many of them.
 */
import {stableKey} from './graph-model.mjs';

const isNode = node => Boolean(node && typeof node.kind === 'string' && node.attrs && node.slots);
const kind = (node, name) => node?.kind === name;
const fold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
const literalKinds = new Set(['NumberLiteral', 'StringLiteral', 'DoubleQuotedLiteral', 'NullLiteral', 'BlobLiteral', 'BooleanLiteral', 'BigIntLiteral']);
const comparisons = new Set(['=', '==', '!=', '<>', '<', '>', '<=', '>=', 'IS', 'IS NOT', 'LIKE', 'NOT LIKE', 'IN', 'NOT IN', 'BETWEEN', 'NOT BETWEEN']);
const mirrors = {'=': '=', '==': '==', '!=': '!=', '<>': '<>', '>': '<', '<': '>', '>=': '<=', '<=': '>='};
const outerJoin = value => typeof value === 'string' && /^(?:LEFT|RIGHT|FULL)(?: OUTER)? JOIN$/.test(value);

function children(node) {
    return Object.keys(node.slots || {}).sort().flatMap(field => {
        const value = node.slots[field];
        return (Array.isArray(value) ? value : [value]).filter(isNode).map(child => ({field, child}));
    });
}

function index(root) {
    const entries = [];
    let serial = 0;
    const visit = (node, scope = null, role = 'other', predicateRole = role, parent = null, parentField = null) => {
        if (!isNode(node)) return;
        if (kind(node, 'Select')) {
            scope = {id: serial++, parent: scope, sources: []};
            scope.sources = (node.slots.from || []).map((source, i) => ({
                name: fold(source?.attrs?.as ?? source?.attrs?.table),
                identity: ['source', scope.id, i, fold(source?.attrs?.db ?? null), fold(source?.attrs?.table ?? null)]
            }));
            role = 'other'; predicateRole = role;
        }
        const entry = {node, scope, role, predicateRole, parent, parentField, children: []};
        entries.push(entry);
        for (const {field, child} of children(node)) {
            let childRole = role, childPredicateRole = predicateRole;
            if (kind(node, 'Select')) {
                childRole = ({columns: 'projection', where: 'predicate', from: 'source',
                    groupby: 'group', having: 'having', orderby: 'order'})[field] || 'other';
                childPredicateRole = childRole;
            }
            if (kind(node, 'TableSource') && field === 'on' && scope) {
                childRole = 'predicate';
                childPredicateRole = outerJoin(node.attrs.join) ? 'outer-on:' + node.attrs.join : 'predicate';
            }
            entry.children.push(visit(child, scope, childRole, childPredicateRole, node, field));
        }
        return entry;
    };
    const tree = visit(root);
    return {entries, tree};
}

/** One newly introduced role/symbol fact at most per annotated leaf/attr edit. */
export function symbolFacts(root) {
    const facts = new Set();
    for (const {node, scope, role} of index(root).entries) {
        let field;
        if (literalKinds.has(node.kind) && node.kind !== 'NullLiteral') field = 'value';
        else if (kind(node, 'ColumnReference')) field = 'column';
        else if (kind(node, 'TableSource')) field = 'table';
        else if (kind(node, 'AggregateExpression')) field = 'name';
        if (field && node.attrs[field] != null) facts.add(stableKey([scope ? role : 'other', node.kind, field, node.attrs[field]]));
    }
    return facts;
}

const literal = node => literalKinds.has(node?.kind) && node.kind !== 'DoubleQuotedLiteral';
function pure(node) {
    if (!node) return false;
    if (literal(node) || kind(node, 'ColumnReference')) return true;
    if (kind(node, 'UnaryExpression')) return ['NOT', '+', '-', '~'].includes(node.attrs.operator) && pure(node.slots.expr);
    if (kind(node, 'BinaryExpression')) return !node.attrs.collate && pure(node.slots.left) && pure(node.slots.right);
    return false;
}
function containsCollationOrCast(node) {
    if (!isNode(node)) return false;
    if (/collat|cast/i.test(node.kind) || Object.entries(node.attrs).some(([key, value]) => /collat/i.test(key) && value != null)) return true;
    return children(node).some(({child}) => containsCollationOrCast(child));
}

function binding(column, scope) {
    const qualifier = fold(column.attrs.table);
    if (qualifier == null) return ['unqualified', scope?.id ?? null];
    for (let current = scope; current; current = current.parent) {
        const matches = current.sources.filter(source => source.name === qualifier);
        if (matches.length === 1) return matches[0].identity;
        if (matches.length > 1) return ['ambiguous', current.id, qualifier];
    }
    return ['unbound', qualifier];
}
const attrsOf = node => Object.fromEntries(Object.entries(node.attrs).filter(([key, value]) => value != null && !(key === 'distinct' && value === false)));

/**
 * Clause/expression signatures are a deliberately coarser abstraction than the
 * concrete AST graph. Only signatures are flattened; every search state and
 * replayable edge remains concrete. Queries inside expressions are omitted,
 * because JOIN relocation inside them would require a separate whole-query
 * abstraction. Numeric storage class, CAST and collations remain represented.
 */
export function predicateFacts(root) {
    const facts = new Set(), indexed = index(root);
    // Scope belongs to an AST occurrence, not a JS object identity. Cached edit
    // constructors and reverse-idempotence can share object instances between
    // positions. A WeakMap keyed only by nodes would make a zero-cost clone or
    // alias edge change this abstraction even for the same logical AST.
    const term = (node, scope) => {
        if (!isNode(node)) return null;
        if (['Select', 'CompoundSelect', 'Script', 'Subquery'].includes(node.kind)) return null;
        const attrs = attrsOf(node);
        if (kind(node, 'ColumnReference')) {
            delete attrs.table;
            const slots = slotTerms(node, scope);
            return slots === null ? null : ['ColumnReference', attrs, binding(node, scope), slots];
        }
        const expression = node;
        let operator = attrs.operator;
        if (kind(expression, 'BinaryExpression')) {
            const expressionAttrs = attrsOf(expression);
            if (pure(expression) && ['!=', '<>'].includes(operator)) operator = '!=';
            expressionAttrs.operator = operator;
            if (['AND', 'OR'].includes(operator) && pure(expression)) {
                const parts = [];
                const append = signature => {
                    // A nested opposite connective may collapse by idempotence
                    // to this connective, e.g. AND(OR(P,P),P). Flatten after
                    // recursive canonicalization as well as before it.
                    if (signature?.[0] === 'Boolean' && signature[1] === operator) signature[2].forEach(append);
                    else parts.push(signature);
                };
                const flatten = child => {
                    if (kind(child, 'BinaryExpression') && child.attrs.operator === operator && pure(child)) {
                        flatten(child.slots.left); flatten(child.slots.right);
                    } else append(term(child, scope));
                };
                flatten(expression.slots.left); flatten(expression.slots.right);
                if (parts.some(part => part === null)) return null;
                const distinct = [...new Map(parts.map(part => [stableKey(part), part])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, part]) => part);
                return distinct.length === 1 ? distinct[0] : ['Boolean', operator, distinct];
            }
            let left = term(expression.slots.left, scope), right = term(expression.slots.right, scope);
            if (left === null || right === null) return null;
            if (Object.hasOwn(mirrors, operator) && !containsCollationOrCast(expression)
                && literalKinds.has(left[0]) && left[0] !== 'DoubleQuotedLiteral' && right[0] === 'ColumnReference') {
                [left, right] = [right, left]; expressionAttrs.operator = mirrors[operator];
            }
            const rest = slotTerms(expression, scope, new Set(['left', 'right']));
            return rest === null ? null : ['BinaryExpression', expressionAttrs, left, right, rest];
        }
        const slots = slotTerms(node, scope);
        if (kind(node, 'UnaryExpression') && operator === 'NOT' && pure(node.slots.expr)
            && slots?.expr?.[0] === 'BinaryExpression' && slots.expr[1].operator === '=') {
            return [slots.expr[0], {...slots.expr[1], operator: '!='}, ...slots.expr.slice(2)];
        }
        return slots === null ? null : [node.kind, attrs, slots];
    };
    const slotTerms = (node, scope, skip = new Set()) => {
        const result = {};
        for (const field of Object.keys(node.slots).sort()) {
            if (skip.has(field)) continue;
            const value = node.slots[field];
            if (value == null || Array.isArray(value) && !value.length) continue;
            if (Array.isArray(value)) {
                const converted = value.map(child => child === null ? ['hole'] : term(child, scope));
                if (converted.some(child => child === null)) return null;
                result[field] = converted;
            } else {
                result[field] = term(value, scope);
                if (result[field] === null) return null;
            }
        }
        return result;
    };
    const conjunction = (operator, signatures) => {
        const parts = [];
        const append = signature => {
            if (signature?.[0] === 'Boolean' && signature[1] === operator) signature[2].forEach(append);
            else parts.push(signature);
        };
        signatures.forEach(append);
        const distinct = [...new Map(parts.map(part => [stableKey(part), part])).entries()]
            .sort(([a], [b]) => a.localeCompare(b)).map(([, part]) => part);
        return distinct.length === 1 ? distinct[0] : ['Boolean', operator, distinct];
    };
    // This additional abstraction deliberately forgets Boolean evaluation order.
    // The separate ordered-call fact retains volatile-call ordering. Flattening
    // here permits JOIN/WHERE conjunctions to share a signature while preserving
    // AND-versus-OR precedence. It does not transform any concrete graph state.
    const booleanForm = signature => {
        if (signature === null || typeof signature !== 'object') return signature;
        if (!Array.isArray(signature)) return Object.fromEntries(Object.entries(signature).map(([key, value]) => [key, booleanForm(value)]));
        const normalized = signature.map(booleanForm);
        if (normalized[0] === 'Boolean') return conjunction(normalized[1], normalized[2]);
        if (normalized[0] === 'BinaryExpression' && ['AND', 'OR'].includes(normalized[1]?.operator)) {
            return conjunction(normalized[1].operator, [normalized[2], normalized[3]]);
        }
        if (normalized[0] === 'UnaryExpression' && normalized[1]?.operator === 'NOT'
            && normalized[2]?.expr?.[0] === 'BinaryExpression' && normalized[2].expr[1]?.operator === '=') {
            return [normalized[2].expr[0], {...normalized[2].expr[1], operator: '!='}, ...normalized[2].expr.slice(2)];
        }
        return normalized;
    };
    const callSequences = new Map();
    // Repeated predicates in distinct DML statements perform distinct work.
    // A global set alone would miss changing one of several identical WHEREs.
    // No semantic zero edit reorders/adds/removes top-level statements. Paid
    // statement edits may shift many indexes; hence this still participates
    // only in the binary missing-fact bound, never a counted bound.
    if (root.kind === 'Script') for (let i = 0; i < (root.slots.statements || []).length; i++) {
        const statement = root.slots.statements[i];
        if (!['Update', 'Delete'].includes(statement?.kind) || !statement.slots.where) continue;
        const signature = term(statement.slots.where, null);
        if (signature !== null) facts.add(stableKey(['dml-where', i, statement.kind, booleanForm(signature)]));
    }
    for (const {node, scope, role, predicateRole} of indexed.entries) {
        // SQL type parameters, defaults/constraints and assignments also carry
        // semantic attributes. A changed VARCHAR length is not a numeric
        // expression leaf. These component signatures are only a binary search
        // bound and use the same zero-edge-invariant expression abstraction.
        if (['Definition', 'DataType', 'Assignment', 'ReferenceDefinition', 'ViewName'].includes(node.kind)) {
            const signature = term(node, scope);
            if (signature !== null) facts.add(stableKey(['sql-component', node.kind, booleanForm(signature)]));
        }
        if (kind(node, 'Select')) {
            if (node.attrs.distinct === true) facts.add(stableKey(['distinct', scope.id]));
            for (let i = 0; i < (node.slots.from || []).length; i++) {
                const source = node.slots.from[i];
                if (outerJoin(source?.attrs?.join)) facts.add(stableKey(['outer-join', scope.id, i, source.attrs.join]));
            }
            const from = node.slots.from || [];
            const movableInnerSources = from.every(source => kind(source, 'TableSource') && !source.slots.expr
                && !source.attrs.natural && (source.slots.using == null || Array.isArray(source.slots.using) && !source.slots.using.length)
                && (!source.attrs.join || ['INNER JOIN', 'CROSS JOIN'].includes(source.attrs.join)));
            const filters = node.slots.where ? [term(node.slots.where, scope)] : [];
            if (movableInnerSources) for (const source of from) {
                if (source.attrs.join === 'INNER JOIN' && pure(source.slots.on)) filters.push(term(source.slots.on, scope));
            }
            if (filters.length && filters.every(signature => signature !== null)) {
                facts.add(stableKey(['filter-boolean', scope.id, conjunction('AND', filters.map(booleanForm))]));
            }
            if (node.slots.having) {
                const signature = term(node.slots.having, scope);
                if (signature !== null) facts.add(stableKey(['having-boolean', scope.id, booleanForm(signature)]));
            }
        }
        if (kind(node, 'SelectItem') && role === 'projection' && node.slots.expr) {
            const signature = term(node.slots.expr, scope);
            if (signature !== null) facts.add(stableKey(['projection-expression', scope?.id ?? null, signature]));
        }
        // None of the registered zero-cost edits reorder or duplicate function
        // calls: their purity guards reject expressions containing such calls.
        // Keep their order separately so adding/moving pure JOIN predicates does
        // not change this fact. Calls containing a query child remain omitted.
        if (['FunctionExpression', 'AggregateExpression'].includes(node.kind)) {
            const signature = term(node, scope);
            if (signature !== null) {
                const key = stableKey([scope?.id ?? null, predicateRole]);
                if (!callSequences.has(key)) callSequences.set(key, {scope: scope?.id ?? null, role: predicateRole, signatures: []});
                callSequences.get(key).signatures.push(signature);
            }
        }
    }
    for (const sequence of callSequences.values()) facts.add(stableKey(['ordered-calls', sequence.scope, sequence.role, sequence.signatures]));
    const expressions = new Set([...literalKinds, 'ColumnReference', 'BinaryExpression', 'UnaryExpression',
        'AggregateExpression', 'FunctionExpression', 'CastExpression', 'CaseExpression', 'ExpressionList', 'Subquery']);
    const collect = (signature, scope, role) => {
        if (signature === null || typeof signature !== 'object') return;
        if (Array.isArray(signature)) {
            if (signature[0] === 'BinaryExpression' && comparisons.has(signature[1]?.operator)) facts.add(stableKey(['predicate', scope?.id ?? null, role, signature]));
            for (const child of signature) collect(child, scope, role);
        } else for (const child of Object.values(signature)) collect(child, scope, role);
    };
    const visit = entry => {
        if (!entry) return;
        const {node, scope, predicateRole} = entry;
        if (expressions.has(node.kind)) {
            const signature = term(node, scope);
            if (signature !== null) { collect(signature, scope, predicateRole); return; }
        }
        for (const child of entry.children) visit(child);
    };
    visit(indexed.tree);
    return facts;
}
