import {lex, parserSql, parseAst, Unsupported} from './syntax.mjs';

// This is a SQL AST adapter. It deliberately does not call normalizeAst or
// syntaxTree: semantic equivalences belong to graph edges, not node equality.
const fold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
const upper = value => typeof value === 'string' ? value.replace(/[a-z]/g, c => c.toUpperCase()) : value;
export const clone = value => JSON.parse(JSON.stringify(value));

export function stableKey(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return '[' + value.map(stableKey).join(',') + ']';
    if (typeof value.kind === 'string' && value.attrs && value.slots) {
        value = {kind: value.kind,
            attrs: Object.fromEntries(Object.entries(value.attrs).filter(([key, child]) => child != null && !(key === 'distinct' && child === false))),
            slots: Object.fromEntries(Object.entries(value.slots).filter(([, child]) => child != null && !(Array.isArray(child) && !child.length)))};
    }
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stableKey(value[key])).join(',') + '}';
}

/** Visit semantic nodes; a path is an array of slot names and list indexes. */
export function* walkNodes(root, path = []) {
    if (!root) return;
    yield {node: root, path};
    for (const [field, child] of Object.entries(root.slots || {})) {
        if (Array.isArray(child)) {
            for (let i = 0; i < child.length; i++) yield* walkNodes(child[i], [...path, field, i]);
        } else if (child) yield* walkNodes(child, [...path, field]);
    }
}

const word = token => token?.kind === 'Word' ? upper(token.value) : '';
const isName = token => token && (token.kind === 'Word' || token.kind === 'Identifier');
const is = (token, value) => token?.text === value || word(token) === value;
const synthetic = text => lex(text);
function validateNumericBoundaries(sql, tokens) {
    let offset = 0;
    for (const token of tokens) {
        for (;;) {
            if (/\s/.test(sql[offset] || '')) { offset++; continue; }
            if (sql.startsWith('--', offset)) { const end = sql.indexOf('\n', offset); offset = end < 0 ? sql.length : end + 1; continue; }
            if (sql.startsWith('/*', offset)) { offset = sql.indexOf('*/', offset + 2) + 2; continue; }
            break;
        }
        offset += token.text.length;
        if (token.kind === 'Number' && /[A-Za-z_\u0080-\uFFFF.$]/.test(sql[offset] || '')) {
            throw new Unsupported('graph-invalid-numeric-token', 'A SQL numeric token is malformed.');
        }
    }
}
const one = ast => {
    if (Array.isArray(ast)) {
        if (ast.length !== 1) throw new Unsupported('graph-parser-statements', 'Expected one SQL statement.');
        return ast[0];
    }
    return ast;
};
function splitAtDepth(tokens, predicate) {
    const parts = []; let start = 0, depth = 0;
    for (let i = 0; i < tokens.length; i++) {
        if (is(tokens[i], '(')) depth++;
        else if (is(tokens[i], ')')) depth--;
        else if (!depth && predicate(tokens[i], i)) { parts.push(tokens.slice(start, i)); start = i + 1; }
    }
    parts.push(tokens.slice(start)); return parts;
}
function topLevel(tokens, predicate) {
    let depth = 0;
    for (let i = 0; i < tokens.length; i++) {
        if (is(tokens[i], '(')) depth++;
        else if (is(tokens[i], ')')) depth--;
        else if (!depth && predicate(tokens[i], i)) return i;
    }
    return -1;
}

function context(tokens) {
    let serial = 0;
    // Include string contents too: a user literal must never be mistaken for a
    // generated parser placeholder, even if it spells our internal prefix.
    const used = new Set(tokens.filter(t => typeof t.value === 'string').map(t => fold(t.value)));
    return {
        markers: new Map(), adapters: new Set(), partial: false,
        marker(type, value) {
            let name;
            do { name = '__qss_ast_marker_' + serial++ + '__'; } while (used.has(name));
            used.add(name); this.markers.set(name, {type, value}); return name;
        }
    };
}

// Narrow grammar adapters retain native SQLite constructs in the AST. Marker
// nodes are removed after parsing; no marker or source fragment becomes a node.
function grammarInput(tokens, ctx) {
    const result = [];
    // The upstream parser converts numeric literals to JS Number, losing both
    // SQLite's integer/real distinction and large-integer precision. Parameters
    // are parser placeholders only: restore the original literal AST afterwards.
    const typeParameters = new Set();
    const parameterizedTypes = new Set(['CHAR', 'CHARACTER', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'DECIMAL', 'NUMERIC', 'NUMBER', 'FLOAT', 'DOUBLE', 'REAL', 'INTEGER', 'INT']);
    for (let i = 0; i + 1 < tokens.length; i++) {
        if (!parameterizedTypes.has(word(tokens[i])) || !is(tokens[i + 1], '(')) continue;
        const ddl = word(tokens[0]) === 'ALTER' || word(tokens[0]) === 'CREATE' && tokens.slice(0, i).some(token => word(token) === 'TABLE');
        const declaredType = ddl && isName(tokens[i - 1]) && !['DEFAULT', 'CHECK', 'SELECT', 'WHERE', 'AS', 'AND', 'OR'].includes(word(tokens[i - 1]));
        if (word(tokens[i - 1]) !== 'AS' && !declaredType) continue;
        let depth = 1;
        for (let j = i + 2; j < tokens.length && depth; j++) {
            if (is(tokens[j], '(')) depth++;
            else if (is(tokens[j], ')')) depth--;
            else if (tokens[j].kind === 'Number') typeParameters.add(j);
        }
    }
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i], keyword = word(t);
        if (t.kind === 'String' || t.kind === 'Identifier'
            || t.kind === 'Word' && (/[^\x00-\x7f]/.test(t.text) || t.text.startsWith('_'))) {
            const type = t.kind === 'String' ? 'string' : t.kind === 'Word' ? 'unquoted-name' : 'quoted-name';
            const marker = ctx.marker(type, {value: t.value, quote: t.text[0]});
            const quote = t.kind === 'String' ? "'" : '"';
            result.push({kind: quote === "'" ? 'String' : 'Identifier', text: quote + marker + quote, value: marker});
            continue;
        }
        if (t.kind === 'Number' && !typeParameters.has(i)) {
            const real = /[.eE]/.test(t.text) && !/^0x/i.test(t.text)
                || !/^0x/i.test(t.text) && BigInt(t.text) > 9223372036854775807n;
            const marker = ctx.marker('number', {type: 'number', value: t.text,
                storageClass: real ? 'real' : 'integer'});
            result.push({kind: 'Parameter', text: ':' + marker, value: marker});
            continue;
        }
        result.push(t);
        if (keyword === 'REFERENCES' && isName(tokens[i + 1])) {
            result.push(tokens[++i]);
            if (is(tokens[i + 1], '.') && isName(tokens[i + 2])) result.push(tokens[++i], tokens[++i]);
            if (!is(tokens[i + 1], '(')) {
                const marker = ctx.marker('implicit-reference-columns', null);
                result.push(...synthetic('(' + marker + ')'));
                ctx.adapters.add('implicit-reference-columns');
            }
        } else if (keyword === 'IN' && isName(tokens[i + 1])
            && !['SELECT', 'WITH', 'VALUES'].includes(word(tokens[i + 1]))) {
            const first = tokens[++i];
            let db = null, table = first.value;
            if (is(tokens[i + 1], '.') && isName(tokens[i + 2])) { db = table; ++i; table = tokens[++i].value; }
            const marker = ctx.marker('table-membership', {type: 'table_membership', db, table});
            result.push(...synthetic('(' + marker + ')'));
            ctx.adapters.add('table-membership');
        } else if (['AVG', 'SUM', 'MIN', 'MAX'].includes(keyword)
            && is(tokens[i + 1], '(') && is(tokens[i + 2], ')')) {
            const marker = ctx.marker('hole', null);
            result.push(tokens[++i], ...synthetic(marker), tokens[++i]);
            ctx.partial = true;
        }
    }
    return result;
}

function restoreMarkers(value, ctx) {
    if (value === null || typeof value !== 'object') {
        const marker = typeof value === 'string' ? ctx.markers.get(value) : null;
        return marker && ['string', 'quoted-name', 'unquoted-name'].includes(marker.type) ? marker.value.value : value;
    }
    if (Array.isArray(value)) return value.map(v => restoreMarkers(v, ctx));
    const markerName = value.type === 'column_ref' ? value.column : value.value;
    if (typeof markerName === 'string' && ctx.markers.has(markerName)) {
        const marker = ctx.markers.get(markerName);
        if (marker.type === 'hole') return null;
        if (marker.type === 'number') return clone(marker.value);
        if (['string', 'quoted-name', 'unquoted-name'].includes(marker.type)) {
            if (value.type === 'column_ref') {
                return Object.fromEntries(Object.entries(value).map(([key, child]) => [key,
                    key === 'column' ? marker.value.value : restoreMarkers(child, ctx)]));
            }
            if (marker.type === 'unquoted-name' || marker.type === 'quoted-name' && marker.value.quote !== '"') {
                return {type: 'column_ref', table: null, column: marker.value.value, collate: null};
            }
            return {...value, value: marker.value.value};
        }
        return {type: '__marker', marker: markerName};
    }
    const result = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, restoreMarkers(child, ctx)]));
    if (result.type === 'select' && result.columns?.length === 1 && result.columns[0].expr?.type === '__marker') {
        const marker = ctx.markers.get(result.columns[0].expr.marker);
        if (marker?.type === 'subquery') return clone(marker.value);
    }
    if (result.type === 'expr_list' && result.value?.length === 1 && result.value[0]?.type === '__marker') {
        const marker = ctx.markers.get(result.value[0].marker);
        if (marker.type === 'table-membership') return clone(marker.value);
    }
    if (Array.isArray(result.definition) && result.definition.length === 1 && result.definition[0]?.type === '__marker'
        && ctx.markers.get(result.definition[0].marker)?.type === 'implicit-reference-columns') {
        result.definition = null;
        result.implicit_columns = true;
    }
    return result;
}

function parseStatement(original, ctx) {
    const tokens = grammarInput(original, ctx);
    try { return restoreMarkers(one(parseAst(parserSql(tokens))), ctx); }
    catch (initialError) {
        // SQLite's compound SELECT operators have equal precedence and associate
        // to the left. This constructs their real SQL AST, not a syntax tree.
        const operators = [];
        let depth = 0;
        for (let i = 0; i < original.length; i++) {
            if (is(original[i], '(')) depth++;
            else if (is(original[i], ')')) depth--;
            else if (!depth && ['UNION', 'EXCEPT', 'INTERSECT'].includes(word(original[i]))) operators.push(i);
        }
        if (word(original[0]) === 'SELECT' && operators.length) {
            const index = operators.at(-1), all = word(original[index + 1]) === 'ALL';
            const result = {type: 'compound_select', operator: word(original[index]) + (all ? ' ALL' : ''),
                left: parseStatement(original.slice(0, index), ctx), right: parseStatement(original.slice(index + 1 + Number(all)), ctx)};
            ctx.adapters.add('compound-select'); return liftCompoundTail(result);
        }
        // The parser rejects mixed comma/explicit JOIN chains that SQLite
        // accepts. Parse each comma-delimited source with its JOINs independently.
        if (word(original[0]) === 'SELECT') {
            const from = topLevel(original, token => word(token) === 'FROM');
            if (from >= 0) {
                const relativeEnd = topLevel(original.slice(from + 1), token => ['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'WINDOW', 'UNION', 'EXCEPT', 'INTERSECT'].includes(word(token)));
                const end = relativeEnd < 0 ? original.length : from + 1 + relativeEnd;
                const groups = splitAtDepth(original.slice(from + 1, end), token => is(token, ','));
                if (groups.length > 1 && groups.every(group => group.length)) {
                    const sources = groups.flatMap(group => parseStatement([...synthetic('SELECT 1 FROM'), ...group], ctx).from || []);
                    const placeholder = ctx.marker('table-placeholder', null);
                    const shell = parseStatement([...original.slice(0, from + 1), ...synthetic(placeholder), ...original.slice(end)], ctx);
                    shell.from = sources; ctx.adapters.add('mixed-join-sources'); return shell;
                }
            }
            // SQLite also supports the postfix expression spelling `x NOT NULL`.
            // Its semantic expression AST is the same IS NOT NULL operator.
            const patched = [];
            let changed = false;
            for (let i = 0; i < original.length; i++) {
                if (word(original[i]) === 'NOT' && word(original[i + 1]) === 'NULL'
                    && i > 0 && word(original[i - 1]) !== 'IS'
                    && (isName(original[i - 1]) || is(original[i - 1], ')') || ['Number', 'String'].includes(original[i - 1].kind))) {
                    patched.push(...synthetic('IS')); changed = true;
                }
                patched.push(original[i]);
            }
            if (changed) { const result = parseStatement(patched, ctx); ctx.adapters.add('postfix-not-null'); return result; }
        }
        // CREATE VIEW contains an ordinary SELECT AST; parse that child using
        // the same adapters and retain the complete native view declaration.
        if (word(original[0]) === 'CREATE' && original.some(token => word(token) === 'VIEW')) {
            const as = topLevel(original, (token, i) => word(token) === 'AS' && ['SELECT', 'WITH'].includes(word(original[i + 1])));
            if (as >= 0) {
                const shell = one(parseAst(parserSql([...original.slice(0, as + 1), ...synthetic('SELECT 1')])));
                shell.select = parseStatement(original.slice(as + 1), ctx);
                return shell;
            }
        }
        // The upstream grammar accepts some SELECT expressions at the top
        // level but rejects the same expressions in IN/scalar subqueries of
        // DELETE/UPDATE. Parse each real query child independently, retain the
        // enclosing SQL AST, and replace only its temporary parser placeholder.
        // Parentheses and query boundaries come from the balanced SQLite lexer.
        const shellTokens = []; let extracted = false;
        for (let i = 0; i < original.length; i++) {
            if (!is(original[i], '(') || !['SELECT', 'WITH'].includes(word(original[i + 1]))) {
                shellTokens.push(original[i]); continue;
            }
            let depth = 1, end = i + 1;
            for (; end < original.length && depth; end++) {
                if (is(original[end], '(')) depth++;
                else if (is(original[end], ')')) depth--;
            }
            const content = original.slice(i + 1, end - 1);
            // Re-entering the outer parser may still need another adapter, but
            // must not repeatedly extract an already opaque query placeholder.
            if (content.length === 2 && word(content[0]) === 'SELECT'
                && content[1].kind === 'Parameter' && ctx.markers.get(content[1].value)?.type === 'subquery') {
                shellTokens.push(...original.slice(i, end)); i = end - 1; continue;
            }
            const child = parseStatement(content, ctx), marker = ctx.marker('subquery', child);
            shellTokens.push(original[i], ...synthetic('SELECT'), {kind: 'Parameter', text: ':' + marker, value: marker}, original[end - 1]);
            i = end - 1; extracted = true;
        }
        if (extracted) {
            const result = parseStatement(shellTokens, ctx);
            ctx.adapters.add('nested-query-ast'); return result;
        }
        throw new Unsupported('graph-sql-grammar', 'The SQL cannot be represented by the semantic graph AST adapter.');
    }
}

function liftCompoundTail(compound) {
    let last = compound.right;
    while (last?.type === 'compound_select') last = last.right;
    for (const key of ['orderby', 'limit']) {
        if (last?.[key] != null) { compound[key] = last[key]; last[key] = null; }
    }
    return compound;
}

const kinds = {
    select: 'Select', compound_select: 'CompoundSelect', binary_expr: 'BinaryExpression', unary_expr: 'UnaryExpression',
    column_ref: 'ColumnReference', number: 'NumberLiteral', bigint: 'BigIntLiteral', bool: 'BooleanLiteral',
    string: 'StringLiteral', single_quote_string: 'StringLiteral', double_quote_string: 'DoubleQuotedLiteral',
    null: 'NullLiteral', star: 'Asterisk', aggr_func: 'AggregateExpression', function: 'FunctionExpression',
    expr_list: 'ExpressionList', table_membership: 'TableMembership', case: 'CaseExpression', when: 'WhenExpression',
    create: 'Create', alter: 'Alter', update: 'Update', delete: 'Delete', insert: 'Insert', drop: 'Drop',
    values: 'Values', cast: 'CastExpression', default: 'Default', 'not null': 'NotNull'
};
const listFields = new Set(['columns', 'from', 'with', 'orderby', 'options', 'create_definitions', 'table_options', 'on_action', 'set', 'returning']);
const childFields = new Set(['expr', 'left', 'right', 'where', 'having', 'groupby', 'limit', 'for_update', 'over',
    'collate', 'args', 'ast', 'select', 'definition', 'reference_definition', 'column', 'name', 'using',
    'window', 'partitionby', 'on', 'check', 'nullable', 'default_val']);
const ignored = new Set(['loc', 'tableList', 'columnList', 'parentheses']);
const enumFields = new Set(['operator', 'join', 'dataType', 'keyword', 'constraint_type', 'resource', 'action', 'primary_key']);
const identifierFields = new Set(['table', 'db', 'column', 'as', 'view', 'index', 'constraint']);

function wrapperKind(raw, field, parentKind) {
    if (raw.ast) return 'Subquery';
    if (field === 'columns' && parentKind === 'Select') return 'SelectItem';
    if (field === 'from' || field === 'table') return 'TableSource';
    if (field === 'orderby') return 'OrderByItem';
    if (field === 'groupby') return 'GroupBy';
    if (field === 'args' && parentKind === 'AggregateExpression') return 'AggregateArguments';
    if (field === 'args') return 'FunctionArguments';
    if (field === 'create_definitions' || (field === 'expr' && parentKind === 'Alter')) return 'Definition';
    if (field === 'definition' && raw.dataType) return 'DataType';
    if (field === 'reference_definition') return 'ReferenceDefinition';
    if (field === 'view') return 'ViewName';
    if (field === 'name' && parentKind === 'FunctionExpression') return 'FunctionName';
    if (field === 'with') return 'CommonTableExpression';
    if (field === 'set') return 'Assignment';
    return field ? field[0].toUpperCase() + field.slice(1) : 'SQLComponent';
}

function toNode(input, field = '', parentKind = '') {
    if (input == null) return null;
    if (typeof input !== 'object') return {kind: 'Scalar', attrs: {value: input}, slots: {}};
    if (Array.isArray(input)) throw new Unsupported('graph-model-list', 'A SQL node cannot be an unbound list.');
    let raw = input;
    if (raw.type === '__marker') throw new Unsupported('graph-parser-marker', 'An internal SQL parser marker was not consumed.');
    // Upstream select_stmt -> '(' select_stmt ')' marks parentheses_symbol for
    // SQL rendering. A Subquery.ast child is already explicitly enclosed by its
    // semantic parent. Retaining this duplicate flag would charge an extra edit
    // when the parser chooses a different scalar-subquery grammar branch.
    // Do not drop it globally: compound/grouping contexts keep their structure,
    // and ORDER BY/LIMIT remain attached to their actual query scope.
    if (raw.type === 'select' && field === 'ast' && parentKind === 'Subquery'
        && typeof raw.parentheses_symbol === 'boolean') {
        raw = {...raw}; delete raw.parentheses_symbol;
    }
    // node-sql-parser encodes these SQL prefix operators as named functions.
    // Preserve their actual expression role without applying an equivalence.
    const functionName = raw.type === 'function' && raw.name?.name?.length === 1 ? upper(raw.name.name[0].value) : null;
    if (['NOT', 'EXISTS'].includes(functionName) && raw.args?.value?.length === 1) {
        raw = {type: 'unary_expr', operator: functionName, expr: raw.args.value[0]};
    }
    if (raw.type === 'select' && raw._next) {
        let current = clone(raw), result;
        const first = current;
        while (current) {
            const next = current._next, operator = current.set_op;
            delete current._next; delete current.set_op;
            if (!result) result = current;
            else result = {type: 'compound_select', operator: upper(result.__pendingOperator), left: result, right: current};
            // Internal temporary bookkeeping never enters the semantic model.
            delete result.left?.__pendingOperator;
            if (next) result.__pendingOperator = operator;
            current = next;
        }
        delete result.__pendingOperator;
        if (first.with) { result.with = first.with; first.with = null; }
        raw = liftCompoundTail(result);
    }
    const kind = field === 'orderby' ? 'OrderByItem' : kinds[raw.type]
        || (typeof raw.type === 'string' ? 'SQL:' + raw.type : wrapperKind(raw, field, parentKind));
    const node = {kind, attrs: {}, slots: {}};
    if (kind === 'Select') node.attrs.distinct = raw.distinct === 'DISTINCT' || upper(raw.distinct?.type) === 'DISTINCT';
    if (kind === 'AggregateArguments') node.attrs.distinct = raw.distinct === 'DISTINCT' || upper(raw.distinct?.type) === 'DISTINCT';
    for (const [key, value] of Object.entries(raw)) {
        if (ignored.has(key) || key === 'type' && kind !== 'OrderByItem' || key === 'distinct' && ['Select', 'AggregateArguments'].includes(kind)) continue;
        if (Array.isArray(value)) node.slots[key] = value.map(child => toNode(child, key, kind));
        else if (value && typeof value === 'object') node.slots[key] = toNode(value, key, kind);
        else if (value == null && (listFields.has(key) || childFields.has(key))) node.slots[key] = listFields.has(key) ? [] : null;
        else {
            let scalar = value;
            if (typeof scalar === 'string' && (identifierFields.has(key) || kind === 'Collate' && key === 'name')) scalar = fold(scalar);
            if (typeof scalar === 'string' && (enumFields.has(key) || kind === 'OrderByItem' && key === 'type'
                || kind === 'AggregateExpression' && key === 'name'
                || parentKind === 'FunctionName' && key === 'value')) scalar = upper(scalar);
            node.attrs[key] = scalar;
        }
    }
    if (kind === 'Select') {
        for (const key of ['columns', 'from', 'with', 'orderby', 'options']) node.slots[key] ||= [];
        for (const key of ['where', 'groupby', 'having', 'limit', 'for_update']) node.slots[key] ??= null;
    }
    if (kind === 'AggregateArguments') node.slots.expr ??= null;
    if (kind === 'BinaryExpression') { node.slots.left ??= null; node.slots.right ??= null; }
    if (kind === 'UnaryExpression') node.slots.expr ??= null;
    if (kind === 'TableSource') {
        for (const key of ['db', 'table', 'as', 'join']) node.attrs[key] ??= null;
        for (const key of ['on', 'expr', 'using']) node.slots[key] ??= null;
    }
    if (kind === 'ColumnReference') {
        node.attrs.table ??= null;
        node.slots.collate ??= null;
    }
    if (kind === 'SelectItem') { node.attrs.as ??= null; node.slots.expr ??= null; }
    // Omitted ORDER BY direction is the same SQLite grammar default as ASC;
    // serializers may spell it out without changing the ordering operation.
    if(kind==='OrderByItem')node.attrs.type=upper(node.attrs.type||'ASC');
    if (kind === 'AggregateExpression') { node.slots.args ??= null; node.slots.over ??= null; }
    return node;
}

// SQLite first interprets a double-quoted expression as an identifier. Only an
// unresolved name receives legacy DQS string fallback. This is name resolution
// in the supplied schema, not an equivalence rewrite or an execution probe.
function resolveDoubleQuotedNames(root, schema) {
    const catalog = new Map();
    const addTable = (name, columns) => {
        if (typeof name !== 'string' || !Array.isArray(columns)) return;
        catalog.set(fold(name), new Set(columns.map(column => fold(typeof column === 'string' ? column : column.name))
            .filter(name => typeof name === 'string')));
    };
    if (Array.isArray(schema?.tables)) for (const table of schema.tables) addTable(table.name, table.columns);
    else if (schema && typeof schema === 'object') for (const [name, columns] of Object.entries(schema)) addTable(name, columns);
    const outputNames = (query,tables=catalog) => {
        if (query?.kind === 'Subquery') return outputNames(query.slots.ast,tables);
        if (query?.kind === 'CompoundSelect') return outputNames(query.slots.left,tables);
        const result = new Set();
        if (query?.kind !== 'Select') return result;
        for (const item of query.slots.columns || []) {
            if (typeof item?.attrs?.as === 'string') result.add(fold(item.attrs.as));
            else if (item?.slots?.expr?.kind === 'ColumnReference' && item.slots.expr.attrs.column !== '*') result.add(fold(item.slots.expr.attrs.column));
            else if(item?.slots?.expr?.kind==='Asterisk'||item?.slots?.expr?.kind==='ColumnReference'&&item.slots.expr.attrs.column==='*'){
                const qualifier=item.slots.expr.attrs.table;
                for(const source of query.slots.from||[])if(qualifier==null||fold(source.attrs.as??source.attrs.table)===fold(qualifier))
                    for(const name of source.slots.expr?outputNames(source.slots.expr,tables):tables.get(fold(source.attrs.table))||[])result.add(name);
            }
        }
        return result;
    };
    const matches = (name, scope, aliases) => {
        for (let current = scope; current; current = current.parent) {
            if (current.sources.some(columns => columns.has(name))) return true;
            if (current === scope && aliases && current.aliases.has(name)) return true;
        }
        return false;
    };
    const resolve = (node, scope, tables, aliases = false) => {
        if (!node) return node;
        if(node.kind==='Script'){
            const local=new Map(tables);
            node.slots.statements=(node.slots.statements||[]).map(statement=>{
                const result=resolve(statement,null,local);
                const name=fold(result.slots.table?.[0]?.attrs.table);
                if(result.kind==='Create'&&result.attrs.keyword==='TABLE'&&typeof name==='string'){
                    const columns=(result.slots.create_definitions||[]).filter(d=>d.attrs.resource==='COLUMN').map(d=>fold(d.slots.column?.attrs.column)).filter(n=>typeof n==='string');
                    local.set(name,columns.length?new Set(columns):outputNames(result.slots.select,local));
                }else if(result.kind==='Create'&&result.attrs.keyword==='VIEW'){
                    const view=fold(result.slots.view?.attrs.view),explicit=(result.slots.columns||[]).map(c=>fold(c.attrs.column??c.attrs.value)).filter(n=>typeof n==='string');
                    if(typeof view==='string')local.set(view,explicit.length?new Set(explicit):outputNames(result.slots.select,local));
                }else if(result.kind==='Alter'&&local.has(name)){
                    const columns=new Set(local.get(name));
                    for(const action of result.slots.expr||[]){
                        const column=fold(action.slots.column?.attrs.column);
                        if(action.attrs.resource!=='COLUMN')continue;
                        if(['ADD','RENAME'].includes(action.attrs.action)&&typeof column==='string')columns.add(column);
                        if(action.attrs.action==='DROP')columns.delete(column);
                        if(action.attrs.action==='RENAME')columns.delete(fold(action.slots.old_column?.attrs.column));
                    }local.set(name,columns);
                }else if(result.kind==='Drop'&&['TABLE','VIEW'].includes(result.attrs.keyword))local.delete(name);
                return result;
            });return node;
        }
        if(node.kind==='Create'&&node.attrs.keyword==='TABLE'){
            const columns=new Set((node.slots.create_definitions||[]).filter(d=>d.attrs.resource==='COLUMN').map(d=>fold(d.slots.column?.attrs.column)).filter(n=>typeof n==='string'));
            const checkScope={parent:null,sources:[columns],aliases:new Set()};
            const definitions=n=>{
                for(const [field,value]of Object.entries(n.slots)){
                    const child=v=>field==='check'?resolve(v,checkScope,tables):v&&v.kind==='Definition'?definitions(v):resolve(v,null,tables);
                    n.slots[field]=Array.isArray(value)?value.map(child):child(value);
                }return n;
            };
            node.slots.create_definitions=(node.slots.create_definitions||[]).map(definitions);
            if(node.slots.select)node.slots.select=resolve(node.slots.select,null,tables);
            return node;
        }
        if(node.kind==='Alter'){
            const columns=new Set(tables.get(fold(node.slots.table?.[0]?.attrs.table))||[]);
            for(const action of node.slots.expr||[]){
                if(action.attrs.resource==='COLUMN'&&action.attrs.action==='ADD'){
                    const name=fold(action.slots.column?.attrs.column);
                    if(typeof name==='string')columns.add(name);
                }
            }
            const checkScope={parent:null,sources:[columns],aliases:new Set()};
            for(const action of node.slots.expr||[])for(const [field,value]of Object.entries(action.slots)){
                // CHECK sees existing and newly declared columns. DEFAULT keeps
                // its independent constant-expression/DQS context.
                const child=v=>resolve(v,field==='check'?checkScope:null,tables);
                action.slots[field]=Array.isArray(value)?value.map(child):child(value);
            }
            return node;
        }
        if(node.kind==='Update'||node.kind==='Delete'){
            const sources=(node.slots.table||node.slots.from||[]).map(s=>tables.get(fold(s.attrs.table))||new Set());
            const current={parent:scope,sources,aliases:new Set()};
            for(const [field,value]of Object.entries(node.slots)){
                node.slots[field]=Array.isArray(value)?value.map(child=>resolve(child,current,tables)):resolve(value,current,tables);
            }return node;
        }
        if (node.kind === 'Select' || node.kind === 'CompoundSelect') {
            const local = new Map(tables);
            const ctes = node.slots.with || [];
            const cteName = cte => fold(cte?.slots?.name?.attrs?.value ?? cte?.attrs?.name);
            // A CTE shadows a global relation even when its output is unknown.
            for (const cte of ctes) if (typeof cteName(cte) === 'string') local.set(cteName(cte), new Set());
            for (const cte of ctes) {
                cte.slots.stmt = resolve(cte.slots.stmt, null, local);
                const explicit = (cte.slots.columns || []).map(column => fold(column?.attrs?.column)).filter(name => typeof name === 'string');
                if (typeof cteName(cte) === 'string') local.set(cteName(cte), explicit.length ? new Set(explicit) : outputNames(cte.slots.stmt,local));
            }
            if (node.kind === 'CompoundSelect') {
                for (const [field, value] of Object.entries(node.slots)) {
                    if (field === 'with' || field === 'orderby') continue;
                    node.slots[field] = Array.isArray(value) ? value.map(child => resolve(child, scope, local)) : resolve(value, scope, local);
                }
                // Compound ORDER BY can name an output column or alias from
                // either arm. It has no ordinary FROM scope of its own.
                const names=query=>query?.kind==='CompoundSelect'
                    ?new Set([...names(query.slots.left),...names(query.slots.right)]):outputNames(query,local);
                const orderScope={parent:scope,sources:[names(node)],aliases:new Set()};
                node.slots.orderby=(node.slots.orderby||[]).map(item=>resolve(item,orderScope,local));
                return node;
            }
            const sources = [];
            for (const source of node.slots.from || []) {
                // Ordinary FROM subqueries are not lateral; do not capture an
                // enclosing query merely because a global column has that name.
                if (source.slots.expr) {
                    source.slots.expr = resolve(source.slots.expr, null, local);
                    sources.push(outputNames(source.slots.expr,local));
                } else sources.push(local.get(fold(source.attrs.table)) || new Set());
            }
            const current = {parent: scope, sources,
                aliases: new Set((node.slots.columns || []).map(item => fold(item?.attrs?.as)).filter(name => typeof name === 'string'))};
            for (const [field, value] of Object.entries(node.slots)) {
                if (field === 'with' || field === 'from') continue;
                const useAliases = field !== 'columns';
                node.slots[field] = Array.isArray(value) ? value.map(child => resolve(child, current, local, useAliases)) : resolve(value, current, local, useAliases);
            }
            for (const source of node.slots.from || []) {
                source.slots.on = resolve(source.slots.on, current, local, true);
            }
            return node;
        }
        if (node.kind === 'DoubleQuotedLiteral' && scope && matches(fold(node.attrs.value), scope, aliases)) {
            const slots = {...node.slots, collate: node.slots.collate ?? null};
            const suffix = slots.suffix;
            // The parser stores a literal's postfix COLLATE under `suffix`, but
            // a column's identical postfix under `collate`. Keep that operator
            // attached to the resolved expression in the column grammar role.
            if (slots.collate === null && suffix?.slots?.collate
                && Object.values(suffix.attrs).every(value => value == null)
                && Object.entries(suffix.slots).every(([field, value]) => field === 'collate' || value == null || Array.isArray(value) && !value.length)) {
                slots.collate = suffix.slots.collate; delete slots.suffix;
            }
            node = {kind: 'ColumnReference', attrs: {table: null, column: fold(node.attrs.value)}, slots};
        }
        for (const [field, value] of Object.entries(node.slots)) {
            node.slots[field] = Array.isArray(value) ? value.map(child => resolve(child, scope, tables, aliases)) : resolve(value, scope, tables, aliases);
        }
        return node;
    };
    return resolve(root, null, catalog);
}

/**
 * Build semantic SQL states for the implicit edit graph, including incomplete or
 * non-executable states. The supplied schema resolves SQLite DQS identifier vs
 * string interpretation; semantic equivalences remain edits. No SQL is run here.
 */
export function parseGraphSql(sql, {schema, allowEmpty = false} = {}) {
    const tokens = lex(sql), ctx = context(tokens);
    validateNumericBoundaries(sql, tokens);
    if (!tokens.length && !allowEmpty) throw new Unsupported('empty-reference', 'The graph reference SQL is empty.');
    const statements = splitAtDepth(tokens, token => is(token, ';')).filter(part => part.length)
        .map(part => toNode(parseStatement(part, ctx)));
    return {root: resolveDoubleQuotedNames({kind: 'Script', attrs: {}, slots: {statements}}, schema),
        validation: ctx.partial ? 'partial-sql-ast' : ctx.adapters.size ? 'sqlite-dialect-ast' : 'strict-sql-ast',
        adapters: [...ctx.adapters].sort()};
}
