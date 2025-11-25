<?php

declare(strict_types=1);
 
require_once './Modules/TestQuestionPool/interfaces/interface.ilAssQuestionAutosaveable.php';

/**
 * Main definition of the SQLQuestion plugin
 *
 * @author Dominik Probst <dominik.probst@fau.de>
 * @ingroup ModulesTestQuestionPool
 */
class assSQLQuestion extends assQuestion implements ilAssQuestionAutosaveable 
{
    /**
     * Member variables that have to be part of every assQuestion
     */

    /**
     * @var ?ilassSQLQuestionPlugin The plugin object
     */
    protected ?ilassSQLQuestionPlugin $plugin = null;

    /**
     * Custom member variables/constants for an assSQLQuestion
     */

    /**
     * @var string The first sql sequence of the question
     */
    public string $sequence_a = "";

    /**
     * @var string The second sql sequence of the question
     */
    public string $sequence_b = "";

    /**
     * @var string The third sql sequence of the question
     */
    public string $sequence_c = "";

    /**
     * @var boolean A boolean indicating whether the question includes an integrity check (true) or not (false)
     */
    public bool $integrity_check = false;

    /**
     * @var boolean A boolean indicating whether the questions sequences contain errors (true) or not (false)
     */
    public bool $error_bool = false;

    /**
     * @var string A json string containing the error of the current sql sequences
     */
    public string $error = "";

    /**
     * @var boolean A boolean indicating whether the current questions sequences have been executed (true) or not (false)
     */
    public bool $executed_bool = false;

    /**
     * @var string A json string containg the output relation of the current sql sequences
     */
    public string $output_relation = "";

    /**
     * @var SolutionMetric[] An array containg all pattern solution SolutionMetrics used in this question
     */
    public array $solution_metrics = array();

    /**
     * Member functions that have to be part of every assQuestion
     */

    /**
     * Constructor
     *
     * The constructor takes possible arguments and creates an instance of the question object.
     *
     * @param string $title A title string to describe the question
     * @param string $comment A comment string to describe the question
     * @param string $author A string containing the name of the questions author
     * @param integer $owner A numerical ID to identify the owner/creator
     * @param string $question Question text
     * @access public
     *
     * @see assQuestion:assQuestion()
     */
    public function __construct(
        string $title = "",
        string $comment = "",
        string $author = "",
        int $owner = -1,
        string $question = ""
    ) {
        // needed for excel export
        $this->getPlugin()->loadLanguageModule();

        parent::__construct($title, $comment, $author, $owner, $question);
    }

    /**
     * Returns the question type of the question
     *
     * @return string The question type of the question
     */
    public function getQuestionType(): string
    {
        return 'assSQLQuestion';
    }

    /**
     * Returns the names of the used additional question data tables
     *
     * @return array The names of the additional tables
     */
    public function getAdditionalTableName(): array
    {
        return array(
            'il_qpl_qst_qpisql_qd',
            'il_qpl_qst_qpisql_qsm'
        );
    }

    /**
     * Returns the name of the used answer table
     *
     * @return array The names of the answer table
     */
    public function getAnswerTableName(): array
    {
        return array();
    }

    /**
     * Collects all texts in the question which could contain media objects
     * which were created with the Rich Text Editor
     */
    protected function getRTETextWithMediaObjects(): string
    {
        $text = parent::getRTETextWithMediaObjects();

        return (string) $text;
    }

    /**
     * Get the plugin object
     *
     * @return object The plugin object
     */
    public function getPlugin(): ilassSQLQuestionPlugin
    {
        global $DIC;

        if ($this->plugin == null) {
            /** @var ilComponentFactory $component_factory */
            $component_factory = $DIC["component.factory"];
            $this->plugin = $component_factory->getPlugin('qpisql');
        }
        return $this->plugin;
    }

    /**
     * Returns true, if the question is complete
     *
     * @return boolean True, if the question is complete for use, otherwise false
     */
    public function isComplete(): bool
    {
        // Check whether the question is complete
        if (
            !empty($this->title) &&
            !empty($this->author) &&
            !empty($this->question) &&
            $this->getSequence('sequence_b') != "" &&
            $this->getExecutedBool() &&
            !$this->getErrorBool() &&
            $this->getMaximumPoints() > 0
        ) {
            return true;
        }

        return false;
    }

    /**
     * Saves a question object to a database
     *
     * @param	string $original_id The original id
     * @access public
     * @see assQuestion::saveToDb()
     */
    public function saveToDb($original_id = ''): void
    {
        // Save the basic data (implemented in assQuestion)
        if ($original_id == '') {
            $this->saveQuestionDataToDb();
        } else {
            $this->saveQuestionDataToDb($original_id);
        }

        // Save the assSQLQuestion specific data to the database
        $this->saveSpecificQuestionDataToDb();

        // update the question time stamp and completion status
        parent::saveToDb();
    }

    /**
     * Loads a question object from a database
     *
     * @param integer $question_id A unique key which defines the question in the database
     * @see assQuestion::loadFromDb()
     */
    public function loadFromDb(int $question_id): void
    {
        // Load the basic data
        global $DIC;
        $ilDB = $DIC->database();

        $result = $ilDB->query("SELECT qpl_questions.* FROM qpl_questions WHERE question_id = "
            . $ilDB->quote($question_id, 'integer'));

        $data = $ilDB->fetchAssoc($result);
        $this->setId((int) $question_id);
        $this->setObjId((int) $data['obj_fi']);
        $this->setOriginalId((int) $data['original_id']);
        $this->setOwner((int) $data['owner']);
        $this->setTitle((string) $data['title']);
        $this->setAuthor((string) $data['author']);
        $this->setPoints((float) $data['points']);
        $this->setComment((string) $data['description']);

        $this->setQuestion((string) ilRTE::_replaceMediaObjectImageSrc((string) $data['question_text'], 1));

        // Load the assSQLQuestion specific data
        $this->loadSpecificQuestionDataFromDb($question_id);

        try {
            $this->setAdditionalContentEditingMode(((string) $data['add_cont_edit_mode']) ?? null);
        } catch (ilTestQuestionPoolException $e) {
        }

        // loads additional stuff like suggested solutions
        parent::loadFromDb($question_id);
    }

    /**
     * Duplicates a question
     * This is used for copying a question to a test
     *
     * @param bool   		$for_test
     * @param string 		$title
     * @param string 		$author
     * @param string 		$owner
     * @param integer|null	$testObjId
     *
     * @return void|integer Id of the clone or nothing.
     */
    public function duplicate(bool $for_test = true, string $title = '', string $author = '', int $owner = -1, $testObjId = null): int
    {
        if ($this->getId() <= 0) {
            // The question has not been saved. It cannot be duplicated
            return -1;
        }

        // make a real clone to keep the actual object unchanged
        $clone = clone $this;

        global $DIC;
        $original_id = $DIC->testQuestionPool()->questionInfo()->getOriginalId($this->getId());
        $clone->setId(-1);

        if ((int) $testObjId > 0) {
            $clone->setObjId($testObjId);
        }

        if (!empty($title)) {
            $clone->setTitle($title);
        }
        if (!empty($author)) {
            $clone->setAuthor($author);
        }
        if (!empty($owner)) {
            $clone->setOwner($owner);
        }

        if ($for_test) {
            $clone->saveToDb($original_id);
        } else {
            $clone->saveToDb();
        }

        // copy question page content
        $clone->copyPageOfQuestion($this->getId());
        // copy XHTML media objects
        $clone->copyXHTMLMediaObjectsOfQuestion($this->getId());

        // call the event handler for duplication
        $clone->onDuplicate($this->getObjId(), $this->getId(), $clone->getObjId(), $clone->getId());

        return $clone->getId();
    }

    /**
     * Copies a question
     * This is used when a question is copied on a question pool
     *
     * @param integer	$target_questionpool_id
     * @param string	$title
     *
     * @return void|integer Id of the clone or nothing.
     */
    public function copyObject($target_questionpool_id, $title = '')
    {
        if ($this->getId() <= 0) {
            throw new RuntimeException('The question has not been saved. It cannot be duplicated');
        }

        // make a real clone to keep the object unchanged
        $clone = clone $this;

        global $DIC;
        $original_id = $DIC->testQuestionPool()->questionInfo()->getOriginalId($this->getId());
        $source_questionpool_id = $this->getObjId();
        $clone->setId(-1);
        $clone->setObjId($target_questionpool_id);
        if (!empty($title)) {
            $clone->setTitle($title);
        }

        // save the clone data
        $clone->saveToDb();

        // copy question page content
        $clone->copyPageOfQuestion($original_id);
        // copy XHTML media objects
        $clone->copyXHTMLMediaObjectsOfQuestion($original_id);

        // call the event handler for copy
        $clone->onCopy($source_questionpool_id, $original_id, $clone->getObjId(), $clone->getId());

        return $clone->getId();
    }

    /**
     * Create a new original question in a question pool for a test question
     *
     * @param int $targetParentId			id of the target question pool
     * @param string $targetQuestionTitle
     *
     * @return int|void
     */
    public function createNewOriginalFromThisDuplicate($targetParentId, $targetQuestionTitle = '')
    {
        if ($this->id <= 0) {
            // The question has not been saved. It cannot be duplicated
            return;
        }

        $sourceQuestionId = $this->id;
        $sourceParentId = $this->getObjId();

        // make a real clone to keep the object unchanged
        $clone = clone $this;
        $clone->setId(-1);

        $clone->setObjId($targetParentId);

        if (!empty($targetQuestionTitle)) {
            $clone->setTitle($targetQuestionTitle);
        }

        $clone->saveToDb();
        // copy question page content
        $clone->copyPageOfQuestion($sourceQuestionId);
        // copy XHTML media objects
        $clone->copyXHTMLMediaObjectsOfQuestion($sourceQuestionId);

        $clone->onCopy($sourceParentId, $sourceQuestionId, $clone->getObjId(), $clone->getId());

        return $clone->getId();
    }

    /**
     * Synchronize a question with its original
     * You need to extend this function if a question has additional data that needs to be synchronized
     *
     * @access public
     */
    public function syncWithOriginal(): void
    {
        parent::syncWithOriginal();
    }


    /**
     * Get a submitted solution array by generating a new ParticipantInput object,
     * passing it to the GUIAreas and let them fill it.
     *
     * In general this may return any type that can be stored in a php session
     * The return value is used by:
     * 		savePreviewData()
     * 		saveWorkingData()
     * 		calculateReachedPointsForSolution()
     *
     * @return array ('value1' => string|null, 'value2' => float|null) - 'value1' contains the ParticipantInput object serialized to JSON
     */
    protected function getSolutionSubmit(): array
    {
        // Create a new ParticipantInput
        $participant_input = new ParticipantInput();

        // Insert the different GUIAreas
        $guiAreas = array();
        array_push($guiAreas, new QuestionArea($this->plugin, $this));
        array_push($guiAreas, new SequenceArea($this->plugin, $this));
        array_push($guiAreas, new OutputArea($this->plugin, $this));
        array_push($guiAreas, new ScoringArea($this->plugin, $this));

        // Go through the different GUIAreas
        foreach ($guiAreas as $guiArea) {
            $guiArea->writeParticipantInput($participant_input);
        }

        // Set value1 to be $participant_input serialized to JSON
        $value1 = $participant_input->toJSON();

        return array(
            'value1' => empty($value1) ? null : (string) $value1,
            'value2' => null
        );
    }

    /**
     * Get a stored solution for a user and test pass
     * This is a wrapper to provide the same structure as getSolutionSubmit()
     *
     * @param int 	$active_id		active_id of hte user
     * @param int	$pass			number of the test pass
     * @param bool	$authorized		get the authorized solution
     *
     * @return	array	('value1' => string|null, 'value2' => float|null)
     */
    public function getSolutionStored($active_id, $pass, $authorized = null): array
    {
        // This provides an array with records from tst_solution
        // The example question should only store one record per answer
        // Other question types may use multiple records with value1/value2 in a key/value style
        if (isset($authorized)) {
            // this provides either the authorized or intermediate solution
            $solutions = $this->getSolutionValues($active_id, $pass, $authorized);
        } else {
            // this provides the solution preferring the intermediate
            // or the solution from the previous pass
            $solutions = $this->getTestOutputSolutions($active_id, $pass);
        }


        if (empty($solutions)) {
            // no solution stored yet
            $value1 = null;
            $value2 = null;
        } else {
            // If the process locker isn't activated in the Test and Assessment administration
            // then we may have multiple records due to race conditions
            // In this case the last saved record wins
            $solution = end($solutions);

            $value1 = $solution['value1'];
            $value2 = $solution['value2'];
        }

        return array(
            'value1' => empty($value1) ? null : (string) $value1,
            'value2' => empty($value2) ? null : (float) $value2
        );
    }


    /**
     * Calculate the reached points from a solution array
     *
     * @param	array	('value1' => string, 'value2' => float)
     * @return float The reached points
     */
    protected function calculateReachedPointsForSolution($solution): float
    {
        // Transform value1 of solution into a ParticipantInput
        $participant_input = isset($solution["value1"]) ? ParticipantInput::fromJSON($solution["value1"]) : new ParticipantInput();

        // Extract the participant metrics array out of $participant_input
        $participant_metrics = $participant_input->getAllParticipantMetrics();

        // Initialize the points with zero
        $points = 0;

        // Go through the different ScoringMetrics and sum their points up
        $points += ResultLines::calculateReachedPoints($this->solution_metrics, $participant_metrics);
        $points += ColumnNames::calculateReachedPoints($this->solution_metrics, $participant_metrics);
        $points += FunctionalDependencies::calculateReachedPoints($this->solution_metrics, $participant_metrics);

        return $points;
    }


    /**
     * Returns the points, a learner has reached answering the question
     * The points are calculated from the given answers.
     *
     * @param int $active_id
     * @param integer $pass The Id of the test pass
     * @param bool $authorizedSolution
     * @param boolean $returndetails (deprecated !!)
     * @return int
     *
     * @throws ilTestException
     */
    public function calculateReachedPoints($active_id, $pass = null, $authorizedSolution = true, $returndetails = false): float
    {
        if ($returndetails) {
            throw new ilTestException('return details not implemented for ' . __METHOD__);
        }

        if (is_null($pass)) {
            $pass = $this->getSolutionMaxPass($active_id);
        }

        // get the answers of the learner from the tst_solution table
        // the data is saved by saveWorkingData() in this class
        $solution = $this->getSolutionStored($active_id, $pass, $authorizedSolution);

        return $this->calculateReachedPointsForSolution($solution);
    }

    /**
     * Sets the points, a learner has reached answering the question
     *
     * @param integer $user_id The database ID of the learner
     * @param integer $test_id The database Id of the test containing the question
     * @param integer $points The points the user has reached answering the question
     * @return boolean true on success, otherwise false
     * @access public
     */
    public function setReachedPoints($active_id, $points, $pass = null)
    {
        global $DIC;

        $ilDB = $DIC->database();

        if (($points > 0) && ($points <= $this->getPoints())) {
            if (is_null($pass)) {
                $pass = $this->getSolutionMaxPass($active_id);
            }
            $affectedRows = $ilDB->manipulateF(
                "UPDATE tst_test_result SET points = %s WHERE active_fi = %s AND question_fi = %s AND pass = %s",
                array('float', 'integer', 'integer', 'integer'),
                array($points, $active_id, $this->getId(), $pass)
            );
            self::_updateTestPassResults($active_id, $pass);
            return true;
        } else {
            return true;
        }
    }

    /**
     * Saves the learners input of the question to the database.
     *
     * @param integer $active_id 	Active id of the user
     * @param integer $pass 		Test pass
     * @param boolean $authorized	The solution is authorized
     *
     * @return boolean $status
     */
    public function saveWorkingData($active_id, $pass = null, $authorized = true): bool
    {
        if (is_null($pass)) {
            $pass = ilObjTest::_getPass($active_id);
        }

        // get the submitted solution
        $solution = $this->getSolutionSubmit();

        $entered_values = 0;

        // save the submitted values avoiding race conditions
        $this->getProcessLocker()->executeUserSolutionUpdateLockOperation(function () use (&$entered_values, $solution, $active_id, $pass, $authorized) {
            $entered_values = isset($solution['value1']) || isset($solution['value2']);

            if ($authorized) {
                // a new authorized solution will delete the old one and the intermediate
                $this->removeExistingSolutions($active_id, $pass);
            } elseif ($entered_values) {
                // an new intermediate solution will only delete a previous one
                $this->removeIntermediateSolution($active_id, $pass);
            }

            if ($entered_values) {
                $this->saveCurrentSolution($active_id, $pass, $solution['value1'], $solution['value2'], $authorized);
            }
        });


        // Log whether the user entered values
        if (ilObjAssessmentFolder::_enabledAssessmentLogging()) {
            assQuestion::logAction(
                $this->lng->txtlng(
                    'assessment',
                    $entered_values ? 'log_user_entered_values' : 'log_user_not_entered_values',
                    ilObjAssessmentFolder::_getLogLanguage()
                ),
                $active_id,
                $this->getId()
            );
        }

        // submitted solution is valid
        return true;
    }


    /**
     * Reworks the already saved working data if neccessary
     * @param integer $active_id
     * @param integer $pass
     * @param boolean $obligationsAnswered
     * @param boolean $authorized
     */
    protected function reworkWorkingData($active_id, $pass, $obligationsAnswered, $authorized)
    {
        // usually nothing needs to be reworked
    }


    /**
     * Creates an Excel worksheet for the detailed cumulated results of this question
     *
     * @param object $worksheet    Reference to the parent excel worksheet
     * @param int $startrow     Startrow of the output in the excel worksheet
     * @param int $active_id    Active id of the participant
     * @param int $pass         Test pass
     *
     * @return int
     */
    public function setExportDetailsXLS(ilAssExcelFormatHelper $worksheet, int $startrow, int $active_id, int $pass): int
    {
        $worksheet->setFormattedExcelTitle($worksheet->getColumnCoord(0) . $startrow, $this->getPlugin()->txt('assSQLQuestion'));
        $worksheet->setFormattedExcelTitle($worksheet->getColumnCoord(1) . $startrow, $this->getTitle());

        $solution = $this->getSolutionStored($active_id, $pass, true);

        // Transform value1 of solution into a ParticipantInput
        $participant_input = isset($solution["value1"]) ? ParticipantInput::fromJSON($solution["value1"]) : new ParticipantInput();

        $row = $startrow + 1;

        $worksheet->setCell($row, 0, "Sequence");
        $worksheet->setBold($worksheet->getColumnCoord(0) . $row);
        $worksheet->setCell($row, 1, $participant_input->getSequence());
        $row++;

        $worksheet->setCell($row, 0, "Error_Bool");
        $worksheet->setBold($worksheet->getColumnCoord(0) . $row);
        $worksheet->setCell($row, 1, $participant_input->getErrorBool());
        $row++;

        $worksheet->setCell($row, 0, "Error");
        $worksheet->setBold($worksheet->getColumnCoord(0) . $row);
        $worksheet->setCell($row, 1, $participant_input->getError());
        $row++;

        $worksheet->setCell($row, 0, "Executed_Bool");
        $worksheet->setBold($worksheet->getColumnCoord(0) . $row);
        $worksheet->setCell($row, 1, $participant_input->getExecutedBool());
        $row++;

        $worksheet->setCell($row, 0, "Output_Relation");
        $worksheet->setBold($worksheet->getColumnCoord(0) . $row);
        $worksheet->setCell($row, 1, $participant_input->getOutputRelation());
        $row++;

        return $row + 1;
    }

    /**
     * Creates a question from a QTI file
     *
     * Receives parameters from a QTI parser and creates a valid ILIAS question object
     *
     * @param object $item The QTI item object
     * @param integer $questionpool_id The id of the parent questionpool
     * @param integer $tst_id The id of the parent test if the question is part of a test
     * @param object $tst_object A reference to the parent test object
     * @param integer $question_counter A reference to a question counter to count the questions of an imported question pool
     * @param array $import_mapping An array containing references to included ILIAS objects
     * @access public
     */
    public function fromXML($item, int $questionpool_id, ?int $tst_id, &$tst_object, int &$question_counter, array $import_mapping, array &$solutionhints = []): array
    {
        $import = new assSQLQuestionImport($this);
        $import_mapping = $import->fromXML($item, $questionpool_id, $tst_id, $tst_object, $question_counter, $import_mapping);

        return $import_mapping;
    }

    /**
     * Returns a QTI xml representation of the question and sets the internal
     * domxml variable with the DOM XML representation of the QTI xml representation
     *
     * @return string The QTI xml representation of the question
     * @access public
     */
    public function toXML(
        bool $a_include_header = true,
        bool $a_include_binary = true,
        bool $a_shuffle = false,
        bool $test_output = false,
        bool $force_image_references = false
    ): string {
        $export = new assSQLQuestionExport($this);
        return $export->toXML($a_include_header, $a_include_binary, $a_shuffle, $test_output, $force_image_references);
    }

    /**
     * Custom member functions only needed in an assSQLQuestion
     */

    /**
     * Getter and Setter for all $additional_data
     */

    /**
     * Returns the requested sequence (Either sequence_a, sequence_b or sequence_c)
     *
     * @param string $sequence_name The name of the requested sequence
     * @return string The requested sql sequence
     */
    public function getSequence($sequence_name): string
    {
        switch ($sequence_name) {
            case "sequence_a":
                return $this->sequence_a;
            case "sequence_b":
                return $this->sequence_b;
            case "sequence_c":
                return $this->sequence_c;
        }

        throw new Exception('Requested an unkown sequence');
    }

    /**
     * Sets a sequence (Either sequence_a, sequence_b or sequence_c)
     *
     * @param string $sequence_name The name of the sequence
     * @param string $sequence The requested sql sequence
     */
    public function setSequence($sequence_name, $sequence): void
    {
        switch ($sequence_name) {
            case "sequence_a":
                $this->sequence_a = $sequence;
                return;
            case "sequence_b":
                $this->sequence_b = $sequence;
                return;
            case "sequence_c":
                $this->sequence_c = $sequence;
                return;
        }

        throw new Exception('Tried to set an unkown sequence');
    }

    /**
     * Returns the integrity_check boolean (true for a integrity check has to be done)
     *
     * @return boolean The integrity_check boolean
     */
    public function getIntegrityCheck(): bool
    {
        return $this->integrity_check;
    }

    /**
     * Sets the integrity_check boolean (true for a integrity check has to be done)
     *
     * @param boolean $integrity_check The integrity_check boolean
     */
    public function setIntegrityCheck(bool $integrity_check): void
    {
        $this->integrity_check = $integrity_check;
    }

    /**
     * Returns the error state of the execution (true for errors have been found)
     *
     * @return boolean The error state
     */
    public function getErrorBool(): bool
    {
        return $this->error_bool;
    }

    /**
     * Sets the error state of the execution (true for errors have been found)
     *
     * @param boolean $error_bool The error state of the execution
     */
    public function setErrorBool(bool $error_bool): void
    {
        $this->error_bool = $error_bool;
    }

    /**
     * Returns the error json of the execution (empty for no errors that have been found)
     *
     * @return string The error json
     */
    public function getError(): string
    {
        return $this->error;
    }

    /**
     * Sets the error json of the execution (empty for no errors that have been found)
     *
     * @param string $error The error json
     */
    public function setError(string $error): void
    {
        $this->error = $error;
    }

    /**
     * Returns the execution state (true for code was executed)
     *
     * @return boolean The execution state
     */
    public function getExecutedBool()
    {
        return $this->executed_bool;
    }

    /**
     * Sets the execution state (true for code was executed)
     *
     * @param boolean $executed_bool The execution state
     */
    public function setExecutedBool(bool $executed_bool): void
    {
        $this->executed_bool = $executed_bool;
    }

    /**
     * Returns the output relation
     *
     * @return string The output relation
     */
    public function getOutputRelation(): string
    {
        return $this->output_relation;
    }

    /**
     * Sets the output relation
     *
     * @param string $output_relation The output relation
     */
    public function setOutputRelation(string $output_relation): void
    {
        $this->output_relation = $output_relation;
    }

    /**
     * Get all SolutionMetrics
     *
     * @return SolutionMetric[] A array containing all SolutionMetrics
     */
    public function getAllSolutionMetrics(): array
    {
        return $this->solution_metrics;
    }

    /**
     * Get all SolutionMetrics as JSON string
     *
     * @return string A JSON string containing all SolutionMetrics
     */
    public function getAllSolutionMetricsAsJSON(): string
    {
        $solution_metrics_json = array();

        foreach ($this->solution_metrics as $solution_metric) {
            array_push($solution_metrics_json, $solution_metric->toJSON());
        }

        return json_encode($solution_metrics_json);
    }

    /**
     * Get maximum points by add up all SolutionMetrics
     *
     * @return integer The maxium possible points
     */
    public function getMaximumPoints(): float
    {
        // Initialize with 0
        $maximum_points = 0;

        foreach ($this->solution_metrics as $solution_metric) {
            $maximum_points += $solution_metric->getPoints();
        }

        return $maximum_points;
    }

    /**
     * Sets all SolutionMetrics
     *
     * @param SolutionMetric[] $solution_metrics An array containg all SolutionMetrics to be set
     */
    public function setAllSolutionMetrics(array $solution_metrics): void
    {
        $this->solution_metrics = $solution_metrics;
    }

    /**
     * Sets all SolutionMetrics by using a JSON string
     *
     * @param string $json A JSON string containg all SolutionMetrics to be set
     */
    public function setAllSolutionMetricsFromJSON(string $json): void
    {
        $json_decoded = json_decode($json, true);

        foreach ($json_decoded as $solution_metric) {
            // Decode the inner JSON as well
            $solution_metric_decoded = json_decode($solution_metric, true);

            $this->setSingleSolutionMetric(new SolutionMetric(
                (string) $solution_metric_decoded['type'],
                (int) $solution_metric_decoded['points'],
                (string) $solution_metric_decoded['value']
            ));
        }
    }

    /**
     * Get all scoring metrics with a specific type
     *
     * @param string $type The type of the searched SolutionMetric
     * @return SolutionMetric[] An array containing all metrics with this type
     */
    public function getSolutionMetricsWithType($type): array
    {
        $found_metrics = array();

        foreach ($this->solution_metrics as $solution_metric) {
            if ($solution_metric->getType() == $type) {
                array_push($found_metrics, $solution_metric);
            }
        }

        return $found_metrics;
    }

    /**
     * Save a single SolutionMetric
     *
     * @param SolutionMetric $solution_metric The SolutionMetric to be set
     */
    public function setSingleSolutionMetric(SolutionMetric $solution_metric): void
    {
        if (is_a($solution_metric, "SolutionMetric")) {
            // Remove existing SolutionMetric with the same type
            for ($i = 0; $i < sizeof($this->solution_metrics); $i++) {
                if ($solution_metric->getType() == $this->solution_metrics[$i]->getType()) {
                    array_splice($this->solution_metrics, $i, 1);
                }
            }

            // Push the new SolutionMetric
            array_push($this->solution_metrics, $solution_metric);
        } else {
            throw new Exception("Object is no SolutionMetric in setSingleSolutionMetric()");
        }
    }

    /**
     * Database functions
     */

    /**
     * Save all data that is specific to assSQLQuestion into the database
     * (See dpupdate.php for more informations on used tables)
     */
    public function saveSpecificQuestionDataToDb(): void
    {
        global $DIC;

        $ilDB = $DIC->database();

        // Update "il_qpl_qst_qpisql_qd"

        // Delete existing entries with current question id (to avoid double entries)
        $ilDB->manipulate("DELETE FROM il_qpl_qst_qpisql_qd WHERE question_fi = '" . $this->getId() . "'");

        // Insert the current question data
        $ilDB->manipulateF(
            "INSERT INTO il_qpl_qst_qpisql_qd (
                question_fi,
                sequence_a,
                sequence_b,
                sequence_c,
                integrity_check,
                error_bool,
                error,
                executed_bool,
                output_relation
            )
			VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)",
            array(
                "integer",
                "text",
                "text",
                "text",
                "integer",
                "integer",
                "clob",
                "integer",
                "clob"
            ),
            array(
                $this->getId(),
                $this->getSequence('sequence_a'),
                $this->getSequence('sequence_b'),
                $this->getSequence('sequence_c'),
                $this->getIntegrityCheck(),
                $this->getErrorBool(),
                $this->getError(),
                $this->getExecutedBool(),
                $this->getOutputRelation()
            )
        );


        // Update "il_qpl_qst_qpisql_qsm"

        // Delete existing entries with current question id (to avoid double entries)
        $ilDB->manipulate("DELETE FROM il_qpl_qst_qpisql_qsm
											 WHERE question_fi = '" . $this->getId() . "'");

        // Insert all current SolutionMetrics
        foreach ($this->solution_metrics as $solution_metric) {
            $ilDB->manipulateF(
                "INSERT INTO il_qpl_qst_qpisql_qsm (
                    question_fi,
                    type,
                    points,
                    value
                )
				VALUES (%s, %s, %s, %s)",
                array(
                    "integer",
                    "text",
                    "integer",
                    "clob"
                ),
                array(
                    $this->getId(),
                    $solution_metric->getType(),
                    $solution_metric->getPoints(),
                    $solution_metric->getValue()
                )
            );
        }
    }

    /**
     * Load all data that is specific to assSQLQuestion from the database
     * (See dpupdate.php for more informations on used tables)
     *
     * @param integer $question_id A unique key which defines the question in the database
     */
    public function loadSpecificQuestionDataFromDb($question_id)
    {
        global $DIC;
        $ilDB = $DIC->database();

        // Set Sequences and other data from il_qpl_qst_qpisql_qd
        $result_qd = $ilDB->query("SELECT * FROM il_qpl_qst_qpisql_qd WHERE question_fi = "
            . $ilDB->quote($question_id, 'integer'));

        if ($result_qd->numRows() > 0) {
            $data_qd = $ilDB->fetchAssoc($result_qd);

            $this->setSequence('sequence_a', (string) $data_qd['sequence_a']);
            $this->setSequence('sequence_b', (string) $data_qd['sequence_b']);
            $this->setSequence('sequence_c', (string) $data_qd['sequence_c']);
            $this->setIntegrityCheck((bool) $data_qd['integrity_check']);
            $this->setErrorBool((bool) $data_qd['error_bool']);
            $this->setError((string) $data_qd['error']);
            $this->setExecutedBool((bool) $data_qd['executed_bool']);
            $this->setOutputRelation((string) $data_qd['output_relation']);
        }

        // Set SolutionMetrics from il_qpl_qst_qpisql_qsm
        $result_qsm = $ilDB->query("SELECT * FROM il_qpl_qst_qpisql_qsm WHERE question_fi = "
            . $ilDB->quote($question_id, 'integer'));

        while ($data_qsm = $ilDB->fetchAssoc($result_qsm)) {
            $this->setSingleSolutionMetric(
                new SolutionMetric(
                    (string) $data_qsm['type'],
                    (int) $data_qsm['points'],
                    (string) $data_qsm['value']
                )
            );
        }
    }
}
