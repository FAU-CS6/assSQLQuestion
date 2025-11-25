/**
 * @file ExecutionOutput for a single integrity check checkbox
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * ExecutionOutput for a single integrity check checkbox
  */
 class IntegrityCheckCheckboxOutput extends ExecutionOutput
 {

   /**
    * Constructor
    */
   constructor()
   {
     super();
   }

   /**
    * Event handler that is called at the moment any input is changed
    */
   onChange()
   {
     // Do nothing
   }

   /**
    * Event handler that is called at the moment an execution is started
    */
   onExecution()
   {
     document.getElementById('qpisql-integrity-check').disabled = true;
   }

   /**
    * Event handler that is called if a execution ends with an error
    *
    * @param {SQLRunErrorAbstract} error The error object
    */
   onError(error)
   {
     document.getElementById('qpisql-integrity-check').disabled = false;
   }

   /**
    * Event handler that is called if a execution ends with a result
    *
    * @param {SQLResult} result The result object
    */
   onResult(result)
   {
     document.getElementById('qpisql-integrity-check').disabled = false;
   }

 }
