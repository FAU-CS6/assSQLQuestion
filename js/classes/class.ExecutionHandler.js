/**
 * @file Implements all functions to handle an execution
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

/**
 * Class implementing all functions to handle an execution
 */
class ExecutionHandler
{

  /**
   * Constructor
   */
  constructor()
  {
    // Initialize the ExecutionInput array
    this.inputs = [];

    // Initialize the ExecutionOutput array
    this.outputs = [];
  }

  /**
   * Execution handler
   */

  /**
   * Main handler of the "Execute" button - Starts a execution
   */
  execute()
  {
    // Call the onExecution event handlers
    this.onExecution();

    // Get sequence a
    const sequenceA = this.getSequenceA();

    // Get sequence b
    const sequenceB = this.getSequenceB();

    // Get sequence c
    const sequenceC = this.getSequenceC();

    // Get the state of the integrityCheck checkbox
    const integrityCheck = this.getIntegrityCheck();

    // Execute the SQLRun
    new SQLRun(sequenceA, sequenceB, sequenceC, integrityCheck, this);
  }

  /**
   * Setter for registering the ExecutionInputs and the ExecutionOutputs
   */

   /**
    * Register a ExecutionInput
    *
    * @param {ExecutionInput} input The ExecutionInput to be registered
    */
   registerInput(input)
   {
     this.inputs.push(input);
   }

   /**
    * Register a ExecutionOutput
    *
    * @param {ExecutionOutput} output The ExecutionOutput to be registered
    */
   registerOutput(output)
   {
     this.outputs.push(output);
   }

  /**
   * Getter for the execution inputs
   */

   /**
    * Get the first sql sequence by reading the input areas of the page
    *
    * @return {string} The first sql sequence
    */
   getSequenceA()
   {
     for(var i = 0; i <= this.inputs.length; i++)
     {
       if(this.inputs[i].getName() == "sequence_a")
       {
         return this.inputs[i].getValue();
       }
     }

     throw new Error("There was no sequence A found");
   }

   /**
    * Get the second sql sequence by reading the input areas of the page
    *
    * @return {string} The second sql sequence
    */
   getSequenceB()
   {
     for(var i = 0; i <= this.inputs.length; i++)
     {
       if(this.inputs[i].getName() == "sequence_b")
       {
         return this.inputs[i].getValue();
       }
     }

     throw new Error("There was no sequence B found");
   }

   /**
    * Get the third sql sequence by reading the input areas of the page
    *
    * @return {string} The third sql sequence
    */
   getSequenceC()
   {
     for(var i = 0; i <= this.inputs.length; i++)
     {
       if(this.inputs[i].getName() == "sequence_c")
       {
         return this.inputs[i].getValue();
       }
     }

     throw new Error("There was no sequence C found");
   }

   /**
    * Get the boolean declaring whether the integrity check has to be executed or not
    *
    * @return {boolean} Boolean declaring whether the integrity check has to be executed or not
    */
   getIntegrityCheck()
   {
     for(var i = 0; i <= this.inputs.length; i++)
     {
       if(this.inputs[i].getName() == "integrity_check")
       {
         var value = this.inputs[i].getValue();

         if(value === true || value === false)
         {
           return value;
         }

         if(value == "1" || value == 1)
         {
           return true;
         }

         return false;

       }
     }

     throw new Error("There was no integrity check value found");
   }

   /**
    * Call the event handlers
    */

    /**
     * Call the onChange handlers
     */
    onChange()
    {
      for(var i = 0; i < this.outputs.length; i++)
      {
        this.outputs[i].onChange();
      }
    }

   /**
    * Call the onExecution handlers
    */
   onExecution()
   {
     for(var i = 0; i < this.outputs.length; i++)
     {
       this.outputs[i].onExecution();
     }
   }

   /**
    * Call the onError handlers
    *
    * @param {sqlRunErrorAbstract} error The error object
    */
   onError(error)
   {
     for(var i = 0; i < this.outputs.length; i++)
     {
       this.outputs[i].onError(error);
     }
   }

   /**
    * Call the onResult handlers
    *
    * @param {sqlResult} result The sqlResult
    */
   onResult(result)
   {
     for(var i = 0; i < this.outputs.length; i++)
     {
       this.outputs[i].onResult(result);
     }
   }
}

// Construct a basic EXECUTE HANDLER that can be used at every page
window.EXECUTE_HANDLER = new ExecutionHandler();
