<?php

declare(strict_types=1);

// This needs only an ILIAS source tree with a generated Composer autoloader.
// No ILIAS client, credentials or database are required.
$ilias_path = getenv('ILIAS_PATH') ?: '/var/www/html';
require_once $ilias_path . '/vendor/composer/vendor/autoload.php';
require_once dirname(__DIR__, 2) . '/vendor/autoload.php';
require_once $ilias_path . '/ilias_version.php';

$classes = require dirname(__DIR__, 2) . '/vendor/composer/autoload_classmap.php';
$count = 0;
foreach ($classes as $class => $file) {
    if (!str_starts_with($file, dirname(__DIR__, 2) . '/classes/')) {
        continue;
    }
    if (!class_exists($class) && !interface_exists($class) && !trait_exists($class)) {
        throw new RuntimeException('Could not load plugin class ' . $class);
    }
    ++$count;
}
if ($count === 0) {
    throw new RuntimeException('Generate the plugin autoloader with composer install first.');
}
printf("Loaded all %d plugin classes against ILIAS %s on PHP %s.\n", $count, ILIAS_VERSION_NUMERIC, PHP_VERSION);
