<?php

declare(strict_types=1);

use ILIAS\Test\Settings\ScoreReporting\ScoreReportingTypes;

require __DIR__ . '/bootstrap.php';

// Seeds a disposable, online test. Answers and attempts are entered in the
// browser, never by this fixture. The report command only reads their DB state.
$state_file = sys_get_temp_dir() . '/asssql-exam-fixture.json';
if (($argv[1] ?? '') === 'report') {
    $state = json_decode(file_get_contents($state_file), true, flags: JSON_THROW_ON_ERROR);
    $db = $DIC->database();
    $active = $db->fetchAssoc($db->queryF(
        'SELECT * FROM tst_active WHERE test_fi = %s AND user_fi = %s',
        ['integer', 'integer'], [$state['test_id'], $state['user_id']]
    ));
    $result = ['active' => $active, 'passes' => [], 'questions' => [], 'solutions' => []];
    if ($active) {
        foreach (['passes' => 'tst_pass_result', 'questions' => 'tst_test_result', 'solutions' => 'tst_solutions'] as $key => $table) {
            $rows = $db->queryF("SELECT * FROM $table WHERE active_fi = %s ORDER BY pass", ['integer'], [$active['active_id']]);
            while ($row = $db->fetchAssoc($rows)) {
                if ($key === 'solutions' && isset($row['value1'])) {
                    $row['input'] = json_decode($row['value1'], true);
                }
                $result[$key][] = $row;
            }
        }
    }
    echo json_encode($result, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), "\n";
    exit;
}
if (is_file($state_file)) {
    throw new RuntimeException('The exam fixture already exists in this disposable client.');
}

$user = new ilObjUser();
$user->setLogin('sql.chrome.test');
$user->setFirstname('SQL');
$user->setLastname('Chrome Test');
$user->setEmail('sql-chrome-test@example.invalid');
$password = 'Sql-' . bin2hex(random_bytes(10)) . '!';
$user->setPasswd($password);
$user->setLastPasswordChangeToNow();
$user->setAuthMode('default');
$user->setActive(true, $DIC->user()->getId());
$user->setTimeLimitUnlimited(true);
$user->setProfileIncomplete(false);
$user->setPref('language', 'en');
$user->create();
$user->saveAsNew();
$DIC->rbac()->admin()->assignUser(4, $user->getId());

$pool = new ilObjQuestionPool();
$pool->setTitle('SQL Chrome fixture pool');
$pool->create();
$pool->createReference();
$pool->putInTree(1);
$pool->setPermissions(1);

$test = new ilObjTest();
$test->setTitle('SQL Chrome – mehrere Testdurchläufe');
$test->setDescription('Disposable local ILIAS 11 test: SELECT and UPDATE, 10 points per attempt.');
$test->create();
$test->createReference();
$test->putInTree(1);
$test->setPermissions(1);
$test->saveToDb();

$questions = [
    ['SELECT – Namen', '<p>Geben Sie alle Namen aus people aus.</p>',
        "CREATE TABLE people (id INTEGER, name TEXT); INSERT INTO people VALUES (1, 'Ada'), (2, 'Grace');",
        'SELECT name FROM people ORDER BY id;', '', true, 2,
        '{"columns":["name"],"values":[["Ada"],["Grace"]]}'],
    ['UPDATE – Punkte erhöhen', '<p>Erhöhen Sie die Punkte aller Personen um 1. Sequenz C zeigt anschließend die Personen mit mindestens 10 Punkten.</p>',
        "CREATE TABLE scores (name TEXT, points INTEGER); INSERT INTO scores VALUES ('Ada', 9), ('Grace', 5);",
        'UPDATE scores SET points = points + 1;', 'SELECT name FROM scores WHERE points >= 10 ORDER BY name;', false, 1,
        '{"columns":["name"],"values":[["Ada"]]}']
];
$question_ids = [];
foreach ($questions as [$title, $text, $a, $b, $c, $integrity, $rows, $relation]) {
    $question = new assSQLQuestion($title, '', 'SQL Chrome test', $DIC->user()->getId(), $text);
    $question->feedbackOBJ = new ilAssSQLQuestionFeedback($question, $DIC->ctrl(), $DIC->database(), $DIC->language());
    $question->setObjId($pool->getId());
    $question->setSequence('sequence_a', $a);
    $question->setSequence('sequence_b', $b);
    $question->setSequence('sequence_c', $c);
    $question->setIntegrityCheck($integrity);
    $question->setExecutedBool(true);
    $question->setOutputRelation($relation);
    $question->setAllSolutionMetrics([
        new SolutionMetric('column_names', 3, '["name"]'),
        new SolutionMetric('functional_dependencies', 0, '[]'),
        new SolutionMetric('result_lines', 2, (string) $rows)
    ]);
    $question->setPoints(5.0);
    $question->saveToDb();
    $question_ids[] = $test->insertQuestion($question->getId());
}

$main = $test->getMainSettings();
$main = $main
    ->withTestBehaviourSettings($main->getTestBehaviourSettings()->withNumberOfTries(5)->withBlockAfterPassedEnabled(false))
    ->withQuestionBehaviourSettings($main->getQuestionBehaviourSettings()
        ->withAutosaveEnabled(true)->withAutosaveInterval(2000)->withShuffleQuestions(false));
$test->getMainSettingsRepository()->store($main, $test->getTestId());
$score = $test->getScoreSettings();
$score = $score
    ->withResultSummarySettings($score->getResultSummarySettings()->withScoreReporting(ScoreReportingTypes::SCORE_REPORTING_FINISHED))
    ->withResultDetailsSettings($score->getResultDetailsSettings()->withShowPassDetails(true)->withShowSolutionListComparison(true)->withShowSolutionFeedback(true));
$test->getScoreSettingsRepository()->store($score, $test->getTestId());
$test->getObjectProperties()->storePropertyIsOnline($test->getObjectProperties()->getPropertyIsOnline()->withOnline());

$state = ['test_id' => $test->getTestId(), 'test_ref_id' => $test->getRefId(), 'user_id' => $user->getId(),
    'question_ids' => $question_ids, 'login' => $user->getLogin(), 'password' => $password,
    'url' => 'http://localhost:8080/goto.php/tst/' . $test->getRefId()];
file_put_contents($state_file, json_encode($state, JSON_THROW_ON_ERROR));
echo json_encode($state, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), "\n";
