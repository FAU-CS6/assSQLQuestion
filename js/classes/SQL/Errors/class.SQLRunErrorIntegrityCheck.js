/**
 * @file A class implementing an error at the integrity check of SQLRun
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * A class implementing an error at the integrity check of SQLRun
  */
class SQLRunErrorIntegrityCheck extends SQLRunErrorAbstract
{
  /**
   * Constructor of a single SQLRunErrorDBCreation
   *
   * @param {string} errorMessage The message of the error
   */
  constructor(errorMessage)
  {
    super(errorMessage);
    this.errorType = "SQLRunErrorIntegrityCheck";
  }

  /**
   * Get (beautified) output text (Error message in a form suitable for the error)
   *
   * @return {string} The (beautified) output text
   */
  getOutputText()
  {
    return error_integrity_check + " " + this.errorMessage;
  }
}
