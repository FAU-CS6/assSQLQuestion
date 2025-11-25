/**
 * @file A class implementing an error occured executing a sequence in SQLRun
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * A class implementing an error occured executing a sequence in SQLRun
  */
class SQLRunErrorRunningSequence extends SQLRunErrorAbstract
{
  /**
   * Constructor of a single SQLRunErrorDBCreation
   *
   * @param {string} errorMessage The message of the error
   * @param {string} sequence The name of the sequence the error occured in
   */
  constructor(errorMessage, sequence)
  {
    super(errorMessage);
    this.errorType = "SQLRunErrorRunningSequence";
    this.sequence = sequence;
  }

  /**
   * Get the name of the sequence the error occured in
   *
   * @return {string} The name of the sequence the error occured in
   */
  getSequenceName()
  {
    return this.sequence;
  }

  /**
   * Get (beautified) output text (Error message in a form suitable for the error)
   *
   * @return {string} The (beautified) output text
   */
  getOutputText()
  {
    return "(" + this.sequence + ") " + error_running_sequence + " <i>" + this.errorMessage + "</i>";
  }

  /**
   * Return the error in the form of json
   *
   * @return {string} The json string
   */
  toJSON()
  {
    return JSON.stringify({"errorType": this.errorType, "errorMessage": this.errorMessage, "sequence": this.sequence});
  }
}
