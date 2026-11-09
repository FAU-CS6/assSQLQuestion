<?php

declare(strict_types=1);

/**
 * Opt-in exhaustive test of privately supplied question-pool ZIPs.
 *
 * Usage (disposable ILIAS only): php -d memory_limit=2G pool-corpus.php import /corpus
 * Then run tests/browser/pool-corpus.cjs and this script with `score /corpus`.
 * The corpus directory contains private questions/solutions; never commit it.
 */
require __DIR__ . '/bootstrap.php';
// Import schema paths in ILIAS 11 are relative to the public web root.
chdir($ilias_path . '/public');
set_exception_handler(static function (Throwable $error): void {
    fwrite(STDERR, get_class($error) . ': ' . $error->getMessage() . "\n" . $error->getTraceAsString() . "\n");
    exit(1);
});

$mode = $argv[1] ?? '';
$examPrefix = getenv('ILIAS_CORPUS_EXAM_PREFIX') ?: '';
if (!preg_match('/^[A-Za-z0-9_-]*$/', $examPrefix)) throw new InvalidArgumentException('Invalid corpus exam prefix.');
$directory = realpath($argv[2] ?? '');
if ($directory === false || !in_array($mode, ['import', 'verify', 'verify-teacher', 'score', 'exam', 'report'], true)) {
    throw new InvalidArgumentException('Usage: pool-corpus.php import|verify|verify-teacher|score|exam|report PRIVATE_CORPUS_DIRECTORY');
}

function corpusJSON(string $path): array
{
    return json_decode(file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
}

function corpusWrite(string $path, array $data): void
{
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR) . "\n");
}

/** Strict range options: reject malformed values before creating repository objects. */
function corpusRangeInteger(string $name, int $default, int $minimum): int
{
    $value = getenv($name);
    if ($value === false || $value === '') return $default;
    if (!preg_match('/^(0|[1-9][0-9]*)$/D', $value)
        || strlen($value) > strlen((string) PHP_INT_MAX)
        || (strlen($value) === strlen((string) PHP_INT_MAX) && strcmp($value, (string) PHP_INT_MAX) > 0)
        || (int) $value < $minimum) {
        throw new InvalidArgumentException($name . ' must be an integer >= ' . $minimum . '.');
    }
    return (int) $value;
}

function corpusMetrics(string $json): array
{
    $metrics = [];
    foreach (json_decode($json, true, flags: JSON_THROW_ON_ERROR) as $metric) {
        $m = is_string($metric) ? json_decode($metric, true, flags: JSON_THROW_ON_ERROR) : $metric;
        $metrics[$m['type']] = ['points' => (int) $m['points'], 'value' => $m['value']];
    }
    ksort($metrics);
    return $metrics;
}

function corpusSnapshot(assSQLQuestion $question): array
{
    return [
        'title' => $question->getTitle(), 'comment' => $question->getComment(),
        'author' => $question->getAuthor(), 'question' => $question->getQuestion(),
        'maxattempts' => $question->getNrOfTries(), 'externalId' => $question->getExternalId(),
        'lifecycle' => $question->getLifecycle()->getIdentifier(),
        'content_editing_mode' => $question->getAdditionalContentEditingMode(),
        'sequence_a' => $question->getSequence('sequence_a'),
        'sequence_b' => $question->getSequence('sequence_b'),
        'sequence_c' => $question->getSequence('sequence_c'),
        'integrity_check' => $question->getIntegrityCheck(),
        'editor_assistance' => $question->getEditorAssistance(),
        'error_bool' => $question->getErrorBool(), 'error' => $question->getError(),
        'executed_bool' => $question->getExecutedBool(), 'output_relation' => $question->getOutputRelation(),
        'metrics' => corpusMetrics($question->getAllSolutionMetricsAsJSON()),
        'maximum_points' => $question->getMaximumPoints(),
        'feedback_correct' => $question->feedbackOBJ->getGenericFeedbackContent($question->getId(), true),
        'feedback_incorrect' => $question->feedbackOBJ->getGenericFeedbackContent($question->getId(), false)
    ];
}

function corpusURLs(ilObjQuestionPool $pool, int $questionId): array
{
    global $DIC;
    $ctrl = $DIC->ctrl();
    $ctrl->setParameterByClass(ilObjQuestionPoolGUI::class, 'ref_id', $pool->getRefId());
    $ctrl->setParameterByClass(assSQLQuestionGUI::class, 'q_id', $questionId);
    $edit = $ctrl->getLinkTargetByClass([ilRepositoryGUI::class, ilObjQuestionPoolGUI::class, assSQLQuestionGUI::class], 'editQuestion');
    $ctrl->setParameterByClass(ilAssQuestionPreviewGUI::class, 'q_id', $questionId);
    $preview = $ctrl->getLinkTargetByClass([ilRepositoryGUI::class, ilObjQuestionPoolGUI::class, ilAssQuestionPreviewGUI::class], 'show');
    return ['preview_url' => $preview, 'edit_url' => $edit,
        'import_url' => $ctrl->getLinkTargetByClass([ilRepositoryGUI::class, ilObjQuestionPoolGUI::class], 'uploadQuestionsImport'),
        'export_url' => $ctrl->getLinkTargetByClass([ilRepositoryGUI::class, ilObjQuestionPoolGUI::class, ilExportGUI::class], 'listExportFiles')];
}

function corpusExpected(array $source): array
{
    $m = $source['metadata'];
    $metrics = corpusMetrics($m['SOLUTION_METRICS']);
    return [
        'title' => $source['title'], 'comment' => $source['comment'],
        'author' => $m['AUTHOR'], 'question' => $source['question'],
        'maxattempts' => $source['maxattempts'], 'externalId' => $m['externalId'] ?? '',
        'lifecycle' => $m['ilias_lifecycle'] ?? $m['lifecycle'] ?? 'draft',
        // Native ILIAS imports legacy unset modes as the supported RTE default.
        'content_editing_mode' => ($m['additional_cont_edit_mode'] ?? '') ?: assQuestion::ADDITIONAL_CONTENT_EDITING_MODE_RTE,
        'sequence_a' => $m['SEQUENCE_A'], 'sequence_b' => $m['SEQUENCE_B'], 'sequence_c' => $m['SEQUENCE_C'],
        'integrity_check' => (bool) $m['INTEGRITY_CHECK'],
        'editor_assistance' => (bool) ($m['EDITOR_ASSISTANCE'] ?? false),
        'error_bool' => (bool) $m['ERROR_BOOL'], 'error' => $m['ERROR'],
        'executed_bool' => (bool) $m['EXECUTED_BOOL'], 'output_relation' => $m['OUTPUT_RELATION'],
        'metrics' => $metrics, 'maximum_points' => (float) array_sum(array_column($metrics, 'points')),
        'feedback_correct' => $source['feedback']['response_allcorrect'] ?? '',
        'feedback_incorrect' => $source['feedback']['response_onenotcorrect'] ?? ''
    ];
}

function corpusDifferences(array $expected, array $actual): array
{
    $fields = [];
    foreach ($expected as $field => $value) {
        if ($value !== ($actual[$field] ?? null)) {
            $fields[] = $field;
        }
    }
    return $fields;
}

function corpusExtract(string $archive): string
{
    $zip = new ZipArchive();
    if ($zip->open($archive) !== true) {
        throw new RuntimeException('Cannot open corpus ZIP.');
    }
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = $zip->getNameIndex($i);
        if (str_starts_with($name, '/') || preg_match('~(^|/)\.\.(/|$)|\\\\~', $name)) {
            throw new RuntimeException('Unsafe ZIP entry.');
        }
    }
    $target = CLIENT_DATA_DIR . '/temp';
    $zip->extractTo($target);
    $zip->close();
    return $target . '/' . basename($archive, '.zip');
}

/** Exercise the same native manifest/legacy import paths as the pool GUI. */
function corpusImport(string $archive): array
{
    $importDirectory = corpusExtract($archive);
    $basename = basename($archive, '.zip');
    $xml = $importDirectory . '/' . $basename . '.xml';
    $qti = $importDirectory . '/' . str_replace('qpl', 'qti', $basename) . '.xml';
    $pool = new ilObjQuestionPool();
    $pool->setTitle('Disposable SQL corpus import');
    $pool->create();
    $pool->createReference();
    $pool->putInTree(1);
    $pool->setPermissions(1);
    ilSession::set('path_to_import_file', $archive);
    ilSession::set('qpl_import_selected_questions', []);
    if (is_file($importDirectory . '/manifest.xml')) {
        $importer = new ilImport($pool->getRefId());
        $importer->getMapping()->addMapping('components/ILIAS/TestQuestionPool', 'qpl', 'new_id', (string) $pool->getId());
        $importer->importObject($pool, $archive, basename($archive), 'qpl', 'components/ILIAS/TestQuestionPool', true);
        $mapping = $importer->getMapping()->getMappingsOfEntity('components/ILIAS/TestQuestionPool', 'quest');
        $result = [];
        foreach ($mapping as $old => $new) {
            $result[(string) $old] = (int) $new;
        }
    } else {
        $parser = new ilQTIParser($importDirectory, $qti, ilQTIParser::IL_MO_PARSE_QTI, $pool->getId(), []);
        $parser->startParsing();
        $pageParser = new ilQuestionPageParser($pool, $xml, $importDirectory);
        $pageParser->setQuestionMapping($parser->getImportMapping());
        $pageParser->startParsing();
        $pool->fromXML($xml);
        $pool->update();
        $pool->saveToDb();
        $result = [];
        foreach ($parser->getImportMapping() as $old => $new) {
            $result[(string) substr($old, strrpos($old, '_') + 1)] = (int) $new['pool'];
        }
    }
    ilSession::clear('path_to_import_file');
    ilSession::clear('qpl_import_selected_questions');
    ilFileUtils::delDir($importDirectory);
    $pool->read();
    $pool->loadFromDb();
    return [$pool, $result];
}

function corpusTaxonomies(ilObjQuestionPool $pool, array $sourceToQuestion): array
{
    global $DIC;
    $questionToSource = array_flip($sourceToQuestion);
    $snapshot = [];
    foreach (ilObjTaxonomy::getUsageOfObject($pool->getId()) as $taxonomyId) {
        $tree = new ilTaxonomyTree((int) $taxonomyId);
        $nodes = $tree->getSubTree($tree->getNodeData($tree->readRootId()));
        $nodePaths = [];
        foreach ($nodes as $node) {
            $path = array_map(static fn(array $part): string => (string) $part['title'], $tree->getPathFull((int) $node['child']));
            // ILIAS regenerates this synthetic root label with the new taxonomy ID.
            if (($path[0] ?? '') === 'Root node for taxonomy ' . $taxonomyId) $path[0] = '[taxonomy root]';
            $nodePaths[(int) $node['child']] = $path;
        }
        $assignments = [];
        $rows = $DIC->database()->queryF('SELECT * FROM tax_node_assignment WHERE obj_id = %s AND tax_id = %s',
            ['integer', 'integer'], [$pool->getId(), $taxonomyId]);
        while ($row = $DIC->database()->fetchAssoc($rows)) {
            $assignments[] = [$questionToSource[(int) $row['item_id']] ?? 'unknown', $nodePaths[(int) $row['node_id']] ?? [], (string) $row['item_type']];
        }
        sort($assignments);
        $paths = array_values($nodePaths);
        sort($paths);
        $snapshot[] = ['title' => ilObject::_lookupTitle((int) $taxonomyId), 'nodes' => $paths, 'assignments' => $assignments];
    }
    sort($snapshot);
    return $snapshot;
}

function corpusScore(assSQLQuestion $question, array $execution): float
{
    $participant = new ParticipantInput();
    $participant->setExecutedBool(!isset($execution['error']));
    $participant->setErrorBool(isset($execution['error']));
    foreach ($execution['metrics'] ?? [] as $type => $value) {
        $participant->setSingleParticipantMetric(new ParticipantMetric($type, (string) $value));
    }
    $method = new ReflectionMethod(assSQLQuestion::class, 'calculateReachedPointsForSolution');
    return $method->invoke($question, ['value1' => $participant->toJSON()]);
}

if ($mode === 'score') {
    $report = ['questions' => 0, 'same_points' => 0, 'full_points' => 0, 'source_model_mismatches' => [], 'failures' => []];
    $stream = fopen($directory . '/' . $examPrefix . 'browser-results.jsonl', 'r');
    while (($line = fgets($stream)) !== false) {
        $row = json_decode($line, true, flags: JSON_THROW_ON_ERROR);
        $question = assQuestion::instantiateQuestion((int) $row['question_id']);
        $old = corpusScore($question, $row['baseline']);
        $new = corpusScore($question, $row['current']);
        $report['questions']++;
        if ($old === $new) {
            $report['same_points']++;
        } else {
            $report['failures'][] = ['key' => $row['key'], 'baseline_points' => $old, 'current_points' => $new];
        }
        if ($new === $question->getMaximumPoints()) {
            $report['full_points']++;
        } else {
            $report['source_model_mismatches'][] = ['key' => $row['key'], 'points' => $new, 'maximum' => $question->getMaximumPoints()];
        }
        // A saved draft and a failed/cancelled execution must never inherit old points.
        $invalid = new ParticipantInput();
        foreach ($row['current']['metrics'] ?? [] as $type => $value) {
            $invalid->setSingleParticipantMetric(new ParticipantMetric($type, (string) $value));
        }
        $method = new ReflectionMethod(assSQLQuestion::class, 'calculateReachedPointsForSolution');
        foreach ([[false, false], [true, true]] as [$executed, $error]) {
            $invalid->setExecutedBool($executed);
            $invalid->setErrorBool($error);
            if ($method->invoke($question, ['value1' => $invalid->toJSON()]) !== 0.0) {
                $report['failures'][] = ['key' => $row['key'], 'kind' => 'invalidated_answer_received_points'];
            }
        }
    }
    fclose($stream);
    $expectedCount = (int) (getenv('ILIAS_CORPUS_LIMIT') ?: corpusJSON($directory . '/manifest.json')['questions']);
    if ($report['questions'] !== $expectedCount) $report['failures'][] = ['kind' => 'incomplete_scoring_corpus'];
    corpusWrite($directory . '/' . $examPrefix . 'scoring-report.json', $report);
    echo json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), "\n";
    exit($report['failures'] === [] ? 0 : 1);
}

$manifest = corpusJSON($directory . '/manifest.json');
$sourceQuestions = [];
$sourceOrdinals = [];
$source = fopen($directory . '/questions.jsonl', 'r');
while (($line = fgets($source)) !== false) {
    $question = json_decode($line, true, flags: JSON_THROW_ON_ERROR);
    if (isset($sourceOrdinals[$question['key']])) throw new RuntimeException('Duplicate original corpus source key.');
    $sourceOrdinals[$question['key']] = count($sourceOrdinals) + 1;
    $sourceQuestions[$question['pool']][] = $question;
}
fclose($source);
$sourceEditorModeDefaults = 0;
foreach ($sourceQuestions as $poolQuestions) foreach ($poolQuestions as $sourceQuestion) {
    if (($sourceQuestion['metadata']['additional_cont_edit_mode'] ?? '') === '') $sourceEditorModeDefaults++;
}
if ($mode === 'verify') {
    $report = corpusJSON($directory . '/import-report.json');
    $runtimeByKey = [];
    $stream = fopen($directory . '/runtime.jsonl', 'r');
    while (($line = fgets($stream)) !== false) {
        $row = json_decode($line, true, flags: JSON_THROW_ON_ERROR);
        $runtimeByKey[$row['key']] = $row;
    }
    fclose($stream);
    $report['failures'] = [];
    foreach ($report['pools'] as &$poolReport) {
        $key = $poolReport['key'];
        $pool = new ilObjQuestionPool((int) $poolReport['pool_id'], false);
        $second = new ilObjQuestionPool((int) $poolReport['reimported_pool_id'], false);
        $candidateIds = $second->getAllQuestionIds();
        if ($pool->getTitle() !== $second->getTitle() || $pool->getDescription() !== $second->getDescription()) {
            $report['failures'][] = ['pool' => $key, 'stage' => 'pool_metadata_roundtrip'];
        }
        $candidates = [];
        foreach ($candidateIds as $id) {
            $snapshot = corpusSnapshot(assQuestion::instantiateQuestion((int) $id));
            $candidates[hash('sha256', json_encode($snapshot, JSON_THROW_ON_ERROR))][] = (int) $id;
        }
        $firstMap = [];
        $secondMap = [];
        foreach ($sourceQuestions[$key] as $sourceQuestion) {
            $id = (int) $runtimeByKey[$sourceQuestion['key']]['question_id'];
            $firstMap[$sourceQuestion['key']] = $id;
            $snapshot = corpusSnapshot(assQuestion::instantiateQuestion($id));
            $differences = corpusDifferences(corpusExpected($sourceQuestion), $snapshot);
            if ($differences !== []) {
                $report['failures'][] = ['key' => $sourceQuestion['key'], 'stage' => 'source_import', 'fields' => $differences];
            }
            $fingerprint = hash('sha256', json_encode($snapshot, JSON_THROW_ON_ERROR));
            if (empty($candidates[$fingerprint])) {
                $report['failures'][] = ['key' => $sourceQuestion['key'], 'stage' => 'export_reimport_semantics'];
                continue;
            }
            $secondMap[$sourceQuestion['key']] = array_shift($candidates[$fingerprint]);
        }
        if (count($candidateIds) !== count($sourceQuestions[$key])) {
            $report['failures'][] = ['pool' => $key, 'stage' => 'reimport_count'];
        }
        $taxonomyBefore = corpusTaxonomies($pool, $firstMap);
        $poolReport['taxonomy_count'] = count($taxonomyBefore);
        $poolReport['taxonomy_nodes'] = array_sum(array_map(static fn(array $tax): int => count($tax['nodes']), $taxonomyBefore));
        $poolReport['taxonomy_assignments'] = array_sum(array_map(static fn(array $tax): int => count($tax['assignments']), $taxonomyBefore));
        if ($taxonomyBefore !== ($taxonomyAfter = corpusTaxonomies($second, $secondMap))) {
            corpusWrite($directory . '/taxonomy-' . $key . '-debug.json', ['before' => $taxonomyBefore, 'after' => $taxonomyAfter]);
            $report['failures'][] = ['pool' => $key, 'stage' => 'taxonomy_roundtrip'];
        }
    }
    unset($poolReport);
    $report['legacy_empty_editor_modes_defaulted'] = $sourceEditorModeDefaults;
    $report['semantic_verification_complete'] = $report['questions'] === $manifest['questions'];
    corpusWrite($directory . '/import-report.json', $report);
    echo json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), "\n";
    exit($report['failures'] === [] && $report['semantic_verification_complete'] ? 0 : 1);
}

if ($mode === 'verify-teacher') {
    $transfer = corpusJSON(getenv('ILIAS_TEACHER_TRANSFER_REPORT') ?: $directory . '/teacher-transfer-report.json');
    $report = ['questions' => 0, 'reimported' => 0, 'legacy_empty_editor_modes_defaulted' => $sourceEditorModeDefaults, 'pools' => [], 'failures' => []];
    foreach ($transfer['pools'] as $teacherPool) {
        $key = $teacherPool['key'];
        $first = new ilObjQuestionPool((int) $teacherPool['pool_ref_id']);
        $second = new ilObjQuestionPool((int) $teacherPool['reimport_pool_ref_id']);
        $mappings = [];
        foreach (['original' => $teacherPool['question_ids'], 'reimported' => $teacherPool['reimport_question_ids']] as $stage => $ids) {
            $candidates = [];
            foreach ($ids as $id) {
                $snapshot = corpusSnapshot(assQuestion::instantiateQuestion((int) $id));
                $candidates[hash('sha256', json_encode($snapshot, JSON_THROW_ON_ERROR))][] = (int) $id;
            }
            $map = [];
            foreach ($sourceQuestions[$key] as $sourceQuestion) {
                $fingerprint = hash('sha256', json_encode(corpusExpected($sourceQuestion), JSON_THROW_ON_ERROR));
                if (empty($candidates[$fingerprint])) {
                    $report['failures'][] = ['key' => $sourceQuestion['key'], 'stage' => 'teacher_ui_' . $stage . '_source_semantics'];
                    continue;
                }
                $map[$sourceQuestion['key']] = array_shift($candidates[$fingerprint]);
            }
            if (count($ids) !== count($sourceQuestions[$key])) $report['failures'][] = ['pool' => $key, 'stage' => 'teacher_ui_' . $stage . '_count'];
            $mappings[$stage] = $map;
        }
        $before = corpusTaxonomies($first, $mappings['original']);
        $after = corpusTaxonomies($second, $mappings['reimported']);
        if ($before !== $after) $report['failures'][] = ['pool' => $key, 'stage' => 'teacher_ui_taxonomy_roundtrip'];
        if ($first->getTitle() !== $second->getTitle() || $first->getDescription() !== $second->getDescription()) {
            $report['failures'][] = ['pool' => $key, 'stage' => 'teacher_ui_pool_metadata'];
        }
        $poolReport = ['key' => $key, 'questions' => count($mappings['original']), 'reimported' => count($mappings['reimported']),
            'taxonomy_count' => count($before), 'taxonomy_nodes' => array_sum(array_map(static fn(array $tax): int => count($tax['nodes']), $before)),
            'taxonomy_assignments' => array_sum(array_map(static fn(array $tax): int => count($tax['assignments']), $before))];
        $report['pools'][] = $poolReport;
        $report['questions'] += $poolReport['questions'];
        $report['reimported'] += $poolReport['reimported'];
    }
    if ($report['questions'] !== $manifest['questions'] || $report['reimported'] !== $manifest['questions']) {
        $report['failures'][] = ['kind' => 'teacher_ui_corpus_incomplete'];
    }
    corpusWrite($directory . '/teacher-semantic-report.json', $report);
    echo json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), "\n";
    exit($report['failures'] === [] ? 0 : 1);
}

if ($mode === 'exam') {
    $accounts = corpusJSON(getenv('ILIAS_CHROME_STATE') ?: sys_get_temp_dir() . '/asssql-chrome-accounts.json');
    $transfer = corpusJSON(getenv('ILIAS_TEACHER_TRANSFER_REPORT') ?: $directory . '/teacher-transfer-report.json');
    $teacherPools = [];
    foreach ($transfer['pools'] as $pool) {
        $teacherPools[(string) $pool['key']] = $pool;
    }
    if (($exampleId = (int) getenv('ILIAS_CORPUS_EXAMPLE_QUESTION_ID')) > 0) {
        $example = assQuestion::instantiateQuestion($exampleId);
        if (!$example instanceof assSQLQuestion || $example->getOwner() !== (int) $accounts['teacher']['id']) {
            throw new RuntimeException('The selected regression question must be an SQL question owned by the actual teacher account.');
        }
        $xml = simplexml_load_string($example->toXML(), SimpleXMLElement::class, LIBXML_NONET);
        $item = $xml->item;
        $metadata = [];
        foreach ($item->itemmetadata->qtimetadata->qtimetadatafield as $field) $metadata[(string) $field->fieldlabel] = (string) $field->fieldentry;
        $text = '';
        foreach ($item->xpath('./presentation//mattext') as $mattext) $text .= (string) $mattext;
        $feedback = [];
        foreach ($item->itemfeedback as $entry) {
            $ident = (string) $entry['ident'];
            if (!in_array($ident, ['response_allcorrect', 'response_onenotcorrect'], true)) continue;
            $feedback[$ident] = '';
            foreach ($entry->xpath('.//mattext') as $mattext) $feedback[$ident] .= (string) $mattext;
        }
        $record = ['key' => 'example:1', 'pool' => 'example', 'ident' => (string) $item['ident'], 'title' => (string) $item['title'],
            'comment' => (string) $item->qticomment, 'question' => $text, 'maxattempts' => (int) $item['maxattempts'], 'metadata' => $metadata, 'feedback' => $feedback];
        $second = $record;
        $second['key'] = 'example:2';
        $sourceQuestions = ['example' => [$record, $second]];
        $sourceOrdinals = ['example:1' => 1, 'example:2' => 2];
        $manifest = ['questions' => 2, 'pools' => [['key' => 'example', 'count' => 2]]];
        $references = ilObject::_getAllReferences($example->getObjId());
        $teacherPools = ['example' => ['question_ids' => [$exampleId, $exampleId], 'pool_ref_id' => (int) reset($references)]];
    }
    $sourceTotal = count($sourceOrdinals);
    if ($sourceTotal !== (int) $manifest['questions']) throw new RuntimeException('Manifest and original corpus source count differ.');
    $sourceStart = corpusRangeInteger('ILIAS_CORPUS_SOURCE_START', 0, 0);
    if ($sourceStart >= $sourceTotal) throw new InvalidArgumentException('Corpus source start is outside the source corpus.');
    $limit = corpusRangeInteger('ILIAS_CORPUS_LIMIT', $sourceTotal - $sourceStart, 1);
    if ($limit > $sourceTotal - $sourceStart) throw new InvalidArgumentException('Corpus source range exceeds the source corpus.');
    $sourceEnd = $sourceStart + $limit;
    $orderedSourceKeys = [];
    foreach ($manifest['pools'] as $sourcePool) {
        $poolSources = $sourceQuestions[$sourcePool['key']] ?? throw new RuntimeException('Manifest source pool is missing.');
        if (count($poolSources) !== (int) $sourcePool['count']) throw new RuntimeException('Manifest source pool count differs.');
        foreach ($poolSources as $sourceQuestion) $orderedSourceKeys[] = $sourceQuestion['key'];
    }
    if ($orderedSourceKeys !== array_keys($sourceOrdinals)) throw new RuntimeException('Manifest pool order differs from original source order.');
    $expectedSourceKeys = array_slice($orderedSourceKeys, $sourceStart, $limit);
    $selected = [];
    $selectedOriginalIds = [];
    foreach ($manifest['pools'] as $sourcePool) {
        $key = $sourcePool['key'];
        if ($sourceOrdinals[$sourceQuestions[$key][0]['key']] > $sourceEnd) break;
        $teacherPool = $teacherPools[$key] ?? throw new RuntimeException('Missing teacher-Chrome-imported pool ' . $key);
        if ($exampleId <= 0 && count(array_unique($teacherPool['question_ids'])) !== count($teacherPool['question_ids'])) {
            throw new RuntimeException('Teacher source pool contains duplicate question IDs.');
        }
        $candidates = [];
        foreach ($teacherPool['question_ids'] as $id) {
            $question = assQuestion::instantiateQuestion((int) $id);
            $snapshot = corpusSnapshot($question);
            $fingerprint = hash('sha256', json_encode($snapshot, JSON_THROW_ON_ERROR));
            $candidates[$fingerprint][] = ['id' => (int) $id, 'snapshot' => $snapshot];
        }
        foreach ($sourceQuestions[$key] as $sourceQuestion) {
            $ordinal = $sourceOrdinals[$sourceQuestion['key']];
            if ($ordinal > $sourceEnd) break;
            $fingerprint = hash('sha256', json_encode(corpusExpected($sourceQuestion), JSON_THROW_ON_ERROR));
            if (empty($candidates[$fingerprint])) throw new RuntimeException('Teacher UI import differs from original source at ' . $sourceQuestion['key']);
            // Consume even skipped identical sources, so a later range never reuses their original question IDs.
            $candidate = array_shift($candidates[$fingerprint]);
            if ($ordinal <= $sourceStart) continue;
            if ($exampleId <= 0 && isset($selectedOriginalIds[$candidate['id']])) throw new RuntimeException('Duplicate original teacher question in corpus range.');
            $selectedOriginalIds[$candidate['id']] = true;
            $selected[$sourceQuestion['key']] = ['pool' => $key, 'candidate' => $candidate, 'original_source_ordinal' => $ordinal];
        }
    }
    if (array_keys($selected) !== $expectedSourceKeys) throw new RuntimeException('Selected source key coverage differs from the requested range.');
    $test = new ilObjTest();
    $test->setTitle($limit === $sourceTotal ? 'SQL Chrome — all existing StudOn questions'
        : 'SQL Chrome — source questions ' . ($sourceStart + 1) . '–' . $sourceEnd . ' of ' . $sourceTotal);
    $test->setDescription('Disposable acceptance test. Every answer is entered by the ordinary student account in real Chrome.');
    $test->setOwner((int) $accounts['teacher']['id']);
    $test->create();
    $test->createReference();
    $test->putInTree((int) $accounts['category_ref_id']);
    $test->setPermissions((int) $accounts['category_ref_id']);
    $DIC->rbac()->admin()->grantPermission(4, ilRbacReview::_getOperationIdsByName(['visible', 'read']), $test->getRefId());
    $test->saveToDb();
    $runtime = fopen($directory . '/' . $examPrefix . 'exam-runtime.jsonl', 'w');
    $state = ['test_id' => $test->getTestId(), 'test_ref_id' => $test->getRefId(),
        'teacher_id' => $accounts['teacher']['id'], 'student_id' => $accounts['student']['id'],
        'source_kind' => $exampleId > 0 ? 'teacher-owned-example' : 'original-corpus',
        'source_range_explicit' => getenv('ILIAS_CORPUS_SOURCE_START') !== false || getenv('ILIAS_CORPUS_LIMIT') !== false,
        'source_total_questions' => $sourceTotal, 'source_start' => $sourceStart, 'source_count' => $limit,
        'source_end_exclusive' => $sourceEnd, 'source_keys_sha256' => hash('sha256', json_encode($expectedSourceKeys, JSON_THROW_ON_ERROR)),
        'source_questions_sha256' => $exampleId > 0 ? null : hash_file('sha256', $directory . '/questions.jsonl'),
        'url' => ILIAS_HTTP_PATH . '/goto.php/tst/' . $test->getRefId(), 'questions' => []];
    foreach ($selected as $sourceKey => $selection) {
        $key = $selection['pool'];
        $candidate = $selection['candidate'];
        $teacherPool = $teacherPools[$key];
        if (!isset($state['role_check_urls'])) {
            $sourceURLs = corpusURLs(new ilObjQuestionPool((int) $teacherPool['pool_ref_id']), $candidate['id']);
            $state['role_check_urls'] = array_intersect_key($sourceURLs, array_flip(['edit_url', 'import_url', 'export_url']));
        }
        $testQuestionId = $test->insertQuestion($candidate['id']);
        $snapshot = corpusSnapshot(assQuestion::instantiateQuestion($testQuestionId));
        if (corpusDifferences($candidate['snapshot'], $snapshot) !== []) {
            throw new RuntimeException('Copy into student test changed question ' . $sourceKey);
        }
        $state['questions'][$sourceKey] = ['question_id' => $testQuestionId, 'original_question_id' => $candidate['id'],
            'original_source_ordinal' => $selection['original_source_ordinal']];
        fwrite($runtime, json_encode(['key' => $sourceKey, 'pool' => $key,
            'original_source_ordinal' => $selection['original_source_ordinal'],
            'question_id' => $testQuestionId, 'original_question_id' => $candidate['id'],
            'sequences' => [$snapshot['sequence_a'], $snapshot['sequence_b'], $snapshot['sequence_c']],
            'integrity' => $snapshot['integrity_check'], 'output_relation' => $snapshot['output_relation'],
            'metrics' => $snapshot['metrics'], 'maximum_points' => $snapshot['maximum_points']], JSON_THROW_ON_ERROR) . "\n");
    }
    fclose($runtime);
    if (array_keys($state['questions']) !== $expectedSourceKeys) throw new RuntimeException('Created exam source coverage differs from the requested range.');
    $main = $test->getMainSettings();
    $main = $main->withTestBehaviourSettings($main->getTestBehaviourSettings()->withNumberOfTries(5)->withBlockAfterPassedEnabled(false))
        ->withQuestionBehaviourSettings($main->getQuestionBehaviourSettings()->withAutosaveEnabled(true)->withAutosaveInterval(2000)->withShuffleQuestions(false))
        ->withParticipantFunctionalitySettings($main->getParticipantFunctionalitySettings()->withQuestionListEnabled(false));
    $test->getMainSettingsRepository()->store($main, $test->getTestId());
    $score = $test->getScoreSettings();
    $score = $score->withResultSummarySettings($score->getResultSummarySettings()->withScoreReporting(ILIAS\Test\Settings\ScoreReporting\ScoreReportingTypes::SCORE_REPORTING_FINISHED))
        ->withResultDetailsSettings($score->getResultDetailsSettings()->withShowPassDetails(true)->withShowSolutionListComparison(true)->withShowSolutionFeedback(true));
    $test->getScoreSettingsRepository()->store($score, $test->getTestId());
    $test->getObjectProperties()->storePropertyIsOnline($test->getObjectProperties()->getPropertyIsOnline()->withOnline());
    corpusWrite($directory . '/' . $examPrefix . 'exam-state.json', $state);
    echo json_encode(['test_id' => $test->getTestId(), 'test_ref_id' => $test->getRefId(), 'questions' => count($state['questions']), 'url' => $state['url']], JSON_THROW_ON_ERROR), "\n";
    exit;
}

if ($mode === 'report') {
    $state = corpusJSON($directory . '/' . $examPrefix . 'exam-state.json');
    $db = $DIC->database();
    $active = $db->fetchAssoc($db->queryF('SELECT * FROM tst_active WHERE test_fi = %s AND user_fi = %s',
        ['integer', 'integer'], [$state['test_id'], $state['student_id']]));
    if (!$active) {
        throw new RuntimeException('Student has not started the actual test.');
    }
    $pass = isset($argv[3]) ? (int) $argv[3] : max(0, (int) $active['tries'] - 1);
    $passResult = $db->fetchAssoc($db->queryF('SELECT * FROM tst_pass_result WHERE active_fi = %s AND pass = %s',
        ['integer', 'integer'], [$active['active_id'], $pass]));
    $expectedInputs = [];
    $runtimeSourceKeys = [];
    $stream = fopen($directory . '/' . $examPrefix . 'exam-runtime.jsonl', 'r');
    while (($line = fgets($stream)) !== false) {
        $row = json_decode($line, true, flags: JSON_THROW_ON_ERROR);
        if (isset($expectedInputs[(int) $row['question_id']])) throw new RuntimeException('Duplicate native runtime question ID.');
        $runtimeSourceKeys[] = $row['key'];
        if (isset($state['source_start'])) {
            $expectedIdentity = $state['questions'][$row['key']] ?? throw new RuntimeException('Foreign source key in native runtime.');
            if ((int) $row['original_source_ordinal'] !== (int) $state['source_start'] + count($runtimeSourceKeys)
                || ['question_id' => $row['question_id'], 'original_question_id' => $row['original_question_id'],
                    'original_source_ordinal' => $row['original_source_ordinal']] !== $expectedIdentity) {
                throw new RuntimeException('Native runtime source identity differs from declared range.');
            }
        }
        $expectedInputs[(int) $row['question_id']] = $row;
    }
    fclose($stream);
    if ($runtimeSourceKeys !== array_keys($state['questions'])) throw new RuntimeException('Native runtime source coverage differs from exam.');
    $results = [];
    $rows = $db->queryF('SELECT * FROM tst_test_result WHERE active_fi = %s AND pass = %s',
        ['integer', 'integer'], [$active['active_id'], $pass]);
    while ($row = $db->fetchAssoc($rows)) {
        $results[(int) $row['question_fi']] = $row;
    }
    $authorized = $db->fetchAssoc($db->queryF('SELECT COUNT(*) AS rows_count, COUNT(DISTINCT question_fi) AS question_count FROM tst_solutions WHERE active_fi = %s AND pass = %s AND authorized = %s',
        ['integer', 'integer', 'integer'], [$active['active_id'], $pass, 1]));
    $report = ['student_id' => $state['student_id'], 'student_is_system_admin' => $DIC->rbac()->review()->isAssigned((int) $state['student_id'], SYSTEM_ROLE_ID), 'active_id' => $active['active_id'], 'pass' => $pass,
        'expected_questions' => count($state['questions']), 'authorized_rows' => (int) $authorized['rows_count'], 'authorized_unique_questions' => (int) $authorized['question_count'], 'saved_authorized_answers' => 0, 'graded_questions' => count($results),
        'points' => 0.0, 'maximum_points' => 0.0, 'pass_result' => $passResult,
        'source_coverage' => array_intersect_key($state, array_flip(['source_kind', 'source_total_questions', 'source_start', 'source_count', 'source_end_exclusive', 'source_keys_sha256', 'source_questions_sha256'])),
        'source_model_mismatches' => [], 'failures' => []];
    $answerDigest = hash_init('sha256');
    foreach ($state['questions'] as $key => $ids) {
        $id = (int) $ids['question_id'];
        $question = assQuestion::instantiateQuestion($id);
        $solution = $question->getSolutionStored((int) $active['active_id'], $pass, true);
        if (empty($solution['value1'])) {
            $report['failures'][] = ['key' => $key, 'kind' => 'missing_authorized_answer'];
            continue;
        }
        hash_update($answerDigest, $id . ':' . strlen($solution['value1']) . ':' . $solution['value1']);
        $answer = ParticipantInput::fromJSON($solution['value1']);
        $report['saved_authorized_answers']++;
        $expected = $expectedInputs[$id];
        if (preg_replace('/\r\n?/', "\n", $answer->getSequence()) !== preg_replace('/\r\n?/', "\n", $expected['sequences'][1])) {
            $report['failures'][] = ['key' => $key, 'kind' => 'stored_SQL_changed'];
        }
        $points = $question->calculateReachedPoints((int) $active['active_id'], $pass, true);
        $report['points'] += $points;
        $report['maximum_points'] += $question->getMaximumPoints();
        if (!isset($results[$id]) || (float) $results[$id]['points'] !== $points) {
            $report['failures'][] = ['key' => $key, 'kind' => 'stored_grade_differs_from_grader'];
        }
        if ($points !== $question->getMaximumPoints()) {
            $report['source_model_mismatches'][] = ['key' => $key, 'points' => $points, 'maximum' => $question->getMaximumPoints(), 'error' => $answer->getErrorBool()];
        }
    }
    $report['authorized_answer_sha256'] = hash_final($answerDigest);
    if ($report['authorized_rows'] !== count($state['questions']) || $report['authorized_unique_questions'] !== count($state['questions'])) {
        $report['failures'][] = ['kind' => 'authorized_answer_count'];
    }
    if (!$passResult || (float) $passResult['points'] !== $report['points']) {
        $report['failures'][] = ['kind' => 'pass_total_differs_from_question_sum'];
    }
    if (!$passResult || (int) $passResult['questioncount'] !== count($state['questions'])
        || (int) $passResult['answeredquestions'] !== count($state['questions'])
        || $passResult['finalized_by'] !== 'finished_by_participant') {
        $report['failures'][] = ['kind' => 'native_pass_not_fully_answered_and_finished'];
    }
    $browser = corpusJSON($directory . '/' . $examPrefix . 'browser-report.json');
    $report['ui_score'] = $browser['ui_score'] ?? null;
    $report['ui_answered'] = $browser['ui_answered'] ?? null;
    $report['ui_result_verified'] = getenv('ILIAS_CORPUS_VERIFY_UI') !== '0';
    if ($report['ui_result_verified']) {
        if (!preg_match('/([\d.,]+)\s+Of\s+([\d.,]+)/i', $report['ui_score'] ?? '', $score)
            || (float) str_replace(',', '', $score[1]) !== $report['points']
            || (float) str_replace(',', '', $score[2]) !== $report['maximum_points']) {
            $report['failures'][] = ['kind' => 'Chrome_result_total_differs_from_database'];
        }
        if (!preg_match('/(\d+)\s+Of\s+(\d+)/i', $report['ui_answered'] ?? '', $answered)
            || (int) $answered[1] !== count($state['questions']) || (int) $answered[2] !== count($state['questions'])) {
            $report['failures'][] = ['kind' => 'Chrome_answered_count'];
        }
    }
    if ($report['student_is_system_admin']) {
        $report['failures'][] = ['kind' => 'student_has_system_admin_role'];
    }
    $ctrl = $DIC->ctrl();
    $ctrl->setParameterByClass(ilObjTestGUI::class, 'ref_id', $state['test_ref_id']);
    $ctrl->setParameterByClass(ilTestEvaluationGUI::class, 'active_id', $active['active_id']);
    $ctrl->setParameterByClass(ilTestEvaluationGUI::class, 'pass', $pass);
    $report['native_attempt_details_url'] = $ctrl->getLinkTargetByClass([ilRepositoryGUI::class, ilObjTestGUI::class, ilTestResultsGUI::class, ilMyTestResultsGUI::class, ilTestEvaluationGUI::class], 'outUserPassDetails');
    corpusWrite($directory . '/' . $examPrefix . 'student-database-report.json', $report);
    echo json_encode($report, JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR), "\n";
    exit($report['failures'] === [] ? 0 : 1);
}

$runtime = fopen($directory . '/runtime.jsonl', 'w');
$report = ['ilias' => ILIAS_VERSION_NUMERIC, 'pools' => [], 'questions' => 0, 'imported' => 0, 'reimported' => 0, 'failures' => []];
foreach ($manifest['pools'] as $sourcePool) {
    $key = $sourcePool['key'];
    [$pool, $mapping] = corpusImport($directory . '/' . $sourcePool['archive']);
    $poolReport = ['key' => $key, 'expected' => $sourcePool['count'], 'imported' => count($mapping), 'pool_id' => $pool->getId(), 'pool_ref_id' => $pool->getRefId()];
    if (count($mapping) !== $sourcePool['count']) {
        throw new RuntimeException('Question count mismatch in pool ' . $key);
    }
    $snapshots = [];
    $sourceMapping = [];
    foreach ($sourceQuestions[$key] as $sourceQuestion) {
        $oldId = substr($sourceQuestion['ident'], strrpos($sourceQuestion['ident'], '_') + 1);
        $id = $mapping[$oldId] ?? throw new RuntimeException('Missing imported question mapping.');
        $loaded = assQuestion::instantiateQuestion($id);
        if (!$loaded instanceof assSQLQuestion) {
            throw new RuntimeException('Incorrect imported question type.');
        }
        $snapshot = corpusSnapshot($loaded);
        $differences = corpusDifferences(corpusExpected($sourceQuestion), $snapshot);
        if ($differences !== []) {
            $report['failures'][] = ['key' => $sourceQuestion['key'], 'stage' => 'source_import', 'fields' => $differences];
        }
        $snapshots[$id] = $snapshot;
        $sourceMapping[$sourceQuestion['key']] = $id;
        fwrite($runtime, json_encode(corpusURLs($pool, $id) + ['key' => $sourceQuestion['key'], 'pool' => $key, 'question_id' => $id,
            'sequences' => [$snapshot['sequence_a'], $snapshot['sequence_b'], $snapshot['sequence_c']],
            'integrity' => $snapshot['integrity_check'], 'output_relation' => $snapshot['output_relation'],
            'metrics' => $snapshot['metrics'], 'maximum_points' => $snapshot['maximum_points']], JSON_THROW_ON_ERROR) . "\n");
        $report['questions']++;
        $report['imported']++;
    }
    $taxonomyBefore = corpusTaxonomies($pool, $sourceMapping);
    $export = (new ilExport())->exportObject('qpl', $pool->getId());
    if (!$export['success']) {
        throw new RuntimeException('Native pool ZIP export failed.');
    }
    $exportPath = $export['directory'] . '/' . $export['file'];
    copy($exportPath, $directory . '/' . $key . '-roundtrip.zip');
    [$reimported, $secondMapping] = corpusImport($exportPath);
    $poolReport['reimported'] = count($secondMapping);
    $poolReport['reimported_pool_id'] = $reimported->getId();
    $secondSourceMapping = [];
    foreach ($sourceMapping as $questionKey => $id) {
        $secondId = $secondMapping[(string) $id] ?? throw new RuntimeException('Missing reimport mapping.');
        $secondSourceMapping[$questionKey] = $secondId;
        $differences = corpusDifferences($snapshots[$id], corpusSnapshot(assQuestion::instantiateQuestion($secondId)));
        if ($differences !== []) {
            $report['failures'][] = ['key' => $questionKey, 'stage' => 'export_reimport', 'fields' => $differences];
        }
        $report['reimported']++;
    }
    $poolReport['taxonomy_count'] = count($taxonomyBefore);
    if ($taxonomyBefore !== corpusTaxonomies($reimported, $secondSourceMapping)) {
        $report['failures'][] = ['pool' => $key, 'stage' => 'taxonomy_roundtrip'];
    }
    $report['pools'][] = $poolReport;
    corpusWrite($directory . '/import-report.json', $report);
    fflush($runtime);
    echo json_encode($poolReport, JSON_THROW_ON_ERROR), "\n";
}
fclose($runtime);
corpusWrite($directory . '/import-report.json', $report);
echo json_encode(['questions' => $report['questions'], 'imported' => $report['imported'], 'reimported' => $report['reimported'], 'failures' => $report['failures']], JSON_THROW_ON_ERROR), "\n";
exit($report['failures'] === [] ? 0 : 1);
