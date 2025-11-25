<?php

declare(strict_types=1);

/**
 * Represents the ResultLines ScoringMetric
 *
 * @author Dominik Probst <dominik.probst@fau.de>
 */
class ResultLines extends ScoringMetric
{
    /**
     * @var string The type identifier of the scoring metric (e.g. "functional_dependency")
     */
    protected static string $type = "result_lines";

    /**
     * @var string The Javascript funtion to get the value of the sm out of a result
     */
    protected static string $getter = "function(result) { return result.getNumberOfRows(); }";

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
        return $plugin->txt('ai_sca_eo_sm_rl_info');
    }

    /**
     * Get the info text of for the solution page
     *
     * @return string The info text shown at the solution page
     * @access protected
     */
    protected static function getSolutionPageInfo($plugin): string
    {
        return $plugin->txt('ai_sca_so_sm_rl_info');
    }

    /**
     * Calculate the reached points out of a metric
     *
     * @param SolutionMetric[] $solution_metrics The suiting solution metric array (with the pattern solution values)
     * @param ParticipantMetric[] $participant_metrics The participant metric array to be evaluated
     *
     * @return float The reached points
     *
     * @access public
     */
    public static function calculateReachedPoints($solution_metrics, $participant_metrics): float
    {
        // Get the suiting solution and participant metric
        $solution_metric = static::getSolutionMetric($solution_metrics);
        $participant_metric = static::getParticipantMetric($participant_metrics);

        // In this Scoring metric the participant metrics value has to be exactly the value of the solution
        // metric for the participant to receive any points
        if ($solution_metric->getValue() == $participant_metric->getValue()) {
            return $solution_metric->getPoints();
        }

        return 0;
    }
}
