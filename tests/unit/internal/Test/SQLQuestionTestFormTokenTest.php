<?php

declare(strict_types=1);

use PHPUnit\Framework\TestCase;

final class SQLQuestionTestFormTokenTest extends TestCase
{
    public function testTokensAreExactIntegersDisjointFromCoreTimestamps(): void
    {
        for ($i = 0; $i < 100; $i++) {
            $token = SQLQuestionTestFormToken::allocate(time());
            self::assertLessThan(0, $token);
            self::assertGreaterThanOrEqual(-9007199254740991, $token);
            self::assertSame($token, (int) (string) $token);
        }
    }

    public function testRandomCollisionWithLastSubmittedFormIsRetried(): void
    {
        $draws = [-12, -12, -13];
        $token = SQLQuestionTestFormToken::allocate(-12, static function (int $min, int $max) use (&$draws): int {
            self::assertSame(-9007199254740991, $min);
            self::assertSame(-1, $max);
            return array_shift($draws);
        });
        self::assertSame(-13, $token);
        self::assertSame([], $draws);
    }

    public function testInvalidGeneratorCannotIntroduceNativeOrUnsafeValues(): void
    {
        $this->expectException(UnexpectedValueException::class);
        SQLQuestionTestFormToken::allocate(null, static fn(): int => 1);
    }

    public function testMultipleQuestionBlocksInOneRenderKeepTheSameNonce(): void
    {
        $first = SQLQuestionTestFormToken::render(123);
        $second = SQLQuestionTestFormToken::render(124);
        self::assertSame($first, $second);
        self::assertMatchesRegularExpression('/data-qpisql-test-form-token="-[1-9][0-9]*"/', $first);
        self::assertStringContainsString('TestFormToken.bind(document.currentScript.previousElementSibling)', $first);
    }
}
