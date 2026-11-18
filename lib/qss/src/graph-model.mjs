import {lex, parserSql, parseAst, Unsupported} from './syntax.mjs';
import {extendedSqliteStatement} from './sqlite-grammar.mjs';
import {sqliteDeclarationStatement} from './sqlite-declaration-grammar.mjs';
import {sqliteExpressionStatement, sqliteQuotedRelationNames} from './sqlite-expression-grammar.mjs';

// This is a SQL AST adapter. It deliberately does not call normalizeAst or
// syntaxTree: semantic equivalences belong to graph edges, not node equality.
const fold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
const upper = value => typeof value === 'string' ? value.replace(/[a-z]/g, c => c.toUpperCase()) : value;
export const clone = value => JSON.parse(JSON.stringify(value));

export function stableKey(value) {
    return serializeKey(value);
}

/** Search states use persistent, immutable ASTs. Share keys only within one
 * graph; the public stableKey still observes mutations of ordinary objects. */
export function graphKey() {
    const cache = new WeakMap();
    return value => serializeKey(value, cache);
}

function serializeKey(value, cache) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (cache?.has(value)) return cache.get(value);
    const original = value;
    let result;
    if (Array.isArray(value)) result = '[' + value.map(child => serializeKey(child, cache)).join(',') + ']';
    else {
        if (typeof value.kind === 'string' && value.attrs && value.slots) {
            value = {kind: value.kind,
                attrs: Object.fromEntries(Object.entries(value.attrs).filter(([key, child]) => child != null && !(key === 'distinct' && child === false))),
                slots: Object.fromEntries(Object.entries(value.slots).filter(([, child]) => child != null && !(Array.isArray(child) && !child.length)))};
        }
        result = '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + serializeKey(value[key], cache)).join(',') + '}';
    }
    cache?.set(original, result);
    return result;
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

function splitStatements(tokens) {
    const result = []; let start = 0, depth = 0, trigger = false, body = false, cases = 0;
    for (let i = 0; i < tokens.length; i++) {
        if (is(tokens[i], '(')) depth++;
        else if (is(tokens[i], ')')) depth--;
        if (!depth && word(tokens[start]) === 'CREATE' && word(tokens[i]) === 'TRIGGER' && !body) trigger = true;
        if (trigger && word(tokens[i]) === 'BEGIN' && !body) { body = true; continue; }
        if (body && word(tokens[i]) === 'CASE') cases++;
        if (body && word(tokens[i]) === 'END') { if (cases) cases--; else body = false; }
        if (!depth && !body && is(tokens[i], ';')) {
            result.push(tokens.slice(start, i)); start = i + 1; trigger = false; cases = 0;
        }
    }
    result.push(tokens.slice(start)); return result.filter(part => part.length);
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
        if (t.kind === 'Parameter' && !ctx.markers.has(t.value)) {
            const marker = ctx.marker('parameter', {type: 'sqlite_parameter', value: t.text});
            result.push({kind: 'Parameter', text: ':' + marker, value: marker});
            ctx.adapters.add('sqlite-parameters');
            continue;
        }
        if (t.kind === 'String' || t.kind === 'Identifier'
            || t.kind === 'Word' && (/[^\x00-\x7f]/.test(t.text) || t.text.startsWith('_') || keyword === 'LOCAL')) {
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
        if (marker.type === 'parameter' || marker.type === 'collated-expression') return clone(marker.value);
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
    if (upper(result.keyword) === 'REFERENCES' && result.table?.length === 1) {
        const marker = ctx.markers.get(result.table[0].table);
        if (marker?.type === 'foreign-key-deferral') {
            result.table[0].table = marker.value.table;
            result.deferrable = marker.value.deferrable;
            result.initially = marker.value.initially;
        }
    }
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

// SQLite 3.22 supports deferred foreign keys, but the upstream SQLite grammar
// omits their suffix. Preserve the exact declaration on its own REFERENCES
// node; removing the suffix without these attributes would change transactions.
function deferredForeignKeys(original, ctx) {
    if (!['CREATE', 'ALTER'].includes(word(original[0]))) return null;
    const owners = new Map(), replacements = new Map(), removed = new Set();
    let depth = 0;
    const invalid = () => new Unsupported('graph-sql-grammar', 'The SQL cannot be represented by the semantic graph AST adapter.');
    for (let i = 0; i < original.length; i++) {
        if (is(original[i], '(')) { depth++; continue; }
        if (is(original[i], ')')) { owners.delete(depth--); continue; }
        if (is(original[i], ',')) { owners.delete(depth); continue; }
        if (word(original[i]) === 'REFERENCES') { owners.set(depth, i); continue; }
        if (word(original[i]) !== 'DEFERRABLE' || !owners.has(depth)) continue;
        const reference = owners.get(depth), not = word(original[i - 1]) === 'NOT';
        let table = reference + 1;
        if (is(original[table + 1], '.')) table += 2;
        if (!isName(original[table])) throw invalid();
        let end = table + 1;
        if (is(original[end], '(')) {
            let nesting = 0;
            do {
                if (is(original[end], '(')) nesting++;
                else if (is(original[end], ')')) nesting--;
                end++;
            } while (nesting && end < i);
            if (nesting) throw invalid();
        }
        const start = i - Number(not);
        while (end < start) {
            if (word(original[end]) === 'MATCH' && isName(original[end + 1])) { end += 2; continue; }
            if (word(original[end]) !== 'ON' || !['DELETE', 'UPDATE'].includes(word(original[end + 1]))) throw invalid();
            end += 2;
            if (['CASCADE', 'RESTRICT'].includes(word(original[end]))) end++;
            else if (word(original[end]) === 'SET' && ['NULL', 'DEFAULT'].includes(word(original[end + 1]))
                || word(original[end]) === 'NO' && word(original[end + 1]) === 'ACTION') end += 2;
            else throw invalid();
        }
        if (end !== start || replacements.has(table)) throw invalid();
        let initially = null, last = i;
        if (word(original[i + 1]) === 'INITIALLY') {
            initially = word(original[i + 2]);
            if (!['DEFERRED', 'IMMEDIATE'].includes(initially)) throw invalid();
            last += 2;
        }
        const marker = ctx.marker('foreign-key-deferral', {table: original[table].value,
            deferrable: not ? 'NOT DEFERRABLE' : 'DEFERRABLE', initially});
        replacements.set(table, {kind: 'Word', text: marker, value: marker});
        for (let at = start; at <= last; at++) removed.add(at);
        i = last;
    }
    if (!removed.size) return null;
    const result = parseStatement(original.flatMap((token, index) => removed.has(index) ? [] : [replacements.get(index) || token]), ctx);
    ctx.adapters.add('foreign-key-deferral'); return result;
}

function sqliteStatement(original, ctx) {
    const first = word(original[0]);
    const invalid = () => new Unsupported('graph-sql-grammar', 'The SQL cannot be represented by the semantic graph AST adapter.');
    const name = tokens => {
        for (const token of tokens.filter(token => !is(token, '.'))) {
            if (!isName(token)) throw invalid();
            try { one(parseAst(parserSql(grammarInput([...synthetic('SELECT 1 AS'), token], ctx)))); }
            catch { throw invalid(); }
        }
        if (tokens.length === 1 && isName(tokens[0])) return {type: 'qualified_name', db: null, name: fold(tokens[0].value)};
        if (tokens.length === 3 && isName(tokens[0]) && is(tokens[1], '.') && isName(tokens[2])) {
            return {type: 'qualified_name', db: fold(tokens[0].value), name: fold(tokens[2].value)};
        }
        throw invalid();
    };
    const expr = tokens => {
        if (!tokens.length) throw invalid();
        const parsed = parseStatement([...synthetic('SELECT'), ...tokens], ctx);
        if (parsed.type !== 'select' || parsed.columns?.length !== 1 || parsed.columns[0].as != null
            || parsed.from?.length || parsed.where || parsed.groupby || parsed.having || parsed.orderby?.length || parsed.limit) throw invalid();
        return parsed.columns[0].expr;
    };
    const done = value => { ctx.adapters.add('sqlite-statements'); return value; };
    if (first === 'WITH') {
        const values = topLevel(original, (token, index) => word(token) === 'VALUES' && is(original[index - 1], ')'));
        if (values >= 0) {
            const shell = parseStatement([...original.slice(0, values), ...synthetic('SELECT 1')], ctx);
            const query = parseStatement(original.slice(values), ctx);
            query.with = shell.with; return done(query);
        }
    }
    if (first === 'VALUES' && topLevel(original, token => ['UNION', 'EXCEPT', 'INTERSECT'].includes(word(token))) < 0) {
        for (const row of splitAtDepth(original.slice(1), token => is(token, ','))) {
            if (!is(row[0], '(') || !is(row.at(-1), ')')) throw invalid();
            let depth = 0;
            for (let i = 0; i < row.length; i++) {
                if (is(row[i], '(')) depth++;
                else if (is(row[i], ')')) depth--;
                if (depth === 0 && i !== row.length - 1) throw invalid();
            }
        }
        const insert = parseStatement([...synthetic('INSERT INTO qss_values_placeholder'), ...original], ctx);
        if (insert.type !== 'insert' || insert.values?.type !== 'values') throw invalid();
        return done(insert.values);
    }
    if (['INSERT', 'REPLACE'].includes(first) && word(original.at(-2)) === 'DEFAULT' && word(original.at(-1)) === 'VALUES') {
        const insert = parseStatement([...original.slice(0, -2), ...synthetic('VALUES(NULL)')], ctx);
        if (insert.type !== 'insert' && insert.type !== 'replace') throw invalid();
        insert.values = {type: 'default_values'}; return done(insert);
    }
    if (first === 'UPDATE' && word(original[1]) === 'OR') {
        const conflict = word(original[2]);
        if (!['ROLLBACK', 'ABORT', 'REPLACE', 'FAIL', 'IGNORE'].includes(conflict)) throw invalid();
        const update = parseStatement([original[0], ...original.slice(3)], ctx);
        if (update.type !== 'update' || update.conflict != null) throw invalid();
        update.conflict = conflict; return done(update);
    }
    if (first === 'PRAGMA') {
        let end = 2;
        if (is(original[2], '.')) end = 4;
        const pragma = name(original.slice(1, end));
        let value = null, form = 'READ';
        const pragmaValue = tokens => {
            if (tokens.length === 1 && isName(tokens[0])) return {type: 'pragma_name', name: fold(tokens[0].value)};
            if (tokens.length === 1 && ['Number', 'String'].includes(tokens[0].kind)
                || tokens.length === 2 && ['+', '-'].includes(tokens[0].text) && tokens[1].kind === 'Number') return expr(tokens);
            throw invalid();
        };
        if (end < original.length) {
            if (is(original[end], '=')) { form = 'ASSIGN'; value = pragmaValue(original.slice(end + 1)); }
            else if (is(original[end], '(') && is(original.at(-1), ')')) { form = 'CALL'; value = pragmaValue(original.slice(end + 1, -1)); }
            else throw invalid();
        }
        return done({type: 'pragma', pragma, form, value});
    }
    if (['ANALYZE', 'REINDEX', 'VACUUM'].includes(first)) {
        const target = original.length === 1 ? null : name(original.slice(1));
        if (first === 'VACUUM' && target?.db) throw invalid();
        return done({type: first.toLowerCase(), target});
    }
    if (first === 'DETACH') {
        const database = word(original[1]) === 'DATABASE';
        return done({type: 'detach', database, target: expr(original.slice(database ? 2 : 1))});
    }
    if (first === 'ATTACH') {
        const database = word(original[1]) === 'DATABASE', begin = database ? 2 : 1;
        const as = topLevel(original, token => word(token) === 'AS');
        if (as < begin || as === original.length - 1) throw invalid();
        const target = original.slice(as + 1);
        const schema = target.length === 1 && (isName(target[0]) || target[0].kind === 'String')
            ? target[0].value : expr(target);
        return done({type: 'attach', database: database ? 'DATABASE' : null, expr: expr(original.slice(begin, as)), as: 'as', schema});
    }
    if (['BEGIN', 'COMMIT', 'END', 'ROLLBACK', 'SAVEPOINT', 'RELEASE'].includes(first)) {
        let index = 1, mode = null, transaction = false, savepoint = false, to = false, target = null;
        if (first === 'BEGIN' && ['DEFERRED', 'IMMEDIATE', 'EXCLUSIVE'].includes(word(original[index]))) mode = word(original[index++]);
        if (['BEGIN', 'COMMIT', 'END', 'ROLLBACK'].includes(first) && word(original[index]) === 'TRANSACTION') { transaction = true; index++; }
        if (first === 'ROLLBACK' && word(original[index]) === 'TO') { to = true; index++; }
        if (first === 'RELEASE' || to) {
            if (word(original[index]) === 'SAVEPOINT') { savepoint = true; index++; }
            target = name(original.slice(index)); index = original.length;
        } else if (first === 'SAVEPOINT') { target = name(original.slice(index)); index = original.length; }
        if (target?.db || index !== original.length) throw invalid();
        return done({type: 'transaction', action: first, mode, transaction, savepoint, to, target});
    }
    return null;
}

function parseStatement(original, ctx) {
    const names = sqliteQuotedRelationNames(original);
    if (names) { ctx.adapters.add('sqlite-quoted-relation-name'); return parseStatement(names, ctx); }
    const extended = extendedSqliteStatement(original, ctx, tokens => parseStatement(tokens, ctx));
    if (extended) return extended;
    const declaration = sqliteDeclarationStatement(original, ctx, tokens => parseStatement(tokens, ctx));
    if (declaration) return declaration;
    const statement = sqliteStatement(original, ctx);
    if (statement) return statement;
    const deferred = deferredForeignKeys(original, ctx);
    if (deferred) return deferred;
    const tokens = grammarInput(original, ctx);
    try { return restoreMarkers(one(parseAst(parserSql(tokens))), ctx); }
    catch (initialError) {
        const expression = sqliteExpressionStatement(original, ctx, tokens => parseStatement(tokens, ctx));
        if (expression) return expression;
        // A common incomplete answer uses OR as BETWEEN's separator. Retain
        // that error as an attribute of the real expression, so reaching the
        // valid AND form requires an explicit paid edit. This adapter applies
        // only when one unambiguous BETWEEN expression can be recovered.
        const between = original.map((token, index) => word(token) === 'BETWEEN' ? index : -1).filter(index => index >= 0);
        if (between.length === 1) {
            let depth = 0, separator = -1;
            for (let i = between[0] + 1; i < original.length; i++) {
                if (is(original[i], '(')) depth++;
                else if (is(original[i], ')')) { if (!depth) break; depth--; }
                else if (!depth && word(original[i]) === 'AND') break;
                else if (!depth && word(original[i]) === 'OR') { separator = i; break; }
                else if (!depth && (is(original[i], ',') || ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT'].includes(word(original[i])))) break;
            }
            if (separator >= 0) {
                try {
                    const patched = original.slice(); patched[separator] = synthetic('AND')[0];
                    const result = parseStatement(patched, ctx), candidates = [];
                    const visit = value => {
                        if (!value || typeof value !== 'object') return;
                        if (value.type === 'binary_expr' && ['BETWEEN', 'NOT BETWEEN'].includes(upper(value.operator))) candidates.push(value);
                        for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
                    };
                    visit(result);
                    if (candidates.length === 1) {
                        candidates[0].separator = 'OR'; ctx.partial = true;
                        ctx.adapters.add('between-invalid-separator'); return result;
                    }
                } catch { /* The remaining SQL must still have a representable AST. */ }
            }
        }
        // SQLite's compound SELECT operators have equal precedence and associate
        // to the left. This constructs their real SQL AST, not a syntax tree.
        const operators = [];
        let depth = 0;
        for (let i = 0; i < original.length; i++) {
            if (is(original[i], '(')) depth++;
            else if (is(original[i], ')')) depth--;
            else if (!depth && ['UNION', 'EXCEPT', 'INTERSECT'].includes(word(original[i]))) operators.push(i);
        }
        if (['SELECT', 'VALUES'].includes(word(original[0])) && operators.length) {
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
            const as = topLevel(original, (token, i) => word(token) === 'AS' && ['SELECT', 'WITH', 'VALUES'].includes(word(original[i + 1])));
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
            if (!is(original[i], '(') || !['SELECT', 'WITH', 'VALUES'].includes(word(original[i + 1]))) {
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
    values: 'Values', cast: 'CastExpression', default: 'Default', 'not null': 'NotNull',
    default_values: 'DefaultValues', pragma: 'Pragma', pragma_name: 'PragmaName', qualified_name: 'QualifiedName',
    analyze: 'Analyze', reindex: 'Reindex', vacuum: 'Vacuum', detach: 'Detach', transaction: 'Transaction', trigger_body: 'TriggerBody',
    explain: 'Explain', index_hint: 'IndexHint', column_constraint: 'ColumnConstraint',
    virtual_table_module: 'VirtualTableModule', fts_column: 'FtsColumn', fts_option: 'FtsOption', fts_name: 'FtsName',
    sqlite_parameter: 'ParameterExpression', collate_expr: 'CollateExpression', table_group: 'TableGroup'
};
const listFields = new Set(['columns', 'from', 'with', 'orderby', 'options', 'create_definitions', 'table_options', 'on_action', 'set', 'returning']);
const childFields = new Set(['expr', 'left', 'right', 'where', 'having', 'groupby', 'limit', 'for_update', 'over',
    'collate', 'args', 'ast', 'select', 'definition', 'reference_definition', 'column', 'name', 'using',
    'window', 'partitionby', 'on', 'check', 'nullable', 'default_val']);
const ignored = new Set(['loc', 'tableList', 'columnList', 'parentheses']);
const enumFields = new Set(['operator', 'join', 'dataType', 'keyword', 'constraint_type', 'resource', 'action', 'primary_key']);
const identifierFields = new Set(['table', 'db', 'column', 'as', 'view', 'index', 'constraint', 'primary_key_constraint', 'unique_constraint']);

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
    if (raw.type === 'create' && upper(raw.keyword) === 'TRIGGER' && raw.execute?.type === 'multiple'
        && Array.isArray(raw.execute.expr?.ast)) raw = {...raw, execute: {type: 'trigger_body', statements: raw.execute.expr.ast}};
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
            if (typeof scalar === 'string' && (identifierFields.has(key) && !(kind === 'SelectItem' && key === 'as')
                || kind === 'Collate' && key === 'name')) scalar = fold(scalar);
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
        if (query?.kind === 'Values') {
            const columns = query.slots.values?.[0]?.slots.value || [];
            for (let index = 0; index < columns.length; index++) result.add('column' + (index + 1));
            return result;
        }
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
                    if (result.attrs.virtual && result.slots.module?.kind === 'VirtualTableModule') {
                        for (const argument of result.slots.module.slots.arguments || []) {
                            if (argument.kind === 'FtsColumn') columns.push(fold(argument.slots.column.attrs.column));
                        }
                        if (!columns.length) columns.push('content');
                        // FTS3/4 expose these hidden lookup columns in addition
                        // to the declared content columns.
                        columns.push(name, 'docid', 'rowid', '_rowid_', 'oid');
                    }
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
        if (node.slots.with?.length && !['Select', 'CompoundSelect', 'Values'].includes(node.kind)) {
            // WITH also scopes INSERT/UPDATE/DELETE in SQLite. Resolve these
            // names before their DML targets and correlated query children.
            const local = new Map(tables), ctes = node.slots.with;
            const cteName = cte => fold(cte?.slots?.name?.attrs?.value ?? cte?.attrs?.name);
            for (const cte of ctes) if (typeof cteName(cte) === 'string') local.set(cteName(cte), new Set());
            for (const cte of ctes) {
                cte.slots.stmt = resolve(cte.slots.stmt, null, local);
                const explicit = (cte.slots.columns || []).map(column => fold(column?.attrs?.column)).filter(name => typeof name === 'string');
                if (typeof cteName(cte) === 'string') local.set(cteName(cte), explicit.length ? new Set(explicit) : outputNames(cte.slots.stmt, local));
            }
            node.slots.with = [];
            const result = resolve(node, scope, local, aliases);
            result.slots.with = ctes; return result;
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
        if (node.kind === 'Select' || node.kind === 'CompoundSelect' || node.kind === 'Values') {
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
            if (node.kind === 'Values') {
                for (const [field, value] of Object.entries(node.slots)) {
                    if (field === 'with') continue;
                    node.slots[field] = Array.isArray(value) ? value.map(child => resolve(child, scope, local)) : resolve(value, scope, local);
                }
                return node;
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
export function parseGraphSql(sql, {schema, allowEmpty = false, allowPartial = true} = {}) {
    const tokens = lex(sql), ctx = context(tokens);
    validateNumericBoundaries(sql, tokens);
    if (!tokens.length && !allowEmpty) throw new Unsupported('empty-reference', 'The graph reference SQL is empty.');
    const statements = splitStatements(tokens)
        .map(part => toNode(parseStatement(part, ctx)));
    if (ctx.partial && !allowPartial) throw new Unsupported('graph-partial-reference', 'The reference SQL contains an incomplete expression.');
    return {root: resolveDoubleQuotedNames({kind: 'Script', attrs: {}, slots: {statements}}, schema),
        validation: ctx.partial ? 'partial-sql-ast' : ctx.adapters.size ? 'sqlite-dialect-ast' : 'strict-sql-ast',
        adapters: [...ctx.adapters].sort()};
}
