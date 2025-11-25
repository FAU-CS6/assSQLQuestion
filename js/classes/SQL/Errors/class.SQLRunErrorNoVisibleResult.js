/**
 * @file A class implementing an error for no SELECT or visible result in the sequences of SQLRun
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * A class implementing an error for no SELECT or visible result in the sequences of SQLRun
  */
class SQLRunErrorNoVisibleResult extends SQLRunErrorAbstract
{
  /**
   * Constructor of a single SQLRunErrorDBCreation
   *
   * @param {string} errorMessage The message of the error
   */
  constructor(errorMessage)
  {
    super(errorMessage);
    this.errorType = "SQLRunErrorNoVisibleResult";
  }

  /**
   * Get (beautified) output text (Error message in a form suitable for the error)
   *
   * @return {string} The (beautified) output text
   */
  getOutputText()
  {
    return error_no_visible_result + " " + this.errorMessage;
  }
}
