<?php

declare(strict_types=1);

/**
 * Represents the sequenceA GUIElement
 *
 * @author Dominik Probst <dominik.probst@fau.de>
 *
 * @ilctrl_iscalledby SequenceA: ilObjQuestionPoolGUI, ilObjTestGUI, ilQuestionEditGUI, ilTestExpressPageObjectGUI
 * @ilCtrl_Calls SequenceA: ilFormPropertyDispatchGUI
 */
class SequenceA extends GUIElement
{
    /**
     * Returns the html output of the GUI element tailored for the edit page
     *
     * @return string The html code of the GUI element
     * @access public
     */
    public function getEditOutput()
    {
        // Get any default data
        $sequence_a = $this->object->getSequence('sequence_a');

        // If there is $_POST data use that
        if (isset($_POST["sequence_a"])) {
            $sequence_a = $_POST["sequence_a"];
        }

        $tpl = $this->plugin->getTemplate('SequenceArea/tpl.il_as_qpl_qpisql_sea_sequence_input.html');
        $tpl->setVariable("HEADER", $this->plugin->txt('ai_sea_eo_seq_a'));
        $tpl->setVariable("ID", 'sequence_a');
        $tpl->setVariable("NAME", 'sequence_a');
        $tpl->setVariable("CONTENT", $sequence_a);
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
        $tpl = $this->plugin->getTemplate('SequenceArea/tpl.il_as_qpl_qpisql_sea_hidden_textarea.html');
        $tpl->setVariable("ID", 'sequence_a');
        $tpl->setVariable("NAME", 'sequence_a');
        $tpl->setVariable("VALUE", $this->object->getSequence('sequence_a'));
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
        $this->object->setSequence('sequence_a', (string) $_POST['sequence_a']);
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
