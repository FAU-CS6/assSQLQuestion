/* Read-only aggregate gate for completed, disjoint REAL Chrome student exams.
 * ILIAS_CORPUS_DIRECTORY=/private/original-corpus \
 * QSS_REPORT_DIRECTORY=/private/tmp/asssql-private-artifacts/qss-paper/native-final-coverage \
 * node tests/qss/verify-native-ranges.cjs PART_A PART_B PART_C PART_D
 *
 * Each part supplies exam-state.json, browser-report.json,
 * browser-results.jsonl and database-report.json. This verifier executes no SQL,
 * opens no browser and changes no answers, grades, source files or input reports.
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value);
const normalizeSQL = value => value.replace(/\r\n?/g, '\n');
const ENGINE = 'graph-qss-sqlite-v2', VERSION = require('../../lib/qss/cost-catalog.json').modelVersion;
const ROOT = path.resolve(__dirname, '../..');
const files = ['exam-state.json', 'browser-report.json', 'browser-results.jsonl', 'database-report.json'];

function jsonFile(filename) {
  const bytes = fs.readFileSync(filename);
  return {data: JSON.parse(bytes.toString('utf8')), sha256: hash(bytes), bytes: bytes.length};
}
function positiveInteger(value, name) {
  assert.ok(Number.isSafeInteger(value) && value > 0, name + ' must be a positive integer.');
}
function sha(value, name) { assert.match(value, /^[a-f0-9]{64}$/, name + ' must be SHA-256.'); }
function numberEqual(value, expected, name) {
  assert.ok((typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)), name + ' must be finite.');
  assert.equal(Number(value), expected, name);
}
function uiPair(value, expected, name) {
  assert.equal(typeof value, 'string', name);
  const pair = value.trim().match(/^([0-9]+(?:[.,][0-9]+)?)\s+(?:Of|von)\s+([0-9]+(?:[.,][0-9]+)?)$/i);
  assert.ok(pair, name + ' must report achieved and maximum values.');
  numberEqual(pair[1].replace(',', '.'), expected, name);
  numberEqual(pair[2].replace(',', '.'), expected, name);
}
async function streamJsonLines(filename, each) {
  const stream = fs.createReadStream(filename), digest = crypto.createHash('sha256');
  let bytes = 0, rows = 0;
  stream.on('data', chunk => {digest.update(chunk); bytes += chunk.length;});
  const lines = readline.createInterface({input: stream, crlfDelay: Infinity});
  for await (const line of lines) {
    assert.ok(line.trim().length > 0, 'Empty JSONL record in ' + path.basename(filename));
    await each(JSON.parse(line), rows++);
  }
  return {sha256: digest.digest('hex'), bytes, rows};
}

/** Retain only hashes, identity and maxima, not the 219 MB question contents. */
async function sourceIndex(directory, options) {
  const manifest = jsonFile(path.join(directory, 'manifest.json'));
  assert.equal(manifest.data.questions, options.expectedTotal, 'Unexpected original corpus size.');
  assert.equal(Boolean(manifest.data.synthetic_gate_fixture), Boolean(options.smoke), 'Synthetic gate fixtures are never real Chrome evidence.');
  assert.deepEqual(manifest.data.pools.map(pool => pool.count), options.expectedPoolCounts, 'Original pool counts/order.');
  const index = new Map(), keys = [], pools = new Map();
  let maximum = 0;
  const input = await streamJsonLines(path.join(directory, 'questions.jsonl'), (row, ordinal) => {
    assert.equal(typeof row.key, 'string');
    assert.equal(index.has(row.key), false, 'Duplicate original source key.');
    const metadata = row.metadata;
    assert.equal(typeof metadata.SEQUENCE_B, 'string');
    const metrics = JSON.parse(metadata.SOLUTION_METRICS).map(value => typeof value === 'string' ? JSON.parse(value) : value);
    let points = 0;
    for (const metric of metrics) {
      const weight = Number(metric.points);
      assert.ok(Number.isFinite(weight) && weight >= 0, 'Invalid original metric weight.');
      points += weight;
    }
    assert.ok(Number.isFinite(points), 'Invalid original maximum points.');
    const pool = String(row.pool);
    pools.set(pool, (pools.get(pool) || 0) + 1);
    index.set(row.key, {ordinal: ordinal + 1, pool, maximum: points,
      answer_sha256: hash(normalizeSQL(metadata.SEQUENCE_B)),
      relation_sha256: hash(canonical(JSON.parse(metadata.OUTPUT_RELATION)))});
    keys.push(row.key); maximum += points;
  });
  assert.equal(input.rows, options.expectedTotal, 'Original source row count.');
  assert.equal(pools.size, manifest.data.pools.length, 'Every original pool is present exactly once.');
  for (const pool of manifest.data.pools) assert.equal(pools.get(String(pool.key)), pool.count, 'Manifest/source pool coverage.');
  return {index, keys, maximum, pools, manifest, input};
}

function validateSelfQss(qss, source) {
  assert.ok(qss && typeof qss === 'object', 'Missing QSS evaluation in a native answer.');
  assert.equal(qss.engine, ENGINE); assert.equal(qss.version, VERSION); assert.equal(qss.modelVersion, VERSION);
  assert.equal(qss.rubric, 'paper-linear-v2'); assert.equal(qss.scale, source.maximum > 0 ? source.maximum / 5 : 1);
  assert.equal(qss.formula, 'max(maxPoints - distance * scale, 0)');
  assert.equal(qss.status, 'exact'); assert.equal(qss.distance, 0);
  assert.equal(qss.maxPoints, source.maximum); assert.equal(qss.points, source.maximum);
  assert.equal(qss.exactWithinModel, true); assert.equal(qss.scoreCertifiedWithinModel, true);
  assert.equal(qss.provisionalRubric, true); assert.equal(qss.lowerBound, 0);
  assert.equal(qss.answerDigest, source.answer_sha256, 'Native answer digest must match LF-normalized original B.');
  sha(qss.referenceRevision, 'Reference revision');
  assert.deepEqual(qss.edits, []); assert.equal(qss.editsTruncated, false);
}

async function verifyNativeRanges(options) {
  const parts = options.parts.map(directory => path.resolve(directory));
  assert.equal(parts.length, options.expectedParts, 'Unexpected number of completed native ranges.');
  assert.equal(new Set(parts).size, parts.length, 'Do not include a native range directory twice.');
  const source = await sourceIndex(options.corpusDirectory, options);
  const frozen = jsonFile(options.frozenProof);
  assert.equal(frozen.data.model_version, VERSION);
  sha(frozen.data.worker_sha256, 'Frozen worker'); sha(frozen.data.runtime_sha256, 'Frozen runtime');
  const workerHash = hash(fs.readFileSync(path.join(ROOT, 'lib/qss/worker.qss.js')));
  assert.equal(workerHash, frozen.data.worker_sha256, 'The current worker must match the frozen proof.');
  assert.equal(hash(fs.readFileSync(path.join(ROOT, 'lib/qss/qss.js'))), frozen.data.api_sha256, 'The current API bundle must match the frozen proof.');
  const seenKeys = new Set(), originalIds = new Set(), nativeIds = new Set(), testIds = new Set(), testRefs = new Set(), activeIds = new Set();
  const aggregatePools = new Map(), provenance = [], ranges = [];
  let teacherId, studentId, browserVersion, sqlBundle, total = 0, maximum = 0;
  for (const directory of parts) {
    const stateFile = jsonFile(path.join(directory, files[0])), browserFile = jsonFile(path.join(directory, files[1])), databaseFile = jsonFile(path.join(directory, files[3]));
    const state = stateFile.data, browser = browserFile.data, database = databaseFile.data;
    for (const field of ['teacher_id', 'student_id', 'test_id', 'test_ref_id']) positiveInteger(state[field], field);
    assert.notEqual(state.teacher_id, state.student_id, 'Teacher and student must be distinct accounts.');
    teacherId ??= state.teacher_id; studentId ??= state.student_id;
    assert.equal(state.teacher_id, teacherId, 'All ranges use the same ordinary teacher.');
    assert.equal(state.student_id, studentId, 'All ranges use the same ordinary student.');
    assert.equal(testIds.has(state.test_id), false, 'Duplicate native test ID.'); testIds.add(state.test_id);
    assert.equal(testRefs.has(state.test_ref_id), false, 'Duplicate native test reference.'); testRefs.add(state.test_ref_id);
    assert.equal(state.source_kind, 'original-corpus'); assert.equal(state.source_range_explicit, true);
    assert.equal(state.source_total_questions, source.keys.length);
    assert.ok(Number.isSafeInteger(state.source_start) && state.source_start >= 0);
    positiveInteger(state.source_count, 'source_count');
    assert.equal(state.source_end_exclusive, state.source_start + state.source_count);
    assert.ok(state.source_end_exclusive <= source.keys.length);
    const keys = Object.keys(state.questions), expectedKeys = source.keys.slice(state.source_start, state.source_end_exclusive);
    assert.equal(keys.length, state.source_count, 'Declared source count must match native exam keys.');
    assert.deepEqual(keys, expectedKeys, 'Native exam must cover its exact original source range in order.');
    assert.equal(state.source_keys_sha256, hash(canonical(expectedKeys)), 'Declared source-key hash.');
    assert.equal(state.source_questions_sha256, source.input.sha256, 'Native exam must be seeded from the unchanged original corpus.');
    const rangePools = new Map();
    let rangeMaximum = 0;
    for (const key of keys) {
      assert.equal(seenKeys.has(key), false, 'Duplicate original source key across native ranges.'); seenKeys.add(key);
      const identity = state.questions[key], expected = source.index.get(key);
      positiveInteger(identity.question_id, 'Native question ID'); positiveInteger(identity.original_question_id, 'Original question ID');
      assert.equal(nativeIds.has(identity.question_id), false, 'Duplicate native question ID across ranges.'); nativeIds.add(identity.question_id);
      assert.equal(originalIds.has(identity.original_question_id), false, 'Duplicate original question ID across ranges.'); originalIds.add(identity.original_question_id);
      assert.notEqual(identity.question_id, identity.original_question_id, 'The native question must be a distinct test copy.');
      assert.equal(identity.original_source_ordinal, expected.ordinal, 'Original source ordinal must be retained.');
      rangeMaximum += expected.maximum;
      rangePools.set(expected.pool, (rangePools.get(expected.pool) || 0) + 1);
      aggregatePools.set(expected.pool, (aggregatePools.get(expected.pool) || 0) + 1);
    }
    assert.equal(browser.test_id, state.test_id); assert.equal(browser.student_id, studentId);
    assert.equal(browser.headless, true); assert.match(browser.user_agent, /HeadlessChrome\//);
    browserVersion ??= browser.browser; assert.equal(browser.browser, browserVersion, 'Native ranges use one Chrome version.');
    assert.equal(browser.qss_worker_sha256, workerHash, 'Mixed QSS worker in a native range.');
    assert.equal(browser.runtime_javascript_sha256, frozen.data.runtime_sha256, 'Mixed runtime in a native range.');
    sha(browser.bundle_sha256, 'SQL worker bundle'); sqlBundle ??= browser.bundle_sha256;
    assert.equal(browser.bundle_sha256, sqlBundle, 'SQL baseline bundle must be identical across ranges.');
    for (const field of ['questions', 'ui_question_pages', 'ui_answer_submissions', 'same_execution', 'same_metrics', 'old_workers_executed', 'qss_completed']) {
      assert.equal(browser[field], state.source_count, 'Completed browser count: ' + field);
    }
    assert.equal(browser.finished, true, 'Every native test must be finished by its participant.');
    for (const field of ['failures', 'source_result_mismatches', 'source_metric_mismatches']) assert.deepEqual(browser[field], [], field);
    assert.deepEqual(browser.pools, Object.fromEntries(rangePools), 'Per-range browser pool coverage.');
    assert.deepEqual(browser.role_checks.map(check => check.action).sort(), ['edit_url', 'export_url', 'import_url']);
    assert.ok(browser.role_checks.every(check => check.denied === true), 'Student must be denied teacher pool operations.');
    const coverage = browser.source_coverage;
    assert.equal(coverage?.declared, true); assert.equal(coverage.source_kind, 'original-corpus');
    assert.equal(coverage.corpus_total_questions, source.keys.length);
    assert.equal(coverage.source_start, state.source_start); assert.equal(coverage.source_end_exclusive, state.source_end_exclusive);
    assert.equal(coverage.expected_questions, state.source_count); assert.equal(coverage.completed_questions, state.source_count);
    assert.equal(coverage.completed, true, 'Native range source coverage is unfinished.');
    assert.equal(coverage.expected_source_keys_sha256, state.source_keys_sha256);
    assert.equal(coverage.completed_source_keys_sha256, state.source_keys_sha256);
    assert.equal(coverage.source_questions_sha256, source.input.sha256);
    uiPair(browser.ui_answered, state.source_count, 'Native answered UI count'); uiPair(browser.ui_score, rangeMaximum, 'Native UI points');
    const results = await streamJsonLines(path.join(directory, files[2]), (row, index) => {
      assert.ok(index < keys.length, 'Too many native browser result rows.');
      assert.equal(row.key, keys[index], 'Native browser row must match the original source order.');
      const identity = state.questions[row.key], expected = source.index.get(row.key);
      assert.equal(row.original_source_ordinal, expected.ordinal);
      assert.equal(row.original_question_id, identity.original_question_id); assert.equal(row.question_id, identity.question_id);
      assert.deepEqual(row.actual_native_identity, {sequence: index + 1, form_sequence: index + 1, autosave_sequence: index + 1, question_id: identity.question_id},
        'Native page/form/autosave identity must match the declared test question.');
      assert.equal(row.baseline_result_sha256, expected.relation_sha256, 'Baseline result must match the canonical original OUTPUT_RELATION.');
      assert.equal(row.current_result_sha256, expected.relation_sha256, 'Current result must match the original relation.');
      assert.deepEqual(row.current.metrics, row.baseline.metrics, 'Native legacy metrics must remain unchanged.');
      assert.ok(!row.baseline.error && !row.current.error, 'Model SQL execution must succeed.');
      validateSelfQss(row.qss, expected);
      assert.ok(Array.isArray(row.qss_progress) && row.qss_progress.length > 0, 'Missing native question-local progress observation.');
      assert.ok(row.qss_progress.every(progress => progress.resultHidden === true && progress.nextDisabled === true), 'Results/navigation must wait for QSS.');
    });
    assert.equal(results.rows, state.source_count, 'Missing native browser result rows.');
    assert.equal(database.test_id, state.test_id); assert.equal(database.student_id, studentId);
    positiveInteger(database.active_id, 'Native active ID');
    assert.equal(activeIds.has(database.active_id), false, 'Duplicate native active ID.'); activeIds.add(database.active_id);
    assert.equal(database.student_is_system_admin, false, 'Student must not be a system administrator.');
    for (const field of ['expected', 'authorized_answers', 'qss_saved', 'qss_exact_self', 'stored_grade_rows']) assert.equal(database[field], state.source_count, 'Native database count: ' + field);
    assert.equal(database.manual_overrides, 0, 'Manual grades cannot count as native proof.');
    numberEqual(database.legacy_points, rangeMaximum, 'Native legacy points'); numberEqual(database.maximum_points, rangeMaximum, 'Native maximum points');
    assert.deepEqual(database.failures, []); sha(database.authorized_answers_sha256, 'Authorized answer evidence hash');
    assert.equal(database.native_attempt?.finalized_by, 'finished_by_participant', 'Native attempt must be finalized by the participant.');
    numberEqual(database.native_attempt.answeredquestions, state.source_count, 'Native answered questions');
    numberEqual(database.native_attempt.questioncount, state.source_count, 'Native question count');
    numberEqual(database.native_attempt.points, rangeMaximum, 'Native attempt points');
    total += state.source_count; maximum += rangeMaximum;
    ranges.push({start: state.source_start, end_exclusive: state.source_end_exclusive});
    provenance.push({directory, test_id: state.test_id, active_id: database.active_id,
      source_start: state.source_start, source_end_exclusive: state.source_end_exclusive, questions: state.source_count,
      regular_points: rangeMaximum, qss_saved: database.qss_saved, source_keys_sha256: state.source_keys_sha256,
      input_sha256: {[files[0]]: stateFile.sha256, [files[1]]: browserFile.sha256, [files[2]]: results.sha256, [files[3]]: databaseFile.sha256}});
  }
  assert.equal(total, source.keys.length, 'Exactly every original question must be covered.');
  assert.equal(seenKeys.size, source.keys.length);
  for (const key of source.keys) assert.ok(seenKeys.has(key), 'Missing original source key.');
  for (const id of nativeIds) assert.equal(originalIds.has(id), false, 'Native question IDs must not reuse original teacher question IDs.');
  ranges.sort((a, b) => a.start - b.start);
  let end = 0;
  for (const range of ranges) {assert.equal(range.start, end, 'Native ranges must be disjoint and complete.'); end = range.end_exclusive;}
  assert.equal(end, source.keys.length); assert.equal(maximum, source.maximum, 'Aggregate points must come from original metric weights.');
  assert.deepEqual(Object.fromEntries(aggregatePools), Object.fromEntries(source.pools));
  let teacherProof = null;
  if (options.teacherProof && fs.existsSync(options.teacherProof)) {
    teacherProof = jsonFile(options.teacherProof);
    assert.equal(teacherProof.data.teacher_user_id, teacherId);
    assert.equal(teacherProof.data.teacher_is_system_administrator, false, 'Teacher must be an ordinary account.');
    assert.equal(teacherProof.data.all_pool_and_question_owners_are_teacher, true);
    assert.equal(teacherProof.data.imported_questions, source.keys.length); assert.equal(teacherProof.data.reimported_questions, source.keys.length);
    assert.equal(teacherProof.data.ownership_verified_questions, 2 * source.keys.length);
    // This separate PHP import/role proof is deliberately not a QSS-build proof.
  }
  return {accepted: true, completed: true, scope: 'completed-disjoint-native-Chrome-exam-artifacts',
    synthetic_gate_fixture: Boolean(options.smoke), verifier_executes_SQL_or_browser: false,
    observed_at: new Date().toISOString(), model_version: VERSION, engine: ENGINE,
    worker_sha256: workerHash, runtime_javascript_sha256: frozen.data.runtime_sha256, api_sha256: frozen.data.api_sha256,
    browser: browserVersion, headless: true, teacher_id: teacherId, student_id: studentId,
    student_is_system_admin: false, teacher_is_system_admin: teacherProof ? false : null,
    teacher_role_proof_scope: teacherProof ? 'independent-native-import-and-ownership-audit' : 'not-attested-by-range-inputs',
    questions: total, source_pool_counts: Object.fromEntries(source.pools),
    original_question_ids_unique: originalIds.size, native_question_ids_unique: nativeIds.size,
    authorized_answers: total, qss_saved: total, qss_exact_self: total, stored_grade_rows: total,
    legacy_points: maximum, maximum_points: source.maximum, manual_overrides: 0,
    finished_by_participant: parts.length, source_questions_sha256: source.input.sha256,
    manifest_sha256: source.manifest.sha256, frozen_bundle_proof_sha256: frozen.sha256,
    teacher_role_proof_sha256: teacherProof?.sha256 || null,
    source_keys_sha256: hash(canonical(source.keys)),
    input_parts: provenance, failures: [], input_files_modified: false};
}

async function selfTest() {
  const os = require('node:os');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asssql-native-range-gates-'));
  const corpus = path.join(directory, 'corpus'); fs.mkdirSync(corpus);
  const sourceRows = [1, 2, 3].map((value, index) => ({key: 'anonymous:' + value, pool: index < 2 ? 'anonymous-a' : 'anonymous-b', ordinal: index < 2 ? index + 1 : 1,
    metadata: {SEQUENCE_B: value === 2 ? '\r\nSELECT 2\r\n' : 'SELECT ' + value,
      OUTPUT_RELATION: canonical({columns: ['value'], values: [[value]]}),
      SOLUTION_METRICS: canonical([{type: 'result_lines', points: value, value: '1'}])}}));
  fs.writeFileSync(path.join(corpus, 'manifest.json'), canonical({synthetic_gate_fixture: true, questions: 3,
    pools: [{key: 'anonymous-a', count: 2}, {key: 'anonymous-b', count: 1}]}));
  fs.writeFileSync(path.join(corpus, 'questions.jsonl'), sourceRows.map(canonical).join('\n') + '\n');
  const sourceHash = hash(fs.readFileSync(path.join(corpus, 'questions.jsonl')));
  const frozenProof = path.join(directory, 'frozen.json');
  fs.writeFileSync(frozenProof, canonical({model_version: VERSION,
    worker_sha256: hash(fs.readFileSync(path.join(ROOT, 'lib/qss/worker.qss.js'))),
    api_sha256: hash(fs.readFileSync(path.join(ROOT, 'lib/qss/qss.js'))), runtime_sha256: 'a'.repeat(64)}));
  const teacherProof = path.join(directory, 'teacher.json');
  fs.writeFileSync(teacherProof, canonical({teacher_user_id: 101, teacher_is_system_administrator: false,
    all_pool_and_question_owners_are_teacher: true, imported_questions: 3, reimported_questions: 3, ownership_verified_questions: 6}));
  const parts = [[0, 2], [2, 3]].map(([start, end], part) => {
    const folder = path.join(directory, 'part-' + part); fs.mkdirSync(folder);
    const rows = sourceRows.slice(start, end), keys = rows.map(row => row.key), points = rows.reduce((sum, row) => sum + JSON.parse(row.metadata.SOLUTION_METRICS)[0].points, 0);
    const questions = Object.fromEntries(rows.map((row, index) => [row.key, {question_id: 1001 + start + index,
      original_question_id: 501 + start + index, original_source_ordinal: start + index + 1}]));
    const state = {test_id: 201 + part, test_ref_id: 301 + part, teacher_id: 101, student_id: 102,
      source_kind: 'original-corpus', source_range_explicit: true, source_total_questions: 3,
      source_start: start, source_count: rows.length, source_end_exclusive: end,
      source_keys_sha256: hash(canonical(keys)), source_questions_sha256: sourceHash, questions};
    const browser = {test_id: state.test_id, student_id: 102, browser: 'anonymous-artifact-gate-fixture', user_agent: 'HeadlessChrome/anonymous-gate', headless: true,
      qss_worker_sha256: JSON.parse(fs.readFileSync(frozenProof)).worker_sha256, runtime_javascript_sha256: 'a'.repeat(64), bundle_sha256: 'b'.repeat(64),
      questions: rows.length, ui_question_pages: rows.length, ui_answer_submissions: rows.length, same_execution: rows.length, same_metrics: rows.length,
      old_workers_executed: rows.length, qss_completed: rows.length, finished: true, failures: [], source_result_mismatches: [], source_metric_mismatches: [],
      pools: Object.fromEntries([...new Set(rows.map(row => row.pool))].map(pool => [pool, rows.filter(row => row.pool === pool).length])),
      role_checks: ['edit_url', 'import_url', 'export_url'].map(action => ({action, denied: true})),
      ui_answered: rows.length + ' Of ' + rows.length, ui_score: points + ' Of ' + points,
      source_coverage: {declared: true, source_kind: 'original-corpus', corpus_total_questions: 3, source_start: start, source_end_exclusive: end,
        expected_questions: rows.length, completed_questions: rows.length, completed: true,
        expected_source_keys_sha256: state.source_keys_sha256, completed_source_keys_sha256: state.source_keys_sha256, source_questions_sha256: sourceHash}};
    const results = rows.map((row, index) => ({key: row.key, ...questions[row.key], actual_native_identity: {sequence: index + 1,
      form_sequence: index + 1, autosave_sequence: index + 1, question_id: questions[row.key].question_id},
      baseline_result_sha256: hash(canonical(JSON.parse(row.metadata.OUTPUT_RELATION))), current_result_sha256: hash(canonical(JSON.parse(row.metadata.OUTPUT_RELATION))),
      baseline: {metrics: {result_lines: '1'}}, current: {metrics: {result_lines: '1'}},
      qss_progress: [{phase: 'parsing', resultHidden: true, nextDisabled: true}],
      qss: {engine: ENGINE, version: VERSION, modelVersion: VERSION, rubric: 'paper-linear-v2', scale: JSON.parse(row.metadata.SOLUTION_METRICS)[0].points / 5,
        formula: 'max(maxPoints - distance * scale, 0)', status: 'exact', distance: 0, lowerBound: 0,
        maxPoints: JSON.parse(row.metadata.SOLUTION_METRICS)[0].points, points: JSON.parse(row.metadata.SOLUTION_METRICS)[0].points,
        answerDigest: hash(normalizeSQL(row.metadata.SEQUENCE_B)), referenceRevision: 'c'.repeat(64),
        exactWithinModel: true, scoreCertifiedWithinModel: true, provisionalRubric: true, edits: [], editsTruncated: false}}));
    const database = {test_id: state.test_id, student_id: 102, active_id: 401 + part, student_is_system_admin: false,
      expected: rows.length, authorized_answers: rows.length, qss_saved: rows.length, qss_exact_self: rows.length, stored_grade_rows: rows.length,
      manual_overrides: 0, legacy_points: points, maximum_points: points, failures: [], authorized_answers_sha256: 'd'.repeat(64),
      native_attempt: {points, answeredquestions: rows.length, questioncount: rows.length, finalized_by: 'finished_by_participant'}};
    for (const [file, data] of [[files[0], state], [files[1], browser], [files[3], database]]) fs.writeFileSync(path.join(folder, file), canonical(data));
    fs.writeFileSync(path.join(folder, files[2]), results.map(canonical).join('\n') + '\n');
    return folder;
  });
  const options = {parts, corpusDirectory: corpus, frozenProof, teacherProof, expectedParts: 2, expectedTotal: 3, expectedPoolCounts: [2, 1], smoke: true};
  const baseline = await verifyNativeRanges(options);
  assert.equal(baseline.accepted, true); assert.equal(baseline.questions, 3); assert.equal(baseline.maximum_points, 6);
  assert.equal(baseline.synthetic_gate_fixture, true); assert.equal(baseline.teacher_is_system_admin, false);
  const mutations = [
    ['missing-key', files[2], data => data.pop(), /Missing native browser result rows/],
    ['duplicate-original-ID', files[0], data => {data.questions[sourceRows[2].key].original_question_id = 501;}, /Duplicate original question ID/],
    ['mixed-worker', files[1], data => {data.qss_worker_sha256 = '0'.repeat(64);}, /Mixed QSS worker/],
    ['unfinalized-attempt', files[3], data => {data.native_attempt.finalized_by = 'unfinished';}, /finalized by the participant/],
    ['missing-QSS', files[2], data => {data[0].qss = null;}, /Missing QSS evaluation/]
  ];
  const gates = [];
  for (const [name, file, change, message] of mutations) {
    const target = path.join(parts[1], file), bytes = fs.readFileSync(target);
    const data = file.endsWith('.jsonl') ? bytes.toString().trim().split('\n').map(JSON.parse) : JSON.parse(bytes);
    change(data);
    fs.writeFileSync(target, file.endsWith('.jsonl') ? data.map(canonical).join('\n') + (data.length ? '\n' : '') : canonical(data));
    await assert.rejects(verifyNativeRanges(options), message);
    fs.writeFileSync(target, bytes);
    gates.push({name, rejected_as_required: true});
  }
  const after = await verifyNativeRanges(options);
  assert.equal(after.source_questions_sha256, baseline.source_questions_sha256);
  console.log(JSON.stringify({purpose: 'Anonymous artifact-gate smoke tests only; fabricated records are not SQL, scoring or Chrome proof.',
    valid_three_source_two_part_baseline: true, gate_smokes: gates.length, gates}, null, 2));
}

async function main() {
  const parts = process.argv.slice(2);
  const privateRoot = path.join(require('node:os').tmpdir(), 'asssql-private-artifacts', 'qss-paper');
  const output = path.resolve(process.env.QSS_REPORT_DIRECTORY || path.join(privateRoot, 'native-final-coverage'));
  assert.ok(!parts.map(value => path.resolve(value)).includes(output), 'Never overwrite an input part.');
  const filename = path.join(output, 'native-range-report.json');
  assert.equal(fs.existsSync(filename), false, 'Use a new aggregate output directory; do not overwrite previous evidence.');
  const report = await verifyNativeRanges({parts,
    corpusDirectory: path.resolve(process.env.ILIAS_CORPUS_DIRECTORY || '/tmp/asssql-paper-corpus'),
    frozenProof: path.resolve(process.env.QSS_FROZEN_BUNDLES || path.join(privateRoot, 'frozen-final-bundles.json')),
    teacherProof: path.resolve(process.env.QSS_TEACHER_PROOF || path.join(privateRoot, 'teacher-transfer', 'teacher-transfer-report.json')),
    expectedParts: 4, expectedTotal: 699, expectedPoolCounts: [23, 65, 504, 68, 39], smoke: false});
  fs.mkdirSync(output, {recursive: true, mode: 0o700});
  fs.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({accepted: report.accepted, questions: report.questions, parts: report.input_parts.length,
    qss_saved: report.qss_saved, legacy_points: report.legacy_points, maximum_points: report.maximum_points,
    worker_sha256: report.worker_sha256, output: filename}, null, 2));
}

module.exports = {verifyNativeRanges};
if (require.main === module) (process.argv.includes('--self-test') ? selfTest() : main()).catch(error => {console.error(error); process.exitCode = 1;});
