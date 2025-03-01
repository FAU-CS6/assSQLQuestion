<?php

declare(strict_types=1);

/**
 * Represents the execute button GUIElement
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 *
 * @ilctrl_iscalledby ExecuteButton: ilObjQuestionPoolGUI, ilObjTestGUI, ilQuestionEditGUI, ilTestExpressPageObjectGUI
 * @ilCtrl_Calls ExecuteButton: ilFormPropertyDispatchGUI
 */
class ExecuteButton extends GUIElement
{
    /**
     * Returns the html output of the GUI element tailored for the edit page
     *
     * @return string The html code of the GUI element
     * @access public
     */
    public function getEditOutput()
    {
        $tpl = $this->plugin->getTemplate('SequenceArea/tpl.il_as_qpl_qpisql_sea_execute_button.html');
        $tpl->setVariable("BUTTONTEXT", $this->plugin->txt('ai_sea_exec_text'));
        return $tpl->get();
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
        $tpl = $this->plugin->getTemplate('SequenceArea/tpl.il_as_qpl_qpisql_sea_execute_button.html');
        $tpl->setVariable("BUTTONTEXT", $this->plugin->txt('ai_sea_exec_text'));
        return $tpl->get();
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
        return "";
    }

    /**
     * Writes the POST data of the edit page into the $object
     *
     * @access public
     */
    public function writePostData()
    {
        // Do nothing
    }

    /**
     * Writes the POST data of a participants input into a ParticipantInput object
     *
     * @param ParticipantInput $participant_input The ParticipantInput object the POST data is written to
     * @access public
     */
    public function writeParticipantInput($participant_input)
    {
        // Do nothing
    }
}
