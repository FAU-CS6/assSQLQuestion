<?php

declare(strict_types=1);

/**
 * An abstract scoring metric - implementing functions to save and load
 * scoring metric data out of the database, as well as getting the suiting
 * GUIElement and comparing the pattern solution with the participants solution.
 *
 * It is important that these ScoringMetric does not save any data, it only
 * provides static methods to enable this scoringMetric.
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 */
abstract class ScoringMetric
{
    /**
     * @var string The type identifier of the scoring metric (e.g. "functional_dependency")
     */
    protected static string $type = "abstract";

    /**
     * @var string The Javascript funtion to get the value of the sm out of a result
     */
    protected static string $getter = "function(result) { return 'abstract'; }";

    /**
     * @var string The Javascript to beautifiy (make it more readable) the getter string
     */
    protected static string $beautifier = "function(stringToBeautify) { return stringToBeautify; }";

    /**
     * Get the info text of for the edit page
     *
     * @return string The info text shown at the edit page
     * @access protected
     */
    protected static function getEditPageInfo($plugin): string
    {
        throw new Exception("This is an abstract method that should never be used - Has to be implemented by a subclass");
    }

    /**
     * Get the info text of for the solution page
     *
     * @return string The info text shown at the solution page
     * @access protected
     */
    protected static function getSolutionPageInfo($plugin): string
    {
        throw new Exception("This is an abstract method that should never be used - Has to be implemented by a subclass");
    }

    /**
     * Get the corresponding SolutionMetric (Pattern solution value) for
     * this specific ScoringMetric out of a SolutionMetric array
     *
     * @param SolutionMetric[] $solution_metrics A array containing a bunch of SolutionMetrics
     * @return SolutionMetric The solution metric suiting the type of the ScoringMetric
     * @access protected
     */
    protected static function getSolutionMetric($solution_metrics): SolutionMetric
    {
        foreach ($solution_metrics as $solution_metric) {
            if ($solution_metric->getType() == static::$type) {
                return $solution_metric;
            }
        }

        return new SolutionMetric(static::$type, 0, "");
    }

    /**
     * Get the corresponding ParticipantMetric (Pattern solution value) for
     * this specific ParticipantMetric out of a ParticipantMetric array
     *
     * @param ParticipantMetric[] $participant_metrics A array containing a bunch of ParticipantMetrics
     * @return ParticipantMetric The solution metric suiting the type of the ParticipantMetric
     * @access protected
     */
    protected static function getParticipantMetric($participant_metrics): ParticipantMetric
    {
        foreach ($participant_metrics as $participant_metric) {
            if ($participant_metric->getType() == static::$type) {
                return $participant_metric;
            }
        }

        return new ParticipantMetric(static::$type, "");
    }

    /**
     * Get the edit page html code for the ScoringMetric
     *
     * @param ilassSQLQuestionPlugin $plugin The plugin object
     * @param assSQLQuestion $object The question object
     * @return string The html code of the GUI element
     * @access public
     */
    public static function getEditOutput($plugin, $object): string
    {
        // Get the SolutionMetric
        $solution_metric = static::getSolutionMetric($object->getAllSolutionMetrics());

        $tpl = $plugin->getTemplate('ScoringArea/tpl.il_as_qpl_qpisql_sca_sm_input.html');

        // Scoring metric specific Variables
        $tpl->setVariable("INFO", static::getEditPageInfo($plugin));
        $tpl->setVariable("TYPE", static::$type);
        $tpl->setVariable("GETTER", static::$getter);
        $tpl->setVariable("BEAUTIFIER", static::$beautifier);

        // Set default values
        $value = $solution_metric->getValue();

        if (isset($_POST["value_" . static::$type])) {
            $value = (string) $_POST["value_" . static::$type];
        }

        $points = $solution_metric->getPoints();

        if (isset($_POST["points_" . static::$type])) {
            $points = (int) $_POST["points_" . static::$type];
        }

        $tpl->setVariable("VALUE", $value);

        $default_points = array(
            "" /* 0 */ ,
            "" /* 1 */ ,
            "" /* 2 */ ,
            "" /* 3 */ ,
            "" /* 4 */ ,
            "" /* 5 */ ,
            "" /* 6 */ ,
            "" /* 7 */ ,
            "" /* 8 */ ,
            "" /* 9 */ ,
            "" /* 10 */ ,
            "" /* 11 */ ,
            "" /* 12 */ ,
            "" /* 13 */ ,
            "" /* 14 */ ,
            "" /* 15 */
        );
        $default_points[$points] = "selected='selected'";

        $tpl->setVariable("DEFAULT_POINTS_0", $default_points[0]);
        $tpl->setVariable("DEFAULT_POINTS_1", $default_points[1]);
        $tpl->setVariable("DEFAULT_POINTS_2", $default_points[2]);
        $tpl->setVariable("DEFAULT_POINTS_3", $default_points[3]);
        $tpl->setVariable("DEFAULT_POINTS_4", $default_points[4]);
        $tpl->setVariable("DEFAULT_POINTS_5", $default_points[5]);
        $tpl->setVariable("DEFAULT_POINTS_6", $default_points[6]);
        $tpl->setVariable("DEFAULT_POINTS_7", $default_points[7]);
        $tpl->setVariable("DEFAULT_POINTS_8", $default_points[8]);
        $tpl->setVariable("DEFAULT_POINTS_9", $default_points[9]);
        $tpl->setVariable("DEFAULT_POINTS_10", $default_points[10]);
        $tpl->setVariable("DEFAULT_POINTS_11", $default_points[11]);
        $tpl->setVariable("DEFAULT_POINTS_12", $default_points[12]);
        $tpl->setVariable("DEFAULT_POINTS_13", $default_points[13]);
        $tpl->setVariable("DEFAULT_POINTS_14", $default_points[14]);
        $tpl->setVariable("DEFAULT_POINTS_15", $default_points[15]);

        // Set the executed placeholder
        if (
            (isset($_POST["executed_bool"]) && $_POST["executed_bool"] == "true") ||
            !isset($_POST["executed_bool"]) && $object->getExecutedBool()
        ) {
            $tpl->setVariable("EXECUTED", "true");
        } else {
            $tpl->setVariable("EXECUTED", "false");
        }


        // General translations
        $tpl->setVariable("POINTS", $plugin->txt('ai_sca_points'));
        $tpl->setVariable("WARNING_NO_EXECUTION", $plugin->txt('ai_sca_eo_no_exec'));
        $tpl->setVariable("OUTPUT_TEXT", $plugin->txt('ai_sca_eo_out_text'));

        return $tpl->get();
    }

    /**
     * Get the question page html code for the ScoringMetric
     *
     * @param ilassSQLQuestionPlugin $plugin The plugin object
     * @param assSQLQuestion $object The question object
     * @param ParticipantInput $participant_input A ParticipantInput object containing the existing data
     * @return string The html code of the GUI element
     * @access public
     */
    public static function getQuestionOutput($plugin, $object, $participant_input): string
    {
        // Get the suiting participant_metric
        $participant_metric = static::getParticipantMetric($participant_input->getAllParticipantMetrics());

        // Set the default value
        $value = $participant_metric->getValue();

        // If there exsists a POST value use that instead
        if (isset($_POST["value_" . static::$type])) {
            $value = (string) $_POST["value_" . static::$type];
        }

        $tpl = $plugin->getTemplate('ScoringArea/tpl.il_as_qpl_qpisql_sca_sm_hidden.html');

        // Set the type an the getter
        $tpl->setVariable("TYPE", static::$type);
        $tpl->setVariable("GETTER", static::$getter);

        // Set the default Value
        $tpl->setVariable("VALUE", $participant_metric->getValue());

        return $tpl->get();
    }

    /**
     * Get the solution page html code for the ScoringMetric
     *
     * @param ilassSQLQuestionPlugin $plugin The plugin object
     * @param assSQLQuestion $object The question object
     * @param ParticipantInput|null $participant_input A ParticipantInput object containing the participant inputs
     * @return string The html code of the GUI element
     * @access public
     */
    public static function getSolutionOutput($plugin, $object, $participant_input): string
    {
        $tpl = $plugin->getTemplate('ScoringArea/tpl.il_as_qpl_qpisql_sca_sm_output.html');

        // Set type, ID and beautifier
        $tpl->setVariable("TYPE", static::$type);
        $tpl->setVariable("BEAUTIFIER", static::$beautifier);

        if (!is_null($participant_input)) {
            $tpl->setVariable("ID", $id = "id" . $object->getId() . "cor0");
        } else {
            $tpl->setVariable("ID", $id = "id" . $object->getId() . "cor1");
        }

        // Set the headers
        $tpl->setVariable("HEADER", static::getSolutionPageInfo($plugin));
        $tpl->setVariable("HEADER_COMPUTED_VALUE", $plugin->txt('ai_sca_so_computed_value'));
        $tpl->setVariable("HEADER_POINTS", $plugin->txt('ai_sca_so_points'));
        $tpl->setVariable("HEADER_EXPECTED_VALUE", $plugin->txt('ai_sca_so_expected_value'));
        $tpl->setVariable("HEADER_MAX_POINTS", $plugin->txt('ai_sca_so_max_points'));

        // Expected values
        $tpl->setVariable("EXPECTED_VALUE", static::getSolutionMetric($object->getAllSolutionMetrics())->getValue());
        $tpl->setVariable("MAX_POINTS", static::getSolutionMetric($object->getAllSolutionMetrics())->getPoints());

        // If we display the pattern solution
        if (is_null($participant_input)) {
            $tpl->setVariable("COMPUTED_VALUE", static::getSolutionMetric($object->getAllSolutionMetrics())->getValue());
            $tpl->setVariable("POINTS", static::getSolutionMetric($object->getAllSolutionMetrics())->getPoints());
        }
        // If we display the participants solution
        else {
            $tpl->setVariable("COMPUTED_VALUE", static::getParticipantMetric($participant_input->getAllParticipantMetrics())->getValue());
            $solution_metrics = $object->getAllSolutionMetrics();
            $participant_metrics = $participant_input->getAllParticipantMetrics();
            $tpl->setVariable("POINTS", static::calculateReachedPoints(
                $solution_metrics,
                $participant_metrics
            ));
        }



        return $tpl->get();
    }

    /**
     * Writes the POST data of the edit page into the $object
     *
     * @param ilassSQLQuestionPlugin $plugin The plugin object
     * @param assSQLQuestion $object The question object
     * @access public
     */
    public static function writePostData($plugin, $object): void
    {
        $object->setSingleSolutionMetric(
            new SolutionMetric(
                static::$type, // type
                (int) $_POST["points_" . static::$type], // points
                (string) $_POST["value_" . static::$type]
            ) // value
        );
    }

    /**
     * Writes the POST data of a participants input into a ParticipantInput object
     *
     * @param ParticipantInput $participant_input The ParticipantInput object the POST data is written to
     * @access public
     */
    public static function writeParticipantInput($participant_input): void
    {
        $participant_input->setSingleParticipantMetric(
            new ParticipantMetric(
                static::$type, // type
                (string) $_POST["value_" . static::$type]
            ) // value
        );
    }

    /**
     * Calculate the reached points out of a metric
     *
     * @param SolutionMetric[] $solution_metrics The suiting solution metric array (with the pattern solution values)
     * @param ParticipantMetric[] $participant_metrics The participant metric array to be evaluated
     * @return float The reached points
     * @access protected
     */
    public static function calculateReachedPoints($solution_metrics, $participant_metrics): float
    {
        throw new Exception("This is an abstract method that should never be used - Has to be implemented by a subclass");
    }
}
