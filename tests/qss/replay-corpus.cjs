/* Read-only gate over original browser observations plus narrow focused oracle proofs.
 * No SQL is executed here, no original result file is rewritten, and private input
 * stays outside version control. The accompanying browser rerun supplies evidence.
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { equivalentFormatting, formattingTokenProof, errorCandidates } = require('./fixture-mutations.cjs');

const directory = path.resolve(process.env.ILIAS_CORPUS_DIRECTORY || '/corpus');
const originalDirectory = path.resolve(process.env.QSS_REPORT_DIRECTORY || 'test-results/qss-paper/final');
// The renewed browser harness performs the narrow catalog/NULL probes in-line.
// A separate focused browser rerun can still be supplied explicitly.
const externalProof = Boolean(process.env.QSS_CATALOG_PROOF_DIRECTORY);
const proofDirectory = externalProof ? path.resolve(process.env.QSS_CATALOG_PROOF_DIRECTORY) : originalDirectory;
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const readRows = file => fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);

async function main() {
  const original = readJSON(path.join(originalDirectory, 'corpus-report.json'));
  const records = readRows(path.join(originalDirectory, 'corpus-results.jsonl'));
  const proof = readJSON(path.join(proofDirectory, 'corpus-report.json'));
  const proofRecords = new Map(readRows(path.join(proofDirectory, 'corpus-results.jsonl')).map(row => [row.key, row]));
  assert.equal(original.engine, 'graph-qss-sqlite-v2');
  assert.ok(Number.isFinite(original.scale) && original.scale > 0);
  assert.equal(original.worker_unchanged, true);
  assert.equal(original.worker_sha256, hash(fs.readFileSync(path.join(__dirname, '../../lib/qss/worker.qss.js'))),
    'Recorded observations use the current production bundle.');
  assert.equal(proof.worker_unchanged, true);
  assert.equal(original.worker_sha256, proof.worker_sha256, 'Focused proof uses the same unchanged production worker.');
  assert.deepEqual(proof.failures, []);
  assert.deepEqual(original.semantic_control_gaps, []);
  const byKey = new Map(records.map(row => [row.key, row]));
  assert.equal(byKey.size, records.length, 'Every observed private question key is unique.');
  const approved = new Map((proof.known_control_representation_differences || []).filter(row => row.verified).map(row => [row.key, row]));
  if (externalProof) assert.equal(approved.get('anonymous:null-default-catalog')?.verified, true, 'The anonymous SQLite catalog regression passed.');
  const accepted = { accepted: false, worker_sha256: original.worker_sha256, worker_unchanged: true,
    original_observations_sha256: hash(fs.readFileSync(path.join(originalDirectory, 'corpus-results.jsonl'))),
    focused_proof_sha256: hash(fs.readFileSync(path.join(proofDirectory, 'corpus-results.jsonl'))),
    proof_mode: externalProof ? 'separate-browser-catalog-rerun' : 'inline-browser-catalog-and-NULL-probes',
    engine: original.engine, version: '2.0.1', rubric: 'paper-linear-v1', scale: original.scale,
    questions: 0, self_full_points: 0, formatting_full_points: 0, safe_formatting_neutral: 0,
    exact_raw_format_result_hashes_equal: 0, case_normalized_bag_format_equal: 0, caption_case_or_unordered_row_differences: 0,
    control_query_representation_differences: [], successful_adverse_answers: 0, execution_or_result_errors_graded: 0, execution_or_result_errors_ungraded: 0,
    execution_or_result_error_statuses: {},
    original_model_identity: original.original_identity_coverage, maximum_points: 0, self_points: 0,
    original_raw_observations_preserved: true, original_failures_retained_in_original_report: original.failures };
  const seen = new Set();
  const input = readline.createInterface({ input: fs.createReadStream(path.join(directory, 'questions.jsonl')), crlfDelay: Infinity });
  for await (const line of input) {
    const source = JSON.parse(line), row = byKey.get(source.key), m = source.metadata;
    assert.ok(row, 'Missing original Chrome observation for ' + source.key);
    assert.equal(seen.has(source.key), false); seen.add(source.key);
    const cases = Object.fromEntries(row.cases.map(value => [value.name, value]));
    assert.equal(row.cases.length, 3);
    assert.equal(cases.self.answer_sha256, hash(m.SEQUENCE_B));
    const formatted = equivalentFormatting(m.SEQUENCE_B);
    assert.equal(cases.formatting.answer_sha256, hash(formatted));
    assert.equal(formattingTokenProof(m.SEQUENCE_B, formatted).safe, true);
    for (const current of row.cases) {
      const qss = current.qss;
      assert.equal(qss.engine, original.engine);
      assert.equal(qss.version, '2.0.1');
      if (qss.status === 'exact') {
        assert.equal(qss.rubric, 'paper-linear-v1');
        assert.equal(qss.scale, original.scale);
        assert.ok(Number.isFinite(qss.distance) && qss.distance >= 0);
        assert.equal(qss.exactWithinModel, true);
        assert.equal(qss.edit_cost_sum, qss.distance);
        const expected = Math.round((Math.max(0, row.maximum_points - qss.distance * original.scale) + Number.EPSILON) * 10000) / 10000;
        assert.equal(qss.points, expected);
      } else if (qss.status === 'score-zero-certified') {
        assert.equal(qss.rubric, 'paper-linear-v1'); assert.equal(qss.scale, original.scale);
        assert.equal(qss.points, 0); assert.equal(qss.distance, null);
        assert.ok(qss.lowerBound >= row.maximum_points / original.scale);
        assert.equal(qss.scoreCertifiedWithinModel, true);
      } else {
        assert.ok(['unsupported', 'error', 'cancelled'].includes(qss.status));
        assert.equal(qss.points, null);
      }
    }
    for (const current of [cases.self, cases.formatting]) {
      assert.equal(current.qss.engine, original.engine);
      assert.equal(current.qss.status, 'exact');
      assert.equal(current.qss.distance, 0);
      assert.equal(current.qss.points, row.maximum_points);
    }
    assert.equal(row.source_result_exact, true);
    accepted.questions++; accepted.self_full_points++; accepted.formatting_full_points++;
    accepted.maximum_points += row.maximum_points; accepted.self_points += cases.self.qss.points;
    const rawEqual = cases.self.visible_result_sha256 === cases.formatting.visible_result_sha256;
    if (rawEqual) accepted.exact_raw_format_result_hashes_equal++;
    if (row.formatting_equal) {
      accepted.case_normalized_bag_format_equal++;
      if (!rawEqual) accepted.caption_case_or_unordered_row_differences++;
    } else {
      const oracle = approved.get(source.key), rerun = proofRecords.get(source.key);
      assert.ok(oracle?.verified && rerun?.formatting_oracle?.verified, 'Unknown formatting difference remains a hard failure: ' + source.key);
      assert.equal(oracle.original_control_sha256, hash(m.SEQUENCE_C));
      assert.equal(oracle.literal_NULL_and_null_have_same_SQL_value, true);
      assert.equal(oracle.normalized_control_matches_original_reference, true);
      assert.equal(oracle.all_other_table_info_fields_exact, true);
      assert.deepEqual(oracle.default_type_probe, [['null', 'null', 1]]);
      assert.ok(oracle.table_info_differences.length > 0);
      assert.ok(oracle.table_info_differences.every(value => value.field === 'dflt_value' && value.before === 'NULL' && value.after === 'null'));
      for (const name of ['self', 'formatting']) {
        const focused = rerun.cases.find(value => value.name === name);
        assert.equal(focused.answer_sha256, cases[name].answer_sha256);
        assert.equal(focused.visible_result_sha256, cases[name].visible_result_sha256);
        assert.equal(focused.qss.distance, 0); assert.equal(focused.qss.points, row.maximum_points);
      }
      accepted.control_query_representation_differences.push({ key: source.key, kind: oracle.kind,
        field: 'pragma_table_info.dflt_value', before: 'NULL', after: 'null', SQL_value: null,
        legacy_reference_points: cases.self.legacy.points, legacy_formatted_points: cases.formatting.legacy.points,
        qss_formatted_points: cases.formatting.qss.points, maximum_points: row.maximum_points });
    }
    accepted.safe_formatting_neutral++;
    const wrong = cases.targeted_error;
    assert.ok(errorCandidates(m.SEQUENCE_B).some(candidate => hash(candidate.answer) === wrong.answer_sha256), 'The recorded mutation remains reproducible.');
    if (wrong.sqlite_error) {
      // Faulty B and failed C are distinct from AST representability. Static
      // graph QSS may still return an edit path/score; SQL errors are retained
      // as observations and are never converted into a grading oracle.
      const phase = wrong.sqlite_error_phase;
      accepted.execution_or_result_error_statuses[phase] = (accepted.execution_or_result_error_statuses[phase] || 0) + 1;
      if (Number.isFinite(wrong.qss.points)) accepted.execution_or_result_errors_graded++;
      else accepted.execution_or_result_errors_ungraded++;
    } else {
      assert.equal(wrong.changed_visible_result, true);
      assert.ok(['exact', 'score-zero-certified'].includes(wrong.qss.status));
      assert.ok(Number.isFinite(wrong.qss.points) && wrong.qss.points < row.maximum_points);
      accepted.successful_adverse_answers++;
    }
  }
  assert.equal(accepted.questions, readJSON(path.join(directory, 'manifest.json')).questions);
  assert.equal(accepted.questions, records.length);
  const knownKeys = new Set(accepted.control_query_representation_differences.map(value => value.key));
  assert.ok(original.failures.every(value => value.kind === 'formatting_changed_SQL_result' && knownKeys.has(value.key)), 'All unknown original failures remain fatal.');
  accepted.accepted = true;
  accepted.note = 'This validates the recorded paper-style SQL edit graph, its declared fixed edit costs and linear scoring formula, not universal SQL equivalence or human grading calibration. Raw output differences and legacy scores are retained without alteration.';
  fs.writeFileSync(path.join(originalDirectory, 'acceptance-report.json'), JSON.stringify(accepted, null, 2) + '\n');
  console.log(JSON.stringify(accepted, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
