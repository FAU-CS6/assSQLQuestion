/**
 * @file ExecutionInput for a single integrity check checkbox
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * ExecutionInput for a single integrity check checkbox
  */
 class IntegrityCheckCheckboxInput extends ExecutionInput
 {

   /**
    * Constructor
    */
   constructor()
   {
     super();

     // Set the name of the SequenceInput
     this.name = 'integrity_check';
   }

   /**
    * Getter for the value of the input
    *
    * @return {string} The input value
    */
   getValue()
   {
     return document.getElementById('qpisql-integrity-check').checked;
   }

 }
