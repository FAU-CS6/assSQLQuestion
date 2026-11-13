<?php

declare(strict_types=1);

/**
 * A render nonce for ILIAS' integer formtimestamp duplicate-submit guard.
 *
 * ILIAS 11 assigns time() after getTestOutput(). Two different question forms
 * rendered during that second otherwise look like the same submission. Its
 * session handler does not lock parallel requests, so a session counter is
 * unsuitable. A random negative integer avoids both that shared counter and
 * the positive timestamps of other question types. This is not a CSRF token;
 * the native CSRF, navigation and duplicate-submit checks remain responsible.
 */
final class SQLQuestionTestFormToken
{
    public const int MIN_TOKEN = -9007199254740991;
    public const int MAX_TOKEN = -1;

    private static ?int $request_token = null;

    /** @param null|Closure(int, int): int $random */
    public static function allocate(?int $last_submitted, ?Closure $random = null): int
    {
        if (PHP_INT_SIZE < 8) {
            throw new RuntimeException('SQL question form tokens require 64-bit PHP integers.');
        }
        $random ??= random_int(...);
        do {
            $token = $random(self::MIN_TOKEN, self::MAX_TOKEN);
            if ($token < self::MIN_TOKEN || $token > self::MAX_TOKEN) {
                throw new UnexpectedValueException('Invalid SQL question form token.');
            }
        } while ($token === $last_submitted);
        return $token;
    }

    public static function render(?int $last_submitted): string
    {
        // Several SQL blocks in one HTTP response belong to one native form.
        self::$request_token ??= self::allocate($last_submitted);
        return '<span hidden data-qpisql-test-form-token="' . self::$request_token . '"></span>'
            . '<script>TestFormToken.bind(document.currentScript.previousElementSibling);</script>';
    }
}
