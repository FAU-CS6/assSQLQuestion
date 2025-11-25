/**
 * @file A class representing a single SQL result set
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

/**
 * A single SQL result set
 * Used to be prepared for changes of sql framework - abstracts the results and offers functions on them
 */
class SQLResult
{
  /**
   * Constructor of SQLResult
   * Creates an SQLResult out of the complex result array sql.js returns
   *
   * @param {Array} resultArray The array of a single sql.js result
   */
  constructor(resultArray)
  {
    // Set the columns
    this.columns = resultArray["columns"];

    // Set the values
    this.values = resultArray["values"];
  }

  /**
   * Return the SQLResult in the form of json
   *
   * @return {string} The json string
   */
  toJSON()
  {
    return JSON.stringify({"columns": this.columns,"values": this.values});
  }

  /**
   * Return the SQLResult in the form of a html table
   *
   * @return {string} The HTML code of the table
   */
  toHTMLTable()
  {
    // Begin the table
    var html = "<table class='qpisql-output-table'>";

    // Insert attribute names as header row
    html += "<tr class='qpisql-output-table-header'>";

    for(var i = 0; i < this.columns.length; i++)
    {
      // Insert a new column
      html += "<td>" + this.columns[i] + "</td>";
    }

    html += "</tr>";

    // Insert the single tuples
    for(var i = 0; i < this.values.length; i++)
    {
      html += "<tr class='qpisql-output-table-tuple'>";

      for(var ii = 0; ii < this.values[i].length; ii++)
      {
        html += "<td>" + this.values[i][ii] + "</td>";
      }

      html += "</tr>";
    }

    // End the table
    html += "</table>";

    return html;
  }

  /**
   * Get the number of tuples in the SQLResult
   *
   * @return {number} The number of tuples
   */
  getNumberOfRows()
  {
    return this.values.length;
  }

  /**
   * Get the names of the columns as JSON string
   *
   * @return {string} The names of the columns as JSON string
   */
  getColumnNamesAsJSON()
  {
    return JSON.stringify(this.columns);
  }

  /**
   * Get all minimal functional dependencies in the result as JSON string
   *
   * @return {string} JSON string with all minimal SQLFunctionalDependencies in the result
   */
  getAllMinimalFunctionalDependenciesAsJSON()
  {
    // Get the minimal functional dependencies
    var dependencies = this.getAllMinimalFunctionalDependencies();
    var dependenciesJSON = [];

    // Iterate through the functional dependencies
    for(var i = 0; i < dependencies.length; i++)
    {
      dependenciesJSON.push(dependencies[i].toJSON());
    }

    return JSON.stringify(dependenciesJSON);
  }

  /**
   * Get all minimal functional dependencies in the result
   *
   * Simple addon code for getAllFunctionalDependencies that removes all double functional dependencies
   * and dependencies like ABC->D if A->D or AB->D is also true
   *
   * @return {Array} All minimal SQLFunctionalDependencies in the result
   */
  getAllMinimalFunctionalDependencies()
  {
    // Get all functional dependencies
    var allDependencies = this.getAllFunctionalDependencies();
    var allUniqueDependencies = this.removeDoubleFunctionalDependencies(allDependencies);

    return this.removeNonMinimalFunctionalDependencies(allUniqueDependencies);
  }

  /**
   * Helper function to remove all double SQLFunctionalDependencies in an array
   *
   * @param {Array} startArray An array containing a bunch of SQLFunctionalDependencies
   *
   * @return {Array} The startArray without double SQLFunctionalDependencies
   */
  removeDoubleFunctionalDependencies(startArray)
  {
    // Remove double entries
    var allUniqueDependencies = [];

    for(var i = 0; i < startArray.length; i++)
    {
      // Search for entries like this that are already part of allUniqueDependencies
      var doubleEntries = allUniqueDependencies.filter(function(otherDependency) {
        return startArray[i].equals(otherDependency);
      });

      if(doubleEntries.length < 1)
      {
        allUniqueDependencies.push(startArray[i]);
      }
    }

    return allUniqueDependencies;
  }

  /**
   * Helper function to remove all non minimal SQLFunctionalDependencies in an array
   *
   * @param {Array} startArray An array containing a bunch of SQLFunctionalDependencies
   *
   * @return {Array} The startArray without non minimal SQLFunctionalDependencies
   */
  removeNonMinimalFunctionalDependencies(startArray)
  {
    // Copy the startArray
    var allDependencies = startArray.slice();

    // Remove none minimal entries
    for(var i = 0; i < allDependencies.length; i++)
    {
      // Search for entries that are more minimal
      var moreMinimalEntries = allDependencies.filter(function(otherDependency) {
        return allDependencies[i].isLessMinimalThan(otherDependency);
      });

      // If there are some remove this entry from allUniqueDependencies
      if(moreMinimalEntries.length > 0)
      {
        allDependencies.splice(i, 1);
        i--;
      }
    }

    return allDependencies;
  }

  /**
   * Get all functional dependencies in the result
   *
   * @return {Array} All SQLFunctionalDependencies in the result
   */
  getAllFunctionalDependencies()
  {
    // As recursion is needed for this we pass this to the recursiv helper function
    return this.findFunctionalDependencies([],this.columns.slice());
  }

  /**
   * Recursive helper for getAllFunctionalDependencies()
   *
   * @param {Array} currentDeterminate The attributes that are part of the determinate
   * @param {Array} undecidedAttributes The attributes that might become part of the determinate OR be dependent
   *
   * @return {Array} A array of all SQLFunctionalDependencies found in this branch of the recursion
   */
  findFunctionalDependencies(currentDeterminate, undecidedAttributes)
  {
    // Currently found functional dependencies
    var foundDependencies = [];

    // Iterate through all undecidedAttributes
    for(var i = 0; i < undecidedAttributes.length; i++)
    {
      // Add the i undecidedAttribute to a local copy of newCurrentDeterminate and
      // remove it from alocal copy of the undecidedAttributes
      var newCurrentDeterminate = currentDeterminate.slice();
      newCurrentDeterminate.push(undecidedAttributes[i]);
      var newUndecidedAttributes = undecidedAttributes.slice();
      newUndecidedAttributes.splice(i, 1);

      // Check whether the newCurrentDeterminate is part of a functional dependency with any of the undecidedAttributes
      for(var ii = 0; ii < newUndecidedAttributes.length; ii++)
      {
        if(this.checkFunctionalDependency(newCurrentDeterminate,[newUndecidedAttributes[ii]]))
        {
          // Add this to the found functional dependencies
          foundDependencies.push(new SQLFunctionalDependency(newCurrentDeterminate,[newUndecidedAttributes[ii]]));
        }
      }

      // Start the recursion
      var recursionReturn = this.findFunctionalDependencies(newCurrentDeterminate,newUndecidedAttributes);

      if(recursionReturn.length > 0)
      {
        foundDependencies = foundDependencies.concat(recursionReturn);
      }
    }

    return foundDependencies;
  }

  /**
   * Check whether a specific functional dependency exists in the result
   *
   * @param {Array} determinateAttributes The attributes - to be more specific the names of the columns as string - that are part of the (suspected) determinate
   * @param {Array} dependentAttributes The attributes - to be more specific the names of the columns as string - that are presumably dependent on the determinate
   *
   * @return {boolean} True for the dependency being existent in the result - false for it being not exsistent
   */
   checkFunctionalDependency(determinateAttributes, dependentAttributes)
   {
     // If at least one of the two attributes lists is empty it is no valid functional dependency
     if(determinateAttributes.length < 1 || dependentAttributes.length < 1)
     {
       return false;
     }

     // After that check we have to transform the column names to indices
     var determinatePositions = null;
     var dependentPositions = null;

     try
     {
       determinatePositions = this.transformColumnNamesToPositions(determinateAttributes);
       dependentPositions = this.transformColumnNamesToPositions(dependentAttributes);
     }
     catch(err)
     {
       console.warn("You tried to check a functional dependency with non exsistent column names");

       // A functional dependency with non valid column names of course does not exist
       return false;
     }

     // We sort the positions array to ensure the same ordering all the time
     determinatePositions.sort();
     dependentPositions.sort();

     // Initialize two empty arrays - one for the values of the determinateAttributes
     // and one for the values of the dependentAttributes
     var determinateValuesJSON = [];
     var dependentValuesJSON = [];

     // Now we iterate through the whole value array
     for(var i = 0; i < this.values.length; i++)
     {
       // Read the values
       var determinateValue = new Array(determinatePositions.length);
       var dependentValue = new Array(dependentPositions.length);

       for(var ii = 0; ii < determinatePositions.length; ii++)
       {
         determinateValue[ii] = this.values[i][determinatePositions[ii]];
       }

       for(var ii = 0; ii < dependentPositions.length; ii++)
       {
         dependentValue[ii] = this.values[i][dependentPositions[ii]];
       }

       // Transform the values into a JSON string
       var determinateValueJSON = JSON.stringify(determinateValue);
       var dependentValueJSON = JSON.stringify(dependentValue);

       // Check whether there is already a identical determinateValue in the determinateValuesJSON array
       var positionInArray = determinateValuesJSON.indexOf(determinateValueJSON);

       // If the value already exsists check whether the dependent value is the same like in this case
       if(positionInArray != -1)
       {
         if(determinateValueJSON == determinateValuesJSON[positionInArray] &&
            dependentValueJSON == dependentValuesJSON[positionInArray])
          {
            // Do nothing ... this is fine
          }
          else
          {
            // If the same determinateValue has two different dependentValues linked to it the
            // functional dependency is not valid
            return false;
          }
       }
       else
       {
         // Add the combination of determinateValue and dependentValue to the JSON array
         determinateValuesJSON.push(determinateValueJSON);
         dependentValuesJSON.push(dependentValueJSON);
       }
     }

     // If none of the values leads to a contradiction in the values arrays the functional dependency is valid
     return true;
   }

   /**
    * Transform an array of column names into column positions
    *
    * @param {Array} columnNames An array containing column names
    *
    * @return {Array} An array containing the positions of the column names
    */
   transformColumnNamesToPositions(columnNames)
   {
     var columnPositions = new Array(columnNames.length);

     for (var i = 0; i < columnNames.length; i++)
     {
       var index = this.columns.indexOf(columnNames[i]);

       if(index == -1)
       {
         throw new Error("You tried to compute the position of a non exsistent column name");
       }
       // else
       columnPositions[i] = index;
     }

     return columnPositions;
   }

}
