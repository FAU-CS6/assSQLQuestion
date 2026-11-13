<?php declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class QssCostProfileTest extends TestCase
{
    private const VERSION_SEVEN_STEPS = [
        'toggleJoinedProjectionAlias', 'toggleJoinedIdenticalTableAlias',
        'rewriteUniqueFilteredSemijoin', 'changeSubqueryComparison',
        'qualifyLocalSubqueryColumn', 'toggleLocalSubqueryTableAlias', 'commuteInnerJoinSources'
    ];

    private static function versionSixCosts(): array
    {
        return array_diff_key(QssAssessment::costs(), array_flip(self::VERSION_SEVEN_STEPS));
    }

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

    public function testPreviousProfileKeepsEveryOverrideAndAddsNewStepDefaults(): void
    {
        $newSteps = ['toggleAlterAddColumnKeyword', 'quoteUnboundSqliteString',
            'toggleIntegerPrimaryKeyNotNull', 'toggleExplicitPrimaryKeyReference', 'rewriteBetweenRange',
            'rewriteLiteralInList', 'restoreMissingBinaryTerm', 'qualifySingleTableColumn',
            'toggleRedundantProjectionAlias', 'toggleIdenticalTableAlias',
            'toggleCanonicalIntegerTextComparison', 'restoreMissingNullPredicate', 'restoreMissingOrderByColumn', 'qualifyUnambiguousJoinedWhereColumn'];
        $legacyCosts = array_diff_key(self::versionSixCosts(), array_flip($newSteps));
        self::assertCount(50, $legacyCosts);
        $index = 0;
        foreach ($legacyCosts as &$cost) {
            $cost = $index++ % 7;
        }
        unset($cost);
        $migrated = QssAssessment::costsFromJSON(json_encode([
            'version' => 1, 'modelVersion' => '2.1.1', 'costs' => $legacyCosts
        ], JSON_THROW_ON_ERROR));
        self::assertSame($legacyCosts, array_intersect_key($migrated, $legacyCosts));
        foreach ($newSteps as $id) {
            self::assertSame(QssAssessment::costs()[$id], $migrated[$id]);
        }
        self::assertSame($migrated, QssAssessment::costsFromJSON(json_encode(QssAssessment::profile($migrated))));
    }

    public function testVersionTwoProfilePreservesOverridesOnTheFirstSQLiteExtensions(): void
    {
        $newSteps = ['rewriteLiteralInList', 'restoreMissingBinaryTerm', 'qualifySingleTableColumn',
            'toggleRedundantProjectionAlias', 'toggleIdenticalTableAlias',
            'toggleCanonicalIntegerTextComparison', 'restoreMissingNullPredicate', 'restoreMissingOrderByColumn', 'qualifyUnambiguousJoinedWhereColumn'];
        $legacyCosts = array_diff_key(self::versionSixCosts(), array_flip($newSteps));
        self::assertCount(55, $legacyCosts);
        $legacyCosts['toggleIntegerPrimaryKeyNotNull'] = 6;
        $legacyCosts['rewriteBetweenRange'] = 4;
        $migrated = QssAssessment::costsFromJSON(json_encode([
            'version' => 2, 'modelVersion' => '2.2.0', 'costs' => $legacyCosts
        ], JSON_THROW_ON_ERROR));
        self::assertSame($legacyCosts, array_intersect_key($migrated, $legacyCosts));
        self::assertSame(0, $migrated['rewriteLiteralInList']);
        self::assertSame(1, $migrated['restoreMissingBinaryTerm']);
        foreach (['qualifySingleTableColumn', 'toggleRedundantProjectionAlias', 'toggleIdenticalTableAlias'] as $id) {
            self::assertSame(0, $migrated[$id]);
        }
        self::assertSame(0, $migrated['toggleCanonicalIntegerTextComparison']);
        self::assertSame(1, $migrated['restoreMissingNullPredicate']);
    }

    public function testVersionThreeKeepsAllSixtyOverridesAndAddsOnlyNewDefaults(): void
    {
        $newSteps = ['toggleCanonicalIntegerTextComparison', 'restoreMissingNullPredicate', 'restoreMissingOrderByColumn', 'qualifyUnambiguousJoinedWhereColumn'];
        $legacyCosts = array_diff_key(self::versionSixCosts(), array_flip($newSteps));
        self::assertCount(60, $legacyCosts);
        $index = 0;
        foreach ($legacyCosts as &$cost) {
            $cost = $index++ % 9;
        }
        unset($cost);
        $migrated = QssAssessment::costsFromJSON(json_encode([
            'version' => 3, 'modelVersion' => '2.3.0', 'costs' => $legacyCosts
        ], JSON_THROW_ON_ERROR));
        self::assertSame($legacyCosts, array_intersect_key($migrated, $legacyCosts));
        self::assertSame(0, $migrated['toggleCanonicalIntegerTextComparison']);
        self::assertSame(1, $migrated['restoreMissingNullPredicate']);
    }

    public function testVersionFourKeepsAllSixtyTwoOverridesAndAddsTheOrderByRepairDefault(): void
    {
        $legacyCosts = self::versionSixCosts();
        unset($legacyCosts['restoreMissingOrderByColumn'], $legacyCosts['qualifyUnambiguousJoinedWhereColumn']);
        self::assertCount(62, $legacyCosts);
        $index = 0;
        foreach ($legacyCosts as &$cost) {
            $cost = $index++ % 11;
        }
        unset($cost);
        $migrated = QssAssessment::costsFromJSON(json_encode([
            'version' => 4, 'modelVersion' => '2.4.0', 'costs' => $legacyCosts
        ], JSON_THROW_ON_ERROR));
        self::assertSame($legacyCosts, array_intersect_key($migrated, $legacyCosts));
        self::assertSame(1, $migrated['restoreMissingOrderByColumn']);
        self::assertSame($migrated, QssAssessment::costsFromJSON(json_encode(QssAssessment::profile($migrated))));
    }

    public function testVersionFiveKeepsAllSixtyThreeOverridesAndAddsTheJoinedWhereDefault(): void
    {
        $legacyCosts = self::versionSixCosts();
        unset($legacyCosts['qualifyUnambiguousJoinedWhereColumn']);
        self::assertCount(63, $legacyCosts);
        $index = 0;
        foreach ($legacyCosts as &$cost) {
            $cost = $index++ % 13;
        }
        unset($cost);
        $migrated = QssAssessment::costsFromJSON(json_encode([
            'version' => 5, 'modelVersion' => '2.5.0', 'costs' => $legacyCosts
        ], JSON_THROW_ON_ERROR));
        self::assertSame($legacyCosts, array_intersect_key($migrated, $legacyCosts));
        self::assertSame(0, $migrated['qualifyUnambiguousJoinedWhereColumn']);
        self::assertSame($migrated, QssAssessment::costsFromJSON(json_encode(QssAssessment::profile($migrated))));
    }

    public function testMixedProfileVersionIsNotTreatedAsAnOlderCompatibleProfile(): void
    {
        $this->expectException(InvalidArgumentException::class);
        QssAssessment::costsFromJSON('{"version":1,"modelVersion":"2.2.0","costs":{}}');
    }

    public function testVersionSixProfilesPreserveEveryOverrideAndAddSevenDefaults(): void
    {
        $costs = self::versionSixCosts();
        self::assertCount(64, $costs);
        $index = 0;
        foreach ($costs as &$cost) {
            $cost = $index++ % 17;
        }
        unset($cost);
        foreach (['2.6.0', '2.6.1'] as $modelVersion) {
            $migrated = QssAssessment::costsFromJSON(json_encode([
                'version' => 6, 'modelVersion' => $modelVersion, 'costs' => $costs
            ], JSON_THROW_ON_ERROR));
            self::assertCount(71, $migrated);
            self::assertSame($costs, array_intersect_key($migrated, $costs));
            foreach (self::VERSION_SEVEN_STEPS as $id) {
                self::assertSame($id === 'changeSubqueryComparison' ? 1 : 0, $migrated[$id]);
            }
            self::assertSame(7, QssAssessment::profile($migrated)['version']);
            self::assertSame('2.7.0', QssAssessment::profile($migrated)['modelVersion']);
            self::assertSame($migrated, QssAssessment::costsFromJSON(json_encode(QssAssessment::profile($migrated))));
        }
    }

    public function testVersionSevenStepsAcceptFreeAndPaidAuthorOverrides(): void
    {
        $catalog = QssAssessment::catalog();
        self::assertCount(71, $catalog['steps']);
        self::assertCount(15, array_filter($catalog['steps'], static fn(array $step): bool => $step['group'] === 'basic'));
        foreach ([0, 1, 7] as $cost) {
            $overrides = array_fill_keys(self::VERSION_SEVEN_STEPS, $cost);
            $configured = QssAssessment::costs($overrides);
            self::assertSame($overrides, array_intersect_key($configured, $overrides));
            self::assertSame($configured, QssAssessment::costsFromJSON(json_encode(QssAssessment::profile($configured))));
        }
    }
}
