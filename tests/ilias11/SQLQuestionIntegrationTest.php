<?php

declare(strict_types=1);

use ILIAS\Test\Logging\AdditionalInformationGenerator;
use ILIAS\TestQuestionPool\Questions\QuestionAutosaveable;
use PHPUnit\Framework\TestCase;

final class SQLQuestionIntegrationTest extends TestCase
{
    private ilObjQuestionPool $pool;
    private array $question_ids = [];

    protected function setUp(): void
    {
        $this->pool = new ilObjQuestionPool();
        $this->pool->setTitle('SQL plugin integration test');
        $this->pool->create();
        $this->pool->createReference();
        $this->pool->putInTree(1);
        $this->pool->setPermissions(1);
    }

    protected function tearDown(): void
    {
        foreach (array_unique($this->question_ids) as $id) {
            if (assQuestion::instantiateQuestion($id) instanceof assSQLQuestion) {
                $question = assQuestion::instantiateQuestion($id);
                $question->delete($id);
            }
        }
        $this->pool->delete();
    }

    private function question(): assSQLQuestion
    {
        global $DIC;
        $question = new assSQLQuestion('SQL test', 'Comment', 'Author', $DIC->user()->getId(), '<p>Select the names.</p>');
        $question->feedbackOBJ = new ilAssSQLQuestionFeedback($question, $DIC->ctrl(), $DIC->database(), $DIC->language());
        $question->setObjId($this->pool->getId());
        $question->setSequence('sequence_a', "CREATE TABLE people (id INTEGER, name TEXT); INSERT INTO people VALUES (1, 'Ada'), (2, 'Grace');");
        $question->setSequence('sequence_b', 'SELECT name FROM people ORDER BY id;');
        $question->setSequence('sequence_c', '');
        $question->setExecutedBool(true);
        $question->setOutputRelation('{"columns":["name"],"values":[["Ada"],["Grace"]]}');
        $question->setAllSolutionMetrics([
            new SolutionMetric('column_names', 3, '["name"]'),
            new SolutionMetric('result_lines', 2, '2'),
        ]);
        $question->setPoints($question->getMaximumPoints());
        $question->setExternalId('sql-integration-test');
        $question->setNrOfTries(3);
        $question->saveToDb();
        $this->question_ids[] = $question->getId();
        return $question;
    }

    public function testSaveAndLoadPreserveQuestionAndMetrics(): void
    {
        $question = $this->question();
        $loaded = assQuestion::instantiateQuestion($question->getId());
        self::assertInstanceOf(QuestionAutosaveable::class, $loaded);
        self::assertTrue($loaded->isComplete());
        self::assertSame($question->getSequence('sequence_a'), $loaded->getSequence('sequence_a'));
        self::assertSame($question->getSequence('sequence_b'), $loaded->getSequence('sequence_b'));
        self::assertSame($question->getAllSolutionMetricsAsJSON(), $loaded->getAllSolutionMetricsAsJSON());
        self::assertSame(5.0, $loaded->getMaximumPoints());
        self::assertSame(3, $loaded->getNrOfTries());
        self::assertSame('sql-integration-test', $loaded->getExternalId());
        self::assertNull($loaded->getOriginalId());
    }

    public function testCopyDuplicateAndSynchronizationPreserveSQLData(): void
    {
        $question = $this->question();
        $copy_id = $question->copyObject($this->pool->getId(), 'Copy');
        $this->question_ids[] = $copy_id;
        $copy = assQuestion::instantiateQuestion($copy_id);
        self::assertSame('Copy', $copy->getTitle());
        self::assertSame($question->getAllSolutionMetricsAsJSON(), $copy->getAllSolutionMetricsAsJSON());
        self::assertNull($copy->getOriginalId());

        $duplicate_id = $question->duplicate(true, '', '', -1, $this->pool->getId());
        $this->question_ids[] = $duplicate_id;
        $duplicate = assQuestion::instantiateQuestion($duplicate_id);
        self::assertSame($question->getId(), $duplicate->getOriginalId());
        $duplicate->setSequence('sequence_b', 'SELECT DISTINCT name FROM people;');
        $duplicate->saveToDb();
        $duplicate->syncWithOriginal();
        $original = assQuestion::instantiateQuestion($question->getId());
        self::assertSame($duplicate->getSequence('sequence_b'), $original->getSequence('sequence_b'));
    }

    public function testDeletionRemovesBothPluginTables(): void
    {
        global $DIC;
        $question = $this->question();
        $question->deleteAdditionalTableData($question->getId());
        foreach (['il_qpl_qst_qpisql_qd', 'il_qpl_qst_qpisql_qsm'] as $table) {
            $result = $DIC->database()->queryF("SELECT * FROM $table WHERE question_fi = %s", ['integer'], [$question->getId()]);
            self::assertSame(0, $DIC->database()->numRows($result));
        }
    }

    public function testQTIExportCanBeImportedIncludingGenericFeedback(): void
    {
        $question = $this->question();
        $question->feedbackOBJ->importGenericFeedback($question->getId(), true, '<p>Correct SQL!</p>');
        $xml = $question->toXML();
        self::assertStringContainsString('SEQUENCE_B', $xml);
        $parser = new ilQTIParser(sys_get_temp_dir(), null, ilQTIParser::IL_MO_PARSE_QTI, $this->pool->getId());
        $parser->setXMLContent($xml);
        $parser->startParsing();
        self::assertCount(1, $parser->import_mapping);
        $mapping = current($parser->import_mapping);
        $this->question_ids[] = $mapping['pool'];
        $imported = assQuestion::instantiateQuestion($mapping['pool']);
        self::assertSame($question->getSequence('sequence_b'), $imported->getSequence('sequence_b'));
        self::assertSame($question->getAllSolutionMetricsAsJSON(), $imported->getAllSolutionMetricsAsJSON());
        self::assertStringContainsString('Correct SQL!', $imported->feedbackOBJ->getGenericFeedbackContent($imported->getId(), true));
    }

    public function testQuestionPreviewAndSolutionRenderWithPluginAssets(): void
    {
        $question = $this->question();
        $gui = assQuestion::instantiateQuestionGUI($question->getId());
        self::assertStringContainsString('codemirror_sqlquestion.bundle.js', $gui->getPreview());
        self::assertStringContainsString('worker.sql.js', file_get_contents($question->getPlugin()->getDirectory() . '/js/classes/SQL/class.SQLRun.js'));
        self::assertStringContainsString('SELECT name', $gui->getSolutionOutput(0, null, show_correct_solution: true));
    }

    public function testAutosaveAuthorizationAndScoringUseStoredSQL(): void
    {
        global $DIC;
        $question = $this->question();
        $question->setProcessLocker(new ilAssQuestionProcessLockerDb($DIC->database()));
        $test = new ilObjTest();
        $test->setTitle('SQL autosave integration test');
        $test->create();
        $test->saveToDb();
        $session = new ilTestSession($DIC->database(), $DIC->user());
        $session->setTestId($test->getTestId());
        $session->setUserId($DIC->user()->getId());
        $session->saveToDb();
        $active_id = $session->getActiveId();
        $old_post = $_POST;
        try {
            $_POST = new ILIAS\HTTP\Wrapper\SuperGlobalDropInReplacement($DIC->refinery(), [
                'sequence_b' => 'SELECT name FROM people;',
                'error_bool' => 'false', 'error' => '',
                'executed_bool' => 'true', 'output_relation' => $question->getOutputRelation(),
                'value_result_lines' => '2', 'value_column_names' => '["name"]',
                'value_functional_dependencies' => '[]'
            ]);
            self::assertTrue($question->saveWorkingData($active_id, 0, false));
            self::assertEmpty($question->getSolutionStored($active_id, 0, true)['value1']);
            $saved = $question->getSolutionStored($active_id, 0, false);
            self::assertSame('SELECT name FROM people;', ParticipantInput::fromJSON($saved['value1'])->getSequence());
            self::assertSame(5.0, $question->calculateReachedPoints($active_id, 0, false));

            self::assertTrue($question->saveWorkingData($active_id, 0, true));
            self::assertSame(5.0, $question->calculateReachedPoints($active_id, 0));
            self::assertEmpty($question->getSolutionStored($active_id, 0, false)['value1']);

            // Typing after execution invalidates old metrics. Autosave must
            // preserve this draft without awarding points for stale results.
            $_POST = new ILIAS\HTTP\Wrapper\SuperGlobalDropInReplacement($DIC->refinery(), [
                'sequence_b' => 'SELECT id FROM people;',
                'error_bool' => 'true', 'error' => '',
                'executed_bool' => 'false', 'output_relation' => '',
                'value_result_lines' => 'false', 'value_column_names' => 'false',
                'value_functional_dependencies' => 'false'
            ]);
            self::assertTrue($question->saveWorkingData($active_id, 0, false));
            self::assertSame(0.0, $question->calculateReachedPoints($active_id, 0, false));
            self::assertSame(5.0, $question->calculateReachedPoints($active_id, 0, true));
        } finally {
            $_POST = $old_post;
            $test->delete();
        }
    }

    public function testLoggingAndTextExportIncludeSQLInsteadOfInternalJSON(): void
    {
        $question = $this->question();
        $input = new ParticipantInput();
        $input->setSequence('SELECT name FROM people;');
        $values = [['value1' => $input->toJSON(), 'value2' => null]];
        $method = new ReflectionMethod(assSQLQuestion::class, 'solutionValuesToText');
        self::assertSame($input->getSequence(), $method->invoke($question, $values));
        self::assertSame('', $method->invoke($question, []));
        self::assertSame($question->getSequence('sequence_b'), $question->getCorrectSolutionForTextOutput(0, 0));
        $additional_info = $this->createStub(AdditionalInformationGenerator::class);
        self::assertSame(5.0, $question->toLog($additional_info)[AdditionalInformationGenerator::KEY_QUESTION_REACHABLE_POINTS]);
    }
}
