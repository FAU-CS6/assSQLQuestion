<?php

declare(strict_types=1);

/**
 * Represents the FunctionalDependencies ScoringMetric
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 */
class FunctionalDependencies extends ScoringMetric
{
    /**
     * @var string The type identifier of the scoring metric (e.g. "functional_dependency")
     */
    protected static string $type = "functional_dependencies";

    /**
     * @var string The Javascript funtion to get the value of the sm out of a result
     */
    protected static string $getter = "function(result) { return result.getAllMinimalFunctionalDependenciesAsJSON(); }";

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
        var decoded_inner_json = JSON.parse(decoded_json[i]);

        for(var ii = 0; ii < decoded_inner_json['determinateAttributes'].length; ii++)
        {
          return_string += decoded_inner_json['determinateAttributes'][ii];

          if(ii != decoded_inner_json['determinateAttributes'].length - 1)
          {
              return_string += ' &times; ';
          }
        }

        return_string += ' &rArr; ';

        for(var ii = 0; ii < decoded_inner_json['dependentAttributes'].length; ii++)
        {
          return_string += decoded_inner_json['dependentAttributes'][ii];

          if(ii != decoded_inner_json['dependentAttributes'].length - 1)
          {
              return_string += ' &times; ';
          }
        }

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
        return $plugin->txt('ai_sca_eo_sm_fd_info');
    }

    /**
     * Get the info text of for the solution page
     *
     * @return string The info text shown at the solution page
     * @access protected
     */
    protected static function getSolutionPageInfo($plugin): string
    {
        return $plugin->txt('ai_sca_so_sm_fd_info');
    }

    /**
     * Calculate the reached points out of a metric
     *
     * @param SolutionMetric[] $solution_metrics The suiting solution metric array (with the pattern solution values)
     * @param ParticipantMetric[] $participant_metrics The participant metric array to be evaluated
     *
     * @return int The reached points
     *
     * @access public
     */
    public static function calculateReachedPoints($solution_metrics, $participant_metrics): int
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

        // On the other side it might be possible that the participants fds are empty and the solution metric
        // is not (last condition is true if the code on this position is executed) => In this case the participant gets
        // zero points as well
        if($participant_metric_decoded == "") {
            return 0;
        }

        // If both solutions include no functional dependencies the participant scored full points
        if(sizeof($solution_metric_decoded) == sizeof($participant_metric_decoded)) {
            return $solution_metric->getPoints();
        }

        // Compute the UNION of both
        $union = array();

        // Iterate through the $solution_metric_decoded
        for($i = 0; $i < sizeof($solution_metric_decoded); $i++)
        {
          $found = false;

          for($ii = 0; $ii < sizeof($union); $ii++)
          {
            if(self::compareFunctionalDependencies($union[$ii], $solution_metric_decoded[$i]))
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
            if(self::compareFunctionalDependencies($union[$ii], $participant_metric_decoded[$i]))
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
            if(self::compareFunctionalDependencies($participant_metric_decoded[$ii], $solution_metric_decoded[$i]))
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

    /**
     * Compare function for functional dependencies - has to be 0 if both functional dependencies are equal
     *
     * @param array $a_json The first functional dependency as JSON string - should look like "{"determinateAttributes":[],"dependentAttributes":[]}"
     * @param array $b_json The second functional dependency as JSON string - should look like "{"determinateAttributes":[],"dependentAttributes":[]}"
     *
     * @return int true for both dependencies being the same - false for them being different
     *
     * @access public
     */
    public static function compareFunctionalDependencies($a_json, $b_json): bool
    {
      $a = json_decode($a_json, TRUE);
      $b = json_decode($b_json, TRUE);

      if(!is_array($a) || !is_array($b))
      {
        return false;
      }

      // At first check whether both have the keys determinateAttributes and dependentAttributes
      if(!array_key_exists("determinateAttributes", $a) || !array_key_exists("dependentAttributes", $a) ||
         !array_key_exists("determinateAttributes", $b) || !array_key_exists("dependentAttributes", $b))
      {
        throw new Exception('Tried to compare non functional dependencies in the compareFunctionalDependencies() function');
      }

      // Compare the length of both the determinateAtrributes and the dependentAttributes
      if(sizeof($a["determinateAttributes"]) != sizeof($b["determinateAttributes"]) ||
         sizeof($a["dependentAttributes"]) != sizeof($b["dependentAttributes"]))
      {
        return false;
      }

      // Save the values in seperate arrays for easier handling
      $a_determinate = array_map('strtolower', $a["determinateAttributes"]);
      $a_dependent = array_map('strtolower', $a["dependentAttributes"]);
      $b_determinate = array_map('strtolower', $b["determinateAttributes"]);
      $b_dependent = array_map('strtolower', $b["dependentAttributes"]);

      // Sort the arrays
      sort($a_determinate);
      sort($a_dependent);
      sort($b_determinate);
      sort($b_dependent);

      // Compare the determinate attributes
      for($i = 0; $i < sizeof($a_determinate); $i++)
      {
        if($a_determinate[$i] != $b_determinate[$i])
        {
          return false;
        }
      }

      // Compare the determinate attributes
      for($i = 0; $i < sizeof($a_dependent); $i++)
      {
        if($a_dependent[$i] != $b_dependent[$i])
        {
          return false;
        }
      }

      // Both functional dependencies are equal
      return true;
    }
}
