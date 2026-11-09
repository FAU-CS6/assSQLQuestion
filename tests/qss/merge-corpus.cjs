/* Merge private REAL Chrome range observations without changing their raw parts.
 * ILIAS_CORPUS_DIRECTORY=/private/corpus QSS_MERGE_ALLOW_LIVE_PREFIX=1 \
 * QSS_MERGE_OUTPUT_DIRECTORY=test-results/qss-paper/merged \
 * node tests/qss/merge-corpus.cjs ORIGINAL_PREFIX RANGE_301_500 RANGE_501_699
 *
 * Input order is the explicit preference for identical overlapping observations.
 * An unfinished source-start-0 prefix needs the opt-in and an actual HTTP worker
 * hash check at snapshot time; it is NEVER relabelled as a completed producer run.
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const mutations = require('./fixture-mutations.cjs');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const round = value => Math.round((value + Number.EPSILON) * 10000) / 10000;
function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function fachlich(value) {
  if (Array.isArray(value)) return value.map(fachlich);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/(?:_ms|Ms)$/.test(key) && ![
    'original_ordinal', 'ordinal', 'runtimeMs', 'runtime_ms', 'elapsedMs', 'elapsed_ms',
    'durationMs', 'duration_ms', 'cold_worker_ms', 'visited', 'visitedStates', 'frontier',
    'generated', 'searchStats', 'progress', 'original_identity'
  ].includes(key)).map(([key, entry]) => [key, fachlich(entry)]));
}
function equivalentOverlap(first, second) {
  assert.equal(stable(fachlich(first)), stable(fachlich(second)), 'Overlapping source observations disagree in semantic/hash/grade evidence.');
  if (first.original_identity && second.original_identity) {
    assert.equal(stable(fachlich(first.original_identity)), stable(fachlich(second.original_identity)), 'Overlapping original-model evidence disagrees.');
  }
}
function referenceEvidence(row) {
  return {key: row.key, maximum_points: row.maximum_points, reference_error: row.reference_error,
    source_result_exact: row.source_result_exact, format_token_proof: row.format_token_proof,
    visible_order_compared: row.visible_order_compared, formatting_equal: row.formatting_equal,
    formatting_oracle: row.formatting_oracle,
    cases: row.cases.filter(item => item.name !== 'targeted_error').sort((a, b) => a.name.localeCompare(b.name))};
}
function supersededSyntaxTarget(row, rule) {
  const wrong = row.cases.find(item => item.name === 'targeted_error');
  assert.equal(wrong.qss.status, 'unsupported', 'Only an unsupported generator-syntax failure may be superseded.');
  assert.equal(wrong.qss.points, null); assert.equal(wrong.sqlite_error_phase, 'B');
  assert.match(wrong.sqlite_error || '', /syntax|unrecognized token|incomplete input|unterminated/i,
    'The obsolete target must have an observed SQL-B syntax error, not merely a parser/runtime difference.');
  if (rule.superseded_answer_sha256) assert.equal(wrong.answer_sha256, rule.superseded_answer_sha256);
  return wrong;
}
function validateQss(qss, maximum, contract) {
  assert.equal(qss.engine, contract.engine); assert.equal(qss.version, '2.0.1');
  assert.equal(qss.rubric, 'paper-linear-v1'); assert.equal(qss.scale, contract.scale);
  assert.equal(qss.formula, 'max(maxPoints - distance * scale, 0)');
  assert.equal(qss.maxPoints, maximum);
  assert.ok(Number.isSafeInteger(qss.edit_count) && qss.edit_count >= 0);
  if (qss.status === 'exact') {
    assert.ok(Number.isFinite(qss.distance) && qss.distance >= 0);
    assert.equal(qss.exactWithinModel, true); assert.equal(qss.scoreCertifiedWithinModel, true);
    assert.equal(qss.edit_cost_sum, qss.distance);
    assert.equal(qss.points, round(Math.max(0, maximum - qss.distance * contract.scale)));
  } else if (qss.status === 'score-zero-certified') {
    assert.equal(qss.points, 0); assert.equal(qss.distance, null);
    assert.equal(qss.exactWithinModel, false); assert.equal(qss.edit_count, 0); assert.equal(qss.edit_cost_sum, 0);
    assert.ok(Number.isFinite(qss.lowerBound) && qss.lowerBound >= maximum / contract.scale);
    assert.equal(qss.scoreCertifiedWithinModel, true);
  } else {
    assert.ok(['unsupported', 'error', 'cancelled'].includes(qss.status));
    assert.equal(qss.points, null);
  }
}
function validateOracle(oracle, source) {
  assert.equal(oracle?.verified, true, 'An unexplained formatting result difference is fatal.');
  assert.equal(oracle.kind, 'control-query-dependent-default-expression-spelling');
  assert.equal(oracle.original_control_sha256, source.control_hash);
  assert.equal(oracle.literal_NULL_and_null_have_same_SQL_value, true);
  assert.equal(oracle.normalized_control_matches_original_reference, true);
  assert.equal(oracle.all_other_table_info_fields_exact, true);
  assert.deepEqual(oracle.default_type_probe, [['null', 'null', 1]]);
  assert.ok(oracle.table_info_differences.length > 0);
  assert.ok(oracle.table_info_differences.every(item => item.field === 'dflt_value' && item.before === 'NULL' && item.after === 'null'));
}
function validateRow(row, source, contract, superseded = false) {
  assert.equal(row.maximum_points, source.maximum);
  if (row.original_ordinal != null) assert.equal(row.original_ordinal, source.ordinal);
  assert.equal(row.reference_error, null); assert.equal(row.source_result_exact, true);
  assert.equal(stable(row.format_token_proof), stable(source.format_proof));
  assert.equal(row.format_token_proof.safe, true);
  assert.equal(row.cases.length, 3);
  const cases = new Map(row.cases.map(item => [item.name, item]));
  assert.deepEqual([...cases.keys()].sort(), ['formatting', 'self', 'targeted_error']);
  assert.equal(cases.get('self').answer_sha256, source.answer_hash);
  assert.equal(cases.get('self').visible_result_sha256, source.reference_result_hash, 'The self-run result digest must match the independently supplied original relation.');
  assert.equal(cases.get('formatting').answer_sha256, source.format_hash);
  if (!superseded) assert.ok(source.mutation_hashes.has(cases.get('targeted_error').answer_sha256), 'The tested adverse answer must be a reproducible declared source mutation.');
  for (const item of row.cases) {
    validateQss(item.qss, source.maximum, contract);
    assert.ok(Number.isFinite(item.legacy?.points) && item.legacy.points >= 0 && item.legacy.points <= source.maximum);
    assert.match(item.answer_sha256, /^[a-f0-9]{64}$/);
    assert.ok(item.visible_result_sha256 === null || /^[a-f0-9]{64}$/.test(item.visible_result_sha256));
  }
  for (const name of ['self', 'formatting']) {
    const value = cases.get(name).qss;
    assert.equal(value.status, 'exact'); assert.equal(value.distance, 0); assert.equal(value.points, source.maximum);
  }
  if (!row.formatting_equal) validateOracle(row.formatting_oracle, source);
  const wrong = cases.get('targeted_error');
  if (!superseded) assert.ok(['exact', 'score-zero-certified'].includes(wrong.qss.status) && Number.isFinite(wrong.qss.points),
    'Every selected corpus target needs a certified score; unresolved generated mistakes are not accepted.');
  if (!wrong.sqlite_error) {
    assert.equal(wrong.changed_visible_result, true);
    assert.ok(Number.isFinite(wrong.qss.points) && wrong.qss.points < source.maximum,
      'A successfully observed changed result must not receive full QSS points.');
  }
}
function validateControls(report, contract) {
  assert.deepEqual(report.semantic_control_gaps || [], []);
  const semantic = report.semantic_controls || [], grading = report.grading_controls || [];
  assert.deepEqual(semantic.map(item => item.name).sort(), mutations.semanticControls.map(item => item.name).sort());
  assert.deepEqual(grading.map(item => item.name).sort(), mutations.gradingControls.map(item => item.name).sort());
  for (const item of semantic) {
    validateQss(item.qss, 5, contract);
    assert.equal(item.sqlite_equivalent, true); assert.equal(item.qss.status, 'exact');
    assert.equal(item.qss.distance, 0); assert.equal(item.qss.points, 5);
  }
  for (const item of grading) {
    validateQss(item.qss, 5, contract);
    const definition = mutations.gradingControls.find(control => control.name === item.name);
    assert.equal(item.expectation, definition.expectation); assert.ok(!item.sqlite_reference_error);
    if (definition.expectation === 'partial') assert.ok(!item.sqlite_equivalent && item.qss.points > 0 && item.qss.points < 5);
    if (definition.expectation === 'deduction') assert.ok(!item.sqlite_equivalent && Number.isFinite(item.qss.points) && item.qss.points >= 0 && item.qss.points < 5);
    if (definition.expectation === 'zero') assert.ok(item.qss.points === 0 && ['exact', 'score-zero-certified'].includes(item.qss.status));
    if (definition.expectation === 'unresolved') assert.ok(item.sqlite_answer_error && item.qss.points === null && ['unsupported', 'error'].includes(item.qss.status));
  }
  return {semantic, grading};
}
function readSnapshot(directory, {total, prefixLimit} = {}) {
  const reportBytes = fs.readFileSync(path.join(directory, 'corpus-report.json'));
  const report = JSON.parse(reportBytes.toString('utf8'));
  const rawBytes = fs.readFileSync(path.join(directory, 'corpus-results.jsonl'));
  const lines = rawBytes.toString('utf8').split('\n');
  const trailingPartial = lines.at(-1) !== '';
  lines.pop();
  const rows = lines.filter(Boolean).map(JSON.parse);
  const reportedCount = report.questions;
  assert.ok(Number.isSafeInteger(reportedCount) && reportedCount >= 0);
  const completed = report.completed === true || report.completed == null
    && report.worker_unchanged === true && reportedCount === (report.corpus_total_questions ?? total);
  let selectedCount = completed ? reportedCount : Math.min(reportedCount, rows.length);
  const reportedAvailable = selectedCount;
  if (!completed && (report.source_start ?? 0) === 0 && prefixLimit != null) selectedCount = Math.min(selectedCount, prefixLimit);
  if (completed) { assert.equal(rows.length, reportedCount); assert.equal(trailingPartial, false); }
  return {report, reportBytes, rawBytes, rows: rows.slice(0, selectedCount), completed,
    raw_complete_records: rows.length, selected_count: selectedCount,
    ignored_unreported_records: Math.max(0, rows.length - reportedCount),
    explicit_prefix_limit: !completed && (report.source_start ?? 0) === 0 ? prefixLimit ?? null : null,
    ignored_reported_records_due_to_prefix_limit: reportedAvailable - selectedCount,
    trailing_partial_ignored: trailingPartial};
}
async function sourceIndex(directory) {
  const total = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')).questions;
  const digest = crypto.createHash('sha256'), source = fs.createReadStream(path.join(directory, 'questions.jsonl'));
  source.on('data', chunk => digest.update(chunk));
  const lines = readline.createInterface({input: source, crlfDelay: Infinity}), index = new Map();
  for await (const line of lines) {
    const row = JSON.parse(line), m = row.metadata;
    assert.equal(index.has(row.key), false, 'Original private source keys must be unique.');
    const metrics = JSON.parse(m.SOLUTION_METRICS).map(item => typeof item === 'string' ? JSON.parse(item) : item);
    const formatted = mutations.equivalentFormatting(m.SEQUENCE_B);
    index.set(row.key, {ordinal: index.size + 1, maximum: metrics.reduce((sum, item) => sum + Number(item.points), 0),
      answer_hash: hash(m.SEQUENCE_B), format_hash: hash(formatted), control_hash: hash(m.SEQUENCE_C),
      reference_result_hash: hash(JSON.stringify(JSON.parse(m.OUTPUT_RELATION))),
      format_proof: mutations.formattingTokenProof(m.SEQUENCE_B, formatted),
      mutation_hashes: new Set(mutations.errorCandidates(m.SEQUENCE_B).map(item => hash(item.answer)))});
  }
  assert.equal(index.size, total);
  return {index, total, sha256: digest.digest('hex')};
}
function baseReport(contract, total) {
  return {...contract, corpus_total_questions: total, source_start: 0, source_end_exclusive: total,
    expected_run_questions: total, completed: false, run_status: 'merging', merge: true,
    questions: 0, self_full_points: 0, formatting_full_points: 0, formatting_sqlite_equivalent: 0,
    safe_formatting_neutral: 0, known_control_representation_differences: [], targeted_errors: 0,
    errors_with_sqlite_counterexample: 0, targeted_error_full_points: 0, valid_wrong_answers: 0,
    runtime_error_answers_graded: 0, runtime_error_answers_ungraded: 0, runtime_error_full_points: 0,
    runtime_error_phases: {}, invalid_candidates_executed: 0, targeted_error_resolved_maximum_points: 0,
    sqlite_executions: 0, qss_evaluations: 0, corpus_qss_evaluations: 0, source_result_mismatches: [],
    mutation_types: {}, statuses: {}, source_maximum_points: 0, self_points: 0, formatting_points: 0,
    source_self_legacy_points: 0, targeted_error_qss_points: 0, targeted_error_resolved_scores: 0,
    targeted_error_legacy_points: 0, validations: {}, legacy_full_but_qss_deducts: 0,
    semantic_controls: [], semantic_control_gaps: [], grading_controls: [],
    original_identity_coverage: {enabled: false, questions: 0, exact: 0, unsupported: 0, other: 0, codes: {}},
    targeted_error_distances: {exact: 0, zero_score_certified: 0, unresolved: 0}, failures: []};
}
function accumulate(report, row) {
  ++report.questions; report.source_maximum_points += row.maximum_points;
  report.sqlite_executions += row.executions; report.invalid_candidates_executed += row.invalid_candidates_executed;
  if (row.formatting_equal) ++report.formatting_sqlite_equivalent;
  ++report.safe_formatting_neutral;
  if (row.formatting_oracle?.verified) report.known_control_representation_differences.push({key: row.key, ...row.formatting_oracle});
  for (const item of row.cases) {
    ++report.qss_evaluations; ++report.corpus_qss_evaluations;
    report.statuses[item.qss.status] = (report.statuses[item.qss.status] || 0) + 1;
    for (const [side, value] of Object.entries(item.qss.validation || {})) {
      const key = side + ':' + value; report.validations[key] = (report.validations[key] || 0) + 1;
    }
    if (item.name !== 'targeted_error') {
      report[item.name === 'self' ? 'self_full_points' : 'formatting_full_points']++;
      report[item.name === 'self' ? 'self_points' : 'formatting_points'] += item.qss.points;
      if (item.name === 'self') report.source_self_legacy_points += item.legacy.points;
      continue;
    }
    ++report.targeted_errors; report.targeted_error_legacy_points += item.legacy.points;
    if (Number.isFinite(item.qss.points)) {
      ++report.targeted_error_resolved_scores; report.targeted_error_qss_points += item.qss.points;
      report.targeted_error_resolved_maximum_points += row.maximum_points;
    }
    if (!item.sqlite_error) ++report.valid_wrong_answers;
    else {
      report.runtime_error_phases[item.sqlite_error_phase] = (report.runtime_error_phases[item.sqlite_error_phase] || 0) + 1;
      if (Number.isFinite(item.qss.points)) {
        ++report.runtime_error_answers_graded;
        if (item.qss.points === row.maximum_points) ++report.runtime_error_full_points;
      } else ++report.runtime_error_answers_ungraded;
    }
    report.mutation_types[item.mutation] = (report.mutation_types[item.mutation] || 0) + 1;
    if (item.sqlite_error || item.changed_visible_result) ++report.errors_with_sqlite_counterexample;
    if (!item.sqlite_error && item.qss.points === row.maximum_points) ++report.targeted_error_full_points;
    if (item.legacy.points === row.maximum_points && Number.isFinite(item.qss.points) && item.qss.points < row.maximum_points) ++report.legacy_full_but_qss_deducts;
    ++report.targeted_error_distances[item.qss.status === 'exact' ? 'exact' : item.qss.status === 'score-zero-certified' ? 'zero_score_certified' : 'unresolved'];
  }
  if (row.original_identity) {
    ++report.qss_evaluations;
    const coverage = report.original_identity_coverage, value = row.original_identity;
    coverage.enabled = true; ++coverage.questions;
    if (value.status === 'exact' && value.distance === 0 && value.points === row.maximum_points) ++coverage.exact;
    else if (value.status === 'unsupported') ++coverage.unsupported; else ++coverage.other;
    if (value.code) coverage.codes[value.code] = (coverage.codes[value.code] || 0) + 1;
  }
}
async function currentWorker() {
  const base = (process.env.ILIAS_TEST_URL || 'http://localhost:8080').replace(/\/$/, '');
  const url = base + '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/lib/qss/worker.qss.js';
  const response = await fetch(url, {cache: 'no-store'}); assert.ok(response.ok, 'Actual served worker must be available for the snapshot check.');
  return {checked_at: new Date().toISOString(), url, sha256: hash(Buffer.from(await response.arrayBuffer()))};
}
async function main() {
  const parts = process.argv.slice(2).map(value => path.resolve(value));
  assert.ok(parts.length > 0, 'Supply explicit private range-result directories in overlap-preference order.');
  assert.equal(new Set(parts).size, parts.length);
  const directory = path.resolve(process.env.ILIAS_CORPUS_DIRECTORY || '/corpus');
  const output = path.resolve(process.env.QSS_MERGE_OUTPUT_DIRECTORY || 'test-results/qss-paper/merged');
  assert.ok(!parts.includes(output), 'Never overwrite a raw input part.');
  assert.equal(fs.existsSync(path.join(output, 'corpus-report.json')), false, 'Choose a new merge output directory; old merged proof remains intact.');
  assert.equal(fs.existsSync(path.join(output, 'corpus-results.jsonl')), false);
  const source = await sourceIndex(directory), before = await currentWorker();
  const prefixLimit = process.env.QSS_MERGE_PREFIX_LIMIT == null ? null : Number(process.env.QSS_MERGE_PREFIX_LIMIT);
  assert.ok(prefixLimit == null || Number.isSafeInteger(prefixLimit) && prefixLimit >= 0, 'QSS_MERGE_PREFIX_LIMIT is an explicit count from source offset zero.');
  const snapshots = parts.map(part => readSnapshot(part, {total: source.total, prefixLimit})), first = snapshots[0].report;
  const contract = {engine: first.engine, scale: first.scale, worker_sha256: first.worker_sha256,
    browser: first.browser, headless: true, exact_distance_requested: first.exact_distance_requested || false};
  assert.equal(contract.engine, 'graph-qss-sqlite-v2'); assert.ok(Number.isFinite(contract.scale) && contract.scale > 0);
  assert.equal(before.sha256, contract.worker_sha256);
  assert.equal(hash(fs.readFileSync(path.join(__dirname, '../../lib/qss/worker.qss.js'))), contract.worker_sha256);
  const replacementFile = process.env.QSS_MERGE_SUPERSEDED_MANIFEST;
  const replacementBytes = replacementFile ? fs.readFileSync(replacementFile) : null;
  const replacementData = replacementBytes ? JSON.parse(replacementBytes.toString('utf8')) : [];
  const replacementList = Array.isArray(replacementData) ? replacementData : replacementData.replacements;
  assert.ok(Array.isArray(replacementList));
  const replacementRules = new Map(), preferredReplacements = new Map(), ordinalSources = [...source.index.entries()];
  for (const item of replacementList) {
    assert.ok(Number.isSafeInteger(item.original_ordinal) && item.original_ordinal > 0 && item.original_ordinal <= source.total);
    assert.ok(typeof item.reason === 'string' && item.reason.trim().length > 10, 'A generator repair requires an explicit explanation.');
    const obsolete = parts.indexOf(path.resolve(item.partdirectory));
    const replacement = parts.indexOf(path.resolve(item.replacement_directory));
    assert.ok(obsolete >= 0 && replacement >= 0 && obsolete !== replacement, 'Both obsolete and replacement directories must be explicit distinct inputs.');
    const key = ordinalSources[item.original_ordinal - 1][0], id = obsolete + ':' + key;
    assert.equal(replacementRules.has(id), false, 'Do not declare an obsolete source observation twice.');
    if (preferredReplacements.has(key)) assert.equal(preferredReplacements.get(key), replacement);
    preferredReplacements.set(key, replacement);
    replacementRules.set(id, {...item, key, obsolete_part: obsolete, replacement_part: replacement});
  }
  const report = baseReport(contract, source.total), selected = new Map(), provenance = [], overlaps = [], superseded = [];
  let controls = null, controlPart = null;
  for (let number = 0; number < snapshots.length; number++) {
    const snapshot = snapshots[number], original = snapshot.report;
    assert.equal(original.engine, contract.engine); assert.equal(original.scale, contract.scale);
    assert.equal(original.worker_sha256, contract.worker_sha256, 'Input parts must use one identical worker hash.'); assert.equal(original.headless, true);
    assert.equal(original.browser, contract.browser); assert.equal(Boolean(original.exact_distance_requested), contract.exact_distance_requested);
    assert.deepEqual(original.failures || [], []); assert.deepEqual(original.semantic_control_gaps || [], []);
    const start = original.source_start ?? 0;
    if (snapshot.completed) {
      assert.equal(original.worker_unchanged, true);
      if (original.completed === true) assert.ok(['complete', 'complete-merged-evidence'].includes(original.run_status));
      if (original.expected_run_questions != null) assert.equal(snapshot.rows.length, original.expected_run_questions);
    } else {
      assert.equal(process.env.QSS_MERGE_ALLOW_LIVE_PREFIX, '1', 'An unfinished completed prefix needs explicit opt-in.');
      if (start !== 0) assert.equal(process.env.QSS_MERGE_ALLOW_PARTIAL_RANGES, '1',
        'Taking completed observations from an unfinished nonzero range requires an additional explicit opt-in.');
      assert.notEqual(original.worker_unchanged, false);
    }
    const seen = new Set();
    for (let index = 0; index < snapshot.rows.length; index++) {
      const row = snapshot.rows[index], expected = source.index.get(row.key);
      assert.ok(expected, 'Foreign source key in an input part.');
      assert.equal(seen.has(row.key), false, 'Duplicate source key within one input part.'); seen.add(row.key);
      assert.equal(expected.ordinal, start + index + 1, 'Every part must follow its exact original contiguous source range.');
      const replacementRule = replacementRules.get(number + ':' + row.key);
      validateRow(row, expected, contract, Boolean(replacementRule));
      if (replacementRule) {
        const wrong = supersededSyntaxTarget(row, replacementRule);
        superseded.push({rule: replacementRule, row, old_target: wrong});
        continue;
      }
      if (selected.has(row.key)) {
        equivalentOverlap(selected.get(row.key).row, row);
        overlaps.push({original_ordinal: expected.ordinal, preferred_part: selected.get(row.key).part, identical_alternative_part: number});
        if (preferredReplacements.get(row.key) === number) selected.set(row.key, {row, part: number});
      } else selected.set(row.key, {row, part: number});
    }
    if (!controls && snapshot.completed && original.worker_unchanged === true
      && (original.semantic_controls || []).length === mutations.semanticControls.length
      && (original.grading_controls || []).length === mutations.gradingControls.length) {
      controls = validateControls(original, contract); controlPart = number;
    }
    provenance.push({part: number, directory: parts[number], captured_at: new Date().toISOString(),
      original_report_completed: original.completed ?? null, original_run_status: original.run_status ?? null,
      original_reported_questions: original.questions, producer_worker_unchanged: original.worker_unchanged ?? null,
      evidence_mode: snapshot.completed ? 'completed-producer-range' : 'completed-record-prefix-from-unfinished-producer',
      source_start: start, selected_records: snapshot.selected_count,
      original_ordinal_first: snapshot.rows.length ? start + 1 : null,
      original_ordinal_last: snapshot.rows.length ? start + snapshot.rows.length : null,
      raw_complete_records: snapshot.raw_complete_records, ignored_unreported_records: snapshot.ignored_unreported_records,
      explicit_prefix_limit: snapshot.explicit_prefix_limit,
      ignored_reported_records_due_to_prefix_limit: snapshot.ignored_reported_records_due_to_prefix_limit,
      trailing_partial_record_ignored: snapshot.trailing_partial_ignored,
      report_snapshot_sha256: hash(snapshot.reportBytes), raw_snapshot_sha256: hash(snapshot.rawBytes),
      external_worker_check: before});
  }
  assert.equal(superseded.length, replacementRules.size, 'Every explicit superseded observation must actually occur.');
  for (const item of superseded) {
    const replacement = selected.get(item.rule.key);
    assert.ok(replacement && replacement.part === item.rule.replacement_part, 'The explicitly required replacement observation is missing.');
    assert.notEqual(item.old_target.answer_sha256, replacement.row.cases.find(row => row.name === 'targeted_error').answer_sha256,
      'A generator syntax repair must actually change the malformed submitted SQL.');
    const newTarget = replacement.row.cases.find(row => row.name === 'targeted_error');
    assert.ok(!(newTarget.sqlite_error_phase === 'B'
      && /syntax|unrecognized token|incomplete input|unterminated/i.test(newTarget.sqlite_error || '')),
    'A generator repair must not introduce another SQL-B syntax failure.');
    assert.ok(newTarget.qss.points < replacement.row.maximum_points, 'The replacement adverse answer must receive an actual deduction.');
    assert.equal(stable(fachlich(referenceEvidence(item.row))), stable(fachlich(referenceEvidence(replacement.row))),
      'A generator-only rerun must preserve the self/formatting/reference hashes and scores.');
  }
  assert.equal(selected.size, source.total, 'Exactly every original source question must be present.');
  for (const key of source.index.keys()) assert.ok(selected.has(key), 'An original source question is missing.');
  assert.ok(controls, 'One complete independently validated semantic/grading control set is required.');
  const rows = [...source.index.keys()].map(key => ({...selected.get(key).row, original_ordinal: source.index.get(key).ordinal}));
  for (const row of rows) accumulate(report, row);
  report.semantic_controls = controls.semantic; report.grading_controls = controls.grading;
  report.qss_evaluations += controls.semantic.length + controls.grading.length;
  report.sqlite_executions += 2 * (controls.semantic.length + controls.grading.length);
  const after = await currentWorker(); assert.equal(after.sha256, contract.worker_sha256);
  report.worker_unchanged = true; report.completed = true; report.run_status = 'complete-merged-evidence';
  report.original_identity_coverage.coverage_complete = report.original_identity_coverage.questions === source.total;
  report.merge_provenance = {source_questions_sha256: source.sha256,
    worker_integrity_mode: 'producer-start-hashes-completed-range-end-checks-and-explicit-live-prefix-snapshot-check',
    current_worker_before: before, current_worker_after: after, parts: provenance,
    overlap_preference: 'First explicit input part wins; only equivalent semantic/hash/grade evidence may overlap.',
    identical_overlaps: overlaps, controls_selected_from_part: controlPart,
    superseded_manifest_sha256: replacementBytes ? hash(replacementBytes) : null,
    explicit_generator_replacements: superseded.map(item => ({original_ordinal: item.rule.original_ordinal,
      superseded_part: item.rule.obsolete_part, replacement_part: item.rule.replacement_part, reason: item.rule.reason,
      superseded_target_answer_sha256: item.old_target.answer_sha256,
      superseded_target_status: item.old_target.qss.status, superseded_target_points: item.old_target.qss.points,
      superseded_sqlite_error_phase: item.old_target.sqlite_error_phase, superseded_sqlite_error: item.old_target.sqlite_error,
      replacement_target_answer_sha256: selected.get(item.rule.key).row.cases.find(row => row.name === 'targeted_error').answer_sha256,
      replacement_sqlite_error_phase: selected.get(item.rule.key).row.cases.find(row => row.name === 'targeted_error').sqlite_error_phase ?? null,
      replacement_ast_graded: true,
      self_and_formatting_evidence_unchanged: true})),
    controls_counted_once: {semantic: controls.semantic.length, grading: controls.grading.length},
    unique_original_questions: rows.length, raw_input_files_modified: false};
  fs.mkdirSync(output, {recursive: true, mode: 0o700});
  const snapshotRoot = path.join(output, 'source-snapshots'); fs.mkdirSync(snapshotRoot, {mode: 0o700});
  snapshots.forEach((snapshot, number) => {
    const folder = path.join(snapshotRoot, String(number)); fs.mkdirSync(folder, {mode: 0o700});
    fs.writeFileSync(path.join(folder, 'corpus-report.json'), snapshot.reportBytes, {flag: 'wx', mode: 0o600});
    fs.writeFileSync(path.join(folder, 'corpus-results.snapshot'), snapshot.rawBytes, {flag: 'wx', mode: 0o600});
  });
  fs.writeFileSync(path.join(output, 'corpus-results.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n', {flag: 'wx', mode: 0o600});
  fs.writeFileSync(path.join(output, 'corpus-report.json'), JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  console.log(JSON.stringify({questions: report.questions, worker_sha256: report.worker_sha256,
    self_full_points: report.self_full_points, formatting_full_points: report.formatting_full_points,
    targeted_errors: report.targeted_errors, overlaps: overlaps.length, control_part: controlPart,
    source_parts: provenance.map(item => ({part: item.part, evidence_mode: item.evidence_mode, selected_records: item.selected_records})),
    output}, null, 2));
}
/** Gate tests only: these fabricated observations are NEVER scoring evidence. */
async function selfTest() {
  const os = require('node:os'), http = require('node:http'), {spawn} = require('node:child_process');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'asssql-qss-merge-gate-'));
  const corpus = path.join(temp, 'corpus'); fs.mkdirSync(corpus);
  const worker = fs.readFileSync(path.join(__dirname, '../../lib/qss/worker.qss.js')), workerHash = hash(worker);
  const contract = {engine: 'graph-qss-sqlite-v2', scale: 1, worker_sha256: workerHash,
    browser: 'anonymous-smoke-fixture', headless: true, exact_distance_requested: false};
  const qss = (distance, status = 'exact') => ({engine: contract.engine, version: '2.0.1', rubric: 'paper-linear-v1',
    formula: 'max(maxPoints - distance * scale, 0)', edit_count: status === 'exact' && distance ? 1 : 0,
    scale: 1, maxPoints: 5, status, distance: status === 'exact' ? distance : null,
    lowerBound: distance, points: status === 'unsupported' ? null : Math.max(0, 5 - distance),
    exactWithinModel: status === 'exact', scoreCertifiedWithinModel: status !== 'unsupported', edit_cost_sum: status === 'exact' ? distance : 0});
  const sources = [1, 2, 3].map(value => ({key: 'anonymous:' + value, metadata: {SEQUENCE_B: 'SELECT ' + value,
    SEQUENCE_C: '', OUTPUT_RELATION: JSON.stringify({columns: ['value'], values: [[value]]}),
    SOLUTION_METRICS: JSON.stringify([{type: 'result_lines', points: 5, value: '1'}])}}));
  fs.writeFileSync(path.join(corpus, 'manifest.json'), JSON.stringify({questions: 3}));
  fs.writeFileSync(path.join(corpus, 'questions.jsonl'), sources.map(JSON.stringify).join('\n') + '\n');
  const records = sources.map(source => {
    const sql = source.metadata.SEQUENCE_B, candidate = mutations.errorCandidates(sql)[0];
    return {key: source.key, maximum_points: 5, executions: 3, invalid_candidates_executed: 0,
      reference_error: null, source_result_exact: true, format_token_proof: mutations.formattingTokenProof(sql, mutations.equivalentFormatting(sql)),
      formatting_equal: true, cases: [
        {name: 'self', answer_sha256: hash(sql), visible_result_sha256: hash(source.metadata.OUTPUT_RELATION), legacy: {points: 5}, qss: qss(0)},
        {name: 'formatting', answer_sha256: hash(mutations.equivalentFormatting(sql)), visible_result_sha256: hash(source.metadata.OUTPUT_RELATION), legacy: {points: 5}, qss: qss(0)},
        {name: 'targeted_error', answer_sha256: hash(candidate.answer), visible_result_sha256: hash('wrong:' + source.key),
          legacy: {points: 5}, qss: qss(1), mutation: candidate.kind, sqlite_error: null, changed_visible_result: true}
      ]};
  });
  const semantic = mutations.semanticControls.map(control => ({name: control.name, sqlite_equivalent: true, qss: qss(0)}));
  const grading = mutations.gradingControls.map(control => ({name: control.name, expectation: control.expectation,
    sqlite_equivalent: false, sqlite_reference_error: null,
    sqlite_answer_error: control.expectation === 'unresolved' ? 'synthetic unrepresentable input' : null,
    qss: qss(control.expectation === 'zero' ? 5 : 1, control.expectation === 'unresolved' ? 'unsupported'
      : control.expectation === 'zero' ? 'score-zero-certified' : 'exact')}));
  const server = http.createServer((request, response) => {response.setHeader('Content-Type', 'application/javascript'); response.end(worker);});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const checks = [];
  async function exercise(name, change, expectedFailure) {
    const folder = path.join(temp, name); fs.mkdirSync(folder);
    const prefix = path.join(folder, 'prefix'), range = path.join(folder, 'range'), output = path.join(folder, 'merged');
    fs.mkdirSync(prefix); fs.mkdirSync(range);
    const first = JSON.parse(JSON.stringify(records));
    const second = JSON.parse(JSON.stringify(records.slice(1))).map((row, index) => ({...row, original_ordinal: index + 2}));
    first[1].cases[2].qss.runtimeMs = 5; second[0].cases[2].qss.runtimeMs = 500;
    first[1].setup_sql_ms = 2; second[0].setup_sql_ms = 2000;
    first[1].cases[2].qss_wall_ms = 3; second[0].cases[2].qss_wall_ms = 3000;
    const firstReport = {...contract, questions: 3, failures: [], semantic_control_gaps: []};
    const secondReport = {...contract, questions: 2, source_start: 1, expected_run_questions: 2,
      completed: true, run_status: 'complete', worker_unchanged: true, failures: [], semantic_control_gaps: [],
      semantic_controls: semantic, grading_controls: grading};
    const replacements = [];
    change?.({first, second, firstReport, secondReport, replacements, prefix, range});
    const manifest = path.join(folder, 'superseded.json'); fs.writeFileSync(manifest, JSON.stringify(replacements));
    fs.writeFileSync(path.join(prefix, 'corpus-report.json'), JSON.stringify(firstReport));
    fs.writeFileSync(path.join(prefix, 'corpus-results.jsonl'), first.map(JSON.stringify).join('\n') + '\n');
    fs.writeFileSync(path.join(range, 'corpus-report.json'), JSON.stringify(secondReport));
    fs.writeFileSync(path.join(range, 'corpus-results.jsonl'), second.map(JSON.stringify).join('\n') + '\n');
    const originals = [prefix, range].flatMap(directory => ['corpus-report.json', 'corpus-results.jsonl'].map(file => ({file: path.join(directory, file), hash: hash(fs.readFileSync(path.join(directory, file)))})));
    const result = await new Promise(resolve => {
      const process = spawn(global.process.execPath, [__filename, prefix, range], {env: {...global.process.env,
        ILIAS_CORPUS_DIRECTORY: corpus, ILIAS_TEST_URL: base, QSS_MERGE_OUTPUT_DIRECTORY: output,
        QSS_MERGE_ALLOW_LIVE_PREFIX: '1', QSS_MERGE_ALLOW_PARTIAL_RANGES: '1',
        QSS_MERGE_PREFIX_LIMIT: '2', QSS_MERGE_SUPERSEDED_MANIFEST: manifest}});
      let text = ''; process.stdout.on('data', data => {text += data;}); process.stderr.on('data', data => {text += data;});
      process.on('close', code => resolve({code, text}));
    });
    for (const original of originals) assert.equal(hash(fs.readFileSync(original.file)), original.hash, 'A merge attempt must not change raw input evidence.');
    if (expectedFailure) {
      assert.notEqual(result.code, 0, name + ' must be rejected');
      assert.match(result.text, expectedFailure, name + ' must fail for the intended gate');
    } else {
      assert.equal(result.code, 0, result.text);
      const merged = JSON.parse(fs.readFileSync(path.join(output, 'corpus-report.json')));
      assert.equal(merged.questions, 3); assert.equal(merged.merge_provenance.identical_overlaps.length, replacements.length ? 0 : 1);
      assert.equal(merged.merge_provenance.explicit_generator_replacements.length, replacements.length);
      assert.equal(merged.merge_provenance.parts[0].original_report_completed, null);
      assert.equal(merged.merge_provenance.parts[0].selected_records, 2);
      assert.equal(merged.merge_provenance.parts[0].ignored_reported_records_due_to_prefix_limit, 1);
      assert.deepEqual(merged.merge_provenance.controls_counted_once, {semantic: mutations.semanticControls.length, grading: mutations.gradingControls.length});
    }
    checks.push({name, outcome: expectedFailure ? 'rejected-as-required' : 'accepted-synthetic-merge'});
  }
  const declareReplacement = state => {
    state.replacements.push({partdirectory: state.prefix, original_ordinal: 2, replacement_directory: state.range,
      reason: 'Anonymous generator-only syntax repair, not a score override.'});
  };
  const corruptGeneratedTarget = state => {
    const wrong = state.first[1].cases[2];
    wrong.answer_sha256 = hash('anonymous malformed generated expression');
    wrong.sqlite_error = 'near alias: synthetic syntax error'; wrong.sqlite_error_phase = 'B';
    Object.assign(wrong.qss, {status: 'unsupported', distance: null, points: null, exactWithinModel: false, scoreCertifiedWithinModel: false});
  };
  try {
    await exercise('valid-prefix-overlap-timing-difference', null, null);
    await exercise('missing-source-key', state => {state.second.pop(); state.secondReport.questions = 1; state.secondReport.expected_run_questions = 1;}, /Exactly every original source question/);
    await exercise('wrong-worker-hash', state => {state.secondReport.worker_sha256 = '0'.repeat(64);}, /identical worker hash/);
    await exercise('conflicting-overlap-result-hash', state => {state.second[0].cases[2].visible_result_sha256 = 'f'.repeat(64);}, /Overlapping source observations disagree/);
    await exercise('unsupported-with-points', state => {Object.assign(state.second[1].cases[2].qss, {status: 'unsupported', distance: null, points: 0});}, /0 !== null/);
    await exercise('unresolved-corpus-target', state => {Object.assign(state.second[1].cases[2].qss, {status: 'unsupported', distance: null, points: null});
      state.second[1].cases[2].sqlite_error = 'synthetic syntax error'; state.second[1].cases[2].sqlite_error_phase = 'B';}, /Every selected corpus target needs a certified score/);
    await exercise('zero-certificate-with-points', state => {Object.assign(state.second[1].cases[2].qss, {status: 'score-zero-certified', distance: null, lowerBound: 5, points: 1});}, /1 !== 0/);
    await exercise('zero-certificate-without-bound', state => {Object.assign(state.second[1].cases[2].qss,
      {status: 'score-zero-certified', distance: null, lowerBound: 0, points: 0, exactWithinModel: false, edit_count: 0, edit_cost_sum: 0});}, /lowerBound/);
    await exercise('duplicate-within-part', state => {state.second[1] = JSON.parse(JSON.stringify(state.second[0]));}, /Duplicate source key within/);
    await exercise('foreign-source-key', state => {state.second[1].key = 'anonymous:foreign';}, /Foreign source key/);
    await exercise('unfinished-controls-not-counted', state => {state.secondReport.completed = false;
      state.secondReport.worker_unchanged = null; state.secondReport.run_status = 'controls';}, /One complete independently validated semantic\/grading control set/);
    await exercise('explicit-generator-only-replacement', state => {corruptGeneratedTarget(state); declareReplacement(state);}, null);
    await exercise('replacement-cannot-discard-valid-grade', state => {declareReplacement(state);}, /Only an unsupported generator-syntax failure/);
    await exercise('replacement-cannot-change-formatting-result', state => {corruptGeneratedTarget(state); declareReplacement(state);
      state.second[0].cases[1].visible_result_sha256 = 'f'.repeat(64);}, /preserve the self\/formatting\/reference/);
    await exercise('replacement-cannot-repeat-generator-syntax-error', state => {corruptGeneratedTarget(state); declareReplacement(state);
      state.second[0].cases[2].sqlite_error = 'another synthetic syntax error'; state.second[0].cases[2].sqlite_error_phase = 'B';}, /must not introduce another SQL-B syntax failure/);
    console.log(JSON.stringify({purpose: 'Anonymous acceptance-gate tests only; fabricated observations are not scoring/Chrome proof.', checks, private_smoke_directory: temp}, null, 2));
  } finally { await new Promise(resolve => server.close(resolve)); }
}
module.exports = {stable, fachlich, equivalentOverlap, validateQss, validateControls, validateRow, readSnapshot, accumulate, baseReport};
if (require.main === module) (process.argv.includes('--self-test') ? selfTest() : main()).catch(error => {console.error(error); process.exitCode = 1;});
