<?php

declare(strict_types=1);

/**
 * Represents the sequenceB GUIElement
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 *
 * @ilctrl_iscalledby SequenceB: ilObjQuestionPoolGUI, ilObjTestGUI, ilQuestionEditGUI, ilTestExpressPageObjectGUI
 * @ilCtrl_Calls SequenceB: ilFormPropertyDispatchGUI
 */
class SequenceB extends GUIElement
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
        $sequence_b = $this->object->getSequence('sequence_b');

        // If there is $_POST data use that
        if (isset($_POST["sequence_b"])) {
            $sequence_b = $_POST["sequence_b"];
        }

        $tpl = $this->plugin->getTemplate('SequenceArea/tpl.il_as_qpl_qpisql_sea_sequence_input.html');
        $tpl->setVariable("HEADER", $this->plugin->txt('ai_sea_eo_seq_b'));
        $tpl->setVariable("ID", 'sequence_b');
        $tpl->setVariable("NAME", 'sequence_b');
        $tpl->setVariable("CONTENT", $sequence_b);
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
        // Get any default data
        $sequence_b = $participant_input->getSequence();

        // If there is $_POST data use that
        if (isset($_POST["sequence_b"])) {
            $sequence_b = $_POST["sequence_b"];
        }

        $tpl = $this->plugin->getTemplate('SequenceArea/tpl.il_as_qpl_qpisql_sea_sequence_input.html');
        $tpl->setVariable("HEADER", $this->plugin->txt('ai_sea_qo_seq_b'));
        $tpl->setVariable("ID", 'sequence_b');
        $tpl->setVariable("NAME", 'sequence_b');
        $tpl->setVariable("CONTENT", $sequence_b);
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
        // Get any default data
    $id = "id" . $this->object->getId() . "cor1"; // Helper to get unique ids for every div - cor1 is pattern solution
    $sequence_b = $this->object->getSequence('sequence_b');

        if (!is_null($participant_input)) {
            $id = "id" . $this->object->getId() . "cor0"; // Helper to get unique ids for every div - cor0 is participant solution
            $sequence_b = $participant_input->getSequence();
        }

        $tpl = $this->plugin->getTemplate('SequenceArea/tpl.il_as_qpl_qpisql_sea_sequence_output.html');
        $tpl->setVariable("ID", "sequence_b_" . $id);
        $tpl->setVariable("HEADER", $this->plugin->txt('ai_sea_qo_seq_b'));
        $tpl->setVariable("CONTENT", $sequence_b);
        return $tpl->get();
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
        $this->object->setSequence('sequence_b', (string) $_POST['sequence_b']);
    }

    /**
     * Writes the POST data of a participants input into a ParticipantInput object
     *
     * @param ParticipantInput $participant_input The ParticipantInput object the POST data is written to
     * @access public
     */
    public function writeParticipantInput($participant_input)
    {
        $participant_input->setSequence((string) $_POST['sequence_b']);
    }
}
