<?php declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class QssCostProfileTest extends TestCase
{
    public function testDefaultsAndCustomFreeAndPaidStepsRoundTripExactly(): void
    {
        $costs = QssAssessment::costs(['deMorganBoolean' => 3, 'changeLiteral' => 0]);
        self::assertSame(3, $costs['deMorganBoolean']);
        self::assertSame(0, $costs['changeLiteral']);
        self::assertSame(5, $costs['baseAddStructural']);
        self::assertSame($costs, QssAssessment::costsFromJSON(json_encode(QssAssessment::profile($costs))));
        self::assertSame(QssAssessment::costs(), QssAssessment::costsFromJSON(''));
        self::assertSame('result', QssAssessment::mode('result'));
    }

    public function testInvalidCostsAndUnknownCatalogVersionsAreRejected(): void
    {
        foreach ([['missingEdit' => 0], ['changeLiteral' => -1], ['changeLiteral' => 1.5], ['changeLiteral' => '2'], ['changeLiteral' => 1000001]] as $bad) {
            try { QssAssessment::costs($bad); self::fail('Invalid costs accepted.'); }
            catch (InvalidArgumentException) { self::assertTrue(true); }
        }
        $this->expectException(InvalidArgumentException::class);
        QssAssessment::costsFromJSON('{"version":999,"modelVersion":"future","costs":{}}');
    }
}
