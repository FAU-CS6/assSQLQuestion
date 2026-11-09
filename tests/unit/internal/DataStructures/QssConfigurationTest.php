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
        self::assertCount(24, $labels);
        self::assertSame('qss_sqlrunning', $labels['sqlRunning']);
        self::assertSame('qss_notevaluated', $labels['notEvaluated']);
        self::assertSame('qss_lowerbound', $labels['lowerBound']);
        self::assertSame('qss_editreplace', $labels['editReplace']);
    }
}
