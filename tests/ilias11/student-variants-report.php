<?php

declare(strict_types=1);

/** Read-only audit of the official scorer against private native Chrome records.
 * SQL and QSS are never executed here. No submissions or grades are modified.
 */
require __DIR__ . '/bootstrap.php';

$filename = realpath($argv[1] ?? '');
if ($filename === false) throw new InvalidArgumentException('Usage: student-variants-report.php PRIVATE_CASES_JSONL');
$file = fopen($filename, 'r');
$method = new ReflectionMethod(assSQLQuestion::class, 'calculateReachedPointsForSolution');
$report = ['cases' => 0, 'questions' => 0, 'unchanged_with_qss' => 0,
    'legacy_points_match' => 0, 'cases_sha256' => hash_file('sha256', $filename), 'failures' => []];
$questions = [];
while (($line = fgets($file)) !== false) {
    $row = json_decode($line, true, flags: JSON_THROW_ON_ERROR);
    $id = (int) $row['question_id'];
    $question = $questions[$id] ??= assQuestion::instantiateQuestion($id);
    if (!$question instanceof assSQLQuestion) throw new RuntimeException('Expected a native SQL question.');
    $result = $row['result'];
    $metrics = [];
    foreach ($result['legacy_metrics'] as $type => $value) $metrics[] = json_encode(['type' => $type, 'value' => $value], JSON_THROW_ON_ERROR);
    $input = ['sequence' => $row['answer'], 'error_bool' => $result['error'] === null ? 'false' : 'true',
        'error' => $result['error'] === null ? '' : json_encode($result['error'], JSON_THROW_ON_ERROR),
        'executed_bool' => $result['executed'], 'output_relation' => '', 'participant_metrics' => $metrics];
    $official = $method->invoke($question, ['value1' => json_encode($input, JSON_THROW_ON_ERROR)]);
    $input['qss_evaluation'] = $result['qss'];
    $withQss = $method->invoke($question, ['value1' => json_encode($input, JSON_THROW_ON_ERROR)]);
    ++$report['cases'];
    if ($official === $withQss) ++$report['unchanged_with_qss'];
    else $report['failures'][] = ['ordinal' => $row['ordinal'], 'name' => $row['name'], 'kind' => 'qss_changed_official_score'];
    if (abs($official - (float) $result['legacy_points']) < 1e-8) ++$report['legacy_points_match'];
    else $report['failures'][] = ['ordinal' => $row['ordinal'], 'name' => $row['name'], 'kind' => 'official_score_mismatch'];
}
fclose($file);
$report['questions'] = count($questions);
echo 'STUDENT_VARIANTS_REPORT_JSON=' . json_encode($report, JSON_THROW_ON_ERROR) . "\n";
exit($report['failures'] === [] && $report['cases'] > 0 ? 0 : 1);
