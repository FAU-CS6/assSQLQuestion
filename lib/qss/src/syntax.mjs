import {SQLite} from '@codemirror/lang-sql';
import SQLiteParser from 'node-sql-parser/build/sqlite.js';

const parser = new SQLiteParser.Parser();
const identifierStart = /[A-Za-z_\u0080-\uFFFF]/;
const identifierPart = /[A-Za-z0-9_$\u0080-\uFFFF]/;
const clone = value => JSON.parse(JSON.stringify(value));
const asciiFold = value => typeof value === 'string' ? value.replace(/[A-Z]/g, c => c.toLowerCase()) : value;
export class Unsupported extends Error {
    constructor(code, message) { super(message); this.name = 'Unsupported'; this.code = code; }
}

/** SQLite lexical boundaries, including unterminated constructs Lezer intentionally tolerates. */
export function lex(sql) {
    if (typeof sql !== 'string') throw new Unsupported('input-type', 'SQL must be a string.');
    const tokens = [];
    for (let i = 0; i < sql.length;) {
        if (/\s/.test(sql[i])) { ++i; continue; }
        if (sql.startsWith('--', i)) { const n = sql.indexOf('\n', i + 2); i = n < 0 ? sql.length : n + 1; continue; }
        if (sql.startsWith('/*', i)) {
            const end = sql.indexOf('*/', i + 2);
            if (end < 0) throw new Unsupported('unterminated-comment', 'The SQL comment is not terminated.');
            i = end + 2; continue;
        }
        const start = i, quote = sql[i];
        if (quote === "'" || quote === '"' || quote === '`' || quote === '[') {
            const close = quote === '[' ? ']' : quote;
            ++i; let value = '', closed = false;
            while (i < sql.length) {
                if (sql[i] === close) {
                    if (close !== ']' && sql[i + 1] === close) { value += close; i += 2; continue; }
                    ++i; closed = true; break;
                }
                value += sql[i++];
            }
            if (!closed) throw new Unsupported('unterminated-quote', 'A SQL string or identifier is not terminated.');
            tokens.push({kind: quote === "'" ? 'String' : 'Identifier', text: sql.slice(start, i), value});
        } else if (identifierStart.test(sql[i])) {
            ++i; while (i < sql.length && identifierPart.test(sql[i])) ++i;
            const text = sql.slice(start, i);
            if (/^x$/i.test(text) && sql[i] === "'") {
                const end = sql.indexOf("'", i + 1);
                if (end < 0 || !/^(?:[0-9a-f]{2})*$/i.test(sql.slice(i + 1, end))) throw new Unsupported('invalid-blob', 'Invalid SQLite blob literal.');
                tokens.push({kind: 'Blob', text: sql.slice(start, end + 1), value: sql.slice(i + 1, end).toUpperCase()}); i = end + 1;
            } else tokens.push({kind: 'Word', text, value: text});
        } else {
            const number = /^(?:0[xX][0-9a-fA-F]+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/.exec(sql.slice(i));
            if (number) { i += number[0].length; tokens.push({kind: 'Number', text: number[0], value: number[0]}); }
            else {
                const op = /^(?:->>|->|<>|<=|>=|!=|==|\|\||<<|>>|[+*/%<>=!~&|^-])/.exec(sql.slice(i));
                if (op) { i += op[0].length; tokens.push({kind: 'Operator', text: op[0], value: op[0]}); }
                else if ('(),.;'.includes(sql[i])) { tokens.push({kind: 'Punctuation', text: sql[i], value: sql[i]}); ++i; }
                else throw new Unsupported('unsupported-character', 'Unsupported SQL token at character ' + i + '.');
            }
        }
    }
    const stack = [];
    for (const token of tokens) {
        if (token.text === '(') stack.push(token);
        if (token.text === ')' && !stack.pop()) throw new Unsupported('unbalanced-parentheses', 'SQL parentheses are unbalanced.');
    }
    if (stack.length) throw new Unsupported('unbalanced-parentheses', 'SQL parentheses are unbalanced.');
    return tokens;
}

// SQLite accepts non-ASCII unquoted identifiers. Quote them only in the parser input;
// their original spelling/value is retained in the syntax tree.
const needsParserQuotes = token => token.kind === 'Word' && (/[^\x00-\x7f]/.test(token.text) || token.text.startsWith('_'));
export function parserSql(tokens) {
    return tokens.map(t => needsParserQuotes(t)
        ? '"' + t.text.replaceAll('"', '""') + '"' : t.text).join(' ');
}

export function parseAst(sql) { return parser.astify(sql, {database: 'sqlite'}); }

function tableColumns(schema) {
    const map = new Map();
    if (Array.isArray(schema?.tables)) {
        for (const table of schema.tables) map.set(asciiFold(table.name), new Map((table.columns || []).map(c => [asciiFold(typeof c === 'string' ? c : c.name), typeof c === 'string' ? {} : c])));
    } else if (schema && typeof schema === 'object') {
        for (const [name, columns] of Object.entries(schema)) {
            if (Array.isArray(columns)) map.set(asciiFold(name), new Map(columns.map(c => [asciiFold(typeof c === 'string' ? c : c.name), typeof c === 'string' ? {} : c])));
        }
    }
    return map;
}
export function schemaTables(schema) { return tableColumns(schema); }
const stable = x => JSON.stringify(x);
const astSignature = x => {
    if (Array.isArray(x)) return x.map(astSignature);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort()
        .filter(k => !['parentheses', 'loc', 'tableList', 'columnList'].includes(k) && x[k] != null)
        .map(k => [k, astSignature(x[k])]));
    return x;
};
const pure = x => {
    if (x == null || typeof x !== 'object') return true;
    if (Array.isArray(x)) return x.every(pure);
    if (['function', 'select', 'case', 'window', 'aggr_func'].includes(x.type)) return false;
    return Object.entries(x).every(([k, v]) => k === 'parentheses' || pure(v));
};
const hasCollation = x => {
    if (x == null || typeof x !== 'object') return false;
    if (Array.isArray(x)) return x.some(hasCollation);
    return x.collate != null || x.type === 'collate' || Object.values(x).some(hasCollation);
};
const plainLiteral = x => ['number', 'bigint', 'single_quote_string', 'string', 'null'].includes(x?.type);
const conjunction = terms => terms.length === 0 ? null : terms.slice(1).reduce((a, b) => ({type: 'binary_expr', operator: 'AND', left: a, right: b}), terms[0]);

/** Deliberately conservative equivalence normalization; never evaluates SQL. */
export function normalizeAst(input, schema) {
    const result = clone(input), tables = tableColumns(schema);
    const normalizeSelect = (select, inherited = new Map(), depth = 0) => {
        const bindings = new Map(inherited), sources = [];
        for (let i = 0; i < (select.from || []).length; ++i) {
            const from = select.from[i];
            if (!from.table || from.db || from.expr || from.using) continue;
            const alias = '__qss_scope_' + depth + '_table_' + i;
            from.table = asciiFold(from.table);
            bindings.set(asciiFold(from.as || from.table), alias);
            sources.push({table: from.table, alias});
            from.as = alias;
        }
        for (const column of Array.isArray(select.columns) ? select.columns : []) if (column.as) column.as = asciiFold(column.as);
        const outputAliases = new Set((Array.isArray(select.columns) ? select.columns : []).map(c => c.as).filter(Boolean));
        const walk = (x, clause = '') => {
            if (x == null || typeof x !== 'object') return x;
            if (Array.isArray(x)) return x.map(v => walk(v, clause));
            if (x.type === 'select') { normalizeSelect(x, bindings, depth + 1); return x; }
            if (x.type === 'function' && x.name?.name?.length === 1 && x.name.name[0].value?.toUpperCase() === 'NOT' && x.args?.value?.length === 1) {
                return walk({type: 'unary_expr', operator: 'NOT', expr: x.args.value[0]}, clause);
            }
            if (x.type === 'column_ref') {
                x.column = asciiFold(x.column); x.table = asciiFold(x.table);
                if (x.table && bindings.has(x.table)) x.table = bindings.get(x.table);
                else if (!x.table && x.column !== '*' && !(clause !== 'where' && outputAliases.has(x.column))) {
                    const candidates = sources.filter(s => tables.get(s.table)?.has(x.column));
                    if (candidates.length === 1) x.table = candidates[0].alias;
                    else if (depth === 0 && sources.length === 1 && !tables.has(sources[0].table)) x.table = sources[0].alias;
                }
            }
            for (const [key, value] of Object.entries(x)) {
                if (key === 'parentheses') { delete x[key]; continue; }
                if (typeof value === 'object' && value !== null) x[key] = walk(value, clause);
            }
            if (x.type === 'unary_expr' && x.operator === 'NOT' && x.expr?.type === 'binary_expr' && ['=', '!=', '<>'].includes(x.expr.operator)) {
                return {...x.expr, operator: x.expr.operator === '=' ? '!=' : '='};
            }
            if (x.type === 'binary_expr') {
                if (x.operator === '<>') x.operator = '!=';
                if (['>', '>=', '<', '<='].includes(x.operator) && pure(x.left) && pure(x.right)
                    && !hasCollation(x.left) && !hasCollation(x.right)
                    && plainLiteral(x.left) && x.right?.type === 'column_ref') {
                    // Canonicalize by operand role, not by operator spelling.
                    // Opposite predicates then differ by one operator edit only.
                    [x.left, x.right] = [x.right, x.left];
                    x.operator = {'>': '<', '>=': '<=', '<': '>', '<=': '>='}[x.operator];
                }
                if (x.operator === 'AND' && pure(x)) {
                    const terms = [];
                    const collect = y => { if (y?.type === 'binary_expr' && y.operator === 'AND') { collect(y.left); collect(y.right); } else terms.push(y); };
                    collect(x); terms.sort((a, b) => stable(a).localeCompare(stable(b), 'en'));
                    return conjunction(terms);
                }
            }
            return x;
        };
        for (const [key, value] of Object.entries(select)) {
            if (key !== 'from') select[key] = walk(value, key);
        }
        for (const from of select.from || []) {
            if (from.expr) from.expr = walk(from.expr);
            if (from.on) from.on = walk(from.on, 'where');
        }
        const explicit = Array.isArray(select.columns) && select.columns.every(c => c.expr?.column !== '*');
        const simple = (select.from || []).every(f => f.table && !f.expr && !f.db && !f.using && (!f.join || f.join === 'INNER JOIN') && pure(f.on));
        if (explicit && simple && pure(select.where)) {
            const terms = [select.where, ...(select.from || []).map(f => f.on)].filter(Boolean);
            for (const from of select.from || []) { delete from.join; delete from.on; }
            select.where = walk(conjunction(terms), 'where');
        }
    };
    const visit = x => {
        if (Array.isArray(x)) x.forEach(visit);
        else if (x && typeof x === 'object') {
            if (x.type === 'select') normalizeSelect(x);
            else Object.values(x).forEach(visit);
        }
    };
    visit(result);
    // Preserve precedence when the normalized AST is serialized back into syntax.
    const parenthesize = x => {
        if (Array.isArray(x)) x.forEach(parenthesize);
        else if (x && typeof x === 'object') {
            Object.values(x).forEach(parenthesize);
            if (x.type === 'binary_expr' || x.type === 'unary_expr') x.parentheses = true;
        }
    };
    parenthesize(result); return result;
}

const clauseStarts = new Set(['SELECT', 'FROM', 'WHERE', 'HAVING', 'LIMIT', 'OFFSET', 'SET', 'VALUES', 'RETURNING', 'UNION', 'INTERSECT', 'EXCEPT']);
export function syntaxTree(sql, {schema, executionValid = false, allowEmpty = false} = {}) {
    const tokens = lex(sql);
    if (!tokens.length) {
        if (!allowEmpty) throw new Unsupported('empty-reference', 'The model SQL is empty.');
        return {root: {kind: 'Script', value: '', children: []}, validation: 'empty-answer', normalizedSql: ''};
    }
    let parsedSql = parserSql(tokens), validation = 'sqlite-grammar', ast;
    try {
        ast = parseAst(parsedSql);
    } catch {
        if (!executionValid) throw new Unsupported('sqlite-grammar-gap-or-invalid', 'The strict SQLite parser cannot validate this SQL; successful browser SQLite execution is required for the lossless syntax extension.');
        validation = 'browser-sqlite-confirmed-cst';
    }
    if (ast) {
        try {
            // sqlify mutates subquery wrappers; compare immutable semantic ASTs,
            // excluding only derived parser reference inventories/positions.
            const normalized = normalizeAst(ast, schema), printed = parser.sqlify(clone(normalized), {database: 'sqlite'});
            const unwrapped = value => Array.isArray(value) && value.length === 1 ? value[0] : value;
            if (stable(astSignature(unwrapped(normalized))) === stable(astSignature(unwrapped(parseAst(printed))))) parsedSql = printed;
            else validation = 'sqlite-grammar-lossless-cst';
        } catch { validation = 'sqlite-grammar-lossless-cst'; }
    }
    const canonicalTokens = lex(parsedSql), source = parserSql(canonicalTokens), starts = new Map();
    let pos = 0;
    for (const token of canonicalTokens) {
        const text = needsParserQuotes(token) ? '"' + token.text.replaceAll('"', '""') + '"' : token.text;
        starts.set(pos, token); pos += text.length + 1;
    }
    const tree = SQLite.language.parser.parse(source);
    const make = node => {
        if (node.type.isError) throw new Unsupported('parser-recovery', 'The SQLite syntax parser needed error recovery.');
        if (node.name === 'LineComment' || node.name === 'BlockComment' || node.name === ';') return null;
        const children = [];
        for (let c = node.firstChild; c; c = c.nextSibling) { const child = make(c); if (child) children.push(child); }
        let kind = node.name, value = '';
        if (!children.length && kind !== 'Script') {
            const token = starts.get(node.from), text = source.slice(node.from, node.to);
            kind = token?.kind === 'Identifier' || kind === 'Identifier' || kind === 'QuotedIdentifier' ? 'Identifier' : kind;
            value = kind === 'Keyword' || kind === 'Type' || kind === 'Null' ? text.toUpperCase() : token?.value ?? text;
            if (kind === 'Identifier' && token?.kind === 'Word') value = asciiFold(value);
        }
        if (kind === 'Statement') {
            const clauses = []; let clause = null;
            for (let i = 0; i < children.length; ++i) {
                const child = children[i], next = children[i + 1];
                const name = child.kind === 'Keyword' && (clauseStarts.has(child.value) || (['GROUP', 'ORDER'].includes(child.value) && next?.value === 'BY')) ? child.value : null;
                if (name) { clause = {kind: 'Clause:' + name, value: '', children: []}; clauses.push(clause); }
                if (!clause) { clause = {kind: 'Clause:statement', value: '', children: []}; clauses.push(clause); }
                clause.children.push(child);
            }
            return {kind, value, children: clauses};
        }
        return {kind, value, children};
    };
    return {root: make(tree.topNode), validation, normalizedSql: source};
}
