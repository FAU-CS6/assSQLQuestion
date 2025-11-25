/**
 * @file (Abstract) implemantation of a single output element for the Execution
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * (Abstract) Implemantation of a single output element for the Execution
  */
 class ExecutionOutput
 {

   /**
    * Constructor
    */
   constructor()
   {
     // Do nothing
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
     // Do nothing
   }

   /**
    * Event handler that is called if a execution ends with an error
    *
    * @param {SQLRunErrorAbstract} error The error object
    */
   onError(error)
   {
     // Do nothing
   }

   /**
    * Event handler that is called if a execution ends with a result
    *
    * @param {SQLResult} result The result object
    */
   onResult(result)
   {
     // Do nothing
   }

 }
