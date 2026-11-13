import {lex, parseAst, parserSql, Unsupported} from './syntax.mjs';

const word = token => token?.kind === 'Word' ? token.value.toUpperCase() : '';
const is = (token, value) => token?.text === value || word(token) === value;
const named = token => ['Word', 'Identifier'].includes(token?.kind);
const invalid = () => new Unsupported('graph-sql-grammar', 'Incomplete or invalid SQLite statement.');
function endGroup(tokens, start) {
    if (!is(tokens[start], '(')) throw invalid();
    let depth = 0;
    for (let i = start; i < tokens.length; i++) {
        if (is(tokens[i], '(')) depth++;
        else if (is(tokens[i], ')') && --depth === 0) return i + 1;
    }
    throw invalid();
}
function top(tokens, predicate, start = 0) {
    for (let i = start; i < tokens.length; i++) {
        if (is(tokens[i], '(')) { i = endGroup(tokens, i) - 1; continue; }
        if (predicate(tokens[i], i)) return i;
    }
    return -1;
}
function split(tokens) {
    const result = []; let start = 0;
    for (;;) {
        const comma = top(tokens, token => is(token, ','), start);
        result.push(tokens.slice(start, comma < 0 ? tokens.length : comma));
        if (comma < 0) return result;
        start = comma + 1;
    }
}
function transform(value, visit) {
    if (!value || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(child => transform(child, visit));
    return visit(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, transform(child, visit)])));
}
function markerName(raw) {
    return raw?.type === 'function' && raw.name?.name?.length === 1
        ? raw.name.name[0].value ?? raw.name.name[0].column : null;
}

// A REFERENCES ... MATCH name clause is declaration syntax, not the binary
// full-text MATCH operator. Parenthesized CHECK/DEFAULT expressions occupy a
// different depth and must continue through the ordinary operator adapter.
function foreignKeyMatch(tokens, index) {
    if (!['CREATE', 'ALTER'].includes(word(tokens[0]))) return false;
    const depths = []; let depth = 0;
    for (let i = 0; i <= index; i++) {
        depths.push(depth);
        if (is(tokens[i], '(')) depth++;
        else if (is(tokens[i], ')')) depth--;
    }
    const level = depths[index];
    for (let i = index - 1; i >= 0; i--) {
        if (depths[i] < level) return false;
        if (depths[i] !== level) continue;
        if (word(tokens[i]) === 'REFERENCES') return true;
        if (is(tokens[i], ',') || is(tokens[i], ';')
            || ['CHECK', 'DEFAULT', 'COLLATE', 'PRIMARY', 'UNIQUE', 'CONSTRAINT'].includes(word(tokens[i]))) return false;
    }
    return false;
}

/** Missing SQLite grammar productions. Every adapter restores a structured SQL
 * operation; parser placeholders and source fragments never become graph nodes. */
export function extendedSqliteStatement(tokens, ctx, parse) {
    const first = word(tokens[0]);
    const done = value => { ctx.adapters.add('sqlite-extended-grammar'); return value; };
    const expression = input => {
        const query = parse([...lex('SELECT'), ...input]);
        if (query.type !== 'select' || query.columns?.length !== 1 || query.columns[0].as != null
            || query.from?.length || query.where || query.groupby || query.having || query.orderby?.length || query.limit) throw invalid();
        return query.columns[0].expr;
    };
    if (first === 'EXPLAIN') {
        const queryPlan = word(tokens[1]) === 'QUERY' && word(tokens[2]) === 'PLAN';
        const rest = tokens.slice(queryPlan ? 3 : 1);
        if (!rest.length || word(rest[0]) === 'EXPLAIN') throw invalid();
        return done({type: 'explain', query_plan: queryPlan, statement: parse(rest)});
    }
    if (first === 'CREATE' && word(tokens[1]) === 'TEMP') {
        return done(parse([tokens[0], ...lex('TEMPORARY'), ...tokens.slice(2)]));
    }
    if (first === 'WITH') {
        const body = top(tokens, token => ['INSERT', 'REPLACE', 'UPDATE', 'DELETE'].includes(word(token)), 1);
        if (body >= 0) {
            const prefix = parse([...tokens.slice(0, body), ...lex('SELECT 1')]);
            const statement = parse(tokens.slice(body));
            if (!prefix.with?.length || statement.with) throw invalid();
            statement.with = prefix.with; return done(statement);
        }
    }
    if (first === 'DROP' && ['TRIGGER', 'INDEX'].includes(word(tokens[1]))) {
        const shell = parse([tokens[0], ...lex('VIEW'), ...tokens.slice(2)]);
        shell.keyword = word(tokens[1]).toLowerCase(); return done(shell);
    }
    if (first === 'CREATE' && tokens.slice(1, 4).some(token => word(token) === 'TABLE')) {
        const as = top(tokens, (token, index) => word(token) === 'AS' && ['SELECT', 'WITH', 'VALUES'].includes(word(tokens[index + 1])));
        if (as >= 0) {
            // Use the base parser directly for the simple shell to avoid
            // recursively selecting this same CTAS adapter again.
            const query = parse(tokens.slice(as + 1));
            const parsed = parseAst(parserSql([...tokens.slice(0, as + 1), ...lex('SELECT 1')]));
            const shell = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
            if (shell?.type !== 'create' || !shell.query_expr) throw invalid();
            shell.query_expr = query; return done(shell);
        }
    }
    // SQLite's postfix null tests are alternative spellings of IS [NOT] NULL.
    if (tokens.some(token => ['ISNULL', 'NOTNULL'].includes(word(token)))) {
        return done(parse(tokens.flatMap(token => word(token) === 'ISNULL' ? lex('IS NULL')
            : word(token) === 'NOTNULL' ? lex('IS NOT NULL') : [token])));
    }
    // The upstream parser can silently consume NATURAL as the left table's
    // alias. Keep the implicit shared-column join on the actual right source.
    // An explicit AS natural alias, a table named natural or a qualified name
    // is not this join modifier.
    const joinModifiers = new Set(['INNER', 'LEFT', 'OUTER', 'CROSS']);
    const natural = tokens.findIndex((token, i) => {
        if (word(token) !== 'NATURAL' || ['AS', 'FROM', 'JOIN'].includes(word(tokens[i - 1]))
            || is(tokens[i - 1], '.')) return false;
        let j = i + 1;
        while (joinModifiers.has(word(tokens[j]))) ++j;
        return word(tokens[j]) === 'JOIN';
    });
    if (natural >= 0) {
        let join = natural + 1;
        while (joinModifiers.has(word(tokens[join]))) ++join;
        let end = join + 1;
        if (is(tokens[end], '(')) end = endGroup(tokens, end);
        else {
            if (!named(tokens[end])) throw invalid();
            ++end;
            while (is(tokens[end], '.') && named(tokens[end + 1])) end += 2;
            if (is(tokens[end], '(')) end = endGroup(tokens, end);
        }
        const afterSource = end;
        const boundaries = new Set(['ON', 'USING', 'JOIN', 'LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS', 'NATURAL',
            'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'INTERSECT', 'EXCEPT', 'INDEXED', 'NOT']);
        let alias = null;
        if (word(tokens[end]) === 'AS') {
            if (!named(tokens[end + 1])) throw invalid();
            alias = tokens[end + 1].value; end += 2;
        } else if (named(tokens[end]) && !boundaries.has(word(tokens[end]))) alias = tokens[end++].value;
        const marker = ctx.marker('natural-join-source', null);
        const shell = parse([...tokens.slice(0, natural), ...tokens.slice(natural + 1, afterSource),
            ...lex('AS ' + marker), ...tokens.slice(end)]);
        let found = false;
        const result = transform(shell, raw => {
            if (raw.as !== marker) return raw;
            if (raw.on != null || raw.using?.length) throw invalid();
            found = true; return {...raw, as: alias, natural: true};
        });
        if (!found) throw invalid();
        return done(result);
    }
    const cross = tokens.findIndex((token, i) => word(token) === 'CROSS' && word(tokens[i + 1]) === 'JOIN');
    if (cross >= 0) {
        let end = cross + 2;
        if (is(tokens[end], '(')) end = endGroup(tokens, end);
        else {
            if (!named(tokens[end])) throw invalid();
            end++;
            while (is(tokens[end], '.') && named(tokens[end + 1])) end += 2;
            if (is(tokens[end], '(')) end = endGroup(tokens, end);
        }
        const afterSource = end;
        let alias = null;
        const boundaries = new Set(['ON', 'USING', 'JOIN', 'LEFT', 'RIGHT', 'FULL', 'INNER', 'CROSS', 'NATURAL',
            'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'INTERSECT', 'EXCEPT', 'INDEXED', 'NOT']);
        if (word(tokens[end]) === 'AS') {
            if (!named(tokens[end + 1])) throw invalid();
            alias = tokens[end + 1].value; end += 2;
        } else if (named(tokens[end]) && !boundaries.has(word(tokens[end]))) alias = tokens[end++].value;
        const marker = ctx.marker('cross-join-source', null), patched = tokens.slice();
        patched[cross] = lex('INNER')[0];
        const shell = parse([...patched.slice(0, afterSource), ...lex('AS ' + marker), ...patched.slice(end)]);
        let found = false;
        const result = transform(shell, raw => {
            if (raw.as !== marker) return raw;
            found = true; return {...raw, as: alias, join: 'CROSS JOIN'};
        });
        if (!found) throw invalid();
        return done(result);
    }
    // Parenthesized table sources are not scalar subqueries. A single source
    // retains its binding, with an outer alias replacing an inner alias. Join
    // groups retain their own structured source list and nesting boundary.
    const grouped = tokens.findIndex((token, i) => ['FROM', 'JOIN'].includes(word(token))
        && is(tokens[i + 1], '(') && !['SELECT', 'WITH', 'VALUES'].includes(word(tokens[i + 2])));
    if (grouped >= 0) {
        const begin = grouped + 1, end = endGroup(tokens, begin);
        const group = parse([...lex('SELECT * FROM'), ...tokens.slice(begin + 1, end - 1)]);
        if (group.type !== 'select' || !group.from?.length || group.with?.length || group.where
            || group.groupby || group.having || group.orderby?.length || group.limit || group._next) throw invalid();
        const marker = ctx.marker('grouped-table-source', null);
        const shell = parse([...tokens.slice(0, begin), ...lex(marker), ...tokens.slice(end)]);
        let found = false;
        const result = transform(shell, raw => {
            if (raw.table !== marker) return raw;
            found = true;
            if (group.from.length === 1) {
                const source = group.from[0];
                return {...source, ...raw, db: source.db, table: source.table, expr: source.expr,
                    as: raw.as ?? source.as};
            }
            return {...raw, db: null, table: null, expr: {type: 'table_group', from: group.from}};
        });
        if (!found) throw invalid();
        return done(result);
    }
    // A table access hint belongs to the particular source, including aliases.
    const hint = tokens.findIndex((token, i) => word(token) === 'INDEXED'
        && (word(tokens[i - 1]) === 'NOT' || word(tokens[i + 1]) === 'BY'));
    if (hint >= 0) {
        const noIndex = word(tokens[hint - 1]) === 'NOT', start = hint - Number(noIndex), owner = start - 1;
        const end = hint + (noIndex ? 1 : 3);
        if (!named(tokens[owner]) || !noIndex && !named(tokens[hint + 2])) throw invalid();
        const marker = ctx.marker('source-hint', null), original = tokens[owner].value;
        const shell = parse([...tokens.slice(0, owner), ...lex(marker), ...tokens.slice(end)]);
        let found = false;
        const result = transform(shell, raw => {
            if (raw.table !== marker && raw.as !== marker) return raw;
            found = true;
            return {...raw, ...(raw.table === marker ? {table: original} : {as: original}),
                index_hint: {type: 'index_hint', mode: noIndex ? 'NOT INDEXED' : 'INDEXED BY',
                    index: noIndex ? null : tokens[hint + 2].value}};
        });
        if (!found) throw invalid();
        return done(result);
    }
    if (first === 'UPDATE') {
        const set = top(tokens, token => word(token) === 'SET');
        if (set >= 0) {
            const tail = top(tokens, token => ['WHERE', 'RETURNING', 'ORDER', 'LIMIT'].includes(word(token)), set + 1);
            const assignments = split(tokens.slice(set + 1, tail < 0 ? tokens.length : tail));
            const row = assignments.findIndex(part => is(part[0], '('));
            if (row >= 0) {
                const part = assignments[row], end = endGroup(part, 0);
                if (!is(part[end], '=') || end + 1 === part.length) throw invalid();
                const columns = split(part.slice(1, end - 1)).map(column => {
                    if (column.length !== 1 || !named(column[0])) throw invalid();
                    return {type: 'column_ref', table: null, column: column[0].value};
                });
                if (!columns.length) throw invalid();
                const value = expression(part.slice(end + 1)), marker = ctx.marker('row-assignment', null);
                assignments[row] = lex(marker + '=NULL');
                const replacement = assignments.flatMap((assignment, i) => i ? [...lex(','), ...assignment] : assignment);
                const shell = parse([...tokens.slice(0, set + 1), ...replacement, ...(tail < 0 ? [] : tokens.slice(tail))]);
                const assignment = shell.set?.find(item => item.column === marker);
                if (!assignment) throw invalid();
                delete assignment.column; assignment.columns = columns; assignment.value = value;
                return done(shell);
            }
        }
    }
    // Keep an empty IN list explicit. SQLite gives it a defined truth value,
    // but this parser production alone does not claim a free rewrite to it.
    const emptyIn = tokens.findIndex((token, i) => word(token) === 'IN' && is(tokens[i + 1], '(') && is(tokens[i + 2], ')'));
    if (emptyIn >= 0) {
        const marker = ctx.marker('empty-in-list', null);
        const shell = parse([...tokens.slice(0, emptyIn + 2), {kind: 'Parameter', text: ':' + marker, value: marker}, ...tokens.slice(emptyIn + 2)]);
        let found = false;
        const result = transform(shell, raw => {
            if (raw.type === 'expr_list' && raw.value?.length === 1 && raw.value[0]?.type === '__marker'
                && raw.value[0].marker === marker) { found = true; return {...raw, value: []}; }
            return raw;
        });
        if (!found) throw invalid();
        return done(result);
    }
    // [NOT] GLOB/MATCH use the same grammar precedence as [NOT] LIKE. Wrap one RHS
    // primary solely to tag this exact operator, then restore both operations.
    const nonOperands = new Set(['SELECT', 'FROM', 'WHERE', 'AS', 'JOIN', 'ON', 'HAVING', 'BY', 'AND', 'OR', 'WHEN', 'THEN', 'ELSE']);
    const endings = new Set(['FROM', 'WHERE', 'JOIN', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT', 'AS']);
    const glob = tokens.findIndex((token, i) => ['GLOB', 'MATCH'].includes(word(token)) && i > 0 && tokens[i + 1]
        && !(word(token) === 'MATCH' && foreignKeyMatch(tokens, i))
        && !nonOperands.has(word(tokens[i - 1])) && !endings.has(word(tokens[i + 1]))
        && (named(tokens[i - 1]) || ['String', 'Number'].includes(tokens[i - 1].kind) || is(tokens[i - 1], ')')));
    if (glob >= 0) {
        const negated = word(tokens[glob - 1]) === 'NOT';
        const operator = (negated ? 'NOT ' : '') + word(tokens[glob]);
        let begin = glob + 1;
        while (['+', '-', '~'].includes(tokens[begin]?.text) || word(tokens[begin]) === 'NOT') begin++;
        if (!tokens[begin]) throw invalid();
        let end = begin + 1;
        if (is(tokens[begin], '(')) end = endGroup(tokens, begin);
        else if (word(tokens[begin]) === 'CASE') {
            let depth = 1;
            while (end < tokens.length && depth) {
                if (word(tokens[end]) === 'CASE') depth++;
                else if (word(tokens[end]) === 'END') depth--;
                end++;
            }
            if (depth) throw invalid();
        } else {
            while (is(tokens[end], '.') && named(tokens[end + 1])) end += 2;
            if (is(tokens[end], '(')) end = endGroup(tokens, end);
        }
        while (word(tokens[end]) === 'COLLATE' && named(tokens[end + 1])) end += 2;
        const marker = ctx.marker('glob-operand', null), patched = tokens.slice();
        patched[glob] = lex('LIKE')[0];
        const brackets = lex('()');
        const shell = parse([...patched.slice(0, begin), ...lex(marker), brackets[0], ...patched.slice(begin, end),
            brackets[1], ...patched.slice(end)]);
        let restored = 0;
        const visit = value => {
            if (!value || typeof value !== 'object') return {value, tagged: false};
            if (markerName(value) === marker) {
                if (value.args?.value?.length !== 1) throw invalid();
                let operand = value.args.value[0];
                const suffix = value.suffix;
                if (suffix != null) {
                    operand = {...operand};
                    if (operand.type === 'column_ref' && suffix.collate) operand.collate = suffix.collate;
                    else operand.suffix = suffix;
                }
                return {value: operand, tagged: true};
            }
            if (Array.isArray(value)) {
                const children = value.map(visit); return {value: children.map(child => child.value), tagged: children.some(child => child.tagged)};
            }
            const children = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
            const result = Object.fromEntries(Object.entries(children).map(([key, child]) => [key, child.value]));
            if (value.type === 'binary_expr' && value.operator === (negated ? 'NOT LIKE' : 'LIKE') && children.right?.tagged) {
                result.operator = operator; restored++; return {value: result, tagged: false};
            }
            return {value: result, tagged: Object.values(children).some(child => child.tagged)};
        };
        const result = visit(shell); if (result.tagged || restored !== 1) throw invalid();
        return done(result.value);
    }
    return null;
}
