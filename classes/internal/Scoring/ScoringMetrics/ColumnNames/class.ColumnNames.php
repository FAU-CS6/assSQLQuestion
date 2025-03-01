<?php

declare(strict_types=1);

/**
 * Represents the ColumnNames ScoringMetric
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 */
class ColumnNames extends ScoringMetric
{
    /**
     * @var string The type identifier of the scoring metric (e.g. "functional_dependency")
     */
    protected static $type = "column_names";

    /**
     * @var string The Javascript funtion to get the value of the sm out of a result
     */
    protected static $getter = "function(result) { return result.getColumnNamesAsJSON(); }";

    /**
     * @var string The Javascript to beautifiy (make it more readable) the getter string
     */
    protected static $beautifier = "function(stringToBeautify) {
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
    protected static function getEditPageInfo($plugin)
    {
        return $plugin->txt('ai_sca_eo_sm_cn_info');
    }

    /**
     * Get the info text of for the solution page
     *
     * @return string The info text shown at the solution page
     * @access protected
     */
    protected static function getSolutionPageInfo($plugin)
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
    public static function calculateReachedPoints($solution_metrics, $participant_metrics)
    {
        // Get the suiting solution and participant metric
        $solution_metric = static::getSolutionMetric($solution_metrics);
        $participant_metric = static::getParticipantMetric($participant_metrics);

        // Decode the JSONs
        $solution_metric_decoded = json_decode($solution_metric->getValue(), TRUE);
        $participant_metric_decoded = json_decode($participant_metric->getValue(), TRUE);

        // If $solution_metric_decoded is empty the participant only gets (full) points if his solution is empty, too
        if($solution_metric_decoded == "") {
            if($participant_metric_decoded == "") {
                return $solution_metric->getPoints();
            }

            return 0;
        }

        // On the other side it might be possible that the participants column names are empty and the solution metric
        // is not (last condition is true if the code on this position is executed) => In this case the participant gets
        // zero points as well
        if($participant_metric_decoded == "") {
            return 0;
        }

        // Compute the UNION of both
        $union = array();

        // Iterate through the $solution_metric_decoded
        for($i = 0; $i < sizeof($solution_metric_decoded); $i++)
        {
          $found = false;

          for($ii = 0; $ii < sizeof($union); $ii++)
          {
            if(strtolower($union[$ii]) == strtolower($solution_metric_decoded[$i]))
            {
              $found = true;
            }
          }

          if(!$found)
          {
            array_push($union, $solution_metric_decoded[$i]);
          }
        }

        // Iterate through the $solution_metric_decoded
        for($i = 0; $i < sizeof($participant_metric_decoded); $i++)
        {
          $found = false;

          for($ii = 0; $ii < sizeof($union); $ii++)
          {
            if(strtolower($union[$ii]) == strtolower($solution_metric_decoded[$i]))
            {
              $found = true;
            }
          }

          if(!$found)
          {
            array_push($union, $participant_metric_decoded[$i]);
          }
        }

        // Compute the INTERSECT
        $intersect = array();

        // Iterate through the $solution_metric_decoded
        for($i = 0; $i < sizeof($solution_metric_decoded); $i++)
        {
          $found = false;

          for($ii = 0; $ii < sizeof($participant_metric_decoded); $ii++)
          {
            if(strtolower($participant_metric_decoded[$ii]) == strtolower($solution_metric_decoded[$i]))
            {
              $found = true;
            }
          }

          if($found)
          {
            array_push($intersect, $solution_metric_decoded[$i]);
          }
        }

        // Compute 1 - Jaccard distance
        return (1 - ((sizeof($union) - sizeof($intersect))/sizeof($union))) * $solution_metric->getPoints();
    }
}
