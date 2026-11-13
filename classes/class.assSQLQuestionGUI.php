<?php

declare(strict_types=1);

/**
 * GUI class of the SQLQuestion plugin
 *
 * @author Dominik Probst <dominik.probst@fau.de>
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
    public ilassSQLQuestionPlugin $plugin;

    /**
     * @var assSQLQuestion The question object
     */
    public assQuestion $object;

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
        $this->object = new assSQLQuestion(owner: $DIC->user()->getId());
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
    public function editQuestion(bool $checkonly = false, ?bool $is_save_cmd = null): bool
    {
        // Initialize the Language module
        global $DIC;
        $lng = $DIC->language();

        // Prepare the template by loading css and javascript files
        $this->prepareTemplate();

        // Initialize the form
        $form = new ilPropertyFormGUI();
        $this->editForm = $form;
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
        if ($is_save_cmd ?? $this->isSaveCommand()) {
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
            $this->renderEditForm($form);
            // ILIAS 11's direct question-pool controller returns immediately
            // after editQuestion, before printing its main template. Links on
            // the import page use that route; the repository route prints in
            // its enclosing controller and must not be printed here twice.
            $base_class = $DIC->http()->request()->getQueryParams()['baseClass'] ?? '';
            if (is_string($base_class) && strtolower($base_class) === 'ilobjquestionpoolgui'
                && strtolower($this->ctrl->getCmd()) === 'editquestion') {
                $this->tpl->printToStdout();
            }
        }

        return $errors;
    }

    /**
     * Evaluates a posted edit form and writes the form data in the question object
     *
     * @param bool $always
     * @return integer A positive value, if one of the required fields wasn't set, else 0
     */
    protected function writePostData(bool $always = false): int
    {
        $hasErrors = (!$always) ? $this->editQuestion(true) : false;
        if (!$hasErrors) {
            // Write the data of the generic fields
            $this->writeQuestionGenericPostData();

            // Insert the different GUIAreas
            $guiAreas = array();
            array_push($guiAreas, new JsBlockArea($this->plugin, $this->object));
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
    public function getTestOutput(int $active_id, int $pass, bool $is_question_postponed = false, array|bool $user_post_solutions = false, bool $show_specific_inline_feedback = false): string
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
        array_push($guiAreas, new JsBlockArea($this->plugin, $this->object));
        array_push($guiAreas, new QuestionArea($this->plugin, $this->object));
        array_push($guiAreas, new SequenceArea($this->plugin, $this->object));
        array_push($guiAreas, new OutputArea($this->plugin, $this->object));
        array_push($guiAreas, new ScoringArea($this->plugin, $this->object));

        foreach ($guiAreas as $guiArea) {
            $questionoutput .= $guiArea->getQuestionOutput($participant_input);
        }

        // The core writes its seconds-based timestamp after this method. Bind
        // a render nonce in the browser once the native enclosing form exists.
        // Existing installations can retain a pre-update Composer classmap.
        require_once __DIR__ . '/internal/Test/class.SQLQuestionTestFormToken.php';
        $questionoutput .= SQLQuestionTestFormToken::render(ilSession::get('formtimestamp'));

        $pageoutput = $this->outQuestionPage("", $is_question_postponed, $active_id, $questionoutput);
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
    public function getPreview(bool $show_question_only = false, bool $show_inline_feedback = false): string
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
        array_push($guiAreas, new JsBlockArea($this->plugin, $this->object));
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
        int $active_id,
        ?int $pass = null,
        bool $graphical_output = false,
        bool $result_output = false,
        bool $show_question_only = true,
        bool $show_feedback = false,
        bool $show_correct_solution = false,
        bool $show_manual_scoring = false,
        bool $show_question_text = true,
        bool $show_inline_feedback = true
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
        array_push($guiAreas, new JsBlockArea($this->plugin, $this->object));
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
    public function getSpecificFeedbackOutput(array $userSolution): string
    {
        // By default no answer specific feedback is defined
        $output = '';
        return self::prepareTextareaOutput($output, true);
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
    private function prepareTemplate(): void
    {
        // Add CSS files

        // Custom CSS
        $path = $this->plugin->getRelativeDirectory();
        // ILIAS 11 strips CSS query parameters and versions plugin styles with
        // the ILIAS release. Inline the small plugin stylesheet so an update
        // also reaches browsers which cached the previous plugin version.
        $this->tpl->addInlineCss(file_get_contents(dirname(__DIR__) . '/css/custom.css'));

        // Add JS files

        // Add custom JS code

        // Add path to the plugin file to be accessible in JS, too
        $this->tpl->addOnLoadCode('window.QPISQL_URL_PATH = ' . json_encode($path, JSON_THROW_ON_ERROR));

    }

    /**
     * Private helper function to keep editQuestion more clean
     * Implements the question specific fields used in editQuestion
     *
     * @param ilPropertyFormGUI $form The form the fields should be added to
     * @access private
     */
    private function addSpecificQuestionFormProperties(\ilPropertyFormGUI $form): void
    {
        // Insert the different GUIAreas
        $guiAreas = array();
        array_push($guiAreas, new JsBlockArea($this->plugin, $this->object));
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
