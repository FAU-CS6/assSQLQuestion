<?php

declare(strict_types=1);

/**
 * Disposable test-image preparation, never loaded by the plugin.
 * ILIAS 11.5's question list crashes for active question plugins. Apply exactly
 * the upstream fix, and refuse every unknown core version rather than guessing.
 * https://github.com/ILIAS-eLearning/ILIAS/commit/635bd4ec40200c7b6e88aab71eca4a914c9dc6f4
 */
if (PHP_SAPI !== 'cli' || getenv('ILIAS_TEST_CORE_PATCH') !== '1') {
    throw new RuntimeException('Only for disposable test clients: set ILIAS_TEST_CORE_PATCH=1 explicitly.');
}
$path = (getenv('ILIAS_PATH') ?: '/var/www/html')
    . '/components/ILIAS/TestQuestionPool/classes/questions/class.ilAssQuestionType.php';
$originalHash = 'd9d303c0e2e6d8ef1372cfef017b8458a4f34ba5143bb653e59884b7aab6e41a';
$fixedHash = '3daad25e9a484a61fc9dd01ae47209a0a6abbc1b1f2726f71f6aa600ea254881';
$hash = hash_file('sha256', $path);
if ($hash === $fixedHash) {
    echo "The verified upstream question-type fix is already present.\n";
    exit;
}
if ($hash !== $originalHash) {
    throw new RuntimeException('Unknown ILIAS core file; inspect the upstream fix manually. No file was changed.');
}
$source = file_get_contents($path);
$source = str_replace(
    "&& \$question_type_data['plugin_name'] !== null\n            && \$question_type_data['plugin_name'] !== ''",
    "&& (\$question_type_data['plugin_name'] === null\n                || \$question_type_data['plugin_name'] === '')",
    $source
);
$source = str_replace("\$question_type_data['type_tag']", "\$question_type_data['question_type']", $source);
if (hash('sha256', $source) !== $fixedHash) {
    throw new RuntimeException('Unexpected patch result. No file was changed.');
}
if (file_put_contents($path, $source) !== strlen($source)) {
    throw new RuntimeException('Could not write the upstream core fix.');
}
echo "Applied verified upstream ILIAS fix 635bd4ec40200c7b6e88aab71eca4a914c9dc6f4 to the disposable test image.\n";
