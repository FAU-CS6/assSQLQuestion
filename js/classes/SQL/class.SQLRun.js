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

    this.worker = null;
    this.finished = false;
    this.lastResult = null;

    try {
      this.worker = new Worker(window.QPISQL_URL_PATH + '/lib/sql.js/worker.sql.js');
    } catch (error) {
      this.fail(new SQLRunErrorDBCreation(error.message));
      return;
    }
    this.executeSequenceA();
  }

  /** Terminate the worker on every completion path. There is deliberately no timeout. */
  dispose()
  {
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
      this.worker = null;
    }
  }

  fail(error)
  {
    if (this.finished) return;
    this.finished = true;
    this.dispose();
    this.callback.onError(error);
  }

  finish()
  {
    if (this.finished) return;
    if (this.lastResult === null) {
      this.fail(new SQLRunErrorNoVisibleResult(''));
      return;
    }
    this.finished = true;
    this.dispose();
    this.callback.onResult(this.lastResult);
  }

  cancel(message)
  {
    const error = new SQLRunErrorAbstract(message || 'Execution cancelled.');
    error.errorType = 'SQLRunErrorCancelled';
    this.fail(error);
  }

  executeSequence(sequence, name, next)
  {
    if (this.finished) return;
    if (sequence.length === 0) {
      next.call(this);
      return;
    }
    this.worker.onerror = (event) => {
      // The error is handled visibly in the question, not as an uncaught page error.
      if (event.preventDefault) event.preventDefault();
      this.fail(new SQLRunErrorRunningSequence(event.message, name));
    };
    this.worker.onmessage = (event) => {
      if (this.finished) return;
      if (event.data.error) {
        this.fail(new SQLRunErrorRunningSequence(event.data.error, name));
        return;
      }
      const results = event.data.results || [];
      if (results.length > 0) this.lastResult = new SQLResult(results[results.length - 1]);
      next.call(this);
    };
    try {
      this.worker.postMessage({action: 'exec', sql: sequence});
    } catch (error) {
      this.fail(new SQLRunErrorRunningSequence(error.message, name));
    }
  }

  executeSequenceA()
  {
    this.executeSequence(this.sequenceA, 'A', this.captureSchema);
  }

  /** QSS receives the actual prepared SQLite schema, entirely from this worker.
   * Metadata queries never become the user's visible result relation.
   */
  captureSchema()
  {
    if (typeof this.callback.onSchema !== 'function') { this.executeSequenceB(); return; }
    const schema = { tables: [] };
    const read = (sql, callback) => {
      if (this.finished) return;
      this.worker.onmessage = event => {
        if (this.finished) return;
        callback(event.data.error ? null : (event.data.results || [])[0] || null);
      };
      this.worker.postMessage({ action: 'exec', sql });
    };
    const finish = () => { this.callback.onSchema(schema); this.executeSequenceB(); };
    read("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY rowid", result => {
      if (!result) { finish(); return; }
      const names = result.values.map(row => String(row[0]));
      const next = index => {
        if (index >= names.length) { finish(); return; }
        const name = names[index];
        read('PRAGMA table_info("' + name.replace(/"/g, '""') + '")', info => {
          if (info) schema.tables.push({ name, columns: info.values.map(row => ({ name: String(row[1]),
            type: String(row[2]), notnull: Boolean(row[3]), pk: Number(row[5]) })) });
          next(index + 1);
        });
      };
      next(0);
    });
  }

  executeSequenceB()
  {
    if (this.checkIntegrity && !this.checkIntegrityOfSequence(this.sequenceB)) {
      this.fail(new SQLRunErrorIntegrityCheck(''));
      return;
    }
    this.executeSequence(this.sequenceB, 'B', this.executeSequenceC);
  }

  executeSequenceC()
  {
    this.executeSequence(this.sequenceC, 'C', this.finish);
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
