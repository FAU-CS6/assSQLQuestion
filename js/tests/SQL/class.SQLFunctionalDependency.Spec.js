/**
 * @file Test specification for SQL/class.SQLFunctionalDependency.js
 * @author Dominik Probst <dominik.probst@fau.de>
 * @version 0.1
 */

describe("A SQLFunctionalDependency", function() {
  it("can be converted to a valid JSON string", function() {
    // Create a valid SQLFunctionalDependency
    var sqlFD = new SQLFunctionalDependency(["A", "B"], ["D"]);

    // Create the expected JSON string
    var expectedJSON = "{\"determinateAttributes\":[\"A\",\"B\"],\"dependentAttributes\":[\"D\"]}";

    // Do the test
    expect(sqlFD.toJSON()).toBe(expectedJSON);
  });

  it("can be compared to an other SQLFunctionalDependency (equals)", function() {
    // Create valid SQLFunctionalDependencies
    var sqlFD1 = new SQLFunctionalDependency(["A", "B"], ["D"]);
    var sqlFD2 = new SQLFunctionalDependency(["B", "A"], ["D"]);
    var sqlFD3 = new SQLFunctionalDependency(["A", "B"], ["C"]);
    var sqlFD4 = new SQLFunctionalDependency(["A", "D"], ["D"]);
    var sqlFD5 = new SQLFunctionalDependency(["A", "B"], ["D", "E"]);
    var sqlFD6 = new SQLFunctionalDependency(["A", "B"], ["E", "D"]);
    var sqlFD7 = new SQLFunctionalDependency(["A", "B"], ["E", "F"]);

    // Do the test(s)
    // Should be true (equal)
    expect(sqlFD1.equals(sqlFD2)).toBe(true);
    expect(sqlFD2.equals(sqlFD1)).toBe(true);
    expect(sqlFD5.equals(sqlFD6)).toBe(true);
    expect(sqlFD6.equals(sqlFD5)).toBe(true);

    // Should be false (not equal)
    expect(sqlFD1.equals(sqlFD3)).toBe(false);
    expect(sqlFD3.equals(sqlFD1)).toBe(false);
    expect(sqlFD1.equals(sqlFD4)).toBe(false);
    expect(sqlFD1.equals(sqlFD5)).toBe(false);
    expect(sqlFD6.equals(sqlFD7)).toBe(false);
  });

  it("can be compared to an other SQLFunctionalDependency (isLessMinimalThan)", function() {
    // Create valid SQLFunctionalDependencies
    var sqlFD1 = new SQLFunctionalDependency(["A"], ["D"]);
    var sqlFD2 = new SQLFunctionalDependency(["A", "B"], ["D"]);
    var sqlFD3 = new SQLFunctionalDependency(["B", "A"], ["D"]);
    var sqlFD4 = new SQLFunctionalDependency(["A"], ["C"]);
    var sqlFD5 = new SQLFunctionalDependency(["C","B","A"], ["D"]);

    // Do the test(s)
    // Should be true (Other dependency is more minimal)
    expect(sqlFD2.isLessMinimalThan(sqlFD1)).toBe(true);
    expect(sqlFD3.isLessMinimalThan(sqlFD1)).toBe(true);
    expect(sqlFD5.isLessMinimalThan(sqlFD3)).toBe(true);

    // Should be false (Other dependency is not more minimal)
    expect(sqlFD1.isLessMinimalThan(sqlFD2)).toBe(false);
    expect(sqlFD1.isLessMinimalThan(sqlFD3)).toBe(false);
    expect(sqlFD2.isLessMinimalThan(sqlFD3)).toBe(false);
    expect(sqlFD2.isLessMinimalThan(sqlFD4)).toBe(false);
    expect(sqlFD2.isLessMinimalThan(sqlFD4)).toBe(false);
  });



});
