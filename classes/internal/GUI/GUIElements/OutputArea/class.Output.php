<?php

declare(strict_types=1);

/**
 * Represents the actual output element
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 *
 * @ilctrl_iscalledby Output: ilObjQuestionPoolGUI, ilObjTestGUI, ilQuestionEditGUI, ilTestExpressPageObjectGUI
 * @ilCtrl_Calls Output: ilFormPropertyDispatchGUI
 */
class Output extends GUIElement
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
        // Get any default data
        $error_bool = $this->object->getErrorBool() ? "true" : "false";
        $error = $this->object->getError();
        $executed_bool = $this->object->getExecutedBool() ? "true" : "false";
        $output_relation = $this->object->getOutputRelation();

        // If there is $_POST data use that
        if (isset($_POST["error_bool"]) && isset($_POST["error"]) &&
       isset($_POST["executed_bool"]) && isset($_POST["output_relation"])) {
            $error_bool = $_POST["error_bool"];
            $error = $_POST["error"];
            $executed_bool = $_POST["executed_bool"];
            $output_relation = $_POST["output_relation"];
        }

        $tpl = $this->plugin->getTemplate('OutputArea/tpl.il_as_qpl_qpisql_oa_output.html');
        $tpl->setVariable("ERROR_BOOL", $error_bool);
        $tpl->setVariable("ERROR", $error);
        $tpl->setVariable("EXECUTED_BOOL", $executed_bool);
        $tpl->setVariable("OUTPUT_RELATION", $output_relation);
        $tpl->setVariable("STATUS_EXECUTION_RUNNING", $this->plugin->txt('ai_oa_st_run'));
        $tpl->setVariable("ERROR_NO_EXECUTION", $this->plugin->txt('ai_oa_er_no_exec'));
        $tpl->setVariable("ERROR_DB_CREATION", $this->plugin->txt('ai_oa_er_db_crea'));
        $tpl->setVariable("ERROR_INTEGRITY_CHECK", $this->plugin->txt('ai_oa_er_int_che'));
        $tpl->setVariable("ERROR_NO_VISIBLE_RESULT", $this->plugin->txt('ai_oa_er_no_vis'));
        $tpl->setVariable("ERROR_RUNNING_SEQUENCE", $this->plugin->txt('ai_oa_er_run_seq'));
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
        $error_bool = $participant_input->getErrorBool() ? "true" : "false";
        $error = $participant_input->getError();
        $executed_bool = $participant_input->getExecutedBool() ? "true" : "false";
        $output_relation = $participant_input->getOutputRelation();

        // If there is $_POST data use that
        if (isset($_POST["error_bool"]) && isset($_POST["error"]) &&
       isset($_POST["executed_bool"]) && isset($_POST["output_relation"])) {
            $error_bool = $_POST["error_bool"];
            $error = $_POST["error"];
            $executed_bool = $_POST["executed_bool"];
            $output_relation = $_POST["output_relation"];
        }

        $tpl = $this->plugin->getTemplate('OutputArea/tpl.il_as_qpl_qpisql_oa_output.html');
        $tpl->setVariable("ERROR_BOOL", $error_bool);
        $tpl->setVariable("ERROR", $error);
        $tpl->setVariable("EXECUTED_BOOL", $executed_bool);
        $tpl->setVariable("OUTPUT_RELATION", $output_relation);
        $tpl->setVariable("STATUS_EXECUTION_RUNNING", $this->plugin->txt('ai_oa_st_run'));
        $tpl->setVariable("ERROR_NO_EXECUTION", $this->plugin->txt('ai_oa_er_no_exec'));
        $tpl->setVariable("ERROR_DB_CREATION", $this->plugin->txt('ai_oa_er_db_crea'));
        $tpl->setVariable("ERROR_INTEGRITY_CHECK", $this->plugin->txt('ai_oa_er_int_che'));
        $tpl->setVariable("ERROR_NO_VISIBLE_RESULT", $this->plugin->txt('ai_oa_er_no_vis'));
        $tpl->setVariable("ERROR_RUNNING_SEQUENCE", $this->plugin->txt('ai_oa_er_run_seq'));
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
        $error_bool = $this->object->getErrorBool() ? "true" : "false";
        $error = $this->object->getError();
        $executed_bool = $this->object->getExecutedBool() ? "true" : "false";
        $output_relation = $this->object->getOutputRelation();

        // If we have participant input (= do not use the pattern solution)
        if (!is_null($participant_input)) {
            $id = "id" . $this->object->getId() . "cor0"; // Helper to get unique ids for every div - cor0 is participant solution
            $error_bool = $participant_input->getErrorBool() ? "true" : "false";
            $error = $participant_input->getError();
            $executed_bool = $participant_input->getExecutedBool() ? "true" : "false";
            $output_relation = $participant_input->getOutputRelation();
        }

        $tpl = $this->plugin->getTemplate('OutputArea/tpl.il_as_qpl_qpisql_oa_solution.html');
        $tpl->setVariable("ID", $id);
        $tpl->setVariable("ERROR_BOOL", $error_bool);
        $tpl->setVariable("ERROR", $error);
        $tpl->setVariable("EXECUTED_BOOL", $executed_bool);
        $tpl->setVariable("OUTPUT_RELATION", $output_relation);
        $tpl->setVariable("ERROR_NO_EXECUTION", $this->plugin->txt('ai_oa_er_no_exec'));
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
        $this->object->setErrorBool($_POST["error_bool"] == "true" ? true : false);
        $this->object->setError((string) $_POST["error"]);
        $this->object->setExecutedBool($_POST["executed_bool"] == "true" ? true : false);
        $this->object->setOutputRelation((string) $_POST["output_relation"]);
    }

    /**
     * Writes the POST data of a participants input into a ParticipantInput object
     *
     * @param ParticipantInput $participant_input The ParticipantInput object the POST data is written to
     * @access public
     */
    public function writeParticipantInput($participant_input)
    {
        $participant_input->setErrorBool($_POST["error_bool"] == "true" ? true : false);
        $participant_input->setError((string) $_POST["error"]);
        $participant_input->setExecutedBool($_POST["executed_bool"] == "true" ? true : false);
        $participant_input->setOutputRelation((string) $_POST["output_relation"]);
    }
}
