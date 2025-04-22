/**
 * @file ExecutionOutput for a single CodeMirror Sequence input area
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 * @version 0.1
 */

 /**
  * ExecutionOutput for a single CodeMirror Sequence input area
  */
 class SequenceTextareaOutput extends ExecutionOutput
 {

   /**
    * Constructor
    *
    * @param {CodeMirror} editor The instance of CodeMirror
    */
   constructor(editor)
   {
     super();

     this.editor = editor;
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
     this.editor.setReadOnly(true);
     // Transfer the contents of the 
     this.editor.transferValueToTextarea();
   }

   /**
    * Event handler that is called if a execution ends with an error
    *
    * @param {SQLRunErrorAbstract} error The error object
    */
   onError(error)
   {
     // Enable the input
     this.editor.setReadOnly(false);
   }

   /**
    * Event handler that is called if a execution ends with a result
    *
    * @param {SQLResult} result The result object
    */
   onResult(result)
   {
     // Enable the input
     this.editor.setReadOnly(false);
   }

 }
