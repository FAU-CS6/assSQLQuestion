<?php

declare(strict_types=1);

/**
 * An internal helper class to define a solid structure for the participants input
 *
 * @author Dominik Probst <dominik.probst@fau.de>
 */
class ParticipantInput
{
    /**
     * @var string The sql sequence the participant entered
     */
    public string $sequence = "";

    /**
     * @var boolean A boolean indicating whether the participants sequence(s) contain errors (true) or not (false)
     */
    public bool $error_bool = false;

    /**
     * @var string A json string containing the error of the current sql sequences
     */
    public string $error = "";

    /**
     * @var boolean A boolean indicating whether the participants sequence(s) have been executed (true) or not (false)
     */
    public bool $executed_bool = false;

    /**
     * @var string A json string containg the output relation of the participants sequence(s)
     */
    public string $output_relation = "";

    /**
     * @var ParticipantMetric[] An array containg all pattern solution ParticipantMetrics used in this question
     */
    public array $participant_metrics = array();

    /** Optional, untrusted browser-side diagnostics; never a grading metric. */
    private ?array $qss_evaluation = null;

    private const QSS_MAX_JSON_BYTES = 16384;

    /**
     * Constructor
     *
     * The construtor of a single ParticipantInput
     *
     * @access public
     */
    public function __construct()
    {
        // Do nothing
    }

    /**
     * Serialize a ParticipantInput object to a JSON string
     *
     * @return string The JSON string
     */
    public function toJSON(): string
    {
        // To use json_encode we need an array containing the values of the object
        $arr = array(
            'sequence' => $this->sequence,
            'error_bool' => $this->error_bool,
            'error' => $this->error,
            'executed_bool' => $this->executed_bool,
            'output_relation' => $this->output_relation
        );

        // Additionally we of course need the ParticipantMetrics
        $participant_metrics_json = array();

        foreach ($this->participant_metrics as $participant_metric) {
            array_push($participant_metrics_json, $participant_metric->toJSON());
        }

        $arr['participant_metrics'] = $participant_metrics_json;

        if ($this->qss_evaluation !== null) {
            $arr['qss_evaluation'] = $this->qss_evaluation;
        }

        return json_encode($arr);
    }

    /**
     * Unserialize a JSON string into a ParticipantInput
     *
     * @param string $json The json string that should be transformed into a ParticipantInput
     * @return ParticipantInput The resulting ParticipantInput
     */
    public static function fromJSON(string $json): ParticipantInput
    {
        // At first we decode the JSON
        $decoded_json = null;

        // This might fail if the JSON is not valid at all
        try {
            $decoded_json = json_decode($json, true);
        } catch (Exception $e) {
            throw new Exception("We need a valid JSON Structure to decode it into a ParticipantInput");
        }

        // Now we build the ParticipantInput by setting all values
        $participant_input = new ParticipantInput();

        // The sequence
        if (array_key_exists('sequence', $decoded_json)) {
            $participant_input->setSequence((string) $decoded_json['sequence']);
        } else {
            throw new Exception("We need a sequence to decode a JSON into a ParticipantInput");
        }

        // The error_bool
        if (array_key_exists('error_bool', $decoded_json)) {
            $participant_input->setErrorBool($decoded_json['error_bool'] == "true" ? true : false);
        } else {
            throw new Exception("We need an error_bool to decode a JSON into a ParticipantInput");
        }

        // The error
        if (array_key_exists('error', $decoded_json)) {
            $participant_input->setError($decoded_json['error']);
        } else {
            throw new Exception("We need an error to decode a JSON into a ParticipantInput");
        }

        // The executed_bool
        if (array_key_exists('executed_bool', $decoded_json)) {
            $participant_input->setExecutedBool($decoded_json['executed_bool'] == "true" ? true : false);
        } else {
            throw new Exception("We need an executed_bool to decode a JSON into a ParticipantInput");
        }

        // The output_relation
        if (array_key_exists('output_relation', $decoded_json)) {
            $participant_input->setOutputRelation($decoded_json['output_relation']);
        } else {
            throw new Exception("We need an output_relation to decode a JSON into a ParticipantInput");
        }

        // The participant_metrics
        if (array_key_exists('participant_metrics', $decoded_json)) {
            foreach ($decoded_json['participant_metrics'] as $participant_metric) {
                // Decode the inner JSON as well
                $participant_metric_decoded = json_decode($participant_metric, true);

                $participant_input->setSingleParticipantMetric(new ParticipantMetric(
                    $participant_metric_decoded['type'],
                    $participant_metric_decoded['value']
                ));
            }
        } else {
            throw new Exception("We need the participant_metrics to decode a JSON into a ParticipantInput");
        }

        if (isset($decoded_json['qss_evaluation']) && is_array($decoded_json['qss_evaluation'])) {
            $participant_input->setQssEvaluation($decoded_json['qss_evaluation']);
        }

        return $participant_input;
    }

    public function getQssEvaluation(): ?array
    {
        return $this->qss_evaluation;
    }

    /** Invalid optional diagnostics are discarded without rejecting the answer. */
    public function setQssEvaluation(?array $evaluation): void
    {
        $this->qss_evaluation = self::validateQssEvaluation($evaluation);
    }

    public function setQssEvaluationFromJSON(string $json): void
    {
        $this->qss_evaluation = null;
        // Allow some extra incoming edits before keeping only the first fifty.
        if ($json === '' || strlen($json) > self::QSS_MAX_JSON_BYTES * 4) {
            return;
        }
        try {
            $decoded = json_decode($json, true, 32, JSON_THROW_ON_ERROR);
            if (is_array($decoded)) {
                $this->setQssEvaluation($decoded);
            }
        } catch (JsonException $error) {
            // A malformed sidecar must not break the legacy answer/autosave.
        }
    }

    private static function validateQssEvaluation(?array $evaluation): ?array
    {
        if ($evaluation === null || !in_array($evaluation['status'] ?? null,
            ['exact', 'unsupported', 'error', 'cancelled', 'partial', 'score-zero-certified'], true)) {
            return null;
        }
        // Do not persist full queries, schemas or ASTs supplied by the browser.
        $keys = ['status', 'engine', 'version', 'distance', 'points', 'maxPoints',
            'edits', 'limitations', 'exactWithinModel', 'answerDigest', 'referenceRevision',
            'lowerBound', 'upperBound', 'runtimeMs', 'method', 'model', 'nodeCount',
            'referenceNodes', 'candidateNodes', 'visitedStates', 'visited', 'reason',
            'message', 'searchStats', 'diagnostics', 'editsTruncated', 'referenceDistance',
            'pointsPerEdit', 'formula', 'scoreCertifiedWithinModel', 'validation', 'code',
            'normalizationDistance', 'provisionalRubric', 'rubric', 'scale', 'modelVersion'];
        $result = array_intersect_key($evaluation, array_fill_keys($keys, true));
        foreach (['engine', 'method', 'answerDigest', 'referenceRevision', 'formula', 'code', 'rubric', 'modelVersion'] as $key) {
            if (isset($result[$key]) && !is_string($result[$key])) {
                return null;
            }
        }
        if (isset($result['version']) && !is_string($result['version']) && !is_int($result['version'])) {
            return null;
        }
        foreach (['answerDigest', 'referenceRevision'] as $key) {
            if (isset($result[$key]) && !preg_match('/^[a-f0-9]{64}$/iD', $result[$key])) {
                return null;
            }
        }
        foreach (['distance', 'points', 'maxPoints', 'lowerBound', 'upperBound', 'runtimeMs',
                  'nodeCount', 'referenceNodes', 'candidateNodes', 'visitedStates', 'visited',
                  'referenceDistance', 'pointsPerEdit', 'normalizationDistance', 'scale'] as $key) {
            if (isset($result[$key]) &&
                ((!is_int($result[$key]) && !is_float($result[$key])) || !is_finite((float) $result[$key]) || $result[$key] < 0)) {
                return null;
            }
        }
        foreach (['exactWithinModel', 'scoreCertifiedWithinModel', 'editsTruncated', 'provisionalRubric'] as $key) {
            if (isset($result[$key]) && !is_bool($result[$key])) {
                return null;
            }
        }
        if (isset($result['validation'])) {
            if (!is_array($result['validation'])) {
                return null;
            }
            foreach (['reference', 'answer'] as $key) {
                if (isset($result['validation'][$key]) && !is_string($result['validation'][$key])) {
                    return null;
                }
            }
        }
        foreach (['edits', 'limitations'] as $key) {
            if (isset($result[$key])) {
                if (!is_array($result[$key]) || !array_is_list($result[$key])) {
                    return null;
                }
                foreach ($result[$key] as $entry) {
                    if ($key === 'limitations' ? !is_string($entry) :
                        (!is_string($entry) && (!is_array($entry) || array_is_list($entry)))) {
                        return null;
                    }
                }
                if (count($result[$key]) > 50 && $key === 'edits') {
                    $result['editsTruncated'] = true;
                }
                $result[$key] = array_slice($result[$key], 0, 50);
            }
        }
        if (isset($result['edits'])) {
            foreach ($result['edits'] as &$edit) {
                if (is_array($edit)) {
                    // Replay operations may contain complete ASTs. Retain only
                    // their compact feedback, never query/state snapshots.
                    $edit = array_intersect_key($edit, array_fill_keys(
                        ['type', 'name', 'description', 'path', 'cost'], true));
                    foreach (['type', 'name', 'description', 'path'] as $key) {
                        if (isset($edit[$key]) && !is_string($edit[$key])) {
                            return null;
                        }
                    }
                    if (isset($edit['cost']) && ((!is_int($edit['cost']) && !is_float($edit['cost'])) ||
                        !is_finite((float) $edit['cost']) || $edit['cost'] < 0)) {
                        return null;
                    }
                }
            }
            unset($edit);
        }
        if (!self::isBoundedQssMetadata($result)) {
            return null;
        }
        try {
            // Large but valid traces must not discard the whole assessment.
            // Leave the score/bindings intact and identify abbreviated feedback.
            while (!empty($result['edits']) &&
                strlen(json_encode($result, JSON_THROW_ON_ERROR)) > self::QSS_MAX_JSON_BYTES - 32) {
                array_pop($result['edits']);
                $result['editsTruncated'] = true;
            }
            return strlen(json_encode($result, JSON_THROW_ON_ERROR)) <= self::QSS_MAX_JSON_BYTES ? $result : null;
        } catch (JsonException $error) {
            return null;
        }
    }

    /** Accept only bounded plain JSON metadata, not objects or executable values. */
    private static function isBoundedQssMetadata(mixed $value, int $depth = 0): bool
    {
        if ($depth > 6) {
            return false;
        }
        if (is_string($value)) {
            return strlen($value) <= 2048;
        }
        if (is_float($value)) {
            return is_finite($value);
        }
        if ($value === null || is_int($value) || is_bool($value)) {
            return true;
        }
        if (!is_array($value) || count($value) > 100) {
            return false;
        }
        foreach ($value as $key => $entry) {
            if ((is_string($key) && strlen($key) > 64) || !self::isBoundedQssMetadata($entry, $depth + 1)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Returns the sql sequence
     *
     * @return string The sql sequence
     */
    public function getSequence(): string
    {
        return $this->sequence;
    }

    /**
     * Sets the sql sequence
     *
     * @param string $sequence The sql sequence
     */
    public function setSequence(string $sequence): void
    {
        $this->sequence = $sequence;
    }

    /**
     * Returns the error state of the execution (true for errors have been found)
     *
     * @return boolean The error state
     */
    public function getErrorBool(): bool
    {
        return $this->error_bool;
    }

    /**
     * Sets the error state of the execution (true for errors have been found)
     *
     * @param boolean $error_bool The error state of the execution
     */
    public function setErrorBool(bool $error_bool): void
    {
        $this->error_bool = $error_bool;
    }

    /**
     * Returns the error json of the execution (empty for no errors that have been found)
     *
     * @return string The error json
     */
    public function getError(): string
    {
        return $this->error;
    }

    /**
     * Sets the error json of the execution (empty for no errors that have been found)
     *
     * @param string $error The error json
     */
    public function setError(string $error): void
    {
        $this->error = $error;
    }

    /**
     * Returns the execution state (true for code was executed)
     *
     * @return boolean The execution state
     */
    public function getExecutedBool(): bool
    {
        return $this->executed_bool;
    }

    /**
     * Sets the execution state (true for code was executed)
     *
     * @param boolean $executed_bool The execution state
     */
    public function setExecutedBool(bool $executed_bool): void
    {
        $this->executed_bool = $executed_bool;
    }

    /**
     * Returns the output relation
     *
     * @return string The output relation
     */
    public function getOutputRelation(): string
    {
        return $this->output_relation;
    }

    /**
     * Sets the output relation
     *
     * @param string $output_relation The output relation
     */
    public function setOutputRelation(string $output_relation): void
    {
        $this->output_relation = $output_relation;
    }

    /**
     * Get all ParticipantMetrics
     *
     * @return ParticipantMetric[] A array containing all ParticipantMetrics
     */
    public function getAllParticipantMetrics(): array
    {
        return $this->participant_metrics;
    }

    /**
     * Sets all ParticipantMetrics
     *
     * @param ParticipantMetric[] $participant_metrics An array containg all ParticipantMetrics to be set
     */
    public function setAllPartcipantMetrics(array $participant_metrics): void
    {
        $this->participant_metrics = $participant_metrics;
    }

    /**
     * Get all ParticipantMetrics with a specific type
     *
     * @param string $type The type of the searched ParticipantMetric
     * @return ParticipantMetric[] A array containing all metrics with this type
     */
    public function getParticipantMetricsWithType($type): array
    {
        $found_metrics = array();

        foreach ($this->participant_metrics as $participant_metric) {
            if ($participant_metric->getType() == $type) {
                array_push($found_metrics, $participant_metric);
            }
        }

        return $found_metrics;
    }

    /**
     * Save a single ParticipantMetric
     *
     * @param ParticipantMetric $participant_metric The ParticipantMetric to be set
     */
    public function setSingleParticipantMetric($participant_metric): void
    {
        if (is_a($participant_metric, "ParticipantMetric")) {
            // Remove existing SolutionMetric with the same type
            for ($i = 0; $i < sizeof($this->participant_metrics); $i++) {
                if ($participant_metric->getType() == $this->participant_metrics[$i]->getType()) {
                    array_splice($this->participant_metrics, $i, 1);
                }
            }

            // Push the new SolutionMetric
            array_push($this->participant_metrics, $participant_metric);
        } else {
            throw new Exception("Object is no ParticipantMetric in setSingleParticipantMetric()");
        }
    }
}
