<?php declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class QssSolutionOutputTest extends TestCase
{
    private function render(string $mode, ?ParticipantInput $input): array
    {
        global $DIC;
        $previous = $DIC ?? null;
        $DIC = new class {
            public function language(): object { return new class { public function txt(string $key): string { return $key; } }; }
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
        $question = new class($mode) {
            public function __construct(private string $mode) {}
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
            return json_decode((new Output($plugin, $question))->getSolutionOutput($input), true, flags: JSON_THROW_ON_ERROR);
        } finally { $DIC = $previous; }
    }

    public function testOnlyParticipantQssAnswersRequireCompletedEvidence(): void
    {
        $input = new ParticipantInput();
        self::assertSame('true', $this->render('qss', $input)['QSS_REQUIRED']);
        self::assertSame('', $this->render('qss', $input)['QSS_EVALUATION']);
        self::assertSame('false', $this->render('qss', null)['QSS_REQUIRED']);
        self::assertSame('false', $this->render('result', $input)['QSS_REQUIRED']);
    }

    public function testHistoricalContextKeepsItsModelAndRequiresMissingEvidence(): void
    {
        $input = new ParticipantInput();
        $input->setSequence("SELECT 1\r\n");
        $input->setQssGradingContext(['version' => 1, 'mode' => 'qss', 'points' => 0, 'maxPoints' => 10,
            'referenceRevision' => str_repeat('a', 64), 'engineVersion' => '2.1.1', 'rubric' => JsBlock::QSS_RUBRIC, 'scale' => 2]);
        $rendered = $this->render('result', $input);
        self::assertSame('true', $rendered['QSS_REQUIRED']);
        self::assertSame(str_repeat('a', 64), $rendered['QSS_REFERENCE_REVISION']);
        $model = json_decode(html_entity_decode($rendered['QSS_STORED_MODEL'], ENT_QUOTES), true, flags: JSON_THROW_ON_ERROR);
        self::assertSame('2.1.1', $model['engineVersion']);
        self::assertSame(10, $model['maxPoints']);
        self::assertSame(2, $model['scale']);
        self::assertSame(hash('sha256', "SELECT 1\n"), $model['answerDigest']);
    }
}
