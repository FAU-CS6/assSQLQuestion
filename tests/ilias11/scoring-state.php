<?php

declare(strict_types=1);

/** Read-only proof around native UI result recalculation; never submits answers or scores. */
require __DIR__ . '/bootstrap.php';

$testRef = (int) ($argv[1] ?? 0);
$activeId = (int) ($argv[2] ?? 0);
$pass = (int) ($argv[3] ?? 0);
if ($testRef <= 0 || $activeId <= 0 || $pass < 0) {
    throw new InvalidArgumentException('Usage: scoring-state.php TEST_REF ACTIVE_ID PASS');
}
$test = new ilObjTest($testRef);
$db = $DIC->database();
$active = $db->fetchAssoc($db->queryF('SELECT * FROM tst_active WHERE active_id = %s AND test_fi = %s', ['integer', 'integer'], [$activeId, $test->getTestId()]));
if (!$active) throw new RuntimeException('The active participant does not belong to this test.');

$answers = [];
$rows = $db->queryF('SELECT * FROM tst_solutions WHERE active_fi = %s AND pass = %s ORDER BY question_fi, solution_id', ['integer', 'integer'], [$activeId, $pass]);
while ($row = $db->fetchAssoc($rows)) $answers[] = $row;
$manual = [];
$points = [];
$overflows = [];
$rows = $db->queryF('SELECT r.question_fi, r.points, r.manual, q.points AS maximum_points FROM tst_test_result r JOIN qpl_questions q ON q.question_id = r.question_fi WHERE r.active_fi = %s AND r.pass = %s ORDER BY r.question_fi', ['integer', 'integer'], [$activeId, $pass]);
while ($row = $db->fetchAssoc($rows)) {
    $id = (int) $row['question_fi'];
    $manual[$id] = (int) $row['manual'];
    $points[$id] = (float) $row['points'];
    if ((float) $row['points'] > (float) $row['maximum_points']) $overflows[$id] = ['points' => (float) $row['points'], 'maximum_points' => (float) $row['maximum_points']];
}
$feedback = [];
$feedbackRows = 0;
$rows = $db->queryF('SELECT question_fi, feedback, finalized_evaluation FROM tst_manual_fb WHERE active_fi = %s AND pass = %s ORDER BY question_fi', ['integer', 'integer'], [$activeId, $pass]);
while ($row = $db->fetchAssoc($rows)) {
    $feedbackRows++;
    // Missing and empty, unfinalized feedback have the same visible meaning.
    if (($row['feedback'] ?? '') !== '' || (int) $row['finalized_evaluation'] !== 0) {
        $feedback[(int) $row['question_fi']] = ['text' => $row['feedback'] ?? '', 'finalized' => (int) $row['finalized_evaluation']];
    }
}
$marks = array_map(static fn($mark): array => ['short' => $mark->getShortName(), 'official' => $mark->getOfficialName(), 'minimum' => $mark->getMinimumLevel(), 'passed' => $mark->getPassed()], $test->getMarkSchema()->getMarkSteps());
$settings = $db->fetchAssoc($db->queryF('SELECT s.* FROM tst_test_settings s JOIN tst_tests t ON t.settings_id = s.id WHERE t.test_id = %s', ['integer'], [$test->getTestId()]));
$passResult = $db->fetchAssoc($db->queryF('SELECT * FROM tst_pass_result WHERE active_fi = %s AND pass = %s', ['integer', 'integer'], [$activeId, $pass]));
$report = ['test_ref_id' => $testRef, 'test_id' => $test->getTestId(), 'active_id' => $activeId, 'pass' => $pass,
    'answer_rows' => count($answers), 'raw_answers_sha256' => hash('sha256', json_encode($answers, JSON_THROW_ON_ERROR)),
    'graded_questions' => count($points), 'manual_flags' => $manual, 'manual_overrides' => array_sum($manual),
    'points' => $points, 'points_sum' => array_sum($points), 'overflows' => $overflows,
    'feedback_content_sha256' => hash('sha256', json_encode($feedback, JSON_THROW_ON_ERROR)), 'feedback_rows' => $feedbackRows,
    'mark_schema' => $marks, 'score_settings_sha256' => hash('sha256', json_encode($settings, JSON_THROW_ON_ERROR)), 'pass_result' => $passResult];
echo 'SCORING_STATE_JSON=' . json_encode($report, JSON_THROW_ON_ERROR) . "\n";
