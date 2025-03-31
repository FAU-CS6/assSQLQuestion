<?php

declare(strict_types=1);

/**
 * Represents an abstract GUIArea implemented by the different GUIElements of assSQLQuestionGUI.
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 *
 * @ilctrl_iscalledby GUIElement: ilObjQuestionPoolGUI, ilObjTestGUI, ilQuestionEditGUI, ilTestExpressPageObjectGUI
 * @ilCtrl_Calls GUIElement: ilFormPropertyDispatchGUI
 */
abstract class GUIElement
{
    /**
     * @var ilassSQLQuestionPlugin The plugin object
     */
    protected $plugin = null;

    /**
     * @var assSQLQuestion The question object
     */
    protected $object = null;

    /**
     * Constructor
     *
     * @param ilassSQLQuestionPlugin $plugin The plugin object
     * @param assSQLQuestion $object The question object
     * @access public
     */
    public function __construct($plugin, $object)
    {
        // Set plugin and object
        $this->plugin = $plugin;
        $this->object = $object;
    }

    /**
     * Output functions
     */

    /**
     * Returns the html output of the GUI element tailored for the edit page
     *
     * @return string The html code of the GUI element
     * @access public
     */
    abstract public function getEditOutput();

    /**
     * Returns the html output of the GUI element tailored for the question output page
     *
     * @param ParticipantInput $participant_input A ParticipantInput object containing the existing data
     * @return string The html code of the GUI element
     * @access public
     */
    abstract public function getQuestionOutput($participant_input);

    /**
     * Returns the html output of the GUI element tailored for the solution output page
     *
     * @param ParticipantInput|null $participant_input A ParticipantInput object containing the participant inputs
     * @return string The html code of the GUI element
     * @access public
     */
    abstract public function getSolutionOutput($participant_input);

    /**
     * Functions to handle POST data
     */

    /**
     * Writes the POST data of the edit page into the $object
     *
     * @access public
     */
    abstract public function writePostData();

    /**
     * Writes the POST data of a participants input into a ParticipantInput object
     *
     * @param ParticipantInput $participant_input The ParticipantInput object the POST data is written to
     * @access public
     */
    abstract public function writeParticipantInput($participant_input);
}
