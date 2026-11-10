/* Compare the optimized grouping with the pre-update algorithm, including its JSON equality. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const test = require('node:test');
const vm = require('node:vm');

const source = ['class.SQLFunctionalDependency.js', 'class.SQLResult.js'].map(name =>
  fs.readFileSync(path.resolve(__dirname, '../../js/classes/SQL', name), 'utf8')).join('\n');
const {SQLResult, SQLFunctionalDependency} = vm.runInNewContext(source + '\n({SQLResult, SQLFunctionalDependency});', {console: {warn() {}}});

// Frozen reference for checkFunctionalDependency before the Map optimization.
// Both column-position sorting and JSON.stringify equality intentionally stay as
// they were; this test is not an alternative SQL equality definition.
function legacy(determinants, dependents) {
  if (determinants.length < 1 || dependents.length < 1) return false;
  let determinantPositions, dependentPositions;
  try {
    determinantPositions = this.transformColumnNamesToPositions(determinants);
    dependentPositions = this.transformColumnNamesToPositions(dependents);
  } catch (_) {return false;}
  determinantPositions.sort();
  dependentPositions.sort();
  const determinantValues = [], dependentValues = [];
  for (const row of this.values) {
    const determinant = JSON.stringify(determinantPositions.map(position => row[position]));
    const dependent = JSON.stringify(dependentPositions.map(position => row[position]));
    const index = determinantValues.indexOf(determinant);
    if (index !== -1) {
      if (!(determinant === determinantValues[index] && dependent === dependentValues[index])) return false;
    } else {
      determinantValues.push(determinant);
      dependentValues.push(dependent);
    }
  }
  return true;
}

// Frozen uncached enumeration: the reference must not share the new memo logic.
function legacyFind(current, undecided) {
  let found = [];
  for (let i = 0; i < undecided.length; i++) {
    const left = current.slice();
    left.push(undecided[i]);
    const remaining = undecided.slice();
    remaining.splice(i, 1);
    for (let j = 0; j < remaining.length; j++) {
      if (this.checkFunctionalDependency(left, [remaining[j]])) found.push(new SQLFunctionalDependency(left, [remaining[j]]));
    }
    const nested = legacyFind.call(this, left, remaining);
    if (nested.length) found = found.concat(nested);
  }
  return found;
}

function compareAll(result) {
  const reference = new SQLResult({columns: result.columns, values: result.values});
  reference.checkFunctionalDependency = legacy;
  reference.getAllFunctionalDependencies = function () {return legacyFind.call(this, [], this.columns.slice());};
  assert.equal(result.getAllMinimalFunctionalDependenciesAsJSON(), reference.getAllMinimalFunctionalDependenciesAsJSON());
  assert.equal(JSON.stringify(result.getAllFunctionalDependencies()), JSON.stringify(reference.getAllFunctionalDependencies()));
}

test('preserves empty inputs, unknown columns, NULLs, types, duplicates and blob JSON', () => {
  for (const values of [[], [[null, 0], [null, '0']], [[0, null], [-0, null]],
    [[1, 'same'], ['1', 'different']], [[null, null], [null, null]],
    [[new Uint8Array([0, 255]), {'0': 0, '1': 255}], [{'0': 0, '1': 255}, new Uint8Array([0, 255])]],
    [[[0, 255], 'array'], [{'0': 0, '1': 255}, 'object']],
    [['__proto__', '<svg>'], ['__proto__', '<svg>']],
    [[undefined, NaN], [null, Infinity]]]) {
    const result = new SQLResult({columns: ['A', 'B'], values});
    compareAll(result);
    for (const [a, b] of [[[], ['B']], [['A'], []], [['missing'], ['B']], [['A'], ['B']]]) {
      assert.equal(result.checkFunctionalDependency(a, b), legacy.call(result, a, b));
    }
  }
});

test('has identical complete and minimal dependencies for 250 deterministic randomized relations', () => {
  let seed = 0x63062026;
  const next = n => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n;};
  const values = [null, 0, -0, 1, -1, 3.14, '', '0', '1', 'a,b', '[null]', '__proto__',
    new Uint8Array([0, 255]), {'0': 0, '1': 255}, [0, 255], {key: 'value'}];
  for (let i = 0; i < 250; i++) {
    const columns = ['A', 'B', 'C', 'D'].slice(0, 2 + next(3));
    const rows = Array.from({length: next(60)}, () => columns.map(() => values[next(values.length)]));
    if (rows.length) rows.push(rows[0].slice());
    compareAll(new SQLResult({columns, values: rows}));
  }
});

test('recomputes after rows change and preserves first-column handling for duplicate names', () => {
  const result = new SQLResult({columns: ['A', 'A', 'B'], values: [[1, 'ignored', 'x'], [2, 'also ignored', 'y']]});
  assert.equal(result.checkFunctionalDependency(['A'], ['B']), true);
  result.values.push([1, 'new ignored value', 'conflict']);
  assert.equal(result.checkFunctionalDependency(['A'], ['B']), false);
  compareAll(result);
});

test('keeps the memo local and rechecks mutated result rows on every complete call', () => {
  const result = new SQLResult({columns: ['A', 'B', 'C'], values: [[1, 'x', 1], [2, 'y', 2]]});
  const before = result.getAllMinimalFunctionalDependenciesAsJSON();
  result.values.push([1, 'conflict', 1]);
  const after = result.getAllMinimalFunctionalDependenciesAsJSON();
  assert.notEqual(after, before);
  compareAll(result);
  result.values.pop();
  assert.equal(result.getAllMinimalFunctionalDependenciesAsJSON(), before);
  compareAll(result);
});

test('preserves all eight-column permutation outputs while checking each attribute set once', () => {
  const result = new SQLResult({columns: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], values: [[1, 1, 1, 1, 1, 1, 1, 1]]});
  let calls = 0;
  const check = result.checkFunctionalDependency;
  result.checkFunctionalDependency = function (...args) {calls++; return check.apply(this, args);};
  const actual = JSON.stringify(result.getAllFunctionalDependencies());
  const reference = new SQLResult({columns: result.columns, values: result.values});
  reference.checkFunctionalDependency = legacy;
  assert.equal(actual, JSON.stringify(legacyFind.call(reference, [], reference.columns.slice())));
  assert.equal(calls, 8 * (2 ** 7 - 1));
  console.log(`Eight columns retain ${JSON.parse(actual).length} permutation outputs with ${calls} distinct FD checks.`);
});

test('minimal evaluation handles nine columns without building determinant permutations', () => {
  const columns = ['A','B','C','D','E','F','G','H','I'];
  const result = new SQLResult({columns, values: [[1,1,1,1,1,1,1,1,1]]});
  let checks = 0;
  const check = result.checkFunctionalDependency;
  result.checkFunctionalDependency = function (...args) {checks++; return check.apply(this,args);};
  const dependencies = result.getAllMinimalFunctionalDependencies();
  assert.equal(dependencies.length, columns.length * (columns.length - 1));
  assert.ok(dependencies.every(fd => fd.getDeterminateAttributes().length === 1 && fd.getDependentAttributes().length === 1));
  assert.equal(checks, columns.length * (2 ** (columns.length - 1) - 1));
});

test('handles 26000 rows and a late conflicting row with unchanged legacy results', () => {
  const result = new SQLResult({columns: ['id', 'value'], values: Array.from({length: 26000}, (_, i) => [i, 'v' + i])});
  let start = performance.now();
  const optimized = result.checkFunctionalDependency(['id'], ['value']);
  const optimizedMs = performance.now() - start;
  start = performance.now();
  const original = legacy.call(result, ['id'], ['value']);
  const legacyMs = performance.now() - start;
  assert.equal(optimized, true);
  assert.equal(optimized, original);
  result.values.push([0, 'late conflict']);
  assert.equal(result.checkFunctionalDependency(['id'], ['value']), false);
  assert.equal(legacy.call(result, ['id'], ['value']), false);
  console.log(`26000 rows: Map ${optimizedMs.toFixed(1)}ms, legacy ${legacyMs.toFixed(1)}ms; identical results, including late conflict.`);
});
