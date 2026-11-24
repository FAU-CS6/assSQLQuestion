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
   * @param {boolean} checkIntegrity If set to true, changes to the database are not allowed in b sequence
   * @param {ExecutionHandler} callback A handler implementing a callback function onResult (for results) and a callback function onError (for errors)
   */
  constructor(sequenceA, sequenceB, sequenceC, checkIntegrity, callback, schemaOnly = false)
  {
    // Set the calling parameters as member variables
    this.sequenceA = sequenceA;
    this.sequenceB = sequenceB;
    this.sequenceC = sequenceC;
    this.checkIntegrity = checkIntegrity;
    this.schemaOnly = schemaOnly;
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

  /** Recreate only the grading schema on a fresh connection for a released answer. */
  static async preparedSchema(sequenceA, signal)
  {
    let run, abort;
    try {
      return await new Promise((resolve, reject) => {
        signal.throwIfAborted();
        abort = () => { run?.dispose(); reject(signal.reason); };
        signal.addEventListener('abort', abort, { once: true });
        run = new SQLRun(sequenceA, '', '', false, { onSchema: resolve, onError: reject }, true);
      });
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
      run?.dispose();
    }
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
        this.fail(event.data.integrityViolation ? new SQLRunErrorIntegrityCheck('')
          : new SQLRunErrorRunningSequence(event.data.error, name));
        return;
      }
      const results = event.data.results || [];
      if (results.length > 0) this.lastResult = new SQLResult(results[results.length - 1]);
      next.call(this);
    };
    try {
      const request = {action: 'exec', sql: sequence};
      if (name === 'B' && this.checkIntegrity) request.readOnly = true;
      this.worker.postMessage(request);
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
      this.worker.onerror = event => {
        event.preventDefault?.();
        this.fail(new SQLRunErrorRunningSequence(event.message, 'A'));
      };
      try { this.worker.postMessage({ action: 'exec', sql }); }
      catch (error) { this.fail(new SQLRunErrorRunningSequence(error.message, 'A')); }
    };
    const finish = () => {
      this.callback.onSchema(schema);
      if (this.schemaOnly) { this.finished = true; this.dispose(); }
      else this.executeSequenceB();
    };
    read("SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND lower(name) NOT GLOB 'sqlite_*' ORDER BY rowid", result => {
      if (!result) { finish(); return; }
      const names = result.values.map(row => ({ name: String(row[0]), type: String(row[1]) }));
      const next = index => {
        if (index >= names.length) { finish(); return; }
        const { name, type } = names[index];
        read('PRAGMA table_info("' + name.replace(/"/g, '""') + '")', info => {
          if (info) schema.tables.push({ name, type, columns: info.values.map(row => ({ name: String(row[1]),
            type: String(row[2]), notnull: Boolean(row[3]), pk: Number(row[5]) })) });
          next(index + 1);
        });
      };
      next(0);
    });
  }

  executeSequenceB()
  {
    this.executeSequence(this.sequenceB, 'B', this.executeSequenceC);
  }

  executeSequenceC()
  {
    this.executeSequence(this.sequenceC, 'C', this.finish);
  }
}
