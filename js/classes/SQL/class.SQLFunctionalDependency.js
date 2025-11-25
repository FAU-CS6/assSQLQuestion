/**
 * @file A class wrapping simple functional dependencies
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

 /**
  * A class wrapping simple functional dependencies
  */
class SQLFunctionalDependency
{
  /**
   * Constructor of a single SQLFunctionalDependency
   *
   * @param {Array} determinateAttributes The attributes - to be more specific the names of the columns as string - that are part of the determinate
   * @param {Array} dependentAttributes The attributes - to be more specific the names of the columns as string - that are dependent on the determinate
   */
  constructor(determinateAttributes, dependentAttributes)
  {
    this.determinateAttributes = determinateAttributes;
    this.dependentAttributes = dependentAttributes;
  }

  /**
   * Return the SQLFunctionalDependency in the form of json
   *
   * @return {string} The json string
   */
  toJSON()
  {
    return JSON.stringify({"determinateAttributes": this.determinateAttributes,"dependentAttributes": this.dependentAttributes});
  }

  /**
   * Get the determinateAttributes of the functional dependency
   *
   * @return {Array} The determinate attributes
   */
  getDeterminateAttributes()
  {
    return this.determinateAttributes;
  }

  /**
   * Get the dependentAttributes of the functional dependency
   *
   * @return {Array} The dependent attributes
   */
  getDependentAttributes()
  {
    return this.dependentAttributes;
  }

  /**
   * Check whether this SQLFunctionalDependency is equal to a second one
   *
   * @param {SQLFunctionalDependency} otherDependency The other functional dependency
   *
   * @return {boolean} True if both functionalDependencies are equal - otherwise false
   */
  equals(otherDependency)
  {
    // If the otherDependency is no SQLFunctionalDependency the both objects are not equal
    if(!(otherDependency instanceof SQLFunctionalDependency))
    {
      return false;
    }

    // Compare the length of the determinateAttributes and the dependentAttributes
    if(this.getDeterminateAttributes().length != otherDependency.getDeterminateAttributes().length ||
       this.getDependentAttributes().length != otherDependency.getDependentAttributes().length)
    {
      return false;
    }

    // Copy the attributes
    var ownDeterminateAttributes = this.getDeterminateAttributes().slice();
    var ownDependentAttributes = this.getDependentAttributes().slice();
    var otherDeterminateAttributes = otherDependency.getDeterminateAttributes().slice();
    var otherDependentAttributes = otherDependency.getDependentAttributes().slice();

    // Sort them
    ownDeterminateAttributes.sort();
    ownDependentAttributes.sort();
    otherDeterminateAttributes.sort();
    otherDependentAttributes.sort();

    // Compare the determinateAttributes
    for(var i = 0; i < ownDeterminateAttributes.length; i++)
    {
      if(ownDeterminateAttributes[i] != otherDeterminateAttributes[i])
      {
        return false;
      }
    }


    // Compare the dependentAttributes
    for(var i = 0; i < ownDependentAttributes.length; i++)
    {
      if(ownDependentAttributes[i] != otherDependentAttributes[i])
      {
        return false;
      }
    }

    // Both objects are equal if all is the same until now
    return true;
  }

  /**
   * Check whether an other SQLFunctionalDependency is more minimal than this one
   * (e.g. this is AB->C and the other is A->C this will be true)
   *
   * If this is AB->C and the other is A->D this will not be true.
   *
   * @param {SQLFunctionalDependency} otherDependency The other functional dependency
   *
   * @return {boolean} See description text for examples
   */
  isLessMinimalThan(otherDependency)
  {
    // If the otherDependency is no SQLFunctionalDependency the both objects are not equal
    if(!(otherDependency instanceof SQLFunctionalDependency))
    {
      return false;
    }

    // Compare the length of the determinateAttributes and the dependentAttributes
    // In this case an other dependency can only be more minimal if the length of the determinate attributes is
    // shorter than of this one and the dependent attributes length is the same
    if(this.getDeterminateAttributes().length <= otherDependency.getDeterminateAttributes().length ||
       this.getDependentAttributes().length != otherDependency.getDependentAttributes().length)
    {
      return false;
    }

    // Copy the attributes
    var ownDeterminateAttributes = this.getDeterminateAttributes().slice();
    var ownDependentAttributes = this.getDependentAttributes().slice();
    var otherDeterminateAttributes = otherDependency.getDeterminateAttributes().slice();
    var otherDependentAttributes = otherDependency.getDependentAttributes().slice();

    // Sort them
    ownDeterminateAttributes.sort();
    ownDependentAttributes.sort();
    otherDeterminateAttributes.sort();
    otherDependentAttributes.sort();

    // The dependent attributes have to be the same
    for(var i = 0; i < ownDependentAttributes.length; i++)
    {
      if(ownDependentAttributes[i] != otherDependentAttributes[i])
      {
        return false;
      }
    }

    // All attributes of the other dependency have to be part of this one
    // Compare the dependentAttributes
    for(var i = 0; i < otherDependentAttributes.length; i++)
    {
      if(ownDependentAttributes.indexOf(otherDependentAttributes[i]) == -1)
      {
        return false;
      }
    }

    return true;
  }
}
