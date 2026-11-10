/* Opt-in exhaustive private corpus test in installed Google Chrome, never a server SQL runner.
 * NODE_PATH=<local-playwright> CHROME_CDP_URL=http://localhost:9223 \
 * ILIAS_CORPUS_DIRECTORY=/private/corpus node tests/browser/qss-corpus.cjs
 * No SQL/QSS execution deadline is imposed. Reports must remain untracked.
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { chromium } = require('playwright');
const mutations = require('../qss/fixture-mutations.cjs');

const directory = path.resolve(process.env.ILIAS_CORPUS_DIRECTORY || '/corpus');
const outputDirectory = path.resolve(process.env.QSS_REPORT_DIRECTORY || path.join(require('node:os').tmpdir(), 'asssql-private-artifacts', 'qss', 'corpus'));
const base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
const plugin = '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion';
const limit = Number(process.env.QSS_CORPUS_LIMIT || Infinity);
const sourceStart = Number(process.env.QSS_CORPUS_START || 0);
const engine = process.env.QSS_ENGINE || 'graph-qss-sqlite-v2';
const scale = Number(process.env.QSS_SCALE || 1);
const exactDistance = process.env.QSS_EXACT_DISTANCE === '1';
assert.ok(Number.isFinite(scale) && scale > 0, 'QSS_SCALE must be finite and positive.');
assert.ok(Number.isSafeInteger(sourceStart) && sourceStart >= 0, 'QSS_CORPUS_START is a zero-based source offset.');
assert.ok(limit === Infinity || Number.isSafeInteger(limit) && limit >= 0, 'QSS_CORPUS_LIMIT is a nonnegative run count.');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
let ownedContext;

function metrics(metadata) {
  return Object.fromEntries(JSON.parse(metadata.SOLUTION_METRICS).map(value => {
    const metric = typeof value === 'string' ? JSON.parse(value) : value;
    return [metric.type, { points: Number(metric.points), value: metric.value }];
  }));
}

async function installBrowserHarness(page) {
  for (const name of ['SQL/class.SQLFunctionalDependency.js', 'SQL/class.SQLResult.js']) {
    await page.addScriptTag({ url: `${base}${plugin}/js/classes/${name}` });
  }
  await page.evaluate(({ plugin, engine, scale, exactDistance }) => {
    const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
    let nextId = 0;
    const rpc = (url, qss = false) => {
      const worker = new Worker(url);
      let current;
      worker.onmessage = event => {
        if (!current || event.data.id !== current.id) return;
        if (event.data.type === 'progress') {
          current.progress = event.data;
          if (qss && window.__qssCorpusState) window.__qssCorpusState.progress = event.data;
          return;
        }
        const active = current; current = null;
        active.resolve(qss ? event.data.result : event.data);
      };
      worker.onerror = event => {
        event.preventDefault();
        if (!current) return;
        const active = current; current = null;
        active.resolve(qss ? { status: 'error', engine, limitations: [event.message] } : { error: event.message });
      };
      return {
        worker,
        call(data) {
          if (current) throw new Error('Each corpus worker has one in-flight job.');
          return new Promise(resolve => { const id = ++nextId; current = { id, resolve }; worker.postMessage({ ...data, id }); });
        }
      };
    };
    let sql = null;
    const qss = rpc(plugin + '/lib/qss/worker.qss.js', true);
    const freshSQLWorker = () => {
      if (sql) sql.worker.terminate();
      sql = rpc(plugin + '/lib/sql.js/worker.sql.js');
    };
    const exec = async statement => {
      if (!statement.trim()) return { results: [] };
      return sql.call({ action: 'exec', sql: statement });
    };
    const relation = response => response.results?.length ? response.results[response.results.length - 1] : null;
    const canonical = value => JSON.stringify(value);
    // PHP's current strtolower-based metrics fold ASCII, not arbitrary Unicode.
    const lower = name => name.replace(/[A-Z]/g, char => char.toLowerCase());
    const semanticResult = (value, ordered = false) => value ? canonical({ columns: value.columns.map(lower), rows: ordered ? value.values.map(canonical) : value.values.map(canonical).sort() }) : null;
    const jaccard = (expected, actual) => {
      const a = new Set(expected), b = new Set(actual);
      const union = new Set([...a, ...b]);
      return union.size ? [...a].filter(value => b.has(value)).length / union.size : 1;
    };
    const fdKey = value => {
      const fd = typeof value === 'string' ? JSON.parse(value) : value;
      return canonical([fd.determinateAttributes.map(lower).sort(), fd.dependentAttributes.map(lower).sort()]);
    };
    function legacy(result, expected, sourceRelation) {
      if (result.error || !result.relation) return { points: 0, error: true };
      const actual = new SQLResult(result.relation);
      const countPoints = Number(expected.result_lines?.value) === actual.getNumberOfRows() ? expected.result_lines.points : 0;
      const columnPoints = jaccard(JSON.parse(expected.column_names.value).map(lower), actual.columns.map(lower)) * expected.column_names.points;
      let fdPoints = 0, fdReferenceReused = false;
      if (expected.functional_dependencies.points > 0) {
        // Identical full relations have identical FD metrics; changed relations are recomputed.
        fdReferenceReused = canonical(sourceRelation) === canonical(result.relation);
        const actualFDs = fdReferenceReused ? JSON.parse(expected.functional_dependencies.value) : actual.getAllMinimalFunctionalDependencies();
        const actualKeys = actualFDs.map(value => fdKey(value.toJSON ? value.toJSON() : value));
        fdPoints = jaccard(JSON.parse(expected.functional_dependencies.value).map(fdKey), actualKeys) * expected.functional_dependencies.points;
      }
      return { points: countPoints + columnPoints + fdPoints, components: { result_lines: countPoints, column_names: columnPoints, functional_dependencies: fdPoints }, fdReferenceReused };
    }
    async function prepare(a) {
      // Match production SQLRun isolation. Reusing the legacy SQLite heap across
      // hundreds of opened databases can poison later large preparations.
      freshSQLWorker();
      if (window.__qssCorpusState) window.__qssCorpusState.sqlStep = 'worker-open';
      await sql.call({ action: 'open' });
      if (window.__qssCorpusState) window.__qssCorpusState.sqlStep = 'sequence-A';
      const response = await exec(a);
      if (response.error) throw new Error('Preparation failed: ' + response.error);
      if (window.__qssCorpusState) window.__qssCorpusState.sqlStep = 'snapshot-and-schema';
      const foreignKeys = await exec('PRAGMA foreign_keys;');
      const snapshot = await sql.call({ action: 'export' });
      if (!snapshot.buffer) throw new Error('No prepared SQLite snapshot.');
      const names = await exec("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;");
      const tables = [];
      for (const [name, type] of relation(names)?.values || []) {
        const columns = await exec('PRAGMA table_info("' + name.replaceAll('"', '""') + '");');
        tables.push({ name, type, columns: (relation(columns)?.values || []).map(row => ({ name: row[1], type: row[2], notNull: !!row[3], primaryKey: Number(row[5]) })) });
      }
      return { buffer: snapshot.buffer, foreignKeys: relation(foreignKeys)?.values?.[0]?.[0] || 0, schema: { tables } };
    }
    async function execute(prepared, b, c) {
      freshSQLWorker();
      if (window.__qssCorpusState) window.__qssCorpusState.sqlStep = 'worker-open-and-snapshot-restore';
      await sql.call({ action: 'open', buffer: prepared.buffer });
      await exec('PRAGMA foreign_keys=' + (prepared.foreignKeys ? 1 : 0) + ';');
      if (window.__qssCorpusState) window.__qssCorpusState.sqlStep = 'sequence-B';
      const bResult = await exec(b);
      if (bResult.error) return { error: bResult.error, phase: 'B', statementExecutionValid: false };
      if (window.__qssCorpusState) window.__qssCorpusState.sqlStep = 'sequence-C';
      const cResult = await exec(c);
      if (cResult.error) return { error: cResult.error, phase: 'C', statementExecutionValid: true };
      const output = relation(cResult) || relation(bResult);
      return output ? { relation: output, statementExecutionValid: true } : { error: 'No visible result', phase: 'result', statementExecutionValid: true };
    }
    async function catalog(prepared, b) {
      const run = await execute(prepared, b, '');
      if (run.phase === 'B') throw new Error('Catalog proof cannot execute B.');
      const names = relation(await exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"));
      const tables = [];
      for (const [name] of names?.values || []) {
        const info = await exec('PRAGMA table_info("' + name.replaceAll('"', '""') + '");');
        tables.push({ name, rows: relation(info)?.values || [] });
      }
      return tables;
    }
    async function catalogOracle(row, prepared, reference) {
      if (!row.catalogOracle || !row.formatTokenProof.safe) return null;
      const before = await catalog(prepared, row.b), after = await catalog(prepared, row.formatted), differences = [];
      const fields = ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk'];
      let sameShape = before.length === after.length;
      for (let table = 0; sameShape && table < before.length; table++) {
        if (before[table].name !== after[table].name || before[table].rows.length !== after[table].rows.length) { sameShape = false; break; }
        for (let column = 0; column < before[table].rows.length; column++) {
          for (let field = 0; field < fields.length; field++) {
            const a = before[table].rows[column][field], b = after[table].rows[column][field];
            if (canonical(a) !== canonical(b)) differences.push({ table_ordinal: table, column_ordinal: column, field: fields[field], before: a, after: b });
          }
        }
      }
      const onlyNullDefaultSpelling = sameShape && differences.length > 0 && differences.every(value => value.field === 'dflt_value' && value.before === 'NULL' && value.after === 'null');
      const probe = relation(await exec('SELECT typeof((NULL)) AS upper_type, typeof((null)) AS lower_type, (NULL) IS (null) AS same_value;'));
      const sameNullMeaning = canonical(probe?.values) === canonical([['null', 'null', 1]]);
      const normalizedReference = await execute(prepared, row.b, row.catalogOracle.sql);
      const normalizedFormat = await execute(prepared, row.formatted, row.catalogOracle.sql);
      const controlsEqual = !normalizedReference.error && !normalizedFormat.error
        && semanticResult(normalizedReference.relation, row.ordered) === semanticResult(reference.relation, row.ordered)
        && semanticResult(normalizedReference.relation, row.ordered) === semanticResult(normalizedFormat.relation, row.ordered);
      return { kind: 'control-query-dependent-default-expression-spelling', verified: onlyNullDefaultSpelling && sameNullMeaning && controlsEqual,
        table_info_differences: differences, all_other_table_info_fields_exact: sameShape && differences.every(value => value.field === 'dflt_value'),
        literal_NULL_and_null_have_same_SQL_value: sameNullMeaning, default_type_probe: probe?.values,
        qualified_metadata_reads_normalized: row.catalogOracle.fields, normalized_control_matches_original_reference: controlsEqual,
        original_control_sha256: await digest(row.c), diagnostic_control_sha256: await digest(row.catalogOracle.sql),
        note: 'Only the test copy of a qualified pragma_table_info.dflt_value comparison is normalized. Original answers, original C, raw observations and ordinary result strings remain unchanged.' };
    }
    const summarizeQSS = value => ({ status: value.status, engine: value.engine, version: value.version, distance: value.distance,
      points: value.points, maxPoints: value.maxPoints, exactWithinModel: value.exactWithinModel,
      provisionalRubric: value.provisionalRubric,
      scoreCertifiedWithinModel: value.scoreCertifiedWithinModel, referenceDistance: value.referenceDistance,
      scale: value.scale, rubric: value.rubric, modelVersion: value.modelVersion,
      lowerBound: value.lowerBound, formula: value.formula, pointsPerEdit: value.pointsPerEdit,
      validation: value.validation, code: value.code, message: value.message,
      edit_count: value.edits?.length, edit_cost_sum: value.edits?.reduce((sum, edit) => sum + Number(edit.cost), 0), limitations: value.limitations });
    window.qssCorpusQuestion = async row => {
      const started = performance.now();
      window.__qssCorpusState = { ordinal: row.ordinal, stage: 'SQL-preparation', sqlPhase: 'prepare' };
      const prepareStarted = performance.now();
      const prepared = await prepare(row.a);
      const setupSqlMs = performance.now() - prepareStarted;
      window.__qssCorpusState = { ordinal: row.ordinal, stage: 'SQL-reference', sqlPhase: 'reference' };
      const referenceStarted = performance.now();
      const reference = await execute(prepared, row.b, row.c);
      const referenceSqlMs = performance.now() - referenceStarted;
      window.__qssCorpusState = { ordinal: row.ordinal, stage: 'SQL-formatting', sqlPhase: 'formatting' };
      const formattingStarted = performance.now();
      const formatted = await execute(prepared, row.formatted, row.c);
      const formattingSqlMs = performance.now() - formattingStarted;
      const candidateSqlMs = [];
      let selected, changed, fallback, attempts = 0, invalidCandidates = 0;
      for (let index = 0; index < row.candidates.length; index++) {
        const candidate = row.candidates[index];
        window.__qssCorpusState = { ordinal: row.ordinal, stage: 'SQL-candidate', sqlPhase: 'candidate',
          candidate_index: index, candidate_count: row.candidates.length, mutation: candidate.kind };
        const candidateStarted = performance.now();
        const executed = await execute(prepared, candidate.answer, row.c);
        candidateSqlMs.push(performance.now() - candidateStarted);
        attempts++;
        if (executed.error) invalidCandidates++;
        const counterexample = executed.error || semanticResult(executed.relation, row.ordered) !== semanticResult(reference.relation, row.ordered);
        if (counterexample && !executed.error) { selected = candidate; changed = executed; break; }
        if (counterexample && !fallback) fallback = { candidate, executed };
        if (index === row.candidates.length - 1) { selected = fallback?.candidate || candidate; changed = fallback?.executed || executed; }
      }
      const output = { key: row.key, original_ordinal: row.ordinal, maximum_points: row.maxPoints, executions: 2 + attempts, invalid_candidates_executed: invalidCandidates,
        setup_sql_ms: setupSqlMs, ref_sql_ms: referenceSqlMs, format_sql_ms: formattingSqlMs, candidate_sql_ms: candidateSqlMs,
        reference_error: reference.error || null, source_result_exact: canonical(reference.relation) === canonical(row.sourceRelation),
        format_token_proof: row.formatTokenProof,
        visible_order_compared: row.ordered,
        formatting_equal: !formatted.error && semanticResult(reference.relation, row.ordered) === semanticResult(formatted.relation, row.ordered), cases: [] };
      if (!output.formatting_equal && row.catalogOracle) {
        window.__qssCorpusState = { ordinal: row.ordinal, stage: 'SQL-catalog-oracle', sqlPhase: 'catalog-oracle' };
        const oracleStarted = performance.now();
        output.formatting_oracle = await catalogOracle(row, prepared, reference);
        output.catalog_oracle_sql_ms = performance.now() - oracleStarted;
      }
      for (const [name, answer, execution] of [['self', row.b, reference], ['formatting', row.formatted, formatted], ['targeted_error', selected.answer, changed]]) {
        window.__qssCorpusState = { ordinal: row.ordinal, stage: name, sqlPhase: null,
          mutation: name === 'targeted_error' ? selected.kind : null };
        const qssStarted = performance.now();
        const evaluation = await qss.call({ type: 'evaluate', reference: row.b, answer, schema: prepared.schema, maxPoints: row.maxPoints, engine,
          exactDistance, scale,
          referenceExecutionValid: !reference.error, answerExecutionValid: answer.trim() ? !execution.error : undefined });
        const qssWallMs = performance.now() - qssStarted;
        window.__qssCorpusState = { ordinal: row.ordinal, stage: 'legacy-metrics', sqlPhase: null, case: name };
        const legacyStarted = performance.now();
        const legacyResult = legacy(execution, row.metrics, row.sourceRelation);
        const legacyMs = performance.now() - legacyStarted;
        output.cases.push({ name, answer_sha256: await digest(answer), qss: summarizeQSS(evaluation),
          qss_wall_ms: qssWallMs, legacy_metrics_ms: legacyMs, legacy: legacyResult,
          visible_result_sha256: execution.relation ? await digest(canonical(execution.relation)) : null,
          sqlite_error: execution.error || null, sqlite_error_phase: execution.phase || null,
          changed_visible_result: !execution.error && semanticResult(execution.relation, row.ordered) !== semanticResult(reference.relation, row.ordered),
          ...(name === 'targeted_error' ? { mutation: selected.kind, explanation: selected.explanation, candidates_executed: attempts } : {}) });
      }
      if (row.originalIdentity) {
        window.__qssCorpusState = { ordinal: row.ordinal, stage: 'original-identity', sqlPhase: null };
        const originalStarted = performance.now();
        output.original_identity = summarizeQSS(await qss.call({ type: 'evaluate', reference: row.b, answer: row.b,
          schema: prepared.schema, maxPoints: row.maxPoints, engine: 'graph-qss-original-v1',
          referenceExecutionValid: !reference.error, answerExecutionValid: !reference.error }));
        output.original_identity_wall_ms = performance.now() - originalStarted;
      }
      output.legacy_metrics_ms = output.cases.reduce((sum, item) => sum + item.legacy_metrics_ms, 0);
      output.wall_ms = performance.now() - started;
      window.__qssCorpusState = { ordinal: row.ordinal, stage: 'complete', sqlPhase: null };
      return output;
    };
    window.qssCorpusControl = async row => {
      const started = performance.now();
      window.__qssCorpusState = { control_name: row.name, stage: 'control-SQL-preparation', sqlPhase: 'prepare' };
      const prepareStarted = performance.now();
      const prepared = await prepare(row.a);
      const setupSqlMs = performance.now() - prepareStarted;
      window.__qssCorpusState = { control_name: row.name, stage: 'control-SQL-reference', sqlPhase: 'reference' };
      const referenceStarted = performance.now();
      const reference = await execute(prepared, row.reference, '');
      const referenceSqlMs = performance.now() - referenceStarted;
      window.__qssCorpusState = { control_name: row.name, stage: 'control-SQL-answer', sqlPhase: 'candidate', candidate_index: 0 };
      const answerStarted = performance.now();
      const alternative = await execute(prepared, row.answer, '');
      const answerSqlMs = performance.now() - answerStarted;
      window.__qssCorpusState = { control_name: row.name, stage: 'control-QSS', sqlPhase: null };
      const qssStarted = performance.now();
      const evaluated = await qss.call({ type: 'evaluate', reference: row.reference, answer: row.answer, schema: prepared.schema, maxPoints: 5, engine,
        exactDistance, scale, referenceExecutionValid: !reference.error, answerExecutionValid: row.answer.trim() ? !alternative.error : undefined });
      const qssMs = performance.now() - qssStarted;
      window.__qssCorpusState = { control_name: row.name, stage: 'control-complete', sqlPhase: null };
      return { name: row.name, explanation: row.explanation, sqlite_equivalent: !reference.error && !alternative.error && semanticResult(reference.relation) === semanticResult(alternative.relation),
        sqlite_reference_error: reference.error || null, sqlite_answer_error: alternative.error || null,
        setup_sql_ms: setupSqlMs, ref_sql_ms: referenceSqlMs, answer_sql_ms: answerSqlMs,
        qss_wall_ms: qssMs, wall_ms: performance.now() - started, qss: summarizeQSS(evaluated) };
    };
  }, { plugin, engine, scale, exactDistance });
}

async function main() {
  assert.ok(process.env.CHROME_CDP_URL, 'Use an explicitly supplied installed Google Chrome CDP endpoint.');
  const corpusTotal = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')).questions;
  assert.ok(Number.isSafeInteger(corpusTotal) && corpusTotal >= sourceStart, 'The requested source offset must be within the corpus.');
  const expectedRunQuestions = Math.min(limit, corpusTotal - sourceStart);
  fs.mkdirSync(outputDirectory, { recursive: true });
  console.log('QSS_CORPUS_STAGE connecting to explicitly supplied local Chrome');
  const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL, { timeout: 120000 });
  ownedContext = await browser.newContext();
  console.log('QSS_CORPUS_STAGE created own private browser context');
  const page = await ownedContext.newPage();
  await page.route(`${base}/__qss_corpus__`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Private QSS corpus acceptance</title>' }));
  await page.goto(`${base}/__qss_corpus__`);
  const agent = await page.evaluate(() => navigator.userAgent);
  assert.match(agent, /HeadlessChrome\//, 'The corpus run must not open visible browser windows.');
  await installBrowserHarness(page);
  const workerResponse = await page.request.get(`${base}${plugin}/lib/qss/worker.qss.js`);
  assert.equal(workerResponse.status(), 200);
  const report = { engine, scale, exact_distance_requested: exactDistance, browser: await browser.version(), user_agent: agent, headless: true, worker_sha256: hash(await workerResponse.body()),
    timing_units: 'milliseconds', timing_clock: 'browser performance.now()',
    timing_scope: 'SQL phase times include fresh SQL worker startup/snapshot restore and B+C; setup includes A/snapshot/schema. QSS uses the harness shared worker. Question wall time excludes Node-to-browser argument transfer. No deadline is imposed.',
    corpus_total_questions: corpusTotal, source_start: sourceStart, source_end_exclusive: sourceStart + expectedRunQuestions,
    requested_limit: Number.isFinite(limit) ? limit : null, expected_run_questions: expectedRunQuestions,
    original_ordinal_first: expectedRunQuestions ? sourceStart + 1 : null,
    original_ordinal_last: expectedRunQuestions ? sourceStart + expectedRunQuestions : null,
    completed: false, run_status: 'running', worker_unchanged: null,
    questions: 0, self_full_points: 0, formatting_full_points: 0, formatting_sqlite_equivalent: 0, safe_formatting_neutral: 0, known_control_representation_differences: [],
    targeted_errors: 0, errors_with_sqlite_counterexample: 0, targeted_error_full_points: 0,
    valid_wrong_answers: 0, runtime_error_answers_graded: 0, runtime_error_answers_ungraded: 0, runtime_error_full_points: 0, runtime_error_phases: {}, invalid_candidates_executed: 0, targeted_error_resolved_maximum_points: 0,
    sqlite_executions: 0, qss_evaluations: 0, corpus_qss_evaluations: 0, source_result_mismatches: [], mutation_types: {}, statuses: {},
    source_maximum_points: 0, self_points: 0, formatting_points: 0, source_self_legacy_points: 0,
    targeted_error_qss_points: 0, targeted_error_resolved_scores: 0, targeted_error_legacy_points: 0, validations: {},
    legacy_full_but_qss_deducts: 0, semantic_controls: [], semantic_control_gaps: [], grading_controls: [],
    original_identity_coverage: { enabled: process.env.QSS_ORIGINAL_IDENTITY_COVERAGE === '1', questions: 0, exact: 0, unsupported: 0, other: 0, codes: {} },
    targeted_error_distances: { exact: 0, zero_score_certified: 0, unresolved: 0 }, failures: [] };
  const saveReport = () => {
    const filename = path.join(outputDirectory, 'corpus-report.json');
    const temporary = filename + '.' + process.pid + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(report, null, 2) + '\n');
    fs.renameSync(temporary, filename);
  };
  saveReport();
  const details = fs.createWriteStream(path.join(outputDirectory, 'corpus-results.jsonl'));
  try {
    const input = readline.createInterface({ input: fs.createReadStream(path.join(directory, 'questions.jsonl')), crlfDelay: Infinity });
    let sourceIndex = -1;
    for await (const line of input) {
      ++sourceIndex;
      if (sourceIndex < sourceStart) continue;
      if (report.questions >= expectedRunQuestions) break;
      const source = JSON.parse(line), m = source.metadata, expected = metrics(m);
      const row = { key: source.key, a: m.SEQUENCE_A, b: m.SEQUENCE_B, c: m.SEQUENCE_C,
        ordinal: sourceIndex + 1,
        originalIdentity: report.original_identity_coverage.enabled,
        ordered: mutations.tokens(m.SEQUENCE_C.trim() ? m.SEQUENCE_C : m.SEQUENCE_B).some(token => token.upper === 'ORDER'),
        sourceRelation: JSON.parse(m.OUTPUT_RELATION), metrics: expected,
        maxPoints: Object.values(expected).reduce((sum, metric) => sum + metric.points, 0),
        formatted: mutations.equivalentFormatting(m.SEQUENCE_B), candidates: mutations.errorCandidates(m.SEQUENCE_B) };
      row.formatTokenProof = mutations.formattingTokenProof(row.b, row.formatted);
      row.catalogOracle = mutations.nullDefaultCatalogOracle(row.c);
      console.log('QSS_CORPUS_QUESTION_START ' + row.ordinal);
      const result = await page.evaluate(row => window.qssCorpusQuestion(row), row);
      assert.equal(result.original_ordinal, row.ordinal, 'Preserve the original source ordinal in every range.');
      report.questions++;
      report.last_completed_ordinal = row.ordinal;
      if (result.original_identity) {
        report.qss_evaluations++;
        const coverage = report.original_identity_coverage, value = result.original_identity;
        coverage.questions++;
        if (value.status === 'exact' && value.distance === 0 && value.points === row.maxPoints) coverage.exact++;
        else if (value.status === 'unsupported') coverage.unsupported++;
        else { coverage.other++; report.failures.push({ key: source.key, kind: 'original_identity_unexpected_status', result: value }); }
        if (value.code) coverage.codes[value.code] = (coverage.codes[value.code] || 0) + 1;
      }
      report.source_maximum_points += row.maxPoints;
      report.sqlite_executions += result.executions;
      report.invalid_candidates_executed += result.invalid_candidates_executed;
      if (result.reference_error) report.failures.push({ key: source.key, kind: 'reference_SQL_error', error: result.reference_error });
      if (!result.source_result_exact) report.source_result_mismatches.push(source.key);
      if (result.formatting_equal) report.formatting_sqlite_equivalent++;
      if (!result.format_token_proof.safe) report.failures.push({ key: source.key, kind: 'formatting_touched_non_allowlisted_tokens' });
      if (result.format_token_proof.safe && (result.formatting_equal || result.formatting_oracle?.verified)) report.safe_formatting_neutral++;
      else report.failures.push({ key: source.key, kind: 'formatting_changed_SQL_result' });
      if (result.formatting_oracle?.verified) report.known_control_representation_differences.push({ key: source.key, ...result.formatting_oracle });
      for (const current of result.cases) {
        report.qss_evaluations++;
        report.corpus_qss_evaluations++;
        report.statuses[current.qss.status] = (report.statuses[current.qss.status] || 0) + 1;
        for (const [side, validation] of Object.entries(current.qss.validation || {})) {
          const key = side + ':' + validation;
          report.validations[key] = (report.validations[key] || 0) + 1;
        }
        const full = current.qss.status === 'exact' && current.qss.distance === 0 && current.qss.points === row.maxPoints;
        if (current.name !== 'targeted_error') {
          if (Number.isFinite(current.qss.points)) report[current.name === 'self' ? 'self_points' : 'formatting_points'] += current.qss.points;
          if (current.name === 'self') report.source_self_legacy_points += current.legacy.points;
          if (full) report[current.name === 'self' ? 'self_full_points' : 'formatting_full_points']++;
          else report.failures.push({ key: source.key, case: current.name, kind: 'equivalent_answer_not_full', qss: current.qss });
        } else {
          report.targeted_errors++;
          report.targeted_error_legacy_points += current.legacy.points;
          if (Number.isFinite(current.qss.points)) { report.targeted_error_resolved_scores++; report.targeted_error_qss_points += current.qss.points; report.targeted_error_resolved_maximum_points += row.maxPoints; }
          if (!current.sqlite_error) report.valid_wrong_answers++;
          else {
            report.runtime_error_phases[current.sqlite_error_phase] = (report.runtime_error_phases[current.sqlite_error_phase] || 0) + 1;
            if (Number.isFinite(current.qss.points)) {
              report.runtime_error_answers_graded++;
              if (current.qss.points === row.maxPoints) report.runtime_error_full_points++;
            } else report.runtime_error_answers_ungraded++;
          }
          report.mutation_types[current.mutation] = (report.mutation_types[current.mutation] || 0) + 1;
          const counterexample = !!current.sqlite_error || current.changed_visible_result;
          if (counterexample) report.errors_with_sqlite_counterexample++;
          // Execution errors remain observations. C may fail even though B is
          // statically representable; only a successful changed relation is a
          // semantic counterexample used to reject full comparison points.
          if (!current.sqlite_error && current.qss.points === row.maxPoints) {
            report.targeted_error_full_points++;
            if (current.changed_visible_result) report.failures.push({ key: source.key, kind: 'wrong_answer_full_points_despite_SQL_counterexample', mutation: current.mutation });
          }
          if (current.legacy.points === row.maxPoints && Number.isFinite(current.qss.points) && current.qss.points < row.maxPoints) report.legacy_full_but_qss_deducts++;
          if (current.qss.status === 'exact') report.targeted_error_distances.exact++;
          else if (current.qss.status === 'score-zero-certified') report.targeted_error_distances.zero_score_certified++;
          else report.targeted_error_distances.unresolved++;
        }
        if (current.qss.engine !== engine) report.failures.push({ key: source.key, kind: 'unexpected_engine', actual: current.qss.engine });
        if (current.qss.points != null && (current.qss.points < 0 || current.qss.points > row.maxPoints)) report.failures.push({ key: source.key, kind: 'points_out_of_bounds' });
        if (current.qss.status === 'exact') {
          const raw = Math.max(0, row.maxPoints - current.qss.distance * scale);
          const expectedPoints = Math.round((raw + Number.EPSILON) * 10000) / 10000;
          if (!Number.isFinite(current.qss.distance) || current.qss.distance < 0 || current.qss.points !== expectedPoints
              || current.qss.scale !== scale || current.qss.rubric !== 'paper-linear-v1'
              || current.qss.exactWithinModel !== true || current.qss.edit_cost_sum !== current.qss.distance) {
            report.failures.push({ key: source.key, case: current.name, kind: 'distance_formula_or_edit_path_inconsistent', qss: current.qss });
          }
        } else if (current.qss.status === 'score-zero-certified') {
          if (current.qss.points !== 0 || current.qss.distance !== null || current.qss.lowerBound < row.maxPoints / scale
              || current.qss.scale !== scale || current.qss.rubric !== 'paper-linear-v1'
              || current.qss.scoreCertifiedWithinModel !== true) report.failures.push({ key: source.key, kind: 'zero_score_missing_certificate' });
        } else if (current.qss.points != null) report.failures.push({ key: source.key, kind: 'unresolved_status_has_points' });
      }
      details.write(JSON.stringify(result) + '\n');
      saveReport();
      if (report.questions % 10 === 0 || report.questions === 1) console.log(`QSS_CORPUS ${report.questions}/${expectedRunQuestions} (source ordinal ${row.ordinal}/${corpusTotal}): self ${report.self_full_points}, formatting ${report.formatting_full_points}, counterexamples ${report.errors_with_sqlite_counterexample}, failures ${report.failures.length}`);
    }
    assert.equal(report.questions, expectedRunQuestions, 'Every question in the explicitly requested source range must be tested.');
    report.run_status = 'controls'; saveReport();
    for (const control of mutations.semanticControls) {
      console.log('QSS_CORPUS_SEMANTIC_CONTROL ' + control.name);
      const result = await page.evaluate(row => window.qssCorpusControl(row), control);
      report.qss_evaluations++;
      report.sqlite_executions += 2;
      assert.equal(result.sqlite_equivalent, true, 'The independently executed semantic control must be equivalent: ' + control.name);
      report.semantic_controls.push(result);
      if (result.qss.status !== 'exact' || result.qss.distance !== 0 || result.qss.points !== 5) report.semantic_control_gaps.push(result);
    }
    for (const control of mutations.gradingControls) {
      console.log('QSS_CORPUS_GRADING_CONTROL ' + control.name);
      const result = await page.evaluate(row => window.qssCorpusControl(row), control);
      report.qss_evaluations++;
      report.sqlite_executions += 2;
      report.grading_controls.push({ ...result, expectation: control.expectation });
      let valid = !result.sqlite_reference_error;
      if (control.expectation === 'partial') valid &&= !result.sqlite_equivalent && result.qss.points > 0 && result.qss.points < 5;
      if (control.expectation === 'deduction') valid &&= !result.sqlite_equivalent && Number.isFinite(result.qss.points) && result.qss.points >= 0 && result.qss.points < 5;
      if (control.expectation === 'zero') valid &&= result.qss.points === 0 && ['exact', 'score-zero-certified'].includes(result.qss.status);
      if (control.expectation === 'unresolved') valid &&= !!result.sqlite_answer_error && result.qss.points === null && ['unsupported', 'error'].includes(result.qss.status);
      if (!valid) report.failures.push({ control: control.name, kind: 'grading_control_expectation', result });
    }
    const finalWorker = await page.request.get(`${base}${plugin}/lib/qss/worker.qss.js`);
    report.worker_unchanged = finalWorker.ok() && hash(await finalWorker.body()) === report.worker_sha256;
    if (!report.worker_unchanged) report.failures.push({ kind: 'worker_changed_during_corpus_run' });
    assert.deepEqual(report.failures, []);
    assert.deepEqual(report.semantic_control_gaps, [], 'Every declared semantic equivalence control must pass.');
    report.completed = true; report.run_status = 'complete'; saveReport();
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    report.completed = false; report.run_status = 'failed';
    report.run_error = {name: error.name, message: error.message}; saveReport();
    throw error;
  } finally {
    await new Promise(resolve => details.end(resolve));
    await ownedContext.close();
    ownedContext = null;
  }
}

process.on('SIGINT', async () => { if (ownedContext) await ownedContext.close(); process.exit(130); });
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
