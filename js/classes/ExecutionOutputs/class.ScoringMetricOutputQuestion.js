/**
 * @file ExecutionOutput for all scoring metrics on question output page
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * ExecutionOutput for all scoring metrics on question output page
  */
 class ScoringMetricOutputQuestion extends ExecutionOutput
 {
   /**
    * Constructor
    *
    * @param {string} type The type of the scoring metric - used in the id of the elements to be edited
    * @param {callback} getter The function to get the compute the value of the scoringMetric after a result was issued
    */
   constructor(type, getter)
   {
     super();

     this.type = type;
     this.getter = getter;
   }

   /**
    * Event handler that is called at the moment any input is changed
    */
   onChange()
   {
     document.getElementById('qpisql-scoring-metric-value-' + this.type).value = "false";
   }

   /**
    * Event handler that is called at the moment an execution is started
    */
   onExecution()
   {
     document.getElementById('qpisql-scoring-metric-value-' + this.type).value = "false";
   }

   /**
    * Event handler that is called if a execution ends with an error
    *
    * @param {SQLRunErrorAbstract} error The error object
    */
   onError(error)
   {
     document.getElementById('qpisql-scoring-metric-value-' + this.type).value = "false";
   }

   /**
    * Event handler that is called if a execution ends with a result
    *
    * @param {SQLResult} result The result object
    */
   onResult(result)
   {
     document.getElementById('qpisql-scoring-metric-value-' + this.type).value = this.getter(result);
   }

 }
