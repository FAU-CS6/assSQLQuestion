<?php

declare(strict_types=1);

/**
 * Represents the JS block area used in assSQLQuestionGUI
 *
 * @author Marco Angerer <marco.angerer@fau.de>
 */
class JsBlockArea extends GUIArea
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
        $this->addSubElement(new JsBlock(
            $plugin, // Plugin
            $object // Object
        ));

        // Set Title, Information and Required
        $this->setTitle("");
        $this->setRequired(true);
        $this->setHtml($this->getEditOutput());
    }

    /*
     * Functions originaly implemented in ilCustomInputGUI that need to be overwritten
     */

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
        if (
            (isset($_POST["error_bool"]) && $_POST["error_bool"] == "true") ||
            (isset($_POST["executed_bool"]) && $_POST["executed_bool"] == "false")
        ) {
            // $this->setAlert($this->plugin->txt('ai_oa_eo_error'));
            return false;
        }

        return true;
    }
}
