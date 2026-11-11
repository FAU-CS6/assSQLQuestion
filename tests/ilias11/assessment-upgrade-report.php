<?php

declare(strict_types=1);

/** Read-only fingerprints across the additive assessment-mode migration. */
require __DIR__ . '/bootstrap.php';
$phase = $argv[1] ?? '';
$file = $argv[2] ?? '';
if (!in_array($phase, ['before', 'after'], true) || $file === '') {
    throw new InvalidArgumentException('Usage: assessment-upgrade-report.php before|after PRIVATE_SNAPSHOT');
}
$db = $DIC->database();
$queries = [
    'questions' => 'SELECT * FROM il_qpl_qst_qpisql_qd ORDER BY question_fi',
    'metrics' => 'SELECT * FROM il_qpl_qst_qpisql_qsm ORDER BY question_fi, type',
    'maximums' => 'SELECT q.question_id, q.points FROM qpl_questions q JOIN il_qpl_qst_qpisql_qd d ON d.question_fi=q.question_id ORDER BY q.question_id',
    'answers' => 'SELECT s.* FROM tst_solutions s JOIN il_qpl_qst_qpisql_qd d ON d.question_fi=s.question_fi ORDER BY s.solution_id',
    'grades' => 'SELECT r.* FROM tst_test_result r JOIN il_qpl_qst_qpisql_qd d ON d.question_fi=r.question_fi ORDER BY r.active_fi, r.pass, r.question_fi'
];
$keys = ['questions' => ['question_fi'], 'metrics' => ['question_fi', 'type'], 'maximums' => ['q.question_id'],
    'answers' => ['s.solution_id'], 'grades' => ['r.active_fi', 'r.pass', 'r.question_fi']];
$report = [];
foreach ($queries as $key => $sql) {
    $hash = hash_init('sha256'); $count = 0;
    // ilDB buffers SELECT results. Page large SQL/output payloads rather than
    // materializing all historical corpus copies in PHP memory at once.
    $cursor = null;
    do {
      $query = $sql;
      if ($cursor !== null) {
          $equal = []; $greater = [];
          foreach ($keys[$key] as $field) {
              $parts = explode('.', $field); $value = $cursor[end($parts)];
              $quoted = $db->quote($value, $field === 'type' ? 'text' : 'integer');
              $greater[] = '(' . implode(' AND ', [...$equal, $field . ' > ' . $quoted]) . ')';
              $equal[] = $field . ' = ' . $quoted;
          }
          $query = str_replace(' ORDER BY ', ' WHERE (' . implode(' OR ', $greater) . ') ORDER BY ', $query);
      }
      $rows = $db->query($query . ' LIMIT 20');
      $pageCount = 0;
      while ($row = $db->fetchAssoc($rows)) {
        $cursor = $row;
        if ($key === 'questions') {
            if ($phase === 'after' && ($row['assessment_mode'] ?? null) !== 'result') {
                throw new RuntimeException('An existing question changed assessment mode.');
            }
            unset($row['assessment_mode'], $row['qss_maximum_points'], $row['qss_costs']);
        }
        ksort($row); hash_update($hash, json_encode($row, JSON_THROW_ON_ERROR) . "\n"); $count++; $pageCount++;
      }
    } while ($pageCount === 20);
    $report[$key] = ['rows' => $count, 'sha256' => hash_final($hash)];
    fwrite(STDERR, 'Fingerprinted ' . $key . ': ' . $count . " rows\n");
}
if ($phase === 'before') {
    file_put_contents($file, json_encode($report, JSON_THROW_ON_ERROR), LOCK_EX); chmod($file, 0600);
} else {
    if ($report !== json_decode(file_get_contents($file), true, flags: JSON_THROW_ON_ERROR)) {
        throw new RuntimeException('Existing question, metric, answer or grade data changed during migration.');
    }
}
echo json_encode(['phase' => $phase, 'unchanged' => true, 'tables' => $report], JSON_THROW_ON_ERROR) . "\n";
