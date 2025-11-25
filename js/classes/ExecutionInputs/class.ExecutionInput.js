/**
 * @file (Abstract) implemantation of a single input element for the Execution
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * (Abstract) Implemantation of a single input element for the Execution
  */
 class ExecutionInput
 {

   /**
    * Constructor
    */
   constructor()
   {
     // Set the name of the ExecutionInput
     this.name = "";
   }

   /**
    * Getter for the name
    *
    * @return {string} The name of the ExecutionInput
    */
   getName()
   {
     return this.name;
   }

   /**
    * Getter for the value of the input
    *
    * @return {string} The input value
    */
   getValue()
   {
     return "";
   }

 }
