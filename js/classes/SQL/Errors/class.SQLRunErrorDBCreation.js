/**
 * @file A class implementing an error occured at the creation of the database in SQLRun
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * A class implementing an error occured at the creation of the database in SQLRun
  */
class SQLRunErrorDBCreation extends SQLRunErrorAbstract
{
  /**
   * Constructor of a single SQLRunErrorDBCreation
   *
   * @param {string} errorMessage The message of the error
   */
  constructor(errorMessage)
  {
    super(errorMessage);
    this.errorType = "SQLRunErrorDBCreation";
  }

  /**
   * Get (beautified) output text (Error message in a form suitable for the error)
   *
   * @return {string} The (beautified) output text
   */
  getOutputText()
  {
    // Error_db_creation is a custom string describing a SQLRunErrorDBCreation
    return error_db_creation + " " + this.errorMessage;
  }
}
