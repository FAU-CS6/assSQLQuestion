<?php

declare(strict_types=1);

require __DIR__ . '/bootstrap.php';

$state_file = sys_get_temp_dir() . '/asssql-browser-fixture.json';
if (($argv[1] ?? '') === 'delete') {
    $state = json_decode(file_get_contents($state_file), true, flags: JSON_THROW_ON_ERROR);
    $question = assQuestion::instantiateQuestion($state['question_id']);
    $question->delete($question->getId());
    (new ilObjQuestionPool($state['pool_ref_id']))->delete();
    unlink($state_file);
    exit;
}
if (is_file($state_file)) {
    throw new RuntimeException('Delete the previous browser fixture before creating another one.');
}

$pool = new ilObjQuestionPool();
$pool->setTitle('SQL ILIAS 11 browser test');
$pool->create();
$pool->createReference();
$pool->putInTree(1);
$pool->setPermissions(1);

$question = new assSQLQuestion('SQL browser test', '', 'Plugin test', $DIC->user()->getId(), '<p>Select the names.</p>');
$question->feedbackOBJ = new ilAssSQLQuestionFeedback($question, $DIC->ctrl(), $DIC->database(), $DIC->language());
$question->setObjId($pool->getId());
$question->setSequence('sequence_a', "CREATE TABLE people (id INTEGER, name TEXT); INSERT INTO people VALUES (1, 'Ada'), (2, 'Grace');");
$question->setSequence('sequence_b', 'SELECT name FROM people ORDER BY id;');
$question->setExecutedBool(true);
$question->setOutputRelation('{"columns":["name"],"values":[["Ada"],["Grace"]]}');
$question->setAllSolutionMetrics([
    new SolutionMetric('column_names', 3, '["name"]'),
    new SolutionMetric('functional_dependencies', 0, '[]'),
    new SolutionMetric('result_lines', 2, '2')
]);
$question->setPoints(5.0);
$question->saveToDb();

$ctrl = $DIC->ctrl();
$ctrl->setParameterByClass(ilObjQuestionPoolGUI::class, 'ref_id', $pool->getRefId());
$ctrl->setParameterByClass(assSQLQuestionGUI::class, 'q_id', $question->getId());
$url = $ctrl->getLinkTargetByClass([ilRepositoryGUI::class, ilObjQuestionPoolGUI::class, assSQLQuestionGUI::class], 'editQuestion');
$ctrl->setParameterByClass(ilAssQuestionPreviewGUI::class, 'q_id', $question->getId());
$preview_url = $ctrl->getLinkTargetByClass([ilRepositoryGUI::class, ilObjQuestionPoolGUI::class, ilAssQuestionPreviewGUI::class], 'show');
$state = ['question_id' => $question->getId(), 'pool_ref_id' => $pool->getRefId(), 'edit_url' => $url, 'preview_url' => $preview_url];
file_put_contents($state_file, json_encode($state, JSON_THROW_ON_ERROR));
echo json_encode($state, JSON_THROW_ON_ERROR), "\n";
