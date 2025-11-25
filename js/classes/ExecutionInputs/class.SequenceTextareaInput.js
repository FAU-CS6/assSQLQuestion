/**
 * @file ExecutionInput for a single CodeMirror Sequence input area
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * ExecutionInput for a single CodeMirror Sequence input area
  */
 class SequenceTextareaInput extends ExecutionInput
 {
   /**
    * Constructor
    *
    * @param {string} name The name of the sequence
    * @param {CodeMirror} editor The instance of CodeMirror
    */
   constructor(name, editor)
   {
     super();

     // Set the name of the SequenceInput
     this.name = name;

     // Set the editor
     this.editor = editor;
   }

   /**
    * Getter for the value of the input
    *
    * @return {string} The input value
    */
   getValue()
   {
     return this.editor.getValue();
   }
}
