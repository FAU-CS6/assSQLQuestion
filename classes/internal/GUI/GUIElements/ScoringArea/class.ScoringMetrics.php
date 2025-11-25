<?php

declare(strict_types=1);

/**
 * Represents the quantity of ScoringMetrics
 *
 * @author Dominik Probst <dominik.probst@fau.de>
 *
 * @ilctrl_iscalledby ScoringMetrics: ilObjQuestionPoolGUI, ilObjTestGUI, ilQuestionEditGUI, ilTestExpressPageObjectGUI
 * @ilCtrl_Calls ScoringMetrics: ilFormPropertyDispatchGUI
 */
class ScoringMetrics extends GUIElement
{
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
        $html = "";

        // Add the html code of all ScoringMetrics
        $html .= ResultLines::getEditOutput($this->plugin, $this->object);
        $html .= ColumnNames::getEditOutput($this->plugin, $this->object);
        $html .= FunctionalDependencies::getEditOutput($this->plugin, $this->object);

        return $html;
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
        $html = "";

        // Add the html code of all ScoringMetrics
        $html .= ResultLines::getQuestionOutput($this->plugin, $this->object, $participant_input);
        $html .= ColumnNames::getQuestionOutput($this->plugin, $this->object, $participant_input);
        $html .= FunctionalDependencies::getQuestionOutput($this->plugin, $this->object, $participant_input);

        return $html;
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
        $html = "";

        // Add the html code of all ScoringMetrics
        $html .= ResultLines::getSolutionOutput($this->plugin, $this->object, $participant_input);
        $html .= ColumnNames::getSolutionOutput($this->plugin, $this->object, $participant_input);
        $html .= FunctionalDependencies::getSolutionOutput($this->plugin, $this->object, $participant_input);

        return $html;
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
        // Write the POST data in every ScoringMetric
        ResultLines::writePostData($this->plugin, $this->object);
        ColumnNames::writePostData($this->plugin, $this->object);
        FunctionalDependencies::writePostData($this->plugin, $this->object);
    }

    /**
     * Writes the POST data of a participants input into a ParticipantInput object
     *
     * @param ParticipantInput $participant_input The ParticipantInput object the POST data is written to
     * @access public
     */
    public function writeParticipantInput($participant_input)
    {
        // Write the POST data in every ScoringMetric
        ResultLines::writeParticipantInput($participant_input);
        ColumnNames::writeParticipantInput($participant_input);
        FunctionalDependencies::writeParticipantInput($participant_input);
    }
}
