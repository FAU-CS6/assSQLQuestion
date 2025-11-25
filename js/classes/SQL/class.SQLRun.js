/**
 * @file A class representing a single sql run through
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.2
 */

/**
 * A single database run through (based on sql.js)
 */
class SQLRun
{
  /**
   * Constructor of sqlRun
   * A run through consists of three sql sequences (A, B, C) that are executed successively
   *
   * @param {string} sequenceA The first sql sequence
   * @param {string} sequenceB The second sql sequence
   * @param {string} sequenceC The third sql sequence
   * @param {boolean} checkIntegrity If set to true, changes to the database are not allowed in b sequence - This is checked by hashing the database after a and before c and comparing their hash values
   * @param {ExecutionHandler} callback A handler implementing a callback function onResult (for results) and a callback function onError (for errors)
   */
  constructor(sequenceA, sequenceB, sequenceC, checkIntegrity, callback)
  {
    // Set the calling parameters as member variables
    this.sequenceA = sequenceA;
    this.sequenceB = sequenceB;
    this.sequenceC = sequenceC;
    this.checkIntegrity = checkIntegrity;
    this.callback = callback;

    // Initialize a worker as we do not want the SQL to block our page
    this.worker = new Worker(window.QPISQL_URL_PATH + '/lib/sql.js/worker.sql.js');

    // Initalize a member variable for the lastResult
    // This will be set to the result of the last SELECT query in the sequence
    this.lastResult = null;

    // Call the executeSequenceA
    this.executeSequenceA();
  }

  /**
   * Executes SequenceA and calls executeSequenceB() if no errors have been found.
   * Otherwise it calls the onError callback function.
   */
  executeSequenceA()
  {
    // We have to save this object to a const as we need it in the callbacks
    const thisrun = this;

    // Callback in case there is an error
    this.worker.onerror = function(e, run = thisrun)
    {
      run.callback.onError(new SQLRunErrorRunningSequence(e.message, "A"));
    }

    // Callback in case there was no error
    this.worker.onmessage = function(e, run = thisrun)
    {
      if(e.data.results.length > 0)
      {
        run.lastResult = new SQLResult(e.data.results.pop());
      }

      // Go to the nextSequence
      run.executeSequenceB();
    }

    if(this.sequenceA.length > 0)
    {
      this.worker.postMessage({action:'exec', sql: this.sequenceA});
    }
    else
    {
      // Go to the nextSequence
      this.executeSequenceB();
    }

  }

  /**
   * Executes SequenceB and calls executeSequenceC() if no errors have been found.
   * Otherwise it calls the onError callback function.
   */
  executeSequenceB()
  {
    // If integrity check is active we have to start this integrityCheck
    if(this.checkIntegrity)
    {
      // If sequenceB fails the integrityCheck we have to throw an error
      if(!this.checkIntegrityOfSequence(this.sequenceB))
      {
        this.callback.onError(new SQLRunErrorIntegrityCheck(""));
        return;
      }
    }

    // We have to save this object to a const as we need it in the callbacks
    const thisrun = this;

    // Callback in case there is an error
    this.worker.onerror = function(e, run = thisrun)
    {
      run.callback.onError(new SQLRunErrorRunningSequence(e.message, "B"));
    }

    // Callback in case there was no error
    this.worker.onmessage = function(e, run = thisrun)
    {
      if(e.data.results.length > 0)
      {
        run.lastResult = new SQLResult(e.data.results.pop());
      }

      // Go to the nextSequence
      run.executeSequenceC();
    }

    if(this.sequenceB.length > 0)
    {
      this.worker.postMessage({action:'exec', sql: this.sequenceB});
    }
    else
    {
      // Go to the nextSequence
      this.executeSequenceC();
    }
  }

  /**
   * Executes SequenceC and calls the onResult callback function if no errors have been found.
   * Otherwise it calls the onError callback function.
   */
  executeSequenceC()
  {
    // We have to save this object to a const as we need it in the callbacks
    const thisrun = this;

    // Callback in case there is an error
    this.worker.onerror = function(e, run = thisrun)
    {
      run.callback.onError(new SQLRunErrorRunningSequence(e.message, "C"));
    }

    // Callback in case there was no error
    this.worker.onmessage = function(e, run = thisrun)
    {
      if(e.data.results.length > 0)
      {
        run.lastResult = new SQLResult(e.data.results.pop());
      }

      // Check if there is a last result
      if(run.lastResult == null)
      {
        run.callback.onError(new SQLRunErrorNoVisibleResult(""));
      }
      // If there is one call callbackResult
      else
      {
        run.callback.onResult(run.lastResult);
      }
    }

    if(this.sequenceC.length > 0)
    {
      this.worker.postMessage({action:'exec', sql: this.sequenceC});
    }
    else
    {
      if(this.lastResult == null)
      {
        this.callback.onError(new SQLRunErrorNoVisibleResult(""));
      }
      // If there is one call callbackResult
      else
      {
        this.callback.onResult(this.lastResult);
      }
    }
  }

  /**
   * Checks the integrity of a sequence by searching for patterns
   * that would modify the database.
   *
   * @param {string} sequence The sql sequence to test
   * @return {boolean} Whether the sequence passes the integrity test (true) or not (false)
   */
  checkIntegrityOfSequence(sequence)
  {
    // Check whether there is a CREATE TABLE statement
    var createTablePattern = /create\s+table/i;

    if(createTablePattern.test(sequence))
    {
      return false;
    }

    // Check whether there is a ALTER TABLE statement
    var alterTablePattern = /alter\s+table/i;

    if(alterTablePattern.test(sequence))
    {
      return false;
    }

    // Check whether there is a DROP TABLE statement
    var dropTablePattern = /drop\s+table/i;

    if(dropTablePattern.test(sequence))
    {
      return false;
    }

    // Check whether there is a INSERT INTO statement
    var insertIntoPattern = /insert\s+into/i;

    if(insertIntoPattern.test(sequence))
    {
      return false;
    }

    // Check whether there is a UPDATE statement
    var updatePattern = /update/i;

    if(updatePattern.test(sequence))
    {
      return false;
    }

    // Check whether there is a DELETE FROM statement
    var deleteFromPattern = /delete\s+from/i;

    if(deleteFromPattern.test(sequence))
    {
      return false;
    }
    
    // No pattern matched, so the sequence is full of integrity
    return true;
  }

}
