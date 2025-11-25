/**
 * @file Test specification for SQL/class.SQLResult.js
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

describe("A SQLResult", function() {
  it("can be converted to a valid JSON string", function() {
    // Create a valid SQLResult
    var sqlResult = new SQLResult({columns: ["A", "B", "C", "D"],
                                   values: [["1", "2", "3", "4"],
                                            ["2", "3", "4", "5"],
                                            ["3", "4", "5", "6"]]});

    // Create the expected JSON string
    var expectedJSON = "{\"columns\":[\"A\",\"B\",\"C\",\"D\"],\"values\":[[\"1\",\"2\",\"3\",\"4\"],[\"2\",\"3\",\"4\",\"5\"],[\"3\",\"4\",\"5\",\"6\"]]}";

    // Do the test
    expect(sqlResult.toJSON()).toBe(expectedJSON);
  });

  it("is able to get all minimal functional dependencies", function() {
    // Create a valid SQLResult
    var sqlResult = new SQLResult({columns: ["A", "B", "C", "D"],
                                   values: [["1", "2", "3", "1"],
                                            ["2", "2", "3", "5"],
                                            ["3", "2", "5", "5"]]});

    expect(sqlResult.getAllMinimalFunctionalDependencies().length).toBe(6);
  });

  it("is able to remove double functional dependencies", function() {
    var sqlResult = new SQLResult({columns: ["A", "B", "C", "D"],
                                   values: [["1", "2", "3", "1"],
                                            ["2", "2", "3", "5"],
                                            ["3", "2", "5", "5"]]});

    // Create some valid SQLFunctionalDependencies
    var sqlFD1 = new SQLFunctionalDependency(["A", "B"], ["D"]);
    var sqlFD2 = new SQLFunctionalDependency(["B", "A"], ["D"]);
    var sqlFD3 = new SQLFunctionalDependency(["A", "B"], ["C"]);
    var sqlFD4 = new SQLFunctionalDependency(["A", "D"], ["D"]);
    var sqlFD5 = new SQLFunctionalDependency(["A", "B"], ["D", "E"]);
    var sqlFD6 = new SQLFunctionalDependency(["A", "B"], ["E", "D"]);
    var sqlFD7 = new SQLFunctionalDependency(["A", "B"], ["E", "F"]);
    var sqlFDs = [sqlFD1,sqlFD2,sqlFD3,sqlFD4,sqlFD5,sqlFD6,sqlFD7];

    expect(sqlResult.removeDoubleFunctionalDependencies(sqlFDs).length).toBe(5);
  });

  it("is able to remove non minimal dependencies", function() {
    var sqlResult = new SQLResult({columns: ["A", "B", "C", "D"],
                                   values: [["1", "2", "3", "1"],
                                            ["2", "2", "3", "5"],
                                            ["3", "2", "5", "5"]]});

    // Create some valid SQLFunctionalDependencies
    var sqlFD1 = new SQLFunctionalDependency(["A"], ["D"]);
    var sqlFD2 = new SQLFunctionalDependency(["B", "A"], ["D"]);
    var sqlFD3 = new SQLFunctionalDependency(["A", "B"], ["C"]);
    var sqlFD4 = new SQLFunctionalDependency(["A", "D"], ["D"]);
    var sqlFD5 = new SQLFunctionalDependency(["A", "B"], ["D", "E"]);
    var sqlFD6 = new SQLFunctionalDependency(["A", "B", "C"], ["E", "D"]);
    var sqlFDs = [sqlFD1,sqlFD2,sqlFD3,sqlFD4,sqlFD5,sqlFD6];

    expect(sqlResult.removeNonMinimalFunctionalDependencies(sqlFDs).length).toBe(3);
  });

  it("is able to get all functional dependencies", function() {
    // Create a valid SQLResult
    var sqlResult = new SQLResult({columns: ["A", "B", "C", "D"],
                                   values: [["1", "2", "3", "1"],
                                            ["2", "2", "3", "5"],
                                            ["3", "2", "5", "5"]]});

    expect(sqlResult.getAllFunctionalDependencies().length).toBe(45);
  });

  it("is able to get find functional dependencies", function() {
    // Create a valid SQLResult
    var sqlResult = new SQLResult({columns: ["A", "B", "C", "D"],
                                   values: [["1", "2", "3", "1"],
                                            ["2", "2", "3", "5"],
                                            ["3", "2", "5", "5"]]});

    expect(sqlResult.findFunctionalDependencies([],["A","B","C","D"]).length).toBe(45);
  });

  it("is able to checkFunctionalDependencies", function() {
    // Create a valid SQLResult
    var sqlResult = new SQLResult({columns: ["A", "B", "C", "D"],
                                   values: [["1", "2", "3", "4"],
                                            ["2", "2", "3", "5"],
                                            ["3", "2", "5", "6"]]});

    // Do the test(s)
    // At least one of the parameters is empty => should be false
    expect(sqlResult.checkFunctionalDependency([], ["B"])).toBe(false);
    expect(sqlResult.checkFunctionalDependency(["A"], [])).toBe(false);
    expect(sqlResult.checkFunctionalDependency([], [])).toBe(false);

    // Invalid functional dependencies
    expect(sqlResult.checkFunctionalDependency(["B"], ["A"])).toBe(false);
    expect(sqlResult.checkFunctionalDependency(["C"], ["A"])).toBe(false);
    expect(sqlResult.checkFunctionalDependency(["C"], ["B", "A"])).toBe(false);

    // Valid functional dependencies
    expect(sqlResult.checkFunctionalDependency(["A"], ["B"])).toBe(true);
    expect(sqlResult.checkFunctionalDependency(["C"], ["B"])).toBe(true);
    expect(sqlResult.checkFunctionalDependency(["D"], ["A"])).toBe(true);
    expect(sqlResult.checkFunctionalDependency(["A", "B"], ["C"])).toBe(true);
  });

  it("is able to transform column names to positions", function() {
    // Create a valid SQLResult
    var sqlResult = new SQLResult({columns: ["A", "B", "C", "D"],
                                   values: [["1", "2", "3", "4"],
                                            ["2", "3", "4", "5"],
                                            ["3", "4", "5", "6"]]});

    // Do the test(s)
    expect(sqlResult.transformColumnNamesToPositions(["A"])).toEqual([0]);
    expect(sqlResult.transformColumnNamesToPositions(["C"])).toEqual([2]);
    expect(sqlResult.transformColumnNamesToPositions(["A", "C"])).toEqual([0, 2]);
    expect(sqlResult.transformColumnNamesToPositions(["B", "D"])).toEqual([1, 3]);
  });

});
