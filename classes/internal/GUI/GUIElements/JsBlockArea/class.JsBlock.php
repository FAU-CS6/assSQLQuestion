<?php

declare(strict_types=1);

/**
 * Represents the actual JS block
 *
 * @author Marco Angerer <marco.angerer@fau.de>
 */
class JsBlock extends GUIElement
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
        $tpl = $this->plugin->getTemplate('JsBlockArea/tpl.il_as_qpl_qpisql_jsa_js_block.html');
        $tpl->setVariable("LOADING_TEXT", $this->plugin->txt('ai_js_is_loading'));
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
        $tpl = $this->plugin->getTemplate('JsBlockArea/tpl.il_as_qpl_qpisql_jsa_js_block.html');
        $tpl->setVariable("LOADING_TEXT", $this->plugin->txt('ai_js_is_loading'));
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
        $tpl = $this->plugin->getTemplate('JsBlockArea/tpl.il_as_qpl_qpisql_jsa_js_block.html');
        $tpl->setVariable("LOADING_TEXT", $this->plugin->txt('ai_js_is_loading'));
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
        // do nothing
    }
}
