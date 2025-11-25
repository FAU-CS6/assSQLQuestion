/**
 * @file ExecutionOutput for the hidden fields of the output area
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * ExecutionOutput for visible area of the output area
  */
 class OutputAreaOutput extends ExecutionOutput
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
     this.onError(new SQLRunErrorNoExecution());
   }

   /**
    * Event handler that is called at the moment an execution is started
    */
   onExecution()
   {
     // Set the hidden fields
     document.getElementById('qpisql-error-bool').value = "false";
     document.getElementById('qpisql-error').value = "";
     document.getElementById('qpisql-executed-bool').value = "false";
     document.getElementById('qpisql-output-relation').value = "";

     // Set the other two qpisql-inner-output-areas to be hidden and emtpy
     // In this case the error output area
     document.getElementById('qpisql-output-area-error').innerHTML = "";
     document.getElementById('qpisql-output-area-error').style.display = "none";
     // And the relation output area
     document.getElementById('qpisql-output-area-relation').innerHTML = "";
     document.getElementById('qpisql-output-area-relation').style.display = "none";

     // Set the execution running to be visable
     document.getElementById('qpisql-output-area-execution-running').style.display = "inherit";
   }

   /**
    * Event handler that is called if a execution ends with an error
    *
    * @param {SQLRunErrorAbstract} error The error object
    */
   onError(error)
   {
     // Set the hidden fields
     document.getElementById('qpisql-error-bool').value = "true";
     document.getElementById('qpisql-error').value = error.toJSON();
     document.getElementById('qpisql-executed-bool').value = "false";
     document.getElementById('qpisql-output-relation').value = "";

     // Set the other two qpisql-inner-output-areas to be hidden and emtpy
     // In this case the execution running output area
     document.getElementById('qpisql-output-area-execution-running').style.display = "none";
     // And the relation output area
     document.getElementById('qpisql-output-area-relation').innerHTML = "";
     document.getElementById('qpisql-output-area-relation').style.display = "none";

     // Set the error output area to be visable and output the error
     document.getElementById('qpisql-output-area-error').innerHTML = error.getOutputText();
     document.getElementById('qpisql-output-area-error').style.display = "inherit";
   }

   /**
    * Event handler that is called if a execution ends with a result
    *
    * @param {SQLResult} result The result object
    */
   onResult(result)
   {
     // Set the hidden fields
     document.getElementById('qpisql-error-bool').value = "false";
     document.getElementById('qpisql-error').value = "";
     document.getElementById('qpisql-executed-bool').value = "true";
     document.getElementById('qpisql-output-relation').value = result.toJSON();

     // Set the other two qpisql-inner-output-areas to be hidden and emtpy
     // In this case the execution running output area
     document.getElementById('qpisql-output-area-execution-running').style.display = "none";
     // And the error output area
     document.getElementById('qpisql-output-area-error').innerHTML = "";
     document.getElementById('qpisql-output-area-error').style.display = "none";

     // Set the error output area to be visable and output the error
     document.getElementById('qpisql-output-area-relation').innerHTML = result.toHTMLTable();
     document.getElementById('qpisql-output-area-relation').style.display = "inherit";
   }

 }
