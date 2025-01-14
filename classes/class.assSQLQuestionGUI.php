<?php
require_once "internal/GUI/GUIAreas/class.QuestionArea.php";
require_once "internal/GUI/GUIAreas/class.SequenceArea.php";
require_once "internal/GUI/GUIAreas/class.OutputArea.php";
require_once "internal/GUI/GUIAreas/class.ScoringArea.php";
require_once "internal/DataStructures/class.ParticipantInput.php";

/**
 * GUI class of the SQLQuestion plugin
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 * @version	$Id:  $
 * @ingroup ModulesTestQuestionPool
 *
 * @ilctrl_iscalledby assSQLQuestionGUI: ilObjQuestionPoolGUI, ilObjTestGUI, ilQuestionEditGUI, ilTestExpressPageObjectGUI
 * @ilCtrl_Calls assSQLQuestionGUI: ilFormPropertyDispatchGUI
 */
class assSQLQuestionGUI extends assQuestionGUI
{
    /**
     * Member variables that have to be part of every assQuestionGUI
     */

    /**
     * @var ilassSQLQuestionPlugin The plugin object
     */
    public $plugin = null;

    /**
     * @var assSQLQuestion The question object
     */
    public assQuestion $object;

    /**
     * @const	string URL base path for including used javascript and css files
     */
    const QPISQL_URL_PATH = "./Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion";

    /**
     * Member functions that have to be part of every assQuestionGUI
     */

    /**
    * Constructor
    *
    * @param integer $id The database id of a question object
    * @access public
    */
    public function __construct($id = -1)
    {
        global $DIC;

        parent::__construct();

       /** @var ilComponentFactory $component_factory */
		$component_factory = $DIC["component.factory"];
		$this->plugin = $component_factory->getPlugin('qpisql');
        $this->object = new assSQLQuestion();
        if ($id >= 0) {
            $this->object->loadFromDb($id);
        }
    }

    /**
     * Creates an output of the edit form for the question
     *
     * @param bool $checkonly
     * @return bool
     */
    public function editQuestion($checkonly = false)
    {
        // Initialize the Language module
        global $DIC;
        $lng = $DIC->language();

        // Prepare the template by loading css and javascript files
        $this->prepareTemplate();

        // Initialize the form
        $form = new ilPropertyFormGUI();
        $form->setFormAction($this->ctrl->getFormAction($this));
        $form->setTitle($this->outQuestionType());
        $form->setDescription($this->plugin->txt('gi_info'));
        $form->setMultipart(true);
        $form->setTableWidth("100%");
        $form->setId("qpisql");

        // Add basic fields (title, author, description and question)
        $this->addBasicQuestionFormProperties($form);

        // Add question specific fields
        // As we have to add a bunch of them we created a separate function for this
        $this->addSpecificQuestionFormProperties($form);

        // Add the final form buttons
        $this->populateTaxonomyFormSection($form);
        $this->addQuestionFormCommandButtons($form);

        // Initialize errors variable
        $errors = false;

        // If the question is to be saved
        if ($this->isSaveCommand()) {
            // Set the values to the ones send by POST
            $form->setValuesByPost();

            // checkInput() checks and transforms the input
            // If there are errors set errors to true
            $errors = !$form->checkInput();

            // Set the values to the ones send by POST because checkInput
            // may have changed something
            $form->setValuesByPost();

            if ($errors) {
                $checkonly = false;
            }
        }

        if (!$checkonly) {
            $this->getQuestionTemplate();
            $this->tpl->setVariable("QUESTION_DATA", $form->getHTML());
        }

        return $errors;
    }

    /**
     * Evaluates a posted edit form and writes the form data in the question object
     *
     * @param bool $always
     * @return integer A positive value, if one of the required fields wasn't set, else 0
     */
    protected function writePostData($always = false): int
    {
        $hasErrors = (!$always) ? $this->editQuestion(true) : false;
        if (!$hasErrors) {
            // Write the data of the generic fields
            $this->writeQuestionGenericPostData();

            // Insert the different GUIAreas
            $guiAreas = array();
            array_push($guiAreas, new QuestionArea($this->plugin, $this->object));
            array_push($guiAreas, new SequenceArea($this->plugin, $this->object));
            array_push($guiAreas, new OutputArea($this->plugin, $this->object));
            array_push($guiAreas, new ScoringArea($this->plugin, $this->object));

            // Go through the different GUIAreas
            foreach ($guiAreas as $guiArea) {
                $guiArea->writePostData();
            }

            // Set points
            $this->object->setPoints($this->object->getMaximumPoints());

            $this->saveTaxonomyAssignments();
            return 0;
        }
        return 1;
    }


    /**
     * Get the HTML output of the question for a test
     * (this function could be private)
     *
     * @param integer $active_id						The active user id
     * @param integer $pass								The test pass
     * @param boolean $is_postponed						Question is postponed
     * @param boolean $use_post_solutions				Use post solutions
     * @param boolean $show_specific_inline_feedback	Show a specific inline feedback
     * @return string
     */
	public function getTestOutput($active_id, $pass = NULL, $is_postponed = FALSE, $use_post_solutions = FALSE, $show_specific_inline_feedback = FALSE): string
    {
        // Get the stored solution
        $solution = $this->object->getSolutionStored($active_id, $pass, null);

        // Transform value1 into a ParticipantInput
        $participant_input = isset($solution["value1"]) ? ParticipantInput::fromJSON($solution["value1"]) : new ParticipantInput();

        // Prepare the template
        $this->prepareTemplate();

        $questionoutput = "";

        // Get the complete output code
        $html = "";

        // Insert the different GUIAreas
        $guiAreas = array();
        array_push($guiAreas, new QuestionArea($this->plugin, $this->object));
        array_push($guiAreas, new SequenceArea($this->plugin, $this->object));
        array_push($guiAreas, new OutputArea($this->plugin, $this->object));
        array_push($guiAreas, new ScoringArea($this->plugin, $this->object));

        foreach ($guiAreas as $guiArea) {
            $questionoutput .= $guiArea->getQuestionOutput($participant_input);
        }

        $pageoutput = $this->outQuestionPage("", $is_postponed, $active_id, $questionoutput);
        return $pageoutput;
    }

    /**
     * Get the output for question preview
     * (called from ilObjQuestionPoolGUI)
     *
     * @param boolean	$show_question_only 	show only the question instead of embedding page (true/false)
     * @param boolean	$show_question_only
     * @return string
     */
    public function getPreview($show_question_only = false, $showInlineFeedback = false)
    {
        if (is_object($this->getPreviewSession())) {
            $solution = $this->getPreviewSession()->getParticipantsSolution();
        } else {
            $solution = array('value1' => null, 'value2' => null);
        }

        // Transform value1 into a ParticipantInput
        $participant_input = isset($solution["value1"]) ? ParticipantInput::fromJSON($solution["value1"]) : new ParticipantInput();

        // Prepare the template
        $this->prepareTemplate();

        // Get the complete output code
        $html = "";

        // Insert the different GUIAreas
        $guiAreas = array();
        array_push($guiAreas, new QuestionArea($this->plugin, $this->object));
        array_push($guiAreas, new SequenceArea($this->plugin, $this->object));
        array_push($guiAreas, new OutputArea($this->plugin, $this->object));
        array_push($guiAreas, new ScoringArea($this->plugin, $this->object));

        foreach ($guiAreas as $guiArea) {
            $html .= $guiArea->getQuestionOutput($participant_input);
        }

        return $html;
    }

    /**
     * Get the question solution output
     * @param integer $active_id             The active user id
     * @param integer $pass                  The test pass
     * @param boolean $graphicalOutput       Show visual feedback for right/wrong answers
     * @param boolean $result_output         Show the reached points for parts of the question
     * @param boolean $show_question_only    Show the question without the ILIAS content around
     * @param boolean $show_feedback         Show the question feedback
     * @param boolean $show_correct_solution Show the correct solution instead of the user solution
     * @param boolean $show_manual_scoring   Show specific information for the manual scoring output
     * @param bool    $show_question_text

     * @return string solution output of the question as HTML code
     */
    public function getSolutionOutput(
        $active_id,
        $pass = null,
        $graphicalOutput = false,
        $result_output = false,
        $show_question_only = true,
        $show_feedback = false,
        $show_correct_solution = false,
        $show_manual_scoring = false,
        $show_question_text = true
    ): string {
        // If we want to show the pattern solution we have no participant input
        $participant_input = null;

        // If we do not want to show the pattern solution override it with the participants solution
        if (($active_id > 0) && (!$show_correct_solution)) {
            $solution = $this->object->getSolutionStored($active_id, $pass, true);
            $participant_input = isset($solution["value1"]) ? ParticipantInput::fromJSON($solution["value1"]) : new ParticipantInput();
        }

        // Prepare the template
        $this->prepareTemplate();

        // Get the complete output code
        $html = "";

        // Insert the different GUIAreas
        $guiAreas = array();
        array_push($guiAreas, new QuestionArea($this->plugin, $this->object));
        array_push($guiAreas, new SequenceArea($this->plugin, $this->object));
        array_push($guiAreas, new OutputArea($this->plugin, $this->object));
        array_push($guiAreas, new ScoringArea($this->plugin, $this->object));

        foreach ($guiAreas as $guiArea) {
            $html .= $guiArea->getSolutionOutput($participant_input);
        }

        return $html;
    }

    /**
    * Returns the answer specific feedback for the question
    *
    * @param array $userSolution ($userSolution[<value1>] = <value2>)
    * @return string HTML Code with the answer specific feedback
    * @access public
    */
    public function getSpecificFeedbackOutput($userSolution): string
    {
        // By default no answer specific feedback is defined
        $output = '';
        return $this->object->prepareTextareaOutput($output, true);
    }


    /**
     * Sets the ILIAS tabs for this question type
     * called from ilObjTestGUI and ilObjQuestionPoolGUI
     */
    public function setQuestionTabs(): void
    {
        global $DIC;
        $rbacsystem = $DIC->rbac()->system();
        $ilTabs = $DIC->tabs();

        $this->ctrl->setParameterByClass("ilpageobjectgui", "q_id", $_GET["q_id"]);
        include_once "./Modules/TestQuestionPool/classes/class.assQuestion.php";
        $q_type = $this->object->getQuestionType();

        if (strlen($q_type)) {
            $classname = $q_type . "GUI";
            $this->ctrl->setParameterByClass(strtolower($classname), "sel_question_types", $q_type);
            $this->ctrl->setParameterByClass(strtolower($classname), "q_id", $_GET["q_id"]);
        }

        if ($_GET["q_id"]) {
            if ($rbacsystem->checkAccess('write', $_GET["ref_id"])) {
                // edit page
                $ilTabs->addTarget(
                    "edit_page",
                    $this->ctrl->getLinkTargetByClass("ilAssQuestionPageGUI", "edit"),
                    array("edit", "insert", "exec_pg")
                );
            }

            $this->addTab_Question($ilTabs);
        }

        $force_active = false;
        if ($rbacsystem->checkAccess('write', $_GET["ref_id"])) {
            $url = "";

            if ($classname) {
                $url = $this->ctrl->getLinkTargetByClass($classname, "editQuestion");
            }
            $commands = $_POST["cmd"];

            // edit question properties
            $ilTabs->addTarget(
                "edit_properties",
                $url,
                array("editQuestion", "save", "cancel", "saveEdit", "originalSyncForm"),
                $classname,
                "",
                $force_active
            );
        }

        // add tab for question feedback within common class assQuestionGUI
        $this->addTab_QuestionFeedback($ilTabs);

        // add tab for question hint within common class assQuestionGUI
        $this->addTab_QuestionHints($ilTabs);

        // add tab for question's suggested solution within common class assQuestionGUI
        $this->addTab_SuggestedSolution($ilTabs, $classname);


        // Assessment of questions sub menu entry
        if ($_GET["q_id"]) {
            $ilTabs->addTarget(
                "statistics",
                $this->ctrl->getLinkTargetByClass($classname, "assessment"),
                array("assessment"),
                $classname,
                ""
            );
        }

        $this->addBackTab($ilTabs);
    }


    /**
     * Custom member functions only needed in an assSQLQuestionGUI
     */

    /**
     * Private helper function to prepare the different GUIs by adding required
     * Javascript and CSS files
     *
     * @access private
     */
    private function prepareTemplate()
    {
        // Add CSS files

        // Custom css
        $this->tpl->addCss(self::QPISQL_URL_PATH.'/css/custom.css');

        // Codemirror
        $this->tpl->addCss(self::QPISQL_URL_PATH.'/lib/codemirror/lib/codemirror.css');

        // Add JS files

        // Add custom js code

        // Add path to the plugin file to be accessible in js, too
        $this->tpl->addOnLoadCode("window.QPISQL_URL_PATH = \"".self::QPISQL_URL_PATH."\"");

    }

    /**
     * Private helper function to keep editQuestion more clean
     * Implements the question specific fields used in editQuestion
     *
     * @param ilPropertyFormGUI $form The form the fields should be added to
     * @access private
     */
    private function addSpecificQuestionFormProperties(\ilPropertyFormGUI $form)
    {
        global $lng;

        // Insert the different GUIAreas
        $guiAreas = array();
        array_push($guiAreas, new QuestionArea($this->plugin, $this->object));
        array_push($guiAreas, new SequenceArea($this->plugin, $this->object));
        array_push($guiAreas, new OutputArea($this->plugin, $this->object));
        array_push($guiAreas, new ScoringArea($this->plugin, $this->object));

        // Go through the different GUIAreas
        foreach ($guiAreas as $guiArea) {
            $form->addItem($guiArea);
        }
    }
}
