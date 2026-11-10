<?php

declare(strict_types=1);

/**
 * Represents the actual JS block
 *
 * @author Marco Angerer <marco.angerer@fau.de>
 */
class JsBlock extends GUIElement
{
    public const QSS_ENGINE = 'graph-qss-sqlite-v2';
    public const QSS_ENGINE_VERSION = '2.1.1';
    public const QSS_RUBRIC = 'paper-linear-v2';
    public const QSS_SCALE = 1;
    public const QSS_DEDUCTION_BUDGET = 5;

    public static function getQssScale(float $points): float
    {
        return $points > 0 ? $points / self::QSS_DEDUCTION_BUDGET : 1.0;
    }

    public static function getQssQuestionText($question): string
    {
        return method_exists($question, 'getQuestion')
            ? html_entity_decode(strip_tags($question->getQuestion()), ENT_QUOTES | ENT_HTML5, 'UTF-8') : '';
    }

    public static function getQssReferenceRows($question): ?int
    {
        if (!method_exists($question, 'getOutputRelation')) {
            return null;
        }
        $relation = json_decode($question->getOutputRelation(), true);
        return is_array($relation['values'] ?? null) ? count($relation['values']) : null;
    }

    /*
     * Functions used to get the html code for edit, question and solution output
     */

    /**
     * Returns the html output of the GUI element tailored for the edit page
     *
     * @return string The html code of the GUI element
     * @access public
     */
    public function getEditOutput()
    {
        return $this->render('author', null);
    }

    /**
     * Returns the html output of the GUI element tailored for the question output page
     *
     * @param ParticipantInput $participant_input A ParticipantInput object containing the existing data
     * @return string The html code of the GUI element
     * @access public
     */
    public function getQuestionOutput($participant_input)
    {
        return $this->render('participant', $participant_input);
    }

    /**
     * Returns the html output of the GUI element tailored for the solution output page
     *
     * @param ParticipantInput|null $participant_input A ParticipantInput object containing the participant inputs
     * @return string The html code of the GUI element
     * @access public
     */
    public function getSolutionOutput($participant_input)
    {
        return $this->render('solution', $participant_input);
    }

    private function render(string $context, ?ParticipantInput $participant_input): string
    {
        $tpl = $this->plugin->getTemplate('JsBlockArea/tpl.il_as_qpl_qpisql_jsa_js_block.html');
        $tpl->setVariable("LOADING_TEXT", $this->plugin->txt('ai_js_is_loading'));
        $tpl->setVariable('PLUGIN_PATH', $this->plugin->getRelativeDirectory());
        $tpl->setVariable('INITIALIZE_HANDLER', $context === 'solution' ? 'false' : 'true');
        if ($context !== 'solution') {
            $config = [
                'version' => 2,
                'mode' => 'shadow',
                'engine' => self::QSS_ENGINE,
                'engineVersion' => self::QSS_ENGINE_VERSION,
                'rubric' => self::QSS_RUBRIC,
                'scale' => self::getQssScale($this->object->getMaximumPoints()),
                'scaleMode' => 'question-relative',
                'scaleBudget' => self::QSS_DEDUCTION_BUDGET,
                'questionText' => self::getQssQuestionText($this->object),
                'referenceRows' => self::getQssReferenceRows($this->object),
                'context' => $context,
                'enabled' => true,
                // Client-side graph QSS necessarily exposes the
                // reference. These diagnostics never determine ILIAS grades.
                'referenceSql' => $context === 'author' ? null : $this->object->getSequence('sequence_b'),
                'maxPoints' => $this->object->getMaximumPoints(),
                'referenceRevision' => self::getQssReferenceRevision($this->object),
                'labels' => self::getQssLabels($this->plugin),
            ];
            if ($context === 'participant') {
                $config['referenceExecutionValid'] = $this->object->getExecutedBool() && !$this->object->getErrorBool();
            }
            $evaluation = $participant_input?->getQssEvaluation();
            if (isset($_POST['qss_evaluation']) && is_string($_POST['qss_evaluation'])) {
                $posted = new ParticipantInput();
                $posted->setQssEvaluationFromJSON($_POST['qss_evaluation']);
                $evaluation = $posted->getQssEvaluation();
            }
            $tpl->setCurrentBlock('qss_config');
            $tpl->setVariable('QSS_CONFIG', self::jsonAttribute($config));
            $tpl->setVariable('QSS_EVALUATION', $evaluation === null ? '' : self::jsonAttribute($evaluation));
            $tpl->parseCurrentBlock();
        }
        return $tpl->get();
    }

    public static function getQssReferenceRevision($question): string
    {
        return hash('sha256', json_encode([
            'version' => 2,
            'engine' => self::QSS_ENGINE,
            'engineVersion' => self::QSS_ENGINE_VERSION,
            'rubric' => self::QSS_RUBRIC,
            'scaleBudget' => self::QSS_DEDUCTION_BUDGET,
            'questionText' => self::getQssQuestionText($question),
            'referenceRows' => self::getQssReferenceRows($question),
            'sequence_a' => $question->getSequence('sequence_a'),
            'sequence_b' => $question->getSequence('sequence_b'),
            'sequence_c' => $question->getSequence('sequence_c'),
            'metrics' => $question->getAllSolutionMetricsAsJSON(),
        ], JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE));
    }

    public static function getQssLabels($plugin): array
    {
        $labels = [];
        foreach (['title', 'shadow', 'sqlRunning', 'parsing', 'normalizing', 'comparing',
            'completed', 'unsupported', 'failed', 'cancelled', 'notEvaluated', 'distance',
            'points', 'edits', 'model', 'visited', 'lowerBound', 'waiting', 'stale', 'details',
            'editInsert', 'editDelete', 'editReplace', 'cost'] as $key) {
            $labels[$key] = strip_tags($plugin->txt('qss_' . strtolower($key)));
        }
        return $labels;
    }

    public static function jsonAttribute(array $value): string
    {
        $json = json_encode($value, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
        // ilTemplate removes {VARIABLE} tokens even inside inserted JSON
        // strings. Escape braces in strings only; structural JSON stays intact.
        $json = preg_replace_callback('/"(?:[^"\\\\]|\\\\.)*"/s', static fn(array $match): string =>
            str_replace(['{', '}'], ['\u007b', '\u007d'], $match[0]), $json);
        return htmlspecialchars($json, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    /*
     * Functions used to write POST data to the $object
     */

    /**
     * Writes the POST data of the edit page into the $object
     *
     * @access public
     */
    public function writePostData()
    {
        // do nothing
    }

    /**
     * Writes the POST data of a participants input into a ParticipantInput object
     *
     * @param ParticipantInput $participant_input The ParticipantInput object the POST data is written to
     * @access public
     */
    public function writeParticipantInput($participant_input)
    {
        if (isset($_POST['qss_evaluation']) && is_string($_POST['qss_evaluation'])) {
            $participant_input->setQssEvaluationFromJSON($_POST['qss_evaluation']);
        }
    }
}
