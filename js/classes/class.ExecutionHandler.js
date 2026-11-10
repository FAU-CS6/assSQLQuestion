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
    // ILIAS may replace an editable question through AJAX while a worker runs.
    // Dispose the previous question before its callbacks can touch the new DOM.
    if (window.EXECUTE_HANDLER && typeof window.EXECUTE_HANDLER.dispose === 'function') window.EXECUTE_HANDLER.dispose();
    // Initialize the ExecutionInput array
    this.inputs = [];

    // Initialize the ExecutionOutput array
    this.outputs = [];
    this.activeRun = null;
    this.running = false;
    this.qss = null;
    this.runToken = 0;
    this.navigationControls = [];
    this.initializeQSS();
  }

  /**
   * Execution handler
   */

  /**
   * Main handler of the "Execute" button - Starts a execution
   */
  execute()
  {
    if (this.running) return;
    this.initializeQSS();
    this.running = true;
    this.sqlOutcome = null;
    const token = ++this.runToken;
    this.onExecution();
    try {
      this.snapshot = { schemaSql: this.getSequenceA(), answer: this.getSequenceB(),
        reference: this.qss && this.qss.config.referenceSql !== null ? this.qss.config.referenceSql : this.getSequenceB(),
        maxPoints: this.qss ? this.qss.config.maxPoints : 0 };
      if (this.qss && this.qss.config.context === 'author') {
        const fields = Array.from(document.querySelectorAll('[name^="points_"]'));
        if (fields.length) this.snapshot.maxPoints = fields.reduce((sum, field) => sum + (Number(field.value) || 0), 0);
      }
      const callback = { onResult: result => this.sqlFinished(token, null, result),
        onError: error => this.sqlFinished(token, error, null) };
      if (this.qss) callback.onSchema = schema => { if (token === this.runToken) this.snapshot.schema = schema; };
      this.phase = 'sql';
      const run = new SQLRun(this.snapshot.schemaSql, this.snapshot.answer, this.getSequenceC(), this.getIntegrityCheck(), callback);
      // Empty sequences or validation errors can finish synchronously in the constructor.
      this.activeRun = this.running && this.phase === 'sql' ? run : null;
    } catch (error) {
      this.onError(new SQLRunErrorAbstract(error.message));
    }
  }

  cancel()
  {
    if (!this.running) return;
    const button = document.getElementById('qpisql-cancel-button');
    const message = button ? button.dataset.cancelled : 'Execution cancelled.';
    if (this.activeRun) {
      if (this.qss) this.qss.cancel();
      this.activeRun.cancel(message);
      return;
    }
    ++this.runToken;
    if (this.qss) this.qss.cancel();
    if (this.sqlOutcome && this.sqlOutcome.result) {
      this.onResult(this.sqlOutcome.result);
      return;
    }
    const error = new SQLRunErrorAbstract(message);
    error.errorType = 'SQLRunErrorCancelled';
    this.onError(error);
  }

  initializeQSS()
  {
    if (typeof QSSShadow === 'undefined') return;
    const config = QSSShadow.configuration();
    if (!config) return;
    if (!this.qss) this.qss = new QSSShadow(config);
    if (!document.getElementById('qpisql-output-area') || this.qss.card) return;
    this.qss.mount();
    const stored = document.getElementById('qpisql-qss-evaluation');
    if (stored && stored.value) {
      try {
        const result = JSON.parse(stored.value);
        if (result.referenceRevision === config.referenceRevision && QSSShadow.isCurrentModel(result, config)) {
          const answer = document.querySelector('[name="sequence_b"]')?.value || '';
          const token = this.runToken;
          this.qss.message(this.qss.label('notEvaluated'), false);
          QSSShadow.digest(answer).then(digest => {
            if (token !== this.runToken || this.running) return;
            if (!this.isCurrent()) { this.dispose(); return; }
            if (digest && digest === result.answerDigest) {
              this.qss.result = result;
              this.qss.render(result);
            } else {
              this.qss.clear();
              this.qss.message(this.qss.label('stale'), false);
            }
          });
          return;
        }
        this.qss.clear();
        this.qss.message(this.qss.label('stale'), false);
        return;
      } catch (error) { /* An older or invalid sidecar is simply recalculated. */ }
    }
    this.qss.clear();
  }

  sqlFinished(token, error, result)
  {
    if (token !== this.runToken || !this.running) return;
    if (!this.isCurrent()) { this.dispose(); return; }
    this.activeRun = null;
    this.sqlOutcome = { error, result };
    if (!this.qss || (error && error.errorType === 'SQLRunErrorCancelled')) {
      if (error) this.onError(error); else this.onResult(result);
      return;
    }
    this.phase = 'qss';
    // Keep the established grade available to native deadline submission and
    // autosave. Only visible output and manual navigation wait for shadow QSS.
    for (const output of this.outputs) {
      if (result && output.onSQLResult) output.onSQLResult(result);
      else if (error && output.onSQLError) output.onSQLError(error);
    }
    this.snapshot.answerExecutionValid = !error;
    this.snapshot.answerRows = result ? result.getNumberOfRows() : null;
    this.snapshot.referenceExecutionValid = this.qss.config.context === 'author' ? !error
      : this.qss.config.referenceExecutionValid === true;
    // The visible result table waits for a terminal shadow assessment state.
    this.qss.evaluate(this.snapshot).then(() => {
      if (token !== this.runToken || !this.running) return;
      if (!this.isCurrent()) { this.dispose(); return; }
      if (error) this.onError(error); else this.onResult(result);
    }).catch(failure => {
      if (token !== this.runToken || !this.running) return;
      if (!this.isCurrent()) { this.dispose(); return; }
      this.qss.render({ status: 'error', limitations: [String(failure.message)] });
      if (error) this.onError(error); else this.onResult(result);
    });
  }

  setNavigationBusy(busy)
  {
    if (busy) {
      const form = document.querySelector('#qpisql-executed-bool')?.form;
      const candidates = new Set(document.querySelectorAll('.ilTstNavigationBtn_Next button, .ilTstNavigationBtn_Prev button, .ilTstNavigationBtn_FinishTest button'));
      if (form) for (const element of form.querySelectorAll('button[type="submit"], input[type="submit"]')) candidates.add(element);
      this.navigationControls = [];
      for (const element of candidates) {
        if (element.id === 'qpisql-cancel-button' || element.id === 'qpisql-execute-button') continue;
        this.navigationControls.push([element, element.disabled]);
        element.disabled = true;
      }
      if (!this.submitGuard && form) {
        this.submitGuard = event => {
          // Native time-limit submission uses form.submit(), which deliberately
          // bypasses this user-submit guard. Never extend the ILIAS deadline.
          if (this.running && event.submitter) {
            event.preventDefault();
            if (this.qss) this.qss.card?.scrollIntoView({ block: 'nearest' });
          }
        };
        form.addEventListener('submit', this.submitGuard);
        this.guardForm = form;
      }
    } else {
      for (const [element, disabled] of this.navigationControls) element.disabled = disabled;
      this.navigationControls = [];
    }
  }

  isCurrent()
  {
    return !this.qss || this.qss.isCurrent();
  }

  dispose()
  {
    ++this.runToken;
    this.running = false;
    if (this.activeRun) this.activeRun.dispose();
    this.activeRun = null;
    if (this.qss) {
      this.qss.abortSilently();
      if (this.qss.card) this.qss.card.remove();
    }
    this.setNavigationBusy(false);
    if (this.guardForm && this.submitGuard) this.guardForm.removeEventListener('submit', this.submitGuard);
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
     this.initializeQSS();
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
     for(var i = 0; i < this.inputs.length; i++)
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
     for(var i = 0; i < this.inputs.length; i++)
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
     for(var i = 0; i < this.inputs.length; i++)
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
     for(var i = 0; i < this.inputs.length; i++)
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
      if (this.running) this.cancel();
      ++this.runToken;
      if (this.qss) this.qss.clear();
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
     if (this.qss) {
       this.qss.clear();
       this.qss.progress({ phase: 'sqlRunning' });
       this.setNavigationBusy(true);
     }
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
     this.running = false;
     this.activeRun = null;
     this.phase = null;
     this.setNavigationBusy(false);
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
     this.running = false;
     this.activeRun = null;
     this.phase = null;
     this.setNavigationBusy(false);
     for(var i = 0; i < this.outputs.length; i++)
     {
       this.outputs[i].onResult(result);
     }
   }
}
