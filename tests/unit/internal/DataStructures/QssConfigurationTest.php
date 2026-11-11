<?php declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class QssConfigurationTest extends TestCase
{
    private function question(): object
    {
        return new class {
            public array $sequences = ['sequence_a' => 'CREATE TABLE people (id INTEGER);',
                'sequence_b' => 'SELECT id FROM people;', 'sequence_c' => ''];
            public string $metrics = '["result_lines:1:5"]';
            public function getSequence(string $name): string { return $this->sequences[$name]; }
            public function getAllSolutionMetricsAsJSON(): string { return $this->metrics; }
        };
    }

    public function testReferenceRevisionTracksSchemaReferenceControlAndMetricChanges(): void
    {
        $question = $this->question();
        $revision = JsBlock::getQssReferenceRevision($question);
        self::assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $revision);
        self::assertSame($revision, JsBlock::getQssReferenceRevision(clone $question));
        foreach (['sequence_a', 'sequence_b', 'sequence_c'] as $name) {
            $changed = clone $question;
            $changed->sequences[$name] .= ' -- changed';
            self::assertNotSame($revision, JsBlock::getQssReferenceRevision($changed));
        }
        $question->metrics = '["result_lines:1:6"]';
        self::assertNotSame($revision, JsBlock::getQssReferenceRevision($question));
    }

    public function testPaperModelRevisionInvalidatesThePreviousSyntaxMetric(): void
    {
        $question = $this->question();
        $oldRevision = hash('sha256', json_encode([
            'version' => 1,
            'sequence_a' => $question->getSequence('sequence_a'),
            'sequence_b' => $question->getSequence('sequence_b'),
            'sequence_c' => $question->getSequence('sequence_c'),
            'metrics' => $question->getAllSolutionMetricsAsJSON(),
        ], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE));
        self::assertNotSame($oldRevision, JsBlock::getQssReferenceRevision($question));
        self::assertSame('graph-qss-sqlite-v2', JsBlock::QSS_ENGINE);
        self::assertSame('2.1.1', JsBlock::QSS_ENGINE_VERSION);
        self::assertSame('paper-linear-v2', JsBlock::QSS_RUBRIC);
        self::assertSame(1, JsBlock::QSS_SCALE);
    }

    public function testRelativeScaleAndQuestionRequirementsInvalidateTheRevision(): void
    {
        foreach ([1.0, 2.0, 5.0, 25.0] as $maximum) {
            self::assertSame($maximum / 5, JsBlock::getQssScale($maximum));
        }
        self::assertSame(1.0, JsBlock::getQssScale(0));
        $question = new class {
            public string $text = '<p>Finden Sie eine Lösung ohne JOIN-Operation.</p>';
            public function getQuestion(): string { return $this->text; }
            public function getSequence(string $name): string { return 'SELECT 1'; }
            public function getAllSolutionMetricsAsJSON(): string { return '[]'; }
        };
        self::assertSame('Finden Sie eine Lösung ohne JOIN-Operation.', JsBlock::getQssQuestionText($question));
        $before = JsBlock::getQssReferenceRevision($question);
        $question->text = '<p>Finden Sie eine Lösung.</p>';
        self::assertNotSame($before, JsBlock::getQssReferenceRevision($question));
    }

    public function testJSONAttributePreservesSQLAsDataWithoutCreatingHTMLNodes(): void
    {
        $data = ['referenceSql' => "SELECT '</div><img src=x onerror=alert(1)>&\"{QSS_LITERAL}';", 'points' => 5,
            'nested' => ['{KEY}' => ['escaped' => "quotes \" slash \\ {VALUE}"]]];
        $html = '<div id="config" data-config="' . JsBlock::jsonAttribute($data) . '"></div>';
        $dom = new DOMDocument();
        $dom->loadHTML($html, LIBXML_NOERROR | LIBXML_NOWARNING);
        self::assertSame(0, $dom->getElementsByTagName('img')->length);
        self::assertSame($data, json_decode($dom->getElementById('config')->getAttribute('data-config'), true, flags: JSON_THROW_ON_ERROR));
    }

    public function testConfigLabelsExposeTheAgreedPlainTextKeys(): void
    {
        $labels = JsBlock::getQssLabels(new class {
            public function txt(string $key): string { return '<b>' . $key . '</b>'; }
        });
        self::assertCount(30, $labels);
        self::assertSame('qss_sqlrunning', $labels['sqlRunning']);
        self::assertSame('qss_notevaluated', $labels['notEvaluated']);
        self::assertSame('qss_lowerbound', $labels['lowerBound']);
        self::assertSame('qss_editreplace', $labels['editReplace']);
        self::assertSame('qss_participantrunning', $labels['participantRunning']);
        self::assertSame('qss_participantcompleted', $labels['participantCompleted']);
    }
}
