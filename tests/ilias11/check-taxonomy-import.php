<?php

declare(strict_types=1);

/** Read-only operator preflight; this file is never loaded by the plugin. */
function sqlQuestionTaxonomyImportCapabilities(string $dataSetClass = ilTaxonomyDataSet::class): array
{
    $class = new ReflectionClass($dataSetClass);
    // Inspect declarations without starting a session or accessing the database.
    $dataSet = $class->newInstanceWithoutConstructor();
    $typesMethod = $class->getMethod('getTypes');
    $versions = [];
    foreach ($dataSet->getSupportedVersions() as $version) {
        $types = $typesMethod->invoke($dataSet, 'tax_tree', $version);
        $versions[$version] = ['description_field_declared' => array_key_exists('Description', $types)];
    }
    return ['data_set_class' => $dataSetClass, 'schema_versions' => $versions];
}

function sqlQuestionTaxonomyImportReport(array $archives, array $capabilities): array
{
    $report = ['format' => 1, 'read_only' => true, 'capabilities' => $capabilities,
        'archives' => [], 'nonempty_node_descriptions' => 0, 'unsupported_node_descriptions' => 0,
        'needs_review' => false];
    foreach ($archives as $archive) {
        $zip = new ZipArchive();
        if ($zip->open($archive) !== true) {
            throw new RuntimeException('Cannot open ZIP: ' . basename($archive));
        }
        $row = ['archive' => basename($archive), 'taxonomy_tree_records' => 0,
            'nonempty_node_descriptions' => 0, 'unsupported_node_descriptions' => 0,
            'schema_versions' => []];
        try {
            for ($index = 0; $index < $zip->numFiles; $index++) {
                $name = $zip->getNameIndex($index);
                if (!str_contains('/' . $name, '/Taxonomy/') || !str_ends_with(strtolower($name), '.xml')) {
                    continue;
                }
                $xml = $zip->getFromIndex($index);
                if ($xml === false || stripos($xml, '<!DOCTYPE') !== false) {
                    throw new RuntimeException('Invalid taxonomy XML in ZIP: ' . basename($archive));
                }
                $previous = libxml_use_internal_errors(true);
                try {
                    $document = new DOMDocument();
                    if (!$document->loadXML($xml, LIBXML_NONET | LIBXML_NOBLANKS)) {
                        throw new RuntimeException('Invalid taxonomy XML in ZIP: ' . basename($archive));
                    }
                } finally {
                    libxml_clear_errors();
                    libxml_use_internal_errors($previous);
                }
                $version = $document->documentElement->getAttribute('SchemaVersion');
                $row['schema_versions'][$version] = true;
                $supported = $capabilities['schema_versions'][$version]['description_field_declared'] ?? false;
                $xpath = new DOMXPath($document);
                foreach ($xpath->query('//*[local-name()="Rec" and @Entity="tax_tree"]/*[local-name()="TaxTree"]') as $node) {
                    $row['taxonomy_tree_records']++;
                    $description = $xpath->query('./*[local-name()="Description"]', $node)->item(0);
                    if ($description !== null && trim($description->textContent) !== '') {
                        $row['nonempty_node_descriptions']++;
                        if (!$supported) {
                            $row['unsupported_node_descriptions']++;
                        }
                    }
                }
            }
        } finally {
            $zip->close();
        }
        $row['schema_versions'] = array_keys($row['schema_versions']);
        $report['nonempty_node_descriptions'] += $row['nonempty_node_descriptions'];
        $report['unsupported_node_descriptions'] += $row['unsupported_node_descriptions'];
        $report['archives'][] = $row;
    }
    // A custom core declaring the field still needs an actual import/export
    // acceptance test; a schema declaration alone cannot prove persistence.
    $report['needs_review'] = $report['nonempty_node_descriptions'] > 0;
    $report['description_support'] = $report['unsupported_node_descriptions'] > 0 ? 'unsupported' :
        ($report['nonempty_node_descriptions'] > 0 ? 'declared-by-custom-core' : 'not-required');
    return $report;
}

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    if (PHP_SAPI !== 'cli') {
        http_response_code(404);
        exit(1);
    }
    try {
        $paths = array_slice($argv, 1);
        if ($paths === [] || in_array('--help', $paths, true)) {
            fwrite(STDERR, "Usage: ILIAS_PATH=/path/to/ilias php check-taxonomy-import.php PRIVATE_ZIP_OR_DIRECTORY [...]\n");
            exit($paths === [] ? 1 : 0);
        }
        $iliasPath = getenv('ILIAS_PATH') ?: '/var/www/html';
        require_once $iliasPath . '/vendor/composer/vendor/autoload.php';
        $archives = [];
        foreach ($paths as $path) {
            $files = is_dir($path) ? glob(rtrim($path, '/') . '/*.zip') : [$path];
            if ($files === false || $files === []) {
                throw new RuntimeException('No ZIP archives found in input directory.');
            }
            foreach ($files as $file) {
                if (!is_file($file) || !is_readable($file)) {
                    throw new RuntimeException('ZIP input is not a readable file: ' . basename($file));
                }
                $archives[realpath($file)] = realpath($file);
            }
        }
        sort($archives);
        $report = sqlQuestionTaxonomyImportReport($archives, sqlQuestionTaxonomyImportCapabilities());
        echo json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), "\n";
        exit($report['unsupported_node_descriptions'] > 0 ? 2 : 0);
    } catch (Throwable $error) {
        // Do not print source XML, descriptions, question content or a stack trace.
        fwrite(STDERR, 'Taxonomy preflight failed: ' . $error->getMessage() . "\n");
        exit(1);
    }
}
