/**
 * @file A abstract parent class for the different error types that might occur in SQLRun
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * A abstract parent class for the different error types that might occur in SQLRun
  */
class SQLRunErrorAbstract
{
  /**
   * Constructor of a single SQLRunErrorAbstract
   *
   * @param {string} errorMessage The message of the error
   */
  constructor(errorMessage)
  {
    this.errorType = "SQLRunErrorAbstract";
    this.errorMessage = errorMessage;
  }

  /**
   * Get the saved error message
   *
   * @return {string} The error message
   */
  getErrorMessage()
  {
    return this.errorMessage;
  }

  /**
   * Get the type of the error
   *
   * @return {string} The error type (The class the error is of)
   */
  getErrorType()
  {
    return this.errorType;
  }

  /**
   * Get (beautified) output text (Error message in a form suitable for the error)
   *
   * @return {string} The (beautified) output text
   */
  getOutputText()
  {
    return this.errorMessage;
  }

  /**
   * Return the error in the form of json
   *
   * @return {string} The json string
   */
  toJSON()
  {
    return JSON.stringify({"errorType": this.errorType, "errorMessage": this.errorMessage});
  }
}
