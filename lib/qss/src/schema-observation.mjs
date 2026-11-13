import {lex} from './syntax.mjs';

const metadataName = /\b(?:sqlite_(?:schema|master|temp_schema|temp_master)|pragma_(?!foreign_key_check\b)[a-z_]+)\b/i;
const settings = new Set(['FOREIGN_KEYS', 'DEFER_FOREIGN_KEYS', 'RECURSIVE_TRIGGERS', 'IGNORE_CHECK_CONSTRAINTS']);
const value = token => String(token?.value ?? token?.text ?? '').toUpperCase();

function readsPragma(sql) {
    let tokens;
    try { tokens = lex(sql); }
    catch { return /\bPRAGMA\b/i.test(sql); }
    for (let i = 0; i < tokens.length; i++) {
        if (tokens[i].kind !== 'Word' || value(tokens[i]) !== 'PRAGMA') continue;
        let at = i + 1;
        if (tokens[at + 1]?.text === '.') at += 2;
        // This getter reports constraint violations, rowids and FK indexes,
        // not SQL spelling, NOT NULL flags or explicit parent-column lists.
        // The guarded equivalences preserve those violations and FK ordering.
        if (value(tokens[at]) === 'FOREIGN_KEY_CHECK') continue;
        // These standalone flag assignments inspect no schema. Keep other
        // PRAGMAs conservative, including table_info/foreign_key_list getters.
        if (!settings.has(value(tokens[at])) || tokens[at + 1]?.text !== '='
            || !['0', '1', 'ON', 'OFF', 'TRUE', 'FALSE'].includes(value(tokens[at + 2]))
            || tokens[at + 3] && tokens[at + 3].text !== ';') return true;
    }
    return false;
}

/** Withhold metadata-sensitive equivalences when observable schema text or
 * catalog rows may change. This guard never changes SQL or awards points. */
export function observesSchemaMetadata(request = {}) {
    const statements = [request.reference, request.answer, request.controlSql].map(sql => typeof sql === 'string' ? sql : '');
    const setup = typeof request.schemaSql === 'string' ? request.schemaSql : '';
    return statements.some(readsPragma) || metadataName.test([...statements, setup].join('\n'))
        || !setup && (request.schema?.tables || []).some(table => table.type === 'view');
}

/** Column-name pragmas can make qualification or an explicit AS observable.
 * Inspect setup A as well as both B candidates and control C. Fresh runtime
 * connections otherwise retain SQLite's default short-column-name behavior. */
export function usesCustomOutputColumnNames(request = {}) {
    for (const key of ['schemaSql', 'reference', 'answer', 'controlSql']) {
        const sql = typeof request[key] === 'string' ? request[key] : '';
        if (!/\b(?:short|full)_column_names\b/i.test(sql)) continue;
        let tokens;
        try { tokens = lex(sql); } catch { return true; }
        for (let i = 0; i < tokens.length; i++) {
            if (tokens[i].kind !== 'Word' || value(tokens[i]) !== 'PRAGMA') continue;
            let at = i + 1;
            if (tokens[at + 1]?.text === '.') at += 2;
            if (['SHORT_COLUMN_NAMES', 'FULL_COLUMN_NAMES'].includes(value(tokens[at]))) return true;
        }
    }
    return false;
}
