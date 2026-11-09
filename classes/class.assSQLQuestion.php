<?php

declare(strict_types=1);

use ILIAS\Test\Logging\AdditionalInformationGenerator;
use ILIAS\TestQuestionPool\Questions\QuestionAutosaveable;

/**
 * Main definition of the SQLQuestion plugin
 *
 * @author Dominik Probst <dominik.probst@fau.de>
 * @ingroup ModulesTestQuestionPool
 */
class assSQLQuestion extends assQuestion implements QuestionAutosaveable
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

    /** Optional hints are disabled for existing questions and legacy imports. */
    public bool $editor_assistance = false;

    public function getEditorAssistance(): bool
    {
        return $this->editor_assistance;
    }

    public function setEditorAssistance(bool $enabled): void
    {
        $this->editor_assistance = $enabled;
    }

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
     * Returns the primary additional question data table
     *
     * @return string The name of the additional table
     */
    public function getAdditionalTableName(): string
    {
        return 'il_qpl_qst_qpisql_qd';
    }

    public function deleteAdditionalTableData(int $question_id): void
    {
        parent::deleteAdditionalTableData($question_id);
        $this->db->manipulateF(
            'DELETE FROM il_qpl_qst_qpisql_qsm WHERE question_fi = %s',
            ['integer'],
            [$question_id]
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

    public function toLog(AdditionalInformationGenerator $additional_info): array
    {
        return [
            AdditionalInformationGenerator::KEY_QUESTION_TYPE => $this->getQuestionType(),
            AdditionalInformationGenerator::KEY_QUESTION_TITLE => $this->getTitleForHTMLOutput(),
            AdditionalInformationGenerator::KEY_QUESTION_TEXT => $this->formatSAQuestion($this->getQuestion()),
            AdditionalInformationGenerator::KEY_QUESTION_REACHABLE_POINTS => $this->getMaximumPoints(),
            'Sequence A' => $this->getSequence('sequence_a'),
            'Sequence B' => $this->getSequence('sequence_b'),
            'Sequence C' => $this->getSequence('sequence_c'),
            'Integrity check' => $additional_info->getTrueFalseTagForBool($this->getIntegrityCheck()),
            'Scoring metrics' => $this->getAllSolutionMetricsAsJSON()
        ];
    }

    protected function solutionValuesToLog(
        AdditionalInformationGenerator $additional_info,
        array $solution_values
    ): string {
        return $this->solutionValuesToText($solution_values);
    }

    protected function solutionValuesToText(array $solution_values): string
    {
        if ($solution_values === []) {
            return '';
        }

        $solution = end($solution_values);
        return isset($solution['value1'])
            ? ParticipantInput::fromJSON((string) $solution['value1'])->getSequence()
            : '';
    }

    public function getCorrectSolutionForTextOutput(int $active_id, int $pass): string
    {
        return $this->getSequence('sequence_b');
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
     * @param int|null $original_id The original id
     * @access public
     * @see assQuestion::saveToDb()
     */
    public function saveToDb(?int $original_id = null): void
    {
        // Save the basic data (implemented in assQuestion)
        $this->saveQuestionDataToDb($original_id);

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
        $this->setOriginalId($data['original_id'] === null ? null : (int) $data['original_id']);
        $this->setOwner((int) $data['owner']);
        $this->setTitle((string) $data['title']);
        $this->setAuthor((string) $data['author']);
        $this->setPoints((float) $data['points']);
        $this->setComment((string) $data['description']);
        $this->setNrOfTries((int) $data['nr_of_tries']);

        try {
            $this->setLifecycle(ilAssQuestionLifecycle::getInstance((string) $data['lifecycle']));
        } catch (ilTestQuestionPoolInvalidArgumentException $e) {
            $this->setLifecycle(ilAssQuestionLifecycle::getDraftInstance());
        }

        $this->setQuestion((string) ilRTE::_replaceMediaObjectImageSrc((string) $data['question_text'], 1));

        // Load the assSQLQuestion specific data
        $this->loadSpecificQuestionDataFromDb($question_id);

        try {
            $this->setAdditionalContentEditingMode($data['add_cont_edit_mode'] ?? null);
        } catch (ilTestQuestionPoolException $e) {
        }

        // loads additional stuff like suggested solutions
        parent::loadFromDb($question_id);
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

        if (isset($_POST['qss_evaluation']) && is_string($_POST['qss_evaluation'])) {
            $participant_input->setQssEvaluationFromJSON($_POST['qss_evaluation']);
            $qss = $participant_input->getQssEvaluation();
            $answer = str_replace(["\r\n", "\r"], "\n", $participant_input->getSequence());
            if ($qss !== null &&
                (!hash_equals(JsBlock::getQssReferenceRevision($this), $qss['referenceRevision'] ?? '') ||
                 !hash_equals(hash('sha256', $answer), $qss['answerDigest'] ?? ''))) {
                $participant_input->setQssEvaluation(null);
            }
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

        if (!$participant_input->getExecutedBool() || $participant_input->getErrorBool()) {
            return 0.0;
        }

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
     * @param bool $authorized_solution
     * @return int
     *
     * @throws ilTestException
     */
    public function calculateReachedPoints(int $active_id, ?int $pass = null, bool $authorized_solution = true): float
    {
        if (is_null($pass)) {
            $pass = $this->getSolutionMaxPass($active_id);
        }

        // get the answers of the learner from the tst_solution table
        // the data is saved by saveWorkingData() in this class
        $solution = $this->getSolutionStored($active_id, $pass, $authorized_solution);

        return $this->calculateReachedPointsForSolution($solution);
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
    public function saveWorkingData(int $active_id, ?int $pass = null, bool $authorized = true): bool
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


        // submitted solution is valid
        return true;
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
                editor_assistance,
                error_bool,
                error,
                executed_bool,
                output_relation
            )
			VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
            array(
                "integer",
                "text",
                "text",
                "text",
                "integer",
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
                $this->getEditorAssistance(),
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
            $this->setEditorAssistance((bool) ($data_qd['editor_assistance'] ?? false));
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
