<?php

declare(strict_types=1);

/** Re-read historical final attempts after upgrade; never changes a grade. */
require __DIR__ . '/bootstrap.php';
$directory = rtrim($argv[1] ?? '', '/');
$db = $DIC->database(); $questions = 0; $points = 0.0; $parts = [];
foreach (['student-final-a-', 'student-matrix-b-', 'student-matrix-c-', 'student-matrix-d-'] as $prefix) {
    $state = json_decode(file_get_contents($directory . '/' . $prefix . 'exam-state.json'), true, flags: JSON_THROW_ON_ERROR);
    $active = $db->fetchAssoc($db->queryF('SELECT active_id,last_finished_pass FROM tst_active WHERE test_fi=%s AND user_fi=%s', ['integer','integer'], [$state['test_id'],$state['student_id']]));
    if (!$active || $active['last_finished_pass'] === null) { throw new RuntimeException('Missing completed historical attempt.'); }
    $pass = (int) $active['last_finished_pass']; $activeId = (int) $active['active_id'];
    $grades = [];
    $rows = $db->queryF('SELECT question_fi,points,manual FROM tst_test_result WHERE active_fi=%s AND pass=%s',['integer','integer'],[$activeId,$pass]);
    while ($row = $db->fetchAssoc($rows)) { $grades[(int)$row['question_fi']]=$row; }
    foreach ($state['questions'] as $row) {
        $q = assQuestion::instantiateQuestion($row['question_id']);
        $input = ParticipantInput::fromJSON($q->getSolutionStored($activeId,$pass,true)['value1']);
        $score = $q->calculateReachedPoints($activeId,$pass,true);
        if ($q->getAssessmentMode() !== 'result' || $score !== $q->getMaximumPoints()
            || (float)($grades[$q->getId()]['points'] ?? -1) !== $score || (int)$grades[$q->getId()]['manual'] !== 0
            || $input->getSequence() !== $q->getSequence('sequence_b')) {
            throw new RuntimeException('Historical official grading changed.');
        }
        $points += $score; $questions++;
    }
    $parts[]=['questions'=>count($state['questions']),'pass'=>$pass,'unchanged'=>true];
}
if ($questions !== 699 || $points !== 2259.0) { throw new RuntimeException('Incomplete historical corpus coverage.'); }
echo json_encode(['questions'=>$questions,'official_points'=>$points,'parts'=>$parts,'unchanged'=>true],JSON_THROW_ON_ERROR)."\n";
