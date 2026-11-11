<?php

declare(strict_types=1);

/** Anonymous native author/student acceptance. Does not create student answers. */
require __DIR__ . '/bootstrap.php';
$file = sys_get_temp_dir() . '/asssql-assessment-fixture.json';
$accounts = json_decode(file_get_contents(sys_get_temp_dir() . '/asssql-chrome-accounts.json'), true, flags: JSON_THROW_ON_ERROR);
$command = $argv[1] ?? '';
if ($command === 'create') {
    if (is_file($file)) { throw new RuntimeException('Use a fresh fixture; preserve previous evidence.'); }
    $pool = new ilObjQuestionPool(); $pool->setTitle('SQL assessment choice acceptance');
    $pool->setOwner($accounts['teacher']['id']); $pool->create(); $pool->createReference();
    $pool->putInTree($accounts['category_ref_id']); $pool->setPermissions($accounts['category_ref_id']);
    $state = ['pool_ref_id' => $pool->getRefId(), 'question_ids' => [], 'edit_urls' => [], 'student_id' => $accounts['student']['id']];
    foreach (['Result assessment', 'QSS standard costs', 'QSS custom equivalence cost'] as $title) {
        $question = new assSQLQuestion($title, '', 'SQL acceptance', $accounts['teacher']['id'], '<p>Return value for all positive ids, ordered by id.</p>');
        $question->feedbackOBJ = new ilAssSQLQuestionFeedback($question, $DIC->ctrl(), $DIC->database(), $DIC->language());
        $question->setObjId($pool->getId());
        $question->setSequence('sequence_a', 'CREATE TABLE sample(id INTEGER,value INTEGER);INSERT INTO sample VALUES(1,4),(2,8);');
        $question->setSequence('sequence_b', 'SELECT value FROM sample WHERE id>0 ORDER BY id');
        $question->setSequence('sequence_c', ''); $question->setIntegrityCheck(true);
        $question->setExecutedBool(true); $question->setOutputRelation('{"columns":["value"],"values":[[4],[8]]}');
        $question->setAllSolutionMetrics([new SolutionMetric('column_names', 5, '["value"]'),new SolutionMetric('result_lines',5,'2'),new SolutionMetric('functional_dependencies',0,'[]')]);
        $question->setPoints(10); $question->saveToDb();
        $state['question_ids'][] = $question->getId();
        $DIC->ctrl()->setParameterByClass(ilObjQuestionPoolGUI::class,'ref_id',$pool->getRefId());
        $DIC->ctrl()->setParameterByClass(assSQLQuestionGUI::class,'q_id',$question->getId());
        $state['edit_urls'][] = $DIC->ctrl()->getLinkTargetByClass([ilRepositoryGUI::class,ilObjQuestionPoolGUI::class,assSQLQuestionGUI::class],'editQuestion');
    }
} elseif (in_array($command, ['exam', 'new-exam'], true)) {
    $state = json_decode(file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
    if (isset($state['test_id'])) {
        if ($command !== 'new-exam') { throw new RuntimeException('Exam fixture already exists.'); }
        $state['previous_tests'][] = ['test_id'=>$state['test_id'],'test_ref_id'=>$state['test_ref_id'],'test_questions'=>$state['test_questions']];
    }
    $test = new ilObjTest(); $test->setTitle('SQL result and QSS grading acceptance'); $test->setOwner($accounts['teacher']['id']);
    $test->create(); $test->createReference(); $test->putInTree($accounts['category_ref_id']); $test->setPermissions($accounts['category_ref_id']);
    $DIC->rbac()->admin()->grantPermission(4,ilRbacReview::_getOperationIdsByName(['visible','read']),$test->getRefId());
    $test->saveToDb();
    $state['test_questions'] = [];
    foreach ($state['question_ids'] as $id) { $state['test_questions'][] = $test->insertQuestion($id); }
    $main = $test->getMainSettings();
    $main = $main->withTestBehaviourSettings($main->getTestBehaviourSettings()->withNumberOfTries(3)->withBlockAfterPassedEnabled(false))
        ->withQuestionBehaviourSettings($main->getQuestionBehaviourSettings()->withAutosaveEnabled(true)->withAutosaveInterval(2000)->withShuffleQuestions(false))
        ->withParticipantFunctionalitySettings($main->getParticipantFunctionalitySettings()->withQuestionListEnabled(false));
    $test->getMainSettingsRepository()->store($main,$test->getTestId());
    $score = $test->getScoreSettings();
    $score = $score->withResultSummarySettings($score->getResultSummarySettings()->withScoreReporting(ILIAS\Test\Settings\ScoreReporting\ScoreReportingTypes::SCORE_REPORTING_FINISHED))
        ->withResultDetailsSettings($score->getResultDetailsSettings()->withShowPassDetails(true)->withShowSolutionListComparison(true)->withShowSolutionFeedback(true));
    $test->getScoreSettingsRepository()->store($score,$test->getTestId());
    $test->getObjectProperties()->storePropertyIsOnline($test->getObjectProperties()->getPropertyIsOnline()->withOnline());
    $state['test_id']=$test->getTestId();$state['test_ref_id']=$test->getRefId();$state['url']=ILIAS_HTTP_PATH.'/goto.php/tst/'.$test->getRefId();
} elseif ($command === 'verify-transfer') {
    $state=json_decode(file_get_contents($file),true,flags:JSON_THROW_ON_ERROR);
    $report=json_decode(file_get_contents($argv[2]??''),true,flags:JSON_THROW_ON_ERROR);
    $target=new ilObjQuestionPool((int)$report['checks'][0]['reimport_pool_ref_id']);
    $snapshot=static fn(assSQLQuestion $q):array=>[$q->getAssessmentMode(),$q->getMaximumPoints(),$q->getQssMaximumPoints(),$q->getQssCostsAsJSON(),$q->getAllSolutionMetricsAsJSON(),$q->getSequence('sequence_a'),$q->getSequence('sequence_b'),$q->getSequence('sequence_c'),$q->getOutputRelation(),$q->getIntegrityCheck()];
    $before=[];foreach($state['question_ids']as$id){$before[]=hash('sha256',json_encode($snapshot(assQuestion::instantiateQuestion($id)),JSON_THROW_ON_ERROR));}
    $after=[];foreach($target->getAllQuestionIds()as$id){$q=assQuestion::instantiateQuestion((int)$id);if($q->getOwner()!=$accounts['teacher']['id'])throw new RuntimeException('Unexpected imported question owner.');$after[]=hash('sha256',json_encode($snapshot($q),JSON_THROW_ON_ERROR));}
    sort($before);sort($after);if(count($after)!==3||$before!==$after)throw new RuntimeException('Native mode/cost/maximum/SQL roundtrip changed.');
    echo json_encode(['native_settings_roundtrip'=>3,'mode_costs_maximum_sql_and_legacy_settings_preserved'=>true,'passed'=>true],JSON_THROW_ON_ERROR)."\n";exit;
} elseif ($command === 'report') {
    $state = json_decode(file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
    $db=$DIC->database();
    $active=$db->fetchAssoc($db->queryF('SELECT * FROM tst_active WHERE test_fi=%s AND user_fi=%s',['integer','integer'],[$state['test_id'],$state['student_id']]));
    if (!$active) { throw new RuntimeException('No native student attempt.'); }
    if ($active['last_finished_pass'] === null) { throw new RuntimeException('Native attempt is not finished.'); }
    $pass=(int)$active['last_finished_pass'];
    $expected=[10.0,8.0,6.0];$results=[];
    foreach ($state['test_questions'] as $i=>$id) {
        $q=assQuestion::instantiateQuestion($id);$points=$q->calculateReachedPoints((int)$active['active_id'],$pass);
        $input=ParticipantInput::fromJSON($q->getSolutionStored($active['active_id'],$pass,true)['value1']);
        $grade=$db->fetchAssoc($db->queryF('SELECT points,manual FROM tst_test_result WHERE active_fi=%s AND pass=%s AND question_fi=%s',['integer','integer','integer'],[$active['active_id'],$pass,$id]));
        if ($points!==$expected[$i]) { throw new RuntimeException('Unexpected official points for fixture question '.($i+1).': '.$points); }
        if ((float)($grade['points']??-1)!==$points || (int)$grade['manual']!==0) { throw new RuntimeException('Stored official grade differs.'); }
        if ($i===0 && $input->getQssEvaluation()!==null || $i>0 && count($input->getAllParticipantMetrics())!==0) { throw new RuntimeException('Inactive assessment data was saved.'); }
        if ($i>0 && ($input->getQssGradingContext()===null || $input->getQssGradingContext()['points']!==$points)) { throw new RuntimeException('Missing server-created historical score revision.'); }
        $results[]=['mode'=>$q->getAssessmentMode(),'points'=>$points,'maximum'=>$q->getMaximumPoints(),'result_metrics'=>count($input->getAllParticipantMetrics()),'qss_saved'=>$input->getQssEvaluation()!==null,'grading_revision_saved'=>$input->getQssGradingContext()!==null];
    }
    $attempt=$db->fetchAssoc($db->queryF('SELECT points,answeredquestions,questioncount,finalized_by FROM tst_pass_result WHERE active_fi=%s AND pass=%s',['integer','integer'],[$active['active_id'],$pass]));
    if ((float)$attempt['points']!==24.0 || (int)$attempt['answeredquestions']!==3 || (int)$attempt['questioncount']!==3 || $attempt['finalized_by']!=='finished_by_participant') { throw new RuntimeException('Native final grade mismatch.'); }
    echo json_encode(['native_official_grades'=>$results,'attempt'=>$attempt,'passed'=>true],JSON_THROW_ON_ERROR)."\n"; exit;
} else { throw new InvalidArgumentException('Usage: assessment-fixture.php create|exam|new-exam|report'); }
file_put_contents($file,json_encode($state,JSON_THROW_ON_ERROR));chmod($file,0600);
echo json_encode(['phase'=>$command,'questions'=>count($state['question_ids'])],JSON_THROW_ON_ERROR)."\n";
