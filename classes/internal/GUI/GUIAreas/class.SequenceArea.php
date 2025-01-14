<?php
require_once __DIR__.'/../class.GUIArea.php';

require_once __DIR__.'/../GUIElements/SequenceArea/class.SequenceInfo.php';
require_once __DIR__.'/../GUIElements/SequenceArea/class.SequenceA.php';
require_once __DIR__.'/../GUIElements/SequenceArea/class.SequenceB.php';
require_once __DIR__.'/../GUIElements/SequenceArea/class.SequenceC.php';
require_once __DIR__.'/../GUIElements/SequenceArea/class.IntegrityCheck.php';
require_once __DIR__.'/../GUIElements/SequenceArea/class.ExecuteButton.php';

/**
 * Represents the sequence area used in assSQLQuestionGUI
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 *
 * @ilctrl_iscalledby SequenceArea: ilObjQuestionPoolGUI, ilObjTestGUI, ilQuestionEditGUI, ilTestExpressPageObjectGUI
 * @ilCtrl_Calls SequenceArea: ilFormPropertyDispatchGUI
 */
class SequenceArea extends GUIArea
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
        $this->addSubElement(new SequenceInfo(
            $plugin, // Plugin
            $object // Object
        ));

        // Sequence A
        $this->addSubElement(new SequenceA(
            $plugin, // Plugin
            $object // Object
        ));

        // Sequence B
        $this->addSubElement(new SequenceB(
            $plugin, // Plugin
            $object // Object
        ));

        // Sequence C
        $this->addSubElement(new SequenceC(
            $plugin, // Plugin
            $object // Object
        ));

        // Integrity check
        $this->addSubElement(new IntegrityCheck(
            $plugin, // Plugin
            $object // Object
        ));

        // Execute Button
        $this->addSubElement(new ExecuteButton(
            $plugin, // Plugin
            $object // Object
        ));

        // Set Title, Information and Required
        $this->setTitle($this->plugin->txt('ai_sea_eo_name'));
        $this->setRequired(true);
        $this->setHtml($this->getJavascriptAreaCode() . $this->getEditOutput());
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
        if (isset($_POST["sequence_b"]) && $_POST["sequence_b"] == "") {
            // $this->setAlert($this->plugin->txt('ai_sea_eo_error'));
            return false;
        }

        return true;
    }
}
