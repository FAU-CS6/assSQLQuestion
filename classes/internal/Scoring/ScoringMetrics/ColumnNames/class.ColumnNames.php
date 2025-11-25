<?php

declare(strict_types=1);

/**
 * Represents the ColumnNames ScoringMetric
 *
 * @author Dominik Probst <dominik.probst@fau.de>
 */
class ColumnNames extends ScoringMetric
{
    /**
     * @var string The type identifier of the scoring metric (e.g. "functional_dependency")
     */
    protected static string $type = "column_names";

    /**
     * @var string The Javascript funtion to get the value of the sm out of a result
     */
    protected static string $getter = "function(result) { return result.getColumnNamesAsJSON(); }";

    /**
     * @var string The Javascript to beautifiy (make it more readable) the getter string
     */
    protected static string $beautifier = "function(stringToBeautify) {
      var decoded_json = '';

      try {
        decoded_json = JSON.parse(stringToBeautify);
      } catch (e) {
        return stringToBeautify;
      }

      var return_string = '';

      for(var i = 0; i < decoded_json.length; i++)
      {
        return_string += decoded_json[i];

        if(i != decoded_json.length - 1)
        {
            return_string += ', ';
        }
      }

      return return_string;
    }";

    /**
     * Get the info text of for the edit page
     *
     * @return string The info text shown at the edit page
     * @access protected
     */
    protected static function getEditPageInfo($plugin): string
    {
        return $plugin->txt('ai_sca_eo_sm_cn_info');
    }

    /**
     * Get the info text of for the solution page
     *
     * @return string The info text shown at the solution page
     * @access protected
     */
    protected static function getSolutionPageInfo($plugin): string
    {
        return $plugin->txt('ai_sca_so_sm_cn_info');
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

        // Decode the JSONs
        $solution_columns_anycase = json_decode($solution_metric->getValue(), true);
        $participant_columns_anycase = json_decode($participant_metric->getValue(), true);
        
        // Return early if one of the column arrays is empty
        if (!$solution_columns_anycase && !$participant_columns_anycase) {
            return $solution_metric->getPoints(); // Both empty --> full points
        } elseif (!$solution_columns_anycase || !$participant_columns_anycase) {
            return 0; // One empty but not the other --> no points
        }
        // Sanitize the column names by making the array keys all lowercase
        $solution_columns = array();
        foreach ($solution_columns_anycase as $v) {
            array_push($solution_columns, strtolower($v));
        }
        $participant_columns = array();
        foreach ($participant_columns_anycase as $v) {
            array_push($participant_columns, strtolower($v));
        }

        // Compute the UNION of both
        $union = array_unique(array_merge($solution_columns, $participant_columns));

        // Compute the INTERSECT
        $intersect = array_intersect($solution_columns, $participant_columns);

        // Compute 1 - Jaccard distance
        return (1 - ((sizeof($union) - sizeof($intersect)) / sizeof($union))) * $solution_metric->getPoints();
    }
}
