<?php declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class QssSolutionOutputTest extends TestCase
{
    private function render(string $mode, ?ParticipantInput $input, ?ParticipantInput $preview = null, bool $released = true, array $costs = []): array
    {
        global $DIC;
        $previous = $DIC ?? null;
        $DIC = new class {
            public function language(): object {
                return new class {
                    public function txt(string $key): string { return $key; }
                    public function getLangKey(): string { return 'de'; }
                };
            }
        };
        $plugin = new class {
            public function txt(string $key): string { return $key; }
            public function getTemplate(string $name): object {
                return new class {
                    private array $values = [];
                    public function setVariable(string $key, mixed $value): void { $this->values[$key] = $value; }
                    public function get(): string { return json_encode($this->values, JSON_THROW_ON_ERROR); }
                };
            }
        };
        $question = new class($mode, $costs) {
            public function getQssCosts(): array { return $this->costs; }
            public function __construct(private string $mode, private array $costs) {}
            public function getId(): int { return 1; }
            public function getErrorBool(): bool { return false; }
            public function getError(): string { return ''; }
            public function getExecutedBool(): bool { return true; }
            public function getOutputRelation(): string { return ''; }
            public function getAssessmentMode(): string { return $this->mode; }
            public function getMaximumPoints(): float { return 5; }
            public function getSequence(string $name): string { return 'SELECT 1'; }
            public function getAllSolutionMetricsAsJSON(): string { return '[]'; }
        };
        try {
            $output = json_decode((new Output($plugin, $question, $preview, $released))->getSolutionOutput($input), true, flags: JSON_THROW_ON_ERROR);
            $output['SCORING_INFO'] = (new ScoringInfo($plugin, $question))->getSolutionOutput($input);
            return $output;
        } finally { $DIC = $previous; }
    }

    public function testOnlyParticipantQssAnswersRequireCompletedEvidence(): void
    {
        $input = new ParticipantInput();
        self::assertSame('true', $this->render('qss', $input)['QSS_REQUIRED']);
        self::assertSame('', $this->render('qss', $input)['QSS_EVALUATION']);
        self::assertSame('false', $this->render('qss', null)['QSS_REQUIRED']);
        $result = $this->render('result', $input);
        self::assertSame('false', $result['QSS_REQUIRED']);
        self::assertStringContainsString('ai_sca_so_name', $result['SCORING_INFO']);
    }

    public function testHistoricalResultAnswersKeepResultFeedbackAfterChangingModes(): void
    {
        $input = new ParticipantInput();
        $input->setSingleParticipantMetric(new ParticipantMetric('result_lines', '2'));
        foreach ([null, 0.0, 5.0] as $points) {
            if ($points !== null) {
                $input->setResultPoints($points);
            }
            $saved = ParticipantInput::fromJSON($input->toJSON());
            self::assertSame($points, $saved->getResultPoints());
            $result = $this->render('qss', $saved);
            self::assertSame('false', $result['QSS_REQUIRED']);
            self::assertStringContainsString('ai_sca_so_name', $result['SCORING_INFO']);
        }
    }

    public function testCheckedPreviewKeepsModelOutputAndBindsFeedbackToTheSubmittedAnswer(): void
    {
        $answer = new ParticipantInput();
        $answer->setSequence("SELECT '{TOKEN}'");
        $output = $this->render('qss', null, $answer);
        self::assertSame('id1cor1', $output['ID']);
        self::assertSame('true', $output['QSS_REQUIRED']);
        self::assertSame('', $output['SCORING_INFO']);
        $submission = json_decode(html_entity_decode($output['QSS_SUBMISSION'], ENT_QUOTES), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame($answer->getSequence(), $submission['sql']);
        $model = json_decode(html_entity_decode($output['QSS_STORED_MODEL'], ENT_QUOTES), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(hash('sha256', $answer->getSequence()), $model['answerDigest']);
        $labels = json_decode(html_entity_decode($output['QSS_LABELS'], ENT_QUOTES), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(array_column(QssAssessment::catalog()['steps'], 'de', 'id'), $labels['stepNames']);
    }

    public function testReleasedPathBindsTheAnswerAndReusesTheHistoricalCostProfile(): void
    {
        $answer = new ParticipantInput();
        $answer->setSequence("SELECT 2;\r\nSELECT 3;");
        $costs = ['baseRemoveStructural' => 7];
        $revision = $this->render('qss', $answer, costs: $costs)['QSS_REFERENCE_REVISION'];
        $result = ['status' => 'score-zero-certified', 'points' => 0, 'lowerBound' => 5,
            'engine' => JsBlock::QSS_ENGINE, 'version' => JsBlock::QSS_ENGINE_VERSION, 'modelVersion' => JsBlock::QSS_ENGINE_VERSION,
            'scoreCertifiedWithinModel' => true, 'referenceRevision' => $revision, 'answerDigest' => hash('sha256', "SELECT 2;\nSELECT 3;")];
        $answer->setQssEvaluation($result);
        $answer->setQssGradingContext(['version' => 1, 'mode' => 'qss', 'points' => 0, 'maxPoints' => 5,
            'scale' => 1, 'engineVersion' => JsBlock::QSS_ENGINE_VERSION, 'rubric' => JsBlock::QSS_RUBRIC,
            'referenceRevision' => $revision, 'costProfile' => QssAssessment::profile($costs), 'referenceExecutionValid' => false]);
        $answer = ParticipantInput::fromJSON($answer->toJSON());
        $view = $this->render('qss', $answer, costs: ['baseRemoveStructural' => 12]);
        $request = json_decode(html_entity_decode($view['QSS_PATH_REQUEST'], ENT_QUOTES), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame(7, $request['costs']['baseRemoveStructural']);
        self::assertSame("SELECT 2;\nSELECT 3;", $request['answer']);
        self::assertFalse($request['referenceExecutionValid']);
        $locked = $this->render('qss', $answer, released: false);
        self::assertSame('', $locked['QSS_PATH_REQUEST']);
        self::assertSame('', $locked['QSS_EVALUATION']);
        $answer->setSequence('SELECT 0');
        self::assertSame('', $this->render('qss', $answer)['QSS_PATH_REQUEST']);
        $answer->setSequence("SELECT 2;\nSELECT 3;");
        $answer->setQssEvaluation(array_replace($result, ['referenceRevision' => str_repeat('0', 64)]));
        self::assertSame('', $this->render('qss', $answer)['QSS_PATH_REQUEST']);
    }

    public function testHistoricalContextKeepsItsModelAndRequiresMissingEvidence(): void
    {
        $input = new ParticipantInput();
        $input->setSequence("SELECT 1\r\n");
        $input->setQssGradingContext(['version' => 1, 'mode' => 'qss', 'points' => 0, 'maxPoints' => 10,
            'referenceRevision' => str_repeat('a', 64), 'engineVersion' => '2.1.1', 'rubric' => JsBlock::QSS_RUBRIC, 'scale' => 2]);
        $rendered = $this->render('result', $input);
        self::assertSame('true', $rendered['QSS_REQUIRED']);
        self::assertSame('', $rendered['SCORING_INFO']);
        self::assertSame(str_repeat('a', 64), $rendered['QSS_REFERENCE_REVISION']);
        $model = json_decode(html_entity_decode($rendered['QSS_STORED_MODEL'], ENT_QUOTES), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('2.1.1', $model['engineVersion']);
        self::assertSame(10, $model['maxPoints']);
        self::assertSame(2, $model['scale']);
        self::assertSame(hash('sha256', "SELECT 1\n"), $model['answerDigest']);
    }
}
