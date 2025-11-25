/**
 * @file ExecutionOutput for a single execute buttom
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * ExecutionOutput for a single execute buttom
  */
 class ExecuteButtonOutput extends ExecutionOutput
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
     // Disable the input
     document.getElementById('qpisql-execute-button').disabled = true;
   }

   /**
    * Event handler that is called if a execution ends with an error
    *
    * @param {SQLRunErrorAbstract} error The error object
    */
   onError(error)
   {
     // Enable the input
     document.getElementById('qpisql-execute-button').disabled = false;
   }

   /**
    * Event handler that is called if a execution ends with a result
    *
    * @param {SQLResult} result The result object
    */
   onResult(result)
   {
     // Enable the input
     document.getElementById('qpisql-execute-button').disabled = false;
   }

 }
