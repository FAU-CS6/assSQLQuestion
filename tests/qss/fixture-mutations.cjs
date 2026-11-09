/* Generic mutations only. Private pool SQL is supplied at runtime, never bundled. */
'use strict';

const keywords = new Set(('SELECT DISTINCT ALL FROM WHERE GROUP BY HAVING ORDER ASC DESC LIMIT OFFSET AS ON JOIN INNER LEFT RIGHT FULL OUTER CROSS NATURAL USING AND OR NOT IS NULL IN BETWEEN LIKE GLOB REGEXP MATCH ESCAPE EXCEPT INTERSECT UNION WITH RECURSIVE UPDATE SET DELETE INSERT INTO VALUES REPLACE ABORT FAIL IGNORE ROLLBACK CREATE TABLE VIEW IF EXISTS PRIMARY KEY FOREIGN REFERENCES CONSTRAINT UNIQUE CHECK DEFAULT COLLATE AUTOINCREMENT CASCADE RESTRICT NO ACTION ADD ALTER RENAME TO COLUMN DROP INDEX TEMP TEMPORARY PRAGMA BEGIN END CASE WHEN THEN ELSE CAST COUNT SUM AVG MIN MAX').split(' '));

/** Preserve offsets and distinguish quoted values/identifiers from SQL tokens. */
function tokens(sql) {
  const result = [];
  for (let i = 0; i < sql.length;) {
    const start = i, c = sql[i];
    if (/\s/.test(c)) { while (i < sql.length && /\s/.test(sql[i])) i++; continue; }
    if (sql.startsWith('--', i)) { i = sql.indexOf('\n', i); if (i < 0) i = sql.length; result.push({ type: 'comment', start, end: i, value: sql.slice(start, i) }); continue; }
    if (sql.startsWith('/*', i)) { const end = sql.indexOf('*/', i + 2); i = end < 0 ? sql.length : end + 2; result.push({ type: 'comment', start, end: i, value: sql.slice(start, i) }); continue; }
    if (['\'', '"', '`', '['].includes(c)) {
      const end = c === '[' ? ']' : c;
      i++;
      while (i < sql.length) {
        if (sql[i++] !== end) continue;
        if (c !== '[' && sql[i] === end) { i++; continue; }
        break;
      }
      result.push({ type: c === '\'' ? 'string' : 'quoted_identifier', start, end: i, value: sql.slice(start, i) });
      continue;
    }
    const tail = sql.slice(i);
    const number = tail.match(/^(?:0x[0-9a-f]+|(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/i);
    if (number) { i += number[0].length; result.push({ type: 'number', start, end: i, value: number[0] }); continue; }
    const identifier = tail.match(/^[\p{L}_][\p{L}\p{N}_$]*/u);
    if (identifier) { i += identifier[0].length; result.push({ type: 'word', start, end: i, value: identifier[0], upper: identifier[0].toUpperCase() }); continue; }
    const operator = tail.match(/^(?:<>|!=|<=|>=|==|\|\||<<|>>|->>|->)/);
    i += operator ? operator[0].length : 1;
    result.push({ type: 'symbol', start, end: i, value: sql.slice(start, i) });
  }
  return result;
}

function replace(sql, token, value) { return sql.slice(0, token.start) + value + sql.slice(token.end); }

/** SQLite keyword case, surrounding whitespace, and an inert comment preserve SQL. */
function equivalentFormatting(sql) {
  let answer = sql;
  for (const token of tokens(sql).reverse()) {
    if (token.type === 'word' && keywords.has(token.upper)) answer = replace(answer, token, token.value.toLowerCase());
  }
  return '\n/* QSS acceptance: formatting and keyword case only. */\n' + answer + '\n';
}

function formattingTokenProof(reference, formatted) {
  const original = tokens(reference).filter(token => token.type !== 'comment');
  const changed = tokens(formatted).filter(token => token.type !== 'comment');
  const keywordChanges = [];
  const safe = original.length === changed.length && original.every((token, i) => {
    const next = changed[i];
    if (token.type === next.type && token.value === next.value) return true;
    if (token.type === 'word' && next.type === 'word' && keywords.has(token.upper) && token.value.toLowerCase() === next.value) { keywordChanges.push(token.upper); return true; }
    return false;
  });
  return { safe, changed_keywords: [...new Set(keywordChanges)], allowed_changes: 'Whitespace/comments and allowlisted SQL keyword/function case only; quoted tokens and other words are unchanged.' };
}

/**
 * Test oracle only: pragma_table_info exposes the spelling of a default SQL
 * expression. Normalize exactly NULL/null at a qualified metadata read compared
 * with the text 'NULL'; never fold result strings or quoted SQL string defaults.
 */
function nullDefaultCatalogOracle(sql) {
  const all = tokens(sql).filter(token => token.type !== 'comment');
  const aliases = new Set();
  const statementOf = [];
  let statement = 0;
  for (let i = 0; i < all.length; i++) { statementOf[i] = statement; if (all[i].value === ';') statement++; }
  for (let i = 1; i < all.length; i++) {
    if (all[i].upper !== 'PRAGMA_TABLE_INFO' || !['FROM', 'JOIN'].includes(all[i - 1].upper) || all[i + 1]?.value !== '(') continue;
    let depth = 0, end = i + 1;
    for (; end < all.length; end++) { if (all[end].value === '(') depth++; if (all[end].value === ')' && --depth === 0) break; }
    let alias = end + 1;
    if (all[alias]?.upper === 'AS') alias++;
    if (all[alias]?.type === 'word' && !keywords.has(all[alias].upper)) aliases.add(statementOf[i] + ':' + all[alias].upper);
  }
  const replacements = [];
  for (let i = 2; i < all.length - 2; i++) {
    if (all[i].upper !== 'DFLT_VALUE' || all[i - 1].value !== '.' || !aliases.has(statementOf[i] + ':' + all[i - 2].upper)
        || !['=', '=='].includes(all[i + 1].value) || all[i + 2].type !== 'string' || all[i + 2].value !== "'NULL'") continue;
    const start = all[i - 2].start, end = all[i].end, field = sql.slice(start, end);
    replacements.push({ start, end, value: "(CASE WHEN " + field + " = 'null' THEN 'NULL' ELSE " + field + ' END)' });
  }
  if (!replacements.length) return null;
  let normalized = sql;
  for (const replacement of replacements.reverse()) normalized = normalized.slice(0, replacement.start) + replacement.value + normalized.slice(replacement.end);
  return { sql: normalized, fields: replacements.length, kind: 'pragma-table-info-null-default-case' };
}

/** Candidate edits are intentional changes, not claims about their runtime effect. */
function errorCandidates(sql) {
  const all = tokens(sql).filter(token => token.type !== 'comment');
  const candidates = [];
  for (const token of all.filter(token => token.type === 'number').slice(0, 4)) {
    const number = Number(token.value);
    if (!Number.isFinite(number) || number + 1 === number) continue;
    candidates.push({ kind: 'literal', answer: replace(sql, token, String(number + 1)), explanation: 'One numeric literal is changed; execution determines whether the fixture exposes the difference.' });
  }
  const select = all.findIndex(token => token.upper === 'SELECT');
  if (select >= 0 && all[select + 1]) {
    const start = ['DISTINCT', 'ALL'].includes(all[select + 1].upper) ? select + 2 : select + 1;
    let depth = 0, end = sql.length, alias = null;
    for (let i = start; i < all.length; i++) {
      const token = all[i];
      if (depth === 0 && (token.value === ',' || token.value === ';' || token.value === ')'
          || ['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT', 'RETURNING'].includes(token.upper))) { end = token.start; break; }
      if (depth === 0 && token.upper === 'AS') alias = token.start;
      if (token.value === '(') depth++;
      if (token.value === ')') depth--;
    }
    if (all[start] && end > all[start].start) {
      const expressionEnd = alias ?? end;
      const expression = sql.slice(all[start].start, expressionEnd).trim();
      const suffix = alias == null ? '' : sql.slice(alias, end);
      candidates.push({ kind: 'projection_expression', answer: sql.slice(0, all[start].start) + '(' + expression + ') + 1 ' + suffix + sql.slice(end),
        explanation: 'The first projected expression is incorrectly incremented; existing FROM/JOIN/filter predicates are preserved to avoid an exploding Cartesian result.' });
    }
  }
  const opposite = { '=': '<>', '==': '<>', '<>': '=', '!=': '=', '<': '>', '>': '<', '<=': '>', '>=': '<' };
  const boundedComparisons = all.filter((token, index) => opposite[token.value]
    && [all[index - 1]?.type, all[index + 1]?.type].some(type => type === 'number' || type === 'string'));
  for (const token of boundedComparisons.slice(0, 4)) {
    candidates.push({ kind: 'comparison', answer: replace(sql, token, opposite[token.value]), explanation: 'One comparison operator is replaced by a different predicate.' });
  }
  if (select >= 0 && all[select + 1]) {
    const next = all[select + 1];
    const at = next.upper === 'DISTINCT' || next.upper === 'ALL' ? all[select + 2] : next;
    if (at) candidates.push({ kind: 'column', answer: sql.slice(0, at.start) + '__qss_intentionally_missing_column__, ' + sql.slice(at.start), explanation: 'A deliberately nonexistent projected column is added; the actual SQLite error is checked.' });
  }
  const semicolon = all.find(token => token.value === ';' && sql.slice(token.end).trim());
  if (semicolon) candidates.push({ kind: 'omitted_statement', answer: sql.slice(semicolon.end), explanation: 'The first statement is omitted from the answer script.' });
  candidates.push({ kind: 'replaced_statement', answer: 'SELECT 0 AS __qss_wrong_answer__;', explanation: 'The required operation/script is replaced by an unrelated constant SELECT.' });
  candidates.push({ kind: 'empty_answer', answer: '', explanation: 'The entire submitted SQL answer is omitted.' });
  return candidates.filter((value, index, array) => value.answer !== sql && array.findIndex(other => other.answer === value.answer) === index);
}

const setup = 'CREATE TABLE item(id INTEGER PRIMARY KEY, value INTEGER, label TEXT); INSERT INTO item VALUES (1, 5, \'a\'), (2, 15, \'b\'), (3, 20, NULL); CREATE TABLE detail(id INTEGER PRIMARY KEY, item_id INTEGER); INSERT INTO detail VALUES (1, 2), (2, 3);';
const semanticControls = [
  { name: 'identifier_case', a: setup, reference: 'SELECT id FROM item WHERE value > 10;', answer: 'SELECT ID FROM ITEM WHERE VALUE > 10;', explanation: 'SQLite unquoted ASCII identifiers are case-insensitive; string values and quoted identifiers are not rewritten by the test.' },
  { name: 'alias_rename', a: setup, reference: 'SELECT a.id FROM item AS a WHERE a.value > 10;', answer: 'SELECT b.id FROM item AS b WHERE b.value > 10;', explanation: 'Consistent bound table-alias renaming.' },
  { name: 'and_reorder', a: setup, reference: 'SELECT id FROM item WHERE value > 10 AND id < 3;', answer: 'SELECT id FROM item WHERE id < 3 AND value > 10;', explanation: 'Two deterministic AND predicates are reordered, including nullable data.' },
  { name: 'comparison_mirror', a: setup, reference: 'SELECT id FROM item WHERE value > 10;', answer: 'SELECT id FROM item WHERE 10 < value;', explanation: 'The operands and direction of the same comparison are mirrored.' },
  { name: 'inner_join_to_where', a: setup, reference: 'SELECT i.id FROM item AS i INNER JOIN detail AS d ON i.id = d.item_id;', answer: 'SELECT i.id FROM item AS i, detail AS d WHERE i.id = d.item_id;', explanation: 'An inner join condition moves to WHERE; no outer join is involved.' },
  { name: 'not_equals', a: setup, reference: 'SELECT id FROM item WHERE value <> 10;', answer: 'SELECT id FROM item WHERE NOT (value = 10);', explanation: 'Not-equal and negated equality share SQLite three-valued semantics.' }
];

const gradingControls = [
  { name: 'one_column_error', a: setup, reference: 'SELECT id FROM item;', answer: 'SELECT value FROM item;', expectation: 'partial', explanation: 'One valid projected column is wrong; it changes the visible relation and should receive a deduction with remaining partial credit.' },
  { name: 'material_changes', a: setup, reference: 'SELECT id FROM item WHERE value > 10;', answer: 'SELECT label FROM item WHERE value < 15;', expectation: 'deduction', explanation: 'Projection, predicate direction, and threshold are changed; both executions return rows, the results differ, and full credit is unjustified.' },
  { name: 'correlated_scope_error', a: setup + ' INSERT INTO detail VALUES (3, 3);', reference: 'SELECT a.id FROM item AS a WHERE EXISTS (SELECT 1 FROM detail AS d WHERE d.item_id = a.id);', answer: 'SELECT a.id FROM item AS a WHERE EXISTS (SELECT 1 FROM detail AS d WHERE d.item_id = d.id);', expectation: 'deduction', explanation: 'An outer correlated column is incorrectly replaced by an inner column of the same name; both executions return different nonempty relations and canonical aliases must preserve scope.' },
  { name: 'outer_join_where_error', a: setup, reference: 'SELECT i.id FROM item AS i LEFT JOIN detail AS d ON i.id = d.item_id;', answer: 'SELECT i.id FROM item AS i LEFT JOIN detail AS d ON 1 = 1 WHERE i.id = d.item_id;', expectation: 'deduction', explanation: 'Moving an outer-join predicate to WHERE loses unmatched rows; the INNER JOIN equivalence must not apply.' },
  { name: 'double_quoted_string_case_error', a: setup, reference: 'SELECT "UPPER" AS value;', answer: 'SELECT "upper" AS value;', expectation: 'deduction', explanation: 'This SQLite build accepts unmatched double-quoted names as string values; identifier case normalization must not collapse those different values.' },
  { name: 'collation_precedence_error', a: setup, reference: 'SELECT id FROM item WHERE label COLLATE NOCASE > \'A\' COLLATE BINARY;', answer: 'SELECT id FROM item WHERE \'A\' COLLATE BINARY < label COLLATE NOCASE;', expectation: 'deduction', explanation: 'Mirroring operands changes which explicit SQLite collation has precedence; these results differ despite the apparent comparison symmetry.' },
  { name: 'empty_answer', a: setup, reference: 'SELECT id FROM item;', answer: '', expectation: 'zero', explanation: 'The required answer is absent; zero follows from the explicit empty-answer edit baseline, not a timeout or error fallback.' },
  { name: 'malformed_answer', a: setup, reference: 'SELECT id FROM item;', answer: 'SELECT id FROM;', expectation: 'unresolved', explanation: 'Malformed SQL must be reported as unsupported/error with null score, rather than silently receiving zero or full credit.' }
];

module.exports = { tokens, equivalentFormatting, formattingTokenProof, errorCandidates, semanticControls, gradingControls, nullDefaultCatalogOracle };
