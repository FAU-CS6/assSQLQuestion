import {lex, Unsupported} from './syntax.mjs';

const word = token => token?.kind === 'Word' ? token.value.toUpperCase() : '';
const is = (token, value) => token?.text === value || word(token) === value;
const named = token => ['Word', 'Identifier'].includes(token?.kind);
const invalid = () => new Unsupported('graph-sql-grammar', 'Incomplete or invalid SQLite declaration.');
const shells = new WeakSet();
const quoteLocal = token => word(token) === 'LOCAL' ? lex('"' + token.value + '"')[0] : token;
const conflictActions = new Set(['ROLLBACK', 'ABORT', 'FAIL', 'IGNORE', 'REPLACE']);
const ordinaryTypes = new Set(['INT', 'INTEGER', 'TINYINT', 'SMALLINT', 'MEDIUMINT', 'BIGINT', 'INT2', 'INT8',
    'CHAR', 'CHARACTER', 'VARCHAR', 'NCHAR', 'NVARCHAR', 'TEXT', 'CLOB', 'BLOB', 'REAL', 'DOUBLE', 'FLOAT',
    'NUMERIC', 'DECIMAL', 'NUMBER', 'BOOLEAN', 'DATE', 'DATETIME', 'TIMESTAMP']);
const typeBoundaries = new Set(['SELECT', 'FROM', 'WHERE', 'JOIN', 'ON', 'AND', 'OR', 'NOT', 'AS', 'CREATE',
    'ALTER', 'DROP', 'INSERT', 'UPDATE', 'DELETE', 'VALUES', 'WITH', 'UNION', 'EXCEPT', 'INTERSECT', 'GROUP',
    'HAVING', 'ORDER', 'LIMIT', 'OFFSET', 'RETURNING', 'GENERATED', 'ALWAYS', 'STORED', 'VIRTUAL', 'BEGIN',
    'END', 'CASE', 'WHEN', 'THEN', 'ELSE']);
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
        const part = tokens.slice(start, comma < 0 ? tokens.length : comma);
        if (!part.length) throw invalid();
        result.push(part);
        if (comma < 0) return result;
        start = comma + 1;
    }
}
function nameEnd(tokens, start) {
    if (!named(tokens[start])) throw invalid();
    return is(tokens[start + 1], '.') && named(tokens[start + 2]) ? start + 3 : start + 1;
}
function constraintStart(tokens, index) {
    return ['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'DEFAULT', 'COLLATE', 'REFERENCES', 'NULL'].includes(word(tokens[index]))
        || word(tokens[index]) === 'NOT' && word(tokens[index + 1]) === 'NULL';
}
function constraintChunks(tokens, start) {
    const result = []; let i = start;
    while (i < tokens.length) {
        const begin = i;
        if (word(tokens[i]) === 'CONSTRAINT') {
            if (!named(tokens[i + 1])) throw invalid();
            i += 2;
        }
        const kind = word(tokens[i]);
        if (kind === 'CHECK') i = endGroup(tokens, i + 1);
        else if (kind === 'DEFAULT') {
            i++;
            if (is(tokens[i], '(')) i = endGroup(tokens, i);
            else {
                if (['+', '-'].includes(tokens[i]?.text)) i++;
                if (!tokens[i]) throw invalid();
                i++;
            }
        } else if (kind === 'COLLATE') {
            if (!named(tokens[i + 1])) throw invalid();
            i += 2;
        } else if (kind === 'REFERENCES') {
            i = nameEnd(tokens, i + 1);
            if (is(tokens[i], '(')) i = endGroup(tokens, i);
            while (i < tokens.length) {
                if (word(tokens[i]) === 'ON') {
                    if (!['UPDATE', 'DELETE'].includes(word(tokens[i + 1]))) throw invalid();
                    i += 2;
                    if (['CASCADE', 'RESTRICT'].includes(word(tokens[i]))) i++;
                    else if (word(tokens[i]) === 'SET' && ['NULL', 'DEFAULT'].includes(word(tokens[i + 1]))) i += 2;
                    else if (word(tokens[i]) === 'NO' && word(tokens[i + 1]) === 'ACTION') i += 2;
                    else throw invalid();
                } else if (word(tokens[i]) === 'MATCH' && named(tokens[i + 1])) i += 2;
                else if (word(tokens[i]) === 'DEFERRABLE' || word(tokens[i]) === 'NOT' && word(tokens[i + 1]) === 'DEFERRABLE') {
                    i += word(tokens[i]) === 'NOT' ? 2 : 1;
                    if (word(tokens[i]) === 'INITIALLY') {
                        if (!['DEFERRED', 'IMMEDIATE'].includes(word(tokens[i + 1]))) throw invalid();
                        i += 2;
                    }
                } else break;
            }
        } else if (['PRIMARY', 'NOT', 'NULL', 'UNIQUE'].includes(kind)) {
            if (kind === 'PRIMARY') {
                if (word(tokens[i + 1]) !== 'KEY') throw invalid();
                i += 2;
                if (['ASC', 'DESC'].includes(word(tokens[i]))) i++;
            } else if (kind === 'NOT') {
                if (word(tokens[i + 1]) !== 'NULL') throw invalid();
                i += 2;
            } else i++;
            if (word(tokens[i]) === 'ON') {
                if (word(tokens[i + 1]) !== 'CONFLICT' || !conflictActions.has(word(tokens[i + 2]))) throw invalid();
                i += 3;
            }
            if (kind === 'PRIMARY' && word(tokens[i]) === 'AUTOINCREMENT') i++;
        } else throw invalid();
        if (i < tokens.length && !constraintStart(tokens, i)) throw invalid();
        result.push(tokens.slice(begin, i));
    }
    return result;
}

function columnPrefix(input) {
    const start = top(input, (token, index) => constraintStart(input, index), 1);
    return input.slice(0, start < 0 ? input.length : start);
}
function extendedColumnType(input) {
    if (['CONSTRAINT', 'PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'].includes(word(input[0]))) return false;
    const prefix = columnPrefix(input), opening = prefix.findIndex(token => is(token, '('));
    const names = prefix.slice(1, opening < 0 ? prefix.length : opening);
    return names.length > 1 || names.length === 1 && (names[0].kind !== 'Word' || !ordinaryTypes.has(word(names[0])));
}
function sqliteType(tokens) {
    const opening = tokens.findIndex(token => is(token, '('));
    const names = tokens.slice(0, opening < 0 ? tokens.length : opening);
    if (!names.length || names.some(token => !(named(token) || token.kind === 'String')
        || token.kind === 'Word' && (typeBoundaries.has(word(token)) || constraintStart([token], 0)))) throw invalid();
    const result = {dataType: names.map(token => token.value).join(' ').toUpperCase()};
    if (opening >= 0) {
        if (endGroup(tokens, opening) !== tokens.length) throw invalid();
        const parameters = split(tokens.slice(opening + 1, -1));
        if (parameters.length > 2) throw invalid();
        const numbers = parameters.map(part => {
            if (part.length === 1 && part[0].kind === 'Number') return part[0].text;
            if (part.length === 2 && ['+', '-'].includes(part[0].text) && part[1].kind === 'Number') return part[0].text + part[1].text;
            throw invalid();
        });
        // Type parameters are declaration attributes, not value expressions.
        // Keep their spelling/precision, including signed and large numbers.
        result.length = numbers[0];
        if (numbers.length === 2) result.scale = numbers[1];
        result.parentheses = true;
    }
    return result;
}

/** SQLite declaration gaps are represented as ordinary structured definitions.
 * Names, conflict policies and index directions are syntax, never discarded
 * validation hints. See https://sqlite.org/lang_createtable.html. */
export function sqliteDeclarationStatement(tokens, ctx, parse) {
    if (shells.has(ctx)) return null;
    const done = value => { ctx.adapters.add('sqlite-declaration-grammar'); return value; };
    const shell = input => {
        shells.add(ctx);
        try { return parse(input); } finally { shells.delete(ctx); }
    };
    const parentheses = lex('()');
    const tableShell = definitions => shell([...lex('CREATE TABLE "__qss_declaration_shell"'), parentheses[0], ...definitions, parentheses[1]]);
    const definition = input => tableShell(input).create_definitions?.[0];
    const annotateColumn = input => {
        const start = top(input, (token, index) => constraintStart(input, index), 1);
        const prefix = input.slice(0, start < 0 ? input.length : start);
        prefix[0] = quoteLocal(prefix[0]);
        let result, shellPrefix = prefix;
        try { result = definition(prefix); }
        catch (error) {
            if (prefix.length < 2) throw error;
            result = definition([prefix[0]]);
            result.definition = sqliteType(prefix.slice(1));
            shellPrefix = [prefix[0]];
        }
        if (!result || result.resource !== 'column') throw invalid();
        if (start < 0) return result;
        const seen = new Set();
        for (const original of constraintChunks(input, start)) {
            let clean = original.slice(), constraint = null, conflict = null, direction = null;
            if (word(clean[0]) === 'CONSTRAINT') { constraint = clean[1].value; clean = clean.slice(2); }
            const kind = word(clean[0]);
            const on = top(clean, (token, index) => word(token) === 'ON' && word(clean[index + 1]) === 'CONFLICT');
            if (on >= 0) { conflict = word(clean[on + 2]); clean.splice(on, 3); }
            if (kind === 'PRIMARY' && ['ASC', 'DESC'].includes(word(clean[2]))) {
                direction = word(clean[2]); clean.splice(2, 1);
            }
            const raw = definition([...shellPrefix, ...clean]);
            if (!raw) throw invalid();
            const fields = Object.fromEntries(Object.entries(raw).filter(([key]) => !['column', 'definition', 'resource'].includes(key)));
            const key = kind === 'NOT' || kind === 'NULL' ? 'nullable' : kind;
            if (kind === 'PRIMARY') {
                if (constraint !== null) fields.primary_key_constraint = constraint;
                if (conflict !== null) fields.primary_key_conflict = conflict;
                if (direction !== null) fields.primary_key_order = direction;
            } else if (kind === 'UNIQUE') {
                if (constraint !== null) fields.unique_constraint = constraint;
                if (conflict !== null) fields.unique_conflict = conflict;
            } else {
                const field = ({NOT: 'nullable', NULL: 'nullable', CHECK: 'check', DEFAULT: 'default_val', COLLATE: 'collate', REFERENCES: 'reference_definition'})[kind];
                if (!field || !fields[field]) throw invalid();
                if (constraint !== null) {
                    fields[field].constraint = constraint;
                    if (kind === 'CHECK') fields[field].keyword = 'constraint';
                }
                if (conflict !== null) fields[field].on_conflict = conflict;
            }
            if (seen.has(key)) (result.additional_constraints ||= []).push({type: 'column_constraint', constraint_type: kind, ...fields});
            else { Object.assign(result, fields); seen.add(key); }
        }
        return result;
    };
    const annotateDefinition = input => {
        let start = word(input[0]) === 'CONSTRAINT' ? 2 : 0;
        if (!['PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'].includes(word(input[start]))) return annotateColumn(input);
        let clean = input.slice(), conflict = null, directions = [];
        const on = top(clean, (token, index) => word(token) === 'ON' && word(clean[index + 1]) === 'CONFLICT');
        if (on >= 0) {
            if (!conflictActions.has(word(clean[on + 2])) || on + 3 !== clean.length || word(clean[start]) === 'FOREIGN') throw invalid();
            conflict = word(clean[on + 2]); clean = clean.slice(0, on);
        }
        if (['PRIMARY', 'UNIQUE'].includes(word(clean[start]))) {
            const begin = start + (word(clean[start]) === 'PRIMARY' ? 2 : 1), end = endGroup(clean, begin);
            const list = split(clean.slice(begin + 1, end - 1));
            const flattened = [];
            for (const part of list) {
                const direction = ['ASC', 'DESC'].includes(word(part.at(-1))) ? word(part.pop()) : null;
                directions.push(direction);
                if (flattened.length) flattened.push(...lex(','));
                flattened.push(...part);
            }
            clean = [...clean.slice(0, begin + 1), ...flattened, ...clean.slice(end - 1)];
        }
        const result = definition(clean);
        if (!result || result.resource !== 'constraint') throw invalid();
        if (conflict !== null) result.on_conflict = conflict;
        directions.forEach((direction, index) => { if (direction !== null) result.definition[index].sort_order = direction; });
        return result;
    };

    let position = 1;
    if (word(tokens[0]) === 'CREATE') {
        if (['TEMP', 'TEMPORARY'].includes(word(tokens[position]))) position++;
        if (word(tokens[position]) === 'TRIGGER') {
            const begin = top(tokens, token => word(token) === 'BEGIN', position + 1);
            if (begin < 0 || word(tokens.at(-1)) !== 'END') throw invalid();
            let start = begin + 1, cases = 0, depth = 0; const body = [];
            for (let i = start; i < tokens.length - 1; i++) {
                if (is(tokens[i], '(')) depth++;
                else if (is(tokens[i], ')')) depth--;
                else if (word(tokens[i]) === 'CASE') cases++;
                else if (word(tokens[i]) === 'END') { if (!cases) throw invalid(); cases--; }
                if (is(tokens[i], ';') && !depth && !cases) {
                    const statement = tokens.slice(start, i);
                    if (!['SELECT', 'INSERT', 'REPLACE', 'UPDATE', 'DELETE'].includes(word(statement[0]))) throw invalid();
                    body.push(parse(statement)); start = i + 1;
                }
            }
            if (start !== tokens.length - 1 || cases || depth || !body.length) throw invalid();
            const result = shell([...tokens.slice(0, begin + 1), ...lex('INSERT INTO "__qss_trigger_shell" VALUES(NULL); END')]);
            result.execute = {type: 'trigger_body', statements: body};
            return done(result);
        }
        if (word(tokens[position]) === 'VIRTUAL' && word(tokens[position + 1]) === 'TABLE') {
            if (position !== 1) throw invalid();
            const virtual = position++; let name = position + 1;
            if (word(tokens[name]) === 'IF' && word(tokens[name + 1]) === 'NOT' && word(tokens[name + 2]) === 'EXISTS') name += 3;
            const endName = nameEnd(tokens, name);
            if (word(tokens[endName]) !== 'USING' || !['FTS3', 'FTS4'].includes(word(tokens[endName + 1]))) return null;
            const module = word(tokens[endName + 1]).toLowerCase(), argsStart = endName + 2;
            let args = [];
            if (argsStart < tokens.length) {
                if (endGroup(tokens, argsStart) !== tokens.length) throw invalid();
                args = argsStart + 2 === tokens.length ? [] : split(tokens.slice(argsStart + 1, -1));
            }
            const arguments_ = args.map(part => {
                if (part.length === 1 && (named(part[0]) || part[0].kind === 'String')) {
                    return {type: 'fts_column', column: {type: 'column_ref', table: null, column: part[0].value}};
                }
                if (!is(part[1], '=')) {
                    if (!(named(part[0]) || part[0].kind === 'String')) throw invalid();
                    const first = part[0].kind === 'String' ? lex('"' + part[0].value.replaceAll('"', '""') + '"')[0] : part[0];
                    const declared = annotateColumn([first, ...part.slice(1)]);
                    // FTS3/4 accept but ignore declared types/constraints. Keep
                    // their real structure under FtsColumn; do not treat them
                    // as ordinary table constraints or silently discard them.
                    // https://www.sqlite.org/fts3.html#creating_and_destroying_fts_tables
                    const {resource, ...fields} = declared;
                    return {type: 'fts_column', ...fields};
                }
                if (!named(part[0]) || !is(part[1], '=') || part.length < 3) throw invalid();
                const name = part[0].value.toLowerCase();
                if (!['tokenize', 'content', 'languageid', 'matchinfo', 'notindexed', 'prefix', 'compress', 'uncompress', 'order'].includes(name)) throw invalid();
                if (name !== 'tokenize' && part.length !== 3) throw invalid();
                const values = part.slice(2).map(token => {
                    if (token.kind === 'String') return {type: 'single_quote_string', value: token.value};
                    if (token.kind === 'Identifier' || token.kind === 'Word') return {type: 'fts_name', name: token.value};
                    // Use the common literal adapter so precision and SQLite's
                    // integer/real storage class follow the ordinary SQL path.
                    if (token.kind === 'Number') return parse([...lex('SELECT'), token]).columns[0].expr;
                    throw invalid();
                });
                return {type: 'fts_option', name, values};
            });
            const prefix = tokens.slice(0, endName).filter((_, index) => index !== virtual).map(quoteLocal);
            const result = shell([...prefix, ...lex('("__qss_fts_shell")')]);
            result.virtual = true; result.create_definitions = [];
            result.module = {type: 'virtual_table_module', name: module, arguments: arguments_};
            return done(result);
        }
        if (word(tokens[position]) !== 'TABLE') return null;
        let name = position + 1;
        if (word(tokens[name]) === 'IF' && word(tokens[name + 1]) === 'NOT' && word(tokens[name + 2]) === 'EXISTS') name += 3;
        const begin = nameEnd(tokens, name);
        if (!is(tokens[begin], '(')) return null;
        const end = endGroup(tokens, begin), parts = split(tokens.slice(begin + 1, end - 1));
        const special = tokens.some(token => word(token) === 'LOCAL') || parts.some(part =>
            extendedColumnType(part) || part.some((token, index) => ['ASC', 'DESC'].includes(word(token)) || word(token) === 'ON' && word(part[index + 1]) === 'CONFLICT')
            || top(part, token => word(token) === 'CONSTRAINT', 1) >= 0
            || ['CHECK', 'DEFAULT', 'COLLATE', 'UNIQUE', 'REFERENCES', 'PRIMARY'].some(kind => part.filter(token => word(token) === kind).length > 1));
        if (!special) return null;
        const prefix = tokens.slice(0, begin).map((token, index) => index >= name ? quoteLocal(token) : token);
        const result = shell([...prefix, ...lex('("__qss_declaration_shell")'), ...tokens.slice(end)]);
        result.create_definitions = parts.map(annotateDefinition);
        return done(result);
    }
    if (word(tokens[0]) === 'ALTER' && word(tokens[1]) === 'TABLE') {
        const add = nameEnd(tokens, 2);
        if (word(tokens[add]) !== 'ADD') return null;
        const begin = add + 1 + Number(word(tokens[add + 1]) === 'COLUMN');
        if (!extendedColumnType(tokens.slice(begin)) && !tokens.slice(begin).some((token, index, rest) => ['CONSTRAINT', 'ASC', 'DESC'].includes(word(token))
            || word(token) === 'ON' && word(rest[index + 1]) === 'CONFLICT') && tokens.filter(token => word(token) === 'CHECK').length < 2) return null;
        const result = shell([...tokens.slice(0, begin), ...lex('"__qss_declaration_shell"')]);
        const original = result.expr?.[0];
        if (!original) throw invalid();
        result.expr[0] = {...original, ...annotateColumn(tokens.slice(begin))};
        return done(result);
    }
    return null;
}
