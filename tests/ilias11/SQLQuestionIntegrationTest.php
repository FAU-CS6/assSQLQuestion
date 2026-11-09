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
        $question->setEditorAssistance(true);
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
        self::assertTrue($loaded->getEditorAssistance());
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
        self::assertTrue($copy->getEditorAssistance());

        $duplicate_id = $question->duplicate(true, '', '', -1, $this->pool->getId());
        $this->question_ids[] = $duplicate_id;
        $duplicate = assQuestion::instantiateQuestion($duplicate_id);
        self::assertSame($question->getId(), $duplicate->getOriginalId());
        $duplicate->setSequence('sequence_b', 'SELECT DISTINCT name FROM people;');
        $duplicate->setEditorAssistance(false);
        $duplicate->saveToDb();
        $duplicate->syncWithOriginal();
        $original = assQuestion::instantiateQuestion($question->getId());
        self::assertSame($duplicate->getSequence('sequence_b'), $original->getSequence('sequence_b'));
        self::assertFalse($original->getEditorAssistance());
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
        self::assertTrue($imported->getEditorAssistance());
        self::assertStringContainsString('Correct SQL!', $imported->feedbackOBJ->getGenericFeedbackContent($imported->getId(), true));
    }

    public function testLegacyImportKeepsParticipantHintsDisabled(): void
    {
        $question = $this->question();
        $xml = new DOMDocument();
        $xml->loadXML($question->toXML());
        $xpath = new DOMXPath($xml);
        foreach ($xpath->query('//qtimetadatafield[fieldlabel="EDITOR_ASSISTANCE"]') as $field) {
            $field->parentNode->removeChild($field);
        }
        $parser = new ilQTIParser(sys_get_temp_dir(), null, ilQTIParser::IL_MO_PARSE_QTI, $this->pool->getId());
        $parser->setXMLContent($xml->saveXML());
        $parser->startParsing();
        $mapping = current($parser->import_mapping);
        $this->question_ids[] = $mapping['pool'];
        $imported = assQuestion::instantiateQuestion($mapping['pool']);
        self::assertFalse($imported->getEditorAssistance());
        self::assertSame('', (new EditorAssistance($imported->getPlugin(), $imported))->getQuestionOutput(new ParticipantInput()));
    }

    public function testSQLAndMetricsAreEscapedOnlyForHTMLPresentation(): void
    {
        $question = $this->question();
        $sql = "SELECT '</textarea><img src=x onerror=alert(1)>&' AS sample;";
        $question->setSequence('sequence_a', $sql);
        $question->setSequence('sequence_b', $sql);
        $question->saveToDb();
        $loaded = assQuestion::instantiateQuestion($question->getId());
        self::assertSame($sql, $loaded->getSequence('sequence_b'));
        $plugin = $loaded->getPlugin();
        $input = (new SequenceB($plugin, $loaded))->getEditOutput();
        $hidden = (new SequenceA($plugin, $loaded))->getQuestionOutput(new ParticipantInput());
        foreach ([$input, $hidden] as $html) {
            self::assertStringNotContainsString('<img src=x', $html);
            $dom = new DOMDocument();
            $dom->loadHTML($html, LIBXML_NOERROR | LIBXML_NOWARNING);
            self::assertSame($sql, $dom->getElementsByTagName('textarea')->item(0)->textContent);
        }
        $loaded->setSingleSolutionMetric(new SolutionMetric('column_names', 1, '["</td><img src=x onerror=alert(1)>"]'));
        $html = ColumnNames::getSolutionOutput($plugin, $loaded, null);
        self::assertStringNotContainsString('<img src=x', $html);
        self::assertStringContainsString('&lt;/td&gt;&lt;img', $html);
        self::assertSame($plugin->txt('gi_name'), $GLOBALS['DIC']->language()->txt('assSQLQuestion'));
    }

    public function testNativeAuthoringAssignsOwnerAndLoadingPreservesExistingOwner(): void
    {
        global $DIC;
        $gui = new assSQLQuestionGUI();
        self::assertSame($DIC->user()->getId(), $gui->getObject()->getOwner());
        $question = $this->question();
        $question->setOwner(ANONYMOUS_USER_ID);
        $question->saveToDb();
        $loaded = new assSQLQuestionGUI($question->getId());
        self::assertSame(ANONYMOUS_USER_ID, $loaded->getObject()->getOwner());
    }

    public function testQssConfigurationAndStoredMetadataRemainHTMLData(): void
    {
        $question = $this->question();
        $sql = "SELECT '</div><img src=x onerror=alert(1)>&{QSS_LITERAL}' AS sample;";
        $question->setSequence('sequence_b', $sql);
        $question->setExecutedBool(false);
        $question->setErrorBool(true);
        $plugin = $question->getPlugin();
        $block = new JsBlock($plugin, $question);
        $input = new ParticipantInput();
        $input->setQssEvaluation(['status' => 'unsupported', 'message' => '<img src=x onerror=alert(1)>']);
        $html = $block->getQuestionOutput($input);
        $dom = new DOMDocument();
        $dom->loadHTML($html, LIBXML_NOERROR | LIBXML_NOWARNING);
        $config = json_decode($dom->getElementById('qpisql-qss-config')->getAttribute('data-config'), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('participant', $config['context']);
        self::assertSame(2, $config['version']);
        self::assertSame(JsBlock::QSS_ENGINE, $config['engine']);
        self::assertSame(JsBlock::QSS_ENGINE_VERSION, $config['engineVersion']);
        self::assertSame(JsBlock::QSS_RUBRIC, $config['rubric']);
        self::assertSame(JsBlock::QSS_SCALE, $config['scale']);
        self::assertSame($sql, $config['referenceSql']);
        self::assertFalse($config['referenceExecutionValid']);
        self::assertSame(5, $config['maxPoints']);
        self::assertSame(JsBlock::getQssReferenceRevision($question), $config['referenceRevision']);
        self::assertSame(0, $dom->getElementsByTagName('img')->length);
        self::assertSame($input->getQssEvaluation(), json_decode($dom->getElementById('qpisql-qss-evaluation')->getAttribute('value'), true, flags: JSON_THROW_ON_ERROR));
        self::assertLessThan(strpos($html, 'new ExecutionHandler()'), strpos($html, 'id="qpisql-qss-evaluation"'));

        $dom->loadHTML($block->getEditOutput(), LIBXML_NOERROR | LIBXML_NOWARNING);
        $author = json_decode($dom->getElementById('qpisql-qss-config')->getAttribute('data-config'), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('author', $author['context']);
        self::assertNull($author['referenceSql']);
        self::assertStringNotContainsString('id="qpisql-qss-config"', $block->getSolutionOutput($input));
        self::assertStringNotContainsString('name="qss_evaluation"', $block->getSolutionOutput($input));

        $stored = (new Output($plugin, $question))->getSolutionOutput($input);
        $dom->loadHTML($stored, LIBXML_NOERROR | LIBXML_NOWARNING);
        $container = $dom->getElementsByTagName('div')->item(0);
        self::assertSame($input->getQssEvaluation(), json_decode($container->getAttribute('data-qss-evaluation'), true, flags: JSON_THROW_ON_ERROR));
        self::assertSame(0, $dom->getElementsByTagName('img')->length);
    }

    public function testPostedQssSidecarIsPreservedWithoutAffectingLegacyPoints(): void
    {
        global $DIC;
        $question = $this->question();
        $report = ['status' => 'exact', 'distance' => 9, 'points' => 0,
            'engine' => JsBlock::QSS_ENGINE, 'version' => JsBlock::QSS_ENGINE_VERSION,
            'rubric' => JsBlock::QSS_RUBRIC, 'scale' => JsBlock::QSS_SCALE,
            'maxPoints' => 5, 'exactWithinModel' => true,
            'referenceRevision' => JsBlock::getQssReferenceRevision($question),
            'answerDigest' => hash('sha256', 'SELECT name FROM people;')];
        $original = $_POST;
        try {
            $fields = ['sequence_b' => 'SELECT name FROM people;', 'error_bool' => 'false',
                'error' => '', 'executed_bool' => 'true', 'output_relation' => $question->getOutputRelation(),
                'value_result_lines' => '2', 'value_column_names' => '["name"]', 'value_functional_dependencies' => '[]',
                'qss_evaluation' => json_encode($report, JSON_THROW_ON_ERROR)];
            $_POST = new ILIAS\HTTP\Wrapper\SuperGlobalDropInReplacement($DIC->refinery(), $fields);
            $submit = (new ReflectionMethod(assSQLQuestion::class, 'getSolutionSubmit'))->invoke($question);
            self::assertSame($report, ParticipantInput::fromJSON($submit['value1'])->getQssEvaluation());
            self::assertSame(5.0, (new ReflectionMethod(assSQLQuestion::class, 'calculateReachedPointsForSolution'))->invoke($question, $submit));

            $fields['qss_evaluation'] = '{malformed optional diagnostics';
            $_POST = new ILIAS\HTTP\Wrapper\SuperGlobalDropInReplacement($DIC->refinery(), $fields);
            $submit = (new ReflectionMethod(assSQLQuestion::class, 'getSolutionSubmit'))->invoke($question);
            self::assertNull(ParticipantInput::fromJSON($submit['value1'])->getQssEvaluation());
            self::assertSame(5.0, (new ReflectionMethod(assSQLQuestion::class, 'calculateReachedPointsForSolution'))->invoke($question, $submit));

            foreach (['referenceRevision', 'answerDigest'] as $key) {
                $stale = $report;
                $stale[$key] = hash('sha256', 'a different revision');
                $fields['qss_evaluation'] = json_encode($stale, JSON_THROW_ON_ERROR);
                $_POST = new ILIAS\HTTP\Wrapper\SuperGlobalDropInReplacement($DIC->refinery(), $fields);
                $submit = (new ReflectionMethod(assSQLQuestion::class, 'getSolutionSubmit'))->invoke($question);
                self::assertNull(ParticipantInput::fromJSON($submit['value1'])->getQssEvaluation());
                self::assertSame(5.0, (new ReflectionMethod(assSQLQuestion::class, 'calculateReachedPointsForSolution'))->invoke($question, $submit));
            }

            $fields['sequence_b'] = "SELECT name\r\nFROM people;";
            $report['answerDigest'] = hash('sha256', "SELECT name\nFROM people;");
            $fields['qss_evaluation'] = json_encode($report, JSON_THROW_ON_ERROR);
            $_POST = new ILIAS\HTTP\Wrapper\SuperGlobalDropInReplacement($DIC->refinery(), $fields);
            $submit = (new ReflectionMethod(assSQLQuestion::class, 'getSolutionSubmit'))->invoke($question);
            $answer = ParticipantInput::fromJSON($submit['value1']);
            self::assertSame($report, $answer->getQssEvaluation());
            self::assertSame($fields['sequence_b'], $answer->getSequence());
        } finally {
            $_POST = $original;
        }
    }

    public function testQuestionPreviewAndSolutionRenderWithPluginAssets(): void
    {
        $question = $this->question();
        $gui = assQuestion::instantiateQuestionGUI($question->getId());
        self::assertStringContainsString('codemirror_sqlquestion.bundle.js', $gui->getPreview());
        self::assertStringContainsString('%from%', $gui->getPreview());
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

    private function taxonomyPreflightArchive(): string
    {
        $path = tempnam(sys_get_temp_dir(), 'qpisql-taxonomy-');
        $zip = new ZipArchive();
        if ($path === false || $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            throw new RuntimeException('Cannot create synthetic taxonomy ZIP.');
        }
        $zip->addFromString('pool/Services/Taxonomy/set_1/export.xml',
            '<Export xmlns="urn:export" SchemaVersion="4.3.0"><DataSet>' .
            '<Rec Entity="tax_tree"><TaxTree><Description>Private synthetic detail</Description></TaxTree></Rec>' .
            '<Rec Entity="tax_tree"><TaxTree><Description> </Description></TaxTree></Rec>' .
            '<Rec Entity="tax_tree"><TaxTree><Title>Only a title</Title></TaxTree></Rec>' .
            '</DataSet></Export>');
        $zip->close();
        return $path;
    }

    public function testTaxonomyPreflightReportsTargetCapabilitiesWithoutLeakingDescriptions(): void
    {
        require_once __DIR__ . '/check-taxonomy-import.php';
        $archive = $this->taxonomyPreflightArchive();
        try {
            $capabilities = sqlQuestionTaxonomyImportCapabilities();
            $declared = $capabilities['schema_versions']['4.3.0']['description_field_declared'];
            $report = sqlQuestionTaxonomyImportReport([$archive], $capabilities);
            self::assertSame(3, $report['archives'][0]['taxonomy_tree_records']);
            self::assertSame(1, $report['nonempty_node_descriptions']);
            self::assertSame($declared ? 0 : 1, $report['unsupported_node_descriptions']);
            self::assertTrue($report['read_only']);
            self::assertTrue($report['needs_review']);
            self::assertStringNotContainsString('Private synthetic detail', json_encode($report, JSON_THROW_ON_ERROR));
        } finally {
            unlink($archive);
        }
    }

    public function testTaxonomyPreflightRecognizesCustomDataSetDeclaration(): void
    {
        require_once __DIR__ . '/check-taxonomy-import.php';
        $customDataSet = new class {
            public function getSupportedVersions(): array
            {
                return ['4.3.0'];
            }

            protected function getTypes(string $entity, string $version): array
            {
                return ['TaxId' => 'integer', 'Description' => 'text'];
            }
        };
        $archive = $this->taxonomyPreflightArchive();
        try {
            $capabilities = sqlQuestionTaxonomyImportCapabilities(get_class($customDataSet));
            $report = sqlQuestionTaxonomyImportReport([$archive], $capabilities);
            self::assertTrue($capabilities['schema_versions']['4.3.0']['description_field_declared']);
            self::assertSame(0, $report['unsupported_node_descriptions']);
            self::assertSame('declared-by-custom-core', $report['description_support']);
            self::assertTrue($report['needs_review']);
        } finally {
            unlink($archive);
        }
    }
}
