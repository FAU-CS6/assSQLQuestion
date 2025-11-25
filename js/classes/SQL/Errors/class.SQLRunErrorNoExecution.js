/**
 * @file A class implementing an error occured at the creation of the database in SQLRun
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * A class implementing an error due to no execution being started
  */
class SQLRunErrorNoExecution extends SQLRunErrorAbstract
{
  /**
   * Constructor of a single SQLRunErrorDBCreation
   */
  constructor()
  {
    super("");
    this.errorType = "SQLRunErrorNoExecution";
  }

  /**
   * Get (beautified) output text (Error message in a form suitable for the error)
   *
   * @return {string} The (beautified) output text
   */
  getOutputText()
  {
    return error_no_execution + " " + this.errorMessage;
  }
}
