<?php

declare(strict_types=1);

/** Versioned question configuration shared by persistence, QTI and the browser. */
final class QssAssessment
{
    public const RESULT = 'result';
    public const QSS = 'qss';
    public const MAX_COST = 1000000;

    public static function catalog(): array
    {
        static $catalog;
        return $catalog ??= json_decode(file_get_contents(dirname(__DIR__, 3) . '/lib/qss/cost-catalog.json'), true, flags: JSON_THROW_ON_ERROR);
    }

    public static function mode(string $mode): string
    {
        if (!in_array($mode, [self::RESULT, self::QSS], true)) {
            throw new InvalidArgumentException('Unknown SQL assessment mode.');
        }
        return $mode;
    }

    public static function costs(array $overrides = []): array
    {
        $defaults = array_column(self::catalog()['steps'], 'defaultCost', 'id');
        foreach ($overrides as $id => $cost) {
            if (!array_key_exists($id, $defaults) || !is_int($cost) || $cost < 0 || $cost > self::MAX_COST) {
                throw new InvalidArgumentException('Invalid QSS step cost: ' . $id);
            }
            $defaults[$id] = $cost;
        }
        return $defaults;
    }

    public static function profile(array $costs = []): array
    {
        return ['version' => self::catalog()['version'], 'modelVersion' => self::catalog()['modelVersion'], 'costs' => self::costs($costs)];
    }

    public static function costsFromJSON(string $json): array
    {
        if ($json === '') {
            return self::costs();
        }
        $profile = json_decode($json, true, flags: JSON_THROW_ON_ERROR);
        if (!is_array($profile) || ($profile['version'] ?? null) !== self::catalog()['version']
            || ($profile['modelVersion'] ?? null) !== self::catalog()['modelVersion'] || !is_array($profile['costs'] ?? null)) {
            throw new InvalidArgumentException('Unsupported QSS cost profile.');
        }
        return self::costs($profile['costs']);
    }

    /** Validate browser evidence and recompute the linear score; never run SQL/QSS here.
     * Like the existing result metrics, client evidence is not tamper-proof. */
    public static function points(assSQLQuestion $question, ParticipantInput $input): float
    {
        $q = $input->getQssEvaluation();
        $maximum = $question->getMaximumPoints();
        $scale = JsBlock::getQssScale($maximum);
        if ($q === null || ($q['engine'] ?? null) !== JsBlock::QSS_ENGINE
            || ($q['version'] ?? null) !== JsBlock::QSS_ENGINE_VERSION
            || ($q['modelVersion'] ?? null) !== JsBlock::QSS_ENGINE_VERSION
            || ($q['rubric'] ?? null) !== JsBlock::QSS_RUBRIC
            || ($q['scoreCertifiedWithinModel'] ?? null) !== true
            || ($q['formula'] ?? null) !== 'max(maxPoints - distance * scale, 0)'
            || !is_numeric($q['maxPoints'] ?? null) || (float) $q['maxPoints'] !== $maximum
            || !is_numeric($q['scale'] ?? null) || abs((float) $q['scale'] - $scale) > 1e-10
            || !is_string($q['referenceRevision'] ?? null) || !hash_equals(JsBlock::getQssReferenceRevision($question), $q['referenceRevision'])
            || !is_string($q['answerDigest'] ?? null)
            || !hash_equals(hash('sha256', str_replace(["\r\n", "\r"], "\n", $input->getSequence())), $q['answerDigest'])) {
            return 0.0;
        }
        if (($q['status'] ?? null) === 'score-zero-certified') {
            return 0.0;
        }
        if (($q['status'] ?? null) !== 'exact' || ($q['exactWithinModel'] ?? null) !== true
            || !is_int($q['distance'] ?? null) || $q['distance'] < 0 || $q['distance'] > 9007199254740991) {
            return 0.0;
        }
        return round(max($maximum - $q['distance'] * $scale, 0), 4);
    }
}
