<?php

declare(strict_types=1);

/** Read-only acceptance proof for browser-submitted shadow evaluations. */
require __DIR__ . '/bootstrap.php';

$testId = (int) ($argv[1] ?? 0);
$studentId = (int) ($argv[2] ?? 0);
$expected = (int) ($argv[3] ?? 0);
if ($testId <= 0 || $studentId <= 0 || $expected <= 0) {
    throw new InvalidArgumentException('Usage: qss-report.php TEST_ID STUDENT_ID EXPECTED_MODEL_ANSWERS [TEST_REF_FOR_RESULTS_URL]');
}
$db = $DIC->database();
$active = $db->fetchAssoc($db->queryF(
    'SELECT active_id, last_finished_pass FROM tst_active WHERE test_fi = %s AND user_fi = %s',
    ['integer', 'integer'], [$testId, $studentId]
));
if (!$active || $active['last_finished_pass'] === null) {
    throw new RuntimeException('No completed student attempt.');
}
$activeId = (int) $active['active_id'];
$pass = (int) $active['last_finished_pass'];
$storedGrades = [];
$gradeRows = $db->queryF('SELECT question_fi, points, manual FROM tst_test_result WHERE active_fi = %s AND pass = %s',
    ['integer', 'integer'], [$activeId, $pass]);
while ($grade = $db->fetchAssoc($gradeRows)) $storedGrades[(int) $grade['question_fi']] = $grade;
$rows = $db->queryF('SELECT question_fi, value1 FROM tst_solutions WHERE active_fi = %s AND pass = %s AND authorized = %s ORDER BY question_fi',
    ['integer', 'integer', 'integer'], [$activeId, $pass, 1]);
$report = ['test_id' => $testId, 'student_id' => $studentId, 'active_id' => $activeId, 'pass' => $pass,
    'student_is_system_admin' => $DIC->rbac()->review()->isAssigned($studentId, SYSTEM_ROLE_ID),
    'expected' => $expected, 'authorized_answers' => 0, 'qss_saved' => 0, 'qss_exact_self' => 0,
    'stored_grade_rows' => count($storedGrades), 'manual_overrides' => 0,
    'legacy_points' => 0.0, 'maximum_points' => 0.0, 'failures' => []];
$digest = hash_init('sha256');
while ($row = $db->fetchAssoc($rows)) {
    $id = (int) $row['question_fi'];
    ++$report['authorized_answers'];
    $answer = ParticipantInput::fromJSON((string) $row['value1']);
    $question = assQuestion::instantiateQuestion($id);
    if (!$question instanceof assSQLQuestion) throw new RuntimeException('Expected SQL questions only.');
    $evaluation = $answer->getQssEvaluation();
    hash_update($digest, $id . ':' . strlen($row['value1']) . ':' . $row['value1']);
    $normal = static fn(string $sql): string => str_replace(["\r\n", "\r"], "\n", $sql);
    if ($normal($answer->getSequence()) !== $normal($question->getSequence('sequence_b'))) {
        $report['failures'][] = ['question' => $id, 'kind' => 'submitted_answer_is_not_model'];
    }
    if ($evaluation !== null) ++$report['qss_saved'];
    if ($evaluation === null || ($evaluation['status'] ?? '') !== 'exact'
        || ($evaluation['engine'] ?? '') !== JsBlock::QSS_ENGINE
        || ($evaluation['version'] ?? '') !== JsBlock::QSS_ENGINE_VERSION
        || ($evaluation['rubric'] ?? '') !== JsBlock::QSS_RUBRIC
        || ($evaluation['scale'] ?? null) !== JsBlock::QSS_SCALE
        || !isset($evaluation['distance']) || (float) $evaluation['distance'] !== 0.0
        || ($evaluation['points'] ?? null) != $question->getMaximumPoints()) {
        $report['failures'][] = ['question' => $id, 'kind' => 'missing_or_incorrect_parallel_evaluation'];
    } else ++$report['qss_exact_self'];
    if (($evaluation['answerDigest'] ?? '') !== hash('sha256', $normal($answer->getSequence()))
        || ($evaluation['referenceRevision'] ?? '') !== JsBlock::getQssReferenceRevision($question)) {
        $report['failures'][] = ['question' => $id, 'kind' => 'evaluation_revision_mismatch'];
    }
    $points = $question->calculateReachedPoints($activeId, $pass, true);
    if (!isset($storedGrades[$id]) || (float) $storedGrades[$id]['points'] !== $points) {
        $report['failures'][] = ['question' => $id, 'kind' => 'stored_question_grade_mismatch'];
    }
    if ((int) ($storedGrades[$id]['manual'] ?? 0) !== 0) {
        ++$report['manual_overrides'];
        $report['failures'][] = ['question' => $id, 'kind' => 'unexpected_manual_grade'];
    }
    $report['legacy_points'] += $points;
    $report['maximum_points'] += $question->getMaximumPoints();
    if ($points !== $question->getMaximumPoints()) $report['failures'][] = ['question' => $id, 'kind' => 'legacy_model_score_regression'];
}
$report['authorized_answers_sha256'] = hash_final($digest);
$result = $db->fetchAssoc($db->queryF('SELECT points, answeredquestions, questioncount, finalized_by FROM tst_pass_result WHERE active_fi = %s AND pass = %s',
    ['integer', 'integer'], [$activeId, $pass]));
$report['native_attempt'] = $result;
$testRef = (int) ($argv[4] ?? 0);
if ($testRef > 0) {
    $ctrl = $DIC->ctrl();
    $ctrl->setParameterByClass(ilObjTestGUI::class, 'ref_id', $testRef);
    $ctrl->setParameterByClass(ilTestEvaluationGUI::class, 'active_id', $activeId);
    $ctrl->setParameterByClass(ilTestEvaluationGUI::class, 'pass', $pass);
    $report['native_attempt_details_url'] = $ctrl->getLinkTargetByClass([
        ilRepositoryGUI::class, ilObjTestGUI::class, ilTestResultsGUI::class,
        ilMyTestResultsGUI::class, ilTestEvaluationGUI::class,
    ], 'outUserPassDetails');
}
if ($report['authorized_answers'] !== $expected || $report['qss_saved'] !== $expected || count($storedGrades) !== $expected) $report['failures'][] = ['kind' => 'incomplete_answers'];
if (!$result || (float) $result['points'] !== $report['legacy_points']
    || (int) $result['answeredquestions'] !== $expected || (int) $result['questioncount'] !== $expected
    || $result['finalized_by'] !== 'finished_by_participant') $report['failures'][] = ['kind' => 'native_attempt_mismatch'];
echo 'QSS_REPORT_JSON=' . json_encode($report, JSON_THROW_ON_ERROR) . "\n";
exit($report['failures'] === [] ? 0 : 1);
