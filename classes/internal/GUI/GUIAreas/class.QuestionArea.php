<?php
require_once __DIR__.'/../class.GUIArea.php';

require_once __DIR__.'/../GUIElements/QuestionArea/class.QuestionText.php';

/**
 * Represents the area used in assSQLQuestionGUI to display the question
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 *
 * @ilctrl_iscalledby QuestionArea: ilObjQuestionPoolGUI, ilObjTestGUI, ilQuestionEditGUI, ilTestExpressPageObjectGUI
 * @ilCtrl_Calls QuestionArea: ilFormPropertyDispatchGUI
 */
class QuestionArea extends GUIArea
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
        $this->addSubElement(new QuestionText(
            $plugin, // Plugin
            $object // Object
        ));

        // Set Title and HTML to "" as this should not be displayed on the edit question page
        $this->setTitle("");
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
        // This includes no Input
        return true;
    }
}
