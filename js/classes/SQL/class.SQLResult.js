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
  static escapeHTML(value)
  {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  toHTMLTable(page = 0, pageSize = 100)
  {
    // Retained for integrations using the original string API. Every SQL value is escaped.
    let html = '<table class="qpisql-output-table"><thead><tr>';
    this.columns.forEach(column => { html += '<th scope="col">' + SQLResult.escapeHTML(column) + '</th>'; });
    html += '</tr></thead><tbody>';
    this.values.slice(page * pageSize, (page + 1) * pageSize).forEach(row => {
      html += '<tr>';
      row.forEach(value => { html += '<td>' + SQLResult.escapeHTML(value === null ? 'NULL' : value === '' ? "''" : value) + '</td>'; });
      html += '</tr>';
    });
    return html + '</tbody></table>';
  }

  /** Display a page of rows. Paging never truncates the result used for grading or storage. */
  renderInto(container, labels = {})
  {
    const pageSize = 100;
    let page = 0;
    const text = (key, fallback) => labels[key] || fallback;
    const draw = () => {
      container.textContent = '';
      const first = page * pageSize;
      const last = Math.min(first + pageSize, this.values.length);
      const summary = document.createElement('div');
      summary.className = 'qpisql-result-summary';
      summary.setAttribute('role', 'status');
      summary.textContent = text('rows', 'Rows %from%–%to% of %total%')
        .replace('%from%', this.values.length ? first + 1 : 0).replace('%to%', last).replace('%total%', this.values.length);
      container.appendChild(summary);
      const scroll = document.createElement('div');
      scroll.className = 'qpisql-result-scroll';
      scroll.tabIndex = 0;
      scroll.setAttribute('role', 'region');
      scroll.setAttribute('aria-label', text('result', 'SQL result'));
      const table = document.createElement('table');
      table.className = 'qpisql-output-table';
      const head = table.createTHead().insertRow();
      this.columns.forEach(column => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = String(column);
        head.appendChild(th);
      });
      const body = table.createTBody();
      this.values.slice(first, last).forEach(values => {
        const row = body.insertRow();
        values.forEach(value => {
          const cell = row.insertCell();
          cell.textContent = value === null ? 'NULL' : value === '' ? "''" : String(value);
          if (value === null || value === '') {
            cell.className = 'qpisql-special-value';
            cell.title = value === null ? text('null', 'SQL NULL') : text('empty', 'Empty string');
          }
        });
      });
      if (this.values.length === 0) {
        const empty = body.insertRow().insertCell();
        empty.colSpan = Math.max(this.columns.length, 1);
        empty.textContent = text('noRows', 'The result contains no rows.');
      }
      scroll.appendChild(table);
      container.appendChild(scroll);
      if (this.values.length > pageSize) {
        const navigation = document.createElement('div');
        navigation.className = 'qpisql-result-pages';
        const previous = document.createElement('button');
        previous.type = 'button';
        previous.className = 'btn btn-default btn-sm';
        previous.textContent = text('previous', 'Previous');
        previous.disabled = page === 0;
        const next = document.createElement('button');
        next.type = 'button';
        next.className = 'btn btn-default btn-sm';
        next.textContent = text('next', 'Next');
        next.disabled = last >= this.values.length;
        previous.addEventListener('click', () => { page--; draw(); container.querySelector('button').focus(); });
        next.addEventListener('click', () => { page++; draw(); container.querySelectorAll('button')[1].focus(); });
        navigation.appendChild(previous);
        navigation.appendChild(next);
        container.appendChild(navigation);
      }
    };
    draw();
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
    // A determinant is a set of column positions. Enumerating every permutation
    // first creates factorially many duplicate objects (even for four rows).
    // Increasing positions visit each set once, in the same first-seen order as
    // the old enumeration. Keep the existing equality and minimization rules.
    const allDependencies = [];
    const visit = (selected, start) => {
      for(let i = start; i < this.columns.length; i++)
      {
        const positions = selected.concat(i);
        const determinate = positions.map(position => this.columns[position]);
        for(let j = 0; j < this.columns.length; j++)
        {
          if(!positions.includes(j) && this.checkFunctionalDependency(determinate, [this.columns[j]]))
          {
            allDependencies.push(new SQLFunctionalDependency(determinate, [this.columns[j]]));
          }
        }
        visit(positions, i + 1);
      }
    };
    visit([], 0);
    const allUniqueDependencies = this.removeDoubleFunctionalDependencies(allDependencies);

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
    // A fresh cache belongs to this calculation only. Mutable result rows must
    // be rechecked on the next call. Enumeration and output order stay intact.
    return this.findFunctionalDependencies([],this.columns.slice(),new Map());
  }

  /**
   * Recursive helper for getAllFunctionalDependencies()
   *
   * @param {Array} currentDeterminate The attributes that are part of the determinate
   * @param {Array} undecidedAttributes The attributes that might become part of the determinate OR be dependent
   * @param {Map|null} checks Local memo of equivalent determinant permutations
   *
   * @return {Array} A array of all SQLFunctionalDependencies found in this branch of the recursion
   */
  findFunctionalDependencies(currentDeterminate, undecidedAttributes, checks = null)
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
        // checkFunctionalDependency sorts column positions, so permutations of
        // the same names have identical results. Cache only that boolean; keep
        // constructing every original FD with its original attribute ordering.
        const key = checks ? JSON.stringify([newCurrentDeterminate.slice().sort(), [newUndecidedAttributes[ii]]]) : null;
        let exists;
        if(checks && checks.has(key))
        {
          exists = checks.get(key);
        }
        else
        {
          exists = this.checkFunctionalDependency(newCurrentDeterminate,[newUndecidedAttributes[ii]]);
          if(checks) checks.set(key, exists);
        }
        if(exists)
        {
          // Add this to the found functional dependencies
          foundDependencies.push(new SQLFunctionalDependency(newCurrentDeterminate,[newUndecidedAttributes[ii]]));
        }
      }

      // Start the recursion
      var recursionReturn = this.findFunctionalDependencies(newCurrentDeterminate,newUndecidedAttributes,checks);

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

     // Preserve the existing JSON equality and first-seen row order, but look up
     // each determinant in constant time instead of scanning all previous rows.
     const valuesByDeterminate = new Map();

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

       if(valuesByDeterminate.has(determinateValueJSON))
       {
         if(valuesByDeterminate.get(determinateValueJSON) !== dependentValueJSON)
         {
           return false;
         }
       }
       else
       {
         valuesByDeterminate.set(determinateValueJSON, dependentValueJSON);
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
