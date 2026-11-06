<?php

declare(strict_types=1);

// This suite creates and deletes repository objects. Use a disposable test client.
if (PHP_SAPI !== 'cli' || getenv('ILIAS_TEST_WRITES') !== '1') {
    throw new RuntimeException('Run from CLI with ILIAS_TEST_WRITES=1 on a disposable ILIAS 11 installation.');
}

$ilias_path = getenv('ILIAS_PATH') ?: '/var/www/html';
chdir($ilias_path);
require_once $ilias_path . '/vendor/composer/vendor/autoload.php';

$_GET['baseClass'] = 'ilRepositoryGUI';
$_GET['cmdClass'] = 'assSQLQuestionGUI';
$startup = new ILIAS\Cron\CLI\StartUp(getenv('ILIAS_TEST_CLIENT') ?: 'default', 'root');
$startup->authenticate();
// Cron contexts do not define the web URL used by the repository GUI services.
if (!defined('ILIAS_HTTP_PATH')) {
    define('ILIAS_HTTP_PATH', getenv('ILIAS_HTTP_PATH') ?: 'http://localhost:8080');
}
// Let PHPUnit report PHP issues instead of ILIAS's interactive Whoops handler.
restore_error_handler();
if (explode('.', ILIAS_VERSION_NUMERIC)[0] !== '11') {
    throw new RuntimeException('These integration tests require ILIAS 11.');
}
