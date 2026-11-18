<?php

declare(strict_types=1);

/**
 * Represents the scoring area used in assSQLQuestionGUI
 *
 * @author Dominik Probst <dominik.probst@fau.de>
 *
 * @ilctrl_iscalledby ScoringArea: ilObjQuestionPoolGUI, ilObjTestGUI, ilQuestionEditGUI, ilTestExpressPageObjectGUI
 * @ilCtrl_Calls ScoringArea: ilFormPropertyDispatchGUI
 */
class ScoringArea extends GUIArea
{
    /**
     * Constructor
     *
     * @param ilassSQLQuestionPlugin $plugin The plugin object
     * @param assSQLQuestion $object The question object
     * @access public
     */
    public function __construct($plugin, $object)
    {
        // Use the GUIArea constructor
        parent::__construct(
            $plugin,
            $object
        );

        // Set the subelements

        // Info area
        $this->addSubElement(new AssessmentSettings($plugin, $object));
        $this->addSubElement(new ScoringInfo(
            $plugin, // Plugin
            $object // Object
        ));

        // Output area
        $this->addSubElement(new ScoringMetrics(
            $plugin, // Plugin
            $object // Object
        ));

        // Set Title, Information and Required
        $this->setTitle($this->plugin->txt('ai_sca_eo_name'));
        $this->setRequired(true);
        $this->setHtml($this->getEditOutput());
    }

    /**
     * Checks the input of the edit page
     *
     * (This is an override of the ilCustomInputGUI:checkInput() to be tailored
     * for the sequences input area of editQuestion)
     *
     * @return boolean True if input is ok, False if it is not
     * @access public
     */
    public function checkInput(): bool
    {
        try {
            $postedMode = $_POST['assessment_mode'] ?? QssAssessment::RESULT;
            if (!is_string($postedMode)) { throw new InvalidArgumentException('Invalid assessment mode.'); }
            $mode = QssAssessment::mode($postedMode);
            if ($mode === QssAssessment::QSS) {
                $costs = AssessmentSettings::postedCosts();
                $maximum = $_POST['qss_maximum_points'] ?? '';
                if (!is_string($maximum) || !is_numeric($maximum) || !is_finite((float) $maximum) || (float) $maximum < 0.0001 || (float) $maximum > 1000000) {
                    throw new InvalidArgumentException('Invalid maximum.');
                }
                // Saving unrelated metadata must not require another execution.
                $unchanged = $this->object->getAssessmentMode() === QssAssessment::QSS
                    && $this->object->getExecutedBool() && !$this->object->getErrorBool()
                    && (float) $maximum === $this->object->getQssMaximumPoints()
                    && $costs === $this->object->getQssCosts()
                    && ($_POST['question'] ?? null) === $this->object->getQuestion();
                foreach (['sequence_a', 'sequence_b', 'sequence_c'] as $sequence) {
                    $unchanged = $unchanged && ($_POST[$sequence] ?? null) === $this->object->getSequence($sequence);
                }
                if ($unchanged) { return true; }
                $input = new ParticipantInput();
                $input->setQssEvaluationFromJSON(is_string($_POST['qss_evaluation'] ?? null) ? $_POST['qss_evaluation'] : '');
                $evaluation = $input->getQssEvaluation();
                $answer = str_replace(["\r\n", "\r"], "\n", (string) ($_POST['sequence_b'] ?? ''));
                if (($evaluation['status'] ?? null) !== 'exact' || ($evaluation['distance'] ?? null) !== 0
                    || ($evaluation['scoreCertifiedWithinModel'] ?? null) !== true
                    || ($evaluation['version'] ?? null) !== JsBlock::QSS_ENGINE_VERSION
                    || (float) ($evaluation['maxPoints'] ?? 0) !== (float) $maximum
                    || !hash_equals(hash('sha256', $answer), $evaluation['answerDigest'] ?? '')) {
                    $this->setAlert($this->plugin->txt('assessment_execute'));
                    return false;
                }
                return true;
            }
        } catch (InvalidArgumentException $error) {
            $this->setAlert($this->plugin->txt('assessment_invalid'));
            return false;
        }
        $points = 0;

        if (isset($_POST["points_result_lines"])) {
            $points += $_POST["points_result_lines"];
        }

        if (isset($_POST["points_functional_dependencies"])) {
            $points += $_POST["points_functional_dependencies"];
        }

        if (isset($_POST["points_column_names"])) {
            $points += $_POST["points_column_names"];
        }

        if ($points <= 0) {
            // $this->setAlert($this->plugin->txt('ai_sca_eo_error'));
            return false;
        }

        return true;
    }
}
