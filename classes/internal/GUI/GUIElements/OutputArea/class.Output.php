<?php

declare(strict_types=1);

/**
 * Represents the actual output element
 *
 * @author Dominik Probst <dominik.probst@fau.de>
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
        if (
            isset($_POST["error_bool"]) && isset($_POST["error"]) &&
            isset($_POST["executed_bool"]) && isset($_POST["output_relation"])
        ) {
            $error_bool = $_POST["error_bool"];
            $error = $_POST["error"];
            $executed_bool = $_POST["executed_bool"];
            $output_relation = $_POST["output_relation"];
        }

        $tpl = $this->plugin->getTemplate('OutputArea/tpl.il_as_qpl_qpisql_oa_output.html');
        $tpl->setVariable("ERROR_BOOL", $error_bool === "true" ? "true" : "false");
        $tpl->setVariable("ERROR", htmlspecialchars($error, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        $tpl->setVariable("EXECUTED_BOOL", $executed_bool === "true" ? "true" : "false");
        $tpl->setVariable("OUTPUT_RELATION", htmlspecialchars($output_relation, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        $tpl->setVariable("STATUS_EXECUTION_RUNNING", $this->plugin->txt('ai_oa_st_run'));
        $tpl->setVariable("ERROR_NO_EXECUTION", $this->plugin->txt('ai_oa_er_no_exec'));
        $tpl->setVariable("ERROR_DB_CREATION", $this->plugin->txt('ai_oa_er_db_crea'));
        $tpl->setVariable("ERROR_INTEGRITY_CHECK", $this->plugin->txt('ai_oa_er_int_che'));
        $tpl->setVariable("ERROR_NO_VISIBLE_RESULT", $this->plugin->txt('ai_oa_er_no_vis'));
        $tpl->setVariable("ERROR_RUNNING_SEQUENCE", $this->plugin->txt('ai_oa_er_run_seq'));
        $this->setOutputLabels($tpl);
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
        if (
            isset($_POST["error_bool"]) && isset($_POST["error"]) &&
            isset($_POST["executed_bool"]) && isset($_POST["output_relation"])
        ) {
            $error_bool = $_POST["error_bool"];
            $error = $_POST["error"];
            $executed_bool = $_POST["executed_bool"];
            $output_relation = $_POST["output_relation"];
        }

        $tpl = $this->plugin->getTemplate('OutputArea/tpl.il_as_qpl_qpisql_oa_output.html');
        $tpl->setVariable("ERROR_BOOL", $error_bool === "true" ? "true" : "false");
        $tpl->setVariable("ERROR", htmlspecialchars($error, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        $tpl->setVariable("EXECUTED_BOOL", $executed_bool === "true" ? "true" : "false");
        $tpl->setVariable("OUTPUT_RELATION", htmlspecialchars($output_relation, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        $tpl->setVariable("STATUS_EXECUTION_RUNNING", $this->plugin->txt('ai_oa_st_run'));
        $tpl->setVariable("ERROR_NO_EXECUTION", $this->plugin->txt('ai_oa_er_no_exec'));
        $tpl->setVariable("ERROR_DB_CREATION", $this->plugin->txt('ai_oa_er_db_crea'));
        $tpl->setVariable("ERROR_INTEGRITY_CHECK", $this->plugin->txt('ai_oa_er_int_che'));
        $tpl->setVariable("ERROR_NO_VISIBLE_RESULT", $this->plugin->txt('ai_oa_er_no_vis'));
        $tpl->setVariable("ERROR_RUNNING_SEQUENCE", $this->plugin->txt('ai_oa_er_run_seq'));
        $this->setOutputLabels($tpl);
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
        $tpl->setVariable("ERROR_BOOL", $error_bool === "true" ? "true" : "false");
        $tpl->setVariable("ERROR", htmlspecialchars($error, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        $tpl->setVariable("EXECUTED_BOOL", $executed_bool === "true" ? "true" : "false");
        $tpl->setVariable("OUTPUT_RELATION", htmlspecialchars($output_relation, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
        $tpl->setVariable("ERROR_NO_EXECUTION", $this->plugin->txt('ai_oa_er_no_exec'));
        $this->setOutputLabels($tpl);
        $qss = $participant_input?->getQssEvaluation();
        $tpl->setVariable('QSS_EVALUATION', $qss === null ? '' : JsBlock::jsonAttribute($qss));
        $tpl->setVariable('QSS_LABELS', JsBlock::jsonAttribute(JsBlock::getQssLabels($this->plugin)));
        $tpl->setVariable('QSS_REFERENCE_REVISION', JsBlock::getQssReferenceRevision($this->object));
        return $tpl->get();
    }

    /** Supply plain text labels as an HTML attribute, never as JavaScript source. */
    private function setOutputLabels($tpl): void
    {
        $keys = [
            'running' => 'ai_oa_st_run',
            'notExecuted' => 'qol_not_executed',
            'cancelled' => 'qol_cancelled',
            'failed' => 'qol_failed',
            'success' => 'qol_success',
            'unsaved' => 'qol_unsaved',
            'saved' => 'qol_saved',
            'saveFailed' => 'qol_save_failed',
            'rows' => 'qol_rows',
            'result' => 'qol_result',
            'null' => 'qol_null',
            'empty' => 'qol_empty',
            'noRows' => 'qol_no_rows',
            'previous' => 'qol_previous',
            'next' => 'qol_next',
            'dbCreation' => 'ai_oa_er_db_crea',
            'integrity' => 'ai_oa_er_int_che',
            'noVisibleResult' => 'ai_oa_er_no_vis',
            'sequenceError' => 'ai_oa_er_run_seq',
        ];
        global $DIC;
        $labels = ['autosaveSuccess' => $DIC->language()->txt('autosave_success')];
        foreach ($keys as $name => $key) {
            $labels[$name] = strip_tags($this->plugin->txt($key));
        }
        $tpl->setVariable('LABELS', htmlspecialchars(
            json_encode($labels, JSON_THROW_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE),
            ENT_QUOTES | ENT_SUBSTITUTE,
            'UTF-8'
        ));
        $tpl->setVariable('STATUS_LOADED', htmlspecialchars($this->plugin->txt('qol_loaded'), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8'));
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
