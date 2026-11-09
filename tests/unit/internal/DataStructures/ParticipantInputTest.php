<?php declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class ParticipantInputTest extends TestCase
{
    private function answer(): ParticipantInput
    {
        $answer = new ParticipantInput();
        $answer->setSequence("SELECT name\nFROM people;");
        $answer->setExecutedBool(true);
        $answer->setOutputRelation('{"columns":["name"],"values":[["Ada"]]}');
        $answer->setSingleParticipantMetric(new ParticipantMetric('result_lines', '1'));
        return $answer;
    }

    private function report(): array
    {
        return [
            'status' => 'exact', 'engine' => 'local-qss', 'version' => '1',
            'distance' => 0, 'points' => 5, 'maxPoints' => 5, 'edits' => [],
            'limitations' => ['Structural comparison within the declared model.'],
            'exactWithinModel' => true,
            'referenceDistance' => 7, 'pointsPerEdit' => 0.5, 'formula' => 'max(0, Pmax - cost * distance)',
            'normalizationDistance' => 5, 'provisionalRubric' => true, 'rubric' => 'provisional-cap-5-v1',
            'scoreCertifiedWithinModel' => true,
            'validation' => ['reference' => 'sqlite-executed', 'answer' => 'sqlite-executed'],
            'code' => 'QSS_EXACT',
            'answerDigest' => hash('sha256', 'candidate'),
            'referenceRevision' => hash('sha256', 'reference'),
        ];
    }

    public function testLegacyAnswersHaveNoSidecarAndRoundTripWithoutFormatChanges(): void
    {
        $original = $this->answer()->toJSON();
        $restored = ParticipantInput::fromJSON($original);
        self::assertNull($restored->getQssEvaluation());
        self::assertArrayNotHasKey('qss_evaluation', json_decode($original, true, flags: JSON_THROW_ON_ERROR));
        self::assertSame($original, $restored->toJSON());
    }

    public function testOptionalReportRoundTripsWithoutAddingLegacyMetrics(): void
    {
        $answer = $this->answer();
        $answer->setQssEvaluation($this->report());
        $restored = ParticipantInput::fromJSON($answer->toJSON());
        self::assertSame($this->report(), $restored->getQssEvaluation());
        self::assertSame($answer->getSequence(), $restored->getSequence());
        self::assertSame($answer->getOutputRelation(), $restored->getOutputRelation());
        self::assertTrue($restored->getExecutedBool());
        self::assertFalse($restored->getErrorBool());
        self::assertCount(1, $restored->getAllParticipantMetrics());
        self::assertSame('result_lines', $restored->getAllParticipantMetrics()[0]->getType());
    }

    public function testUnsupportedCancelledAndPartialReportsCanRemainUnscored(): void
    {
        foreach (['unsupported', 'error', 'cancelled', 'partial', 'score-zero-certified'] as $status) {
            $answer = $this->answer();
            $report = ['status' => $status, 'distance' => null, 'points' => null,
                'maxPoints' => 5, 'exactWithinModel' => false, 'lowerBound' => null,
                'method' => 'local', 'model' => ['name' => 'structural'],
                'searchStats' => ['visited' => 10, 'runtimeMs' => 0.5]];
            $answer->setQssEvaluationFromJSON(json_encode($report, JSON_THROW_ON_ERROR));
            self::assertSame($report, ParticipantInput::fromJSON($answer->toJSON())->getQssEvaluation());
        }
    }

    public function testInvalidOptionalJSONDoesNotRejectTheLegacyAnswer(): void
    {
        foreach (['{bad', 'null', 'false', '5', '"text"', '[]', '{"status":"unknown"}'] as $json) {
            $answer = $this->answer();
            $original = $answer->toJSON();
            $answer->setQssEvaluationFromJSON($json);
            self::assertNull($answer->getQssEvaluation());
            self::assertSame($original, $answer->toJSON());
        }
        $stored = json_decode($this->answer()->toJSON(), true, flags: JSON_THROW_ON_ERROR);
        $stored['qss_evaluation'] = 'an older or malformed non-object value';
        self::assertNull(ParticipantInput::fromJSON(json_encode($stored, JSON_THROW_ON_ERROR))->getQssEvaluation());
    }

    public function testRejectsNonFiniteNumbersInvalidFieldTypesAndOversizedDiagnostics(): void
    {
        foreach ([['points' => INF], ['distance' => NAN], ['distance' => -1],
            ['points' => '5'], ['exactWithinModel' => 'true'], ['answerDigest' => 'not-a-digest'],
            ['scoreCertifiedWithinModel' => 'true'], ['referenceDistance' => INF],
            ['pointsPerEdit' => -1], ['validation' => ['answer' => false]],
            ['normalizationDistance' => INF], ['provisionalRubric' => 'true'],
            ['edits' => [null]], ['edits' => [5]], ['limitations' => [false]],
            ['engine' => new stdClass()], ['message' => str_repeat('x', 2049)],
            ['diagnostics' => array_fill(0, 101, 'item')]] as $change) {
            $answer = $this->answer();
            $answer->setQssEvaluation(array_replace($this->report(), $change));
            self::assertNull($answer->getQssEvaluation());
            self::assertTrue($answer->getExecutedBool());
        }
    }

    public function testKeepsOnlyFiftyEditsAndDoesNotPersistQueryOrASTSnapshots(): void
    {
        $report = $this->report();
        $report['edits'] = array_fill(0, 55, ['type' => 'rename', 'path' => '/select/0', 'cost' => 1]);
        $report['referenceSql'] = 'SELECT secret_reference;';
        $report['referenceAst'] = ['secret'];
        $answer = $this->answer();
        $answer->setQssEvaluation($report);
        $saved = $answer->getQssEvaluation();
        self::assertCount(50, $saved['edits']);
        self::assertTrue($saved['editsTruncated']);
        self::assertArrayNotHasKey('referenceSql', $saved);
        self::assertArrayNotHasKey('referenceAst', $saved);
        self::assertCount(55, $report['edits']);
    }

    public function testEncodedMetadataIsBoundedAndCanBeCleared(): void
    {
        $answer = $this->answer();
        $report = $this->report();
        $report['limitations'] = array_fill(0, 50, str_repeat('x', 1024));
        $answer->setQssEvaluation($report);
        self::assertNull($answer->getQssEvaluation());
        $answer->setQssEvaluation($this->report());
        self::assertNotNull($answer->getQssEvaluation());
        $answer->setQssEvaluation(null);
        self::assertNull($answer->getQssEvaluation());
    }

    public function testPaperGraphSidecarKeepsTheScoreAndCompactNamedEditsWithoutReplayStates(): void
    {
        $report = array_replace($this->report(), [
            'engine' => 'graph-qss-sqlite-v2', 'version' => '2.0.1',
            'modelVersion' => 'sql-ast-v2', 'rubric' => 'paper-linear-v1',
            'formula' => 'max(0, maxPoints - distance * scale)', 'scale' => 0.5,
            'edits' => array_fill(0, 55, [
                'type' => 'sql-edit', 'name' => 'setLiteral',
                'description' => str_repeat('Bound SQL literal. ', 50),
                'path' => '/statements/0/where/right', 'cost' => 1,
                'operation' => ['root' => ['kind' => 'select', 'privateSql' => 'never persist']],
                'before' => ['fullAst' => ['private']], 'after' => ['fullAst' => ['private']],
            ]),
        ]);
        $answer = $this->answer();
        $answer->setQssEvaluation($report);
        $saved = $answer->getQssEvaluation();
        self::assertNotNull($saved);
        self::assertSame(0.5, $saved['scale']);
        self::assertSame('sql-ast-v2', $saved['modelVersion']);
        self::assertSame('paper-linear-v1', $saved['rubric']);
        self::assertSame($report['points'], $saved['points']);
        self::assertTrue($saved['editsTruncated']);
        self::assertGreaterThan(0, count($saved['edits']));
        self::assertLessThan(50, count($saved['edits']));
        self::assertArrayNotHasKey('operation', $saved['edits'][0]);
        self::assertArrayNotHasKey('before', $saved['edits'][0]);
        self::assertArrayNotHasKey('after', $saved['edits'][0]);
        self::assertLessThanOrEqual(16384, strlen(json_encode($saved, JSON_THROW_ON_ERROR)));
    }
}
