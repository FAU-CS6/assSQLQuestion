'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { nullDefaultCatalogOracle, equivalentFormatting, formattingTokenProof } = require('./fixture-mutations.cjs');

test('formatting changes leave strings, quoted names, numbers and other identifiers intact', () => {
  const source = 'ALTER TABLE "CamelCase" ADD COLUMN flag TEXT CHECK(flag <> \'UPPER\') DEFAULT NULL;';
  assert.equal(formattingTokenProof(source, equivalentFormatting(source)).safe, true);
  assert.equal(formattingTokenProof(source, equivalentFormatting(source).replace("'UPPER'", "'upper'")).safe, false);
  assert.equal(formattingTokenProof(source, equivalentFormatting(source).replace('"CamelCase"', '"camelcase"')).safe, false);
});

test('limits NULL spelling normalization to a bound pragma_table_info default field', () => {
  const source = "SELECT ti.dflt_value = 'NULL' FROM pragma_table_info('t') AS ti WHERE ti.name = 'flag';";
  const result = nullDefaultCatalogOracle(source);
  assert.equal(result.fields, 1);
  assert.equal(result.sql, "SELECT (CASE WHEN ti.dflt_value = 'null' THEN 'NULL' ELSE ti.dflt_value END) = 'NULL' FROM pragma_table_info('t') AS ti WHERE ti.name = 'flag';");
});

test('preserves ordinary data, string defaults, comments and other comparisons', () => {
  for (const source of [
    "SELECT ti.dflt_value = 'NULL' FROM application_data AS ti;",
    "SELECT ti.dflt_value = '''NULL''' FROM pragma_table_info('t') AS ti;",
    "SELECT ti.dflt_value LIKE 'NULL' FROM pragma_table_info('t') AS ti;",
    "SELECT 'FROM pragma_table_info(t) AS ti; ti.dflt_value = NULL';",
    "-- FROM pragma_table_info(t) AS ti\nSELECT ti.dflt_value = 'NULL' FROM application_data AS ti;"
  ]) assert.equal(nullDefaultCatalogOracle(source), null);
  const separate = "SELECT ti.dflt_value = 'NULL' FROM application_data AS ti; SELECT ti.name FROM pragma_table_info('t') AS ti;";
  assert.equal(nullDefaultCatalogOracle(separate), null);
});
