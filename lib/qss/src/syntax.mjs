import SQLiteParser from 'node-sql-parser/build/sqlite.js';

const parser = new SQLiteParser.Parser();
const identifierStart = /[A-Za-z_\u0080-\uFFFF]/;
const identifierPart = /[A-Za-z0-9_$\u0080-\uFFFF]/;
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
