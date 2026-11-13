import {lex, Unsupported} from './syntax.mjs';
const word = token => token?.kind === 'Word' ? token.value.toUpperCase() : '';
const named = token => ['Word', 'Identifier'].includes(token?.kind);
const invalid = () => new Unsupported('graph-sql-grammar', 'Incomplete SQLite postfix expression.');
const operandIntroducers = new Set(['SELECT', 'DISTINCT', 'ALL', 'WHERE', 'AND', 'OR', 'NOT', 'IS',
    'LIKE', 'GLOB', 'MATCH', 'REGEXP', 'BETWEEN', 'IN', 'ESCAPE', 'ON', 'HAVING', 'WHEN', 'THEN', 'ELSE',
    'BY', 'LIMIT', 'OFFSET', 'RETURNING', 'SET', 'VALUES', 'AS']);

/** SQLite treats single quotes as identifier quotes where a literal is illegal.
 * Change only relation-name positions, preserving expression strings verbatim.
 * The parser's ordinary quoted-name markers still restore the exact name.
 */
export function sqliteQuotedRelationNames(tokens) {
    const first = word(tokens[0]), selected = new Set();
    const markName = index => {
        if (tokens[index]?.kind === 'String') selected.add(index);
        if (tokens[index + 1]?.text === '.' && tokens[index + 2]?.kind === 'String') selected.add(index + 2);
    };
    for (let i = 0; i < tokens.length; i++) {
        const keyword = word(tokens[i]);
        if (['FROM', 'JOIN', 'INTO', 'REFERENCES', 'IN'].includes(keyword)) markName(i + 1);
        if (keyword === 'UPDATE' && i === 0) markName(word(tokens[1]) === 'OR' ? 3 : 1);
        if (['CREATE', 'ALTER', 'DROP'].includes(first) && ['TABLE', 'VIEW', 'INDEX', 'TRIGGER'].includes(keyword)) {
            let index = i + 1;
            if (word(tokens[index]) === 'IF') index += word(tokens[index + 1]) === 'NOT' ? 3 : 2;
            markName(index);
        }
        if (first === 'CREATE' && keyword === 'ON' && tokens.slice(0, i).some(t => ['INDEX', 'TRIGGER'].includes(word(t)))) markName(i + 1);
        if (first === 'ATTACH' && keyword === 'AS') markName(i + 1);
        if (tokens[i]?.kind === 'String' && (tokens[i - 1]?.text === '.' || tokens[i + 1]?.text === '.')) selected.add(i);
    }
    if (!selected.size) return null;
    return tokens.map((token, index) => selected.has(index)
        ? {kind: 'Identifier', text: '"' + token.value.replaceAll('"', '""') + '"', value: token.value} : token);
}

function primaryStart(tokens, end) {
    let begin = end;
    if (word(tokens[end]) === 'END') {
        let depth = 1;
        while (--begin >= 0) {
            if (word(tokens[begin]) === 'END') depth++;
            else if (word(tokens[begin]) === 'CASE' && --depth === 0) break;
        }
        if (begin < 0) return null;
    } else if (named(tokens[end]) && word(tokens[end - 1]) === 'COLLATE') {
        // Repeated COLLATE is left-associative. Parse the complete preceding
        // postfix operand before attaching the next, retaining both clauses.
        begin = primaryStart(tokens, end - 2);
        if (begin === null) {
            begin = end - 2;
            if (!named(tokens[begin]) && tokens[begin]?.kind !== 'String') return null;
            while (tokens[begin - 1]?.text === '.' && named(tokens[begin - 2])) begin -= 2;
        }
    } else if (tokens[end]?.text === ')') {
        let depth = 1;
        while (--begin >= 0) {
            if (tokens[begin].text === ')') depth++;
            else if (tokens[begin].text === '(' && --depth === 0) break;
        }
        if (begin < 0) throw invalid();
        if (named(tokens[begin - 1]) && !operandIntroducers.has(word(tokens[begin - 1]))
            && !['CHECK', 'DEFAULT'].includes(word(tokens[begin - 1]))) {
            begin--;
            while (tokens[begin - 1]?.text === '.' && named(tokens[begin - 2])) begin -= 2;
        }
    } else if (!['Number', 'Parameter', 'Blob'].includes(tokens[end]?.kind)) return null;
    // Unary signs bind more tightly than COLLATE. Include a sign only in an
    // operand position; binary a-1 COLLATE applies COLLATE to 1 alone.
    while (['+', '-', '~'].includes(tokens[begin - 1]?.text)) {
        const previous = tokens[begin - 2];
        if (previous && !['Operator'].includes(previous.kind) && !['(', ','].includes(previous.text)
            && !operandIntroducers.has(word(previous))) break;
        begin--;
    }
    return begin;
}

function columnDeclarationCollation(tokens, index) {
    const first = word(tokens[0]);
    const create = first === 'CREATE' && tokens.slice(1, 4).find(t => !['TEMP', 'TEMPORARY'].includes(word(t)))?.value?.toUpperCase() === 'TABLE';
    if (!create && first !== 'ALTER') return false;
    // CREATE TABLE ... AS SELECT has expression syntax, not column constraints.
    if (create) {
        const open = tokens.findIndex(t => t.text === '(');
        const as = tokens.findIndex(t => word(t) === 'AS');
        if (as >= 0 && (open < 0 || as < open)) return false;
    }
    let depth = 0;
    for (let i = 0; i < index; i++) {
        if (tokens[i].text === '(') depth++;
        else if (tokens[i].text === ')') depth--;
    }
    return depth === (create ? 1 : 0);
}

/** Postfix COLLATE on forms omitted by the upstream expression grammar.
 * A parser placeholder is replaced by the complete structured expression;
 * operand precedence, collation and all neighbouring syntax are retained.
 */
export function sqliteExpressionStatement(tokens, ctx, parse) {
    for (let index = 1; index < tokens.length; index++) {
        if (word(tokens[index]) !== 'COLLATE' || !named(tokens[index + 1])) continue;
        if (columnDeclarationCollation(tokens, index)) continue;
        const begin = primaryStart(tokens, index - 1);
        if (begin === null) continue;
        const query = parse([...lex('SELECT'), ...tokens.slice(begin, index)]);
        if (query.type !== 'select' || query.columns?.length !== 1 || query.columns[0].as != null
            || query.from?.length || query.where || query.groupby || query.having || query.orderby?.length || query.limit) throw invalid();
        const value = {type: 'collate_expr', expr: query.columns[0].expr,
            collate: {type: 'collate', keyword: 'collate', collate: {name: tokens[index + 1].value, symbol: null}}};
        const marker = ctx.marker('collated-expression', value);
        const result = parse([...tokens.slice(0, begin), {kind: 'Parameter', text: ':' + marker, value: marker}, ...tokens.slice(index + 2)]);
        ctx.adapters.add('sqlite-postfix-collation'); return result;
    }
    return null;
}
