<?php
/**
 * Database update script for qpisql
 *
 * @author Dominik Probst <dominik.probst@studium.fau.de>
 * @version $Id$
 */
?>
<#1>
<?php
/**
 * First part:
 * Checking whether qpisql is register in qpl_qst_type and if not register it
 */
$res = $ilDB->queryF(
    "SELECT * FROM qpl_qst_type WHERE type_tag = %s",
    array('text'),
    array('assSQLQuestion')
);

if ($res->numRows() == 0) {
    $res = $ilDB->query("SELECT MAX(question_type_id) maxid FROM qpl_qst_type");
    $data = $ilDB->fetchAssoc($res);
    $max = $data["maxid"] + 1;

    $affectedRows = $ilDB->manipulateF(
        "INSERT INTO qpl_qst_type (question_type_id, type_tag, plugin) VALUES (%s, %s, %s)",
        array("integer", "text", "integer"),
        array($max, 'assSQLQuestion', 1)
    );
}
?>
<#2>
<?php
/**
 * Second part:
 * Adding additional tables used to save data about a question itself
 *
 * As ilDB allows a maxium of 22 Bytes for table names and the ilias documentation
 * requests us to use "il_qpl_qst_qpisql_" as prefix for any of our tables we
 * only have 4 Bytes left to create "talking" table names. The resulting abbreviations
 * are described in the comment before creating a table.
 *
 * Supported data types in ilDB:
 * text, integer, float, date, time, timestamp, clob, blob in
 */

/**
 * Table "il_qpl_qst_qpisql_qd"
 *
 * "qd" is short for "question data"
 *
 * Containing all sequences, the integrity_check, error and executed booleans
 * and the output relation. See class.assSQLQuestion.php (member variables)
 * for more information
 */
if (!$ilDB->tableExists('il_qpl_qst_qpisql_qd')) {
    $fields = array(
    // The id of the question (primary key and foreign key)
    'question_fi' => array(
      'type' => 'integer',
      'length' => 4
    ),
    // The sql sequences
    'sequence_a' => array(
      'type' => 'text'
    ),
    'sequence_b' => array(
      'type' => 'text'
    ),
    'sequence_c' => array(
      'type' => 'text'
    ),
    // The booleans - Data type is integer(1) due to ilDB not supporting
    // boolean and recommending this instead
    'integrity_check' => array(
      'type' => 'integer',
      'length' => 1
    ),
    'error_bool' => array(
      'type' => 'integer',
      'length' => 1
    ),
    // The error coded as json array
    'error' => array(
      'type' => 'clob'
    ),
    'executed_bool' => array(
      'type' => 'integer',
      'length' => 1
    ),
    // The output relation coded as json array
    'output_relation' => array(
      'type' => 'clob'
    )
  );

    $ilDB->createTable("il_qpl_qst_qpisql_qd", $fields);
    $ilDB->addPrimaryKey("il_qpl_qst_qpisql_qd", array("question_fi"));
}

/**
 * Table "il_qpl_qst_qpisql_qsm"
 *
 * "qsm" is short for "question scoring metric"
 *
 * Containing all scoring metrics of a single question -
 * see class.qpisql.scoringMetric.php for more information
 */
if (!$ilDB->tableExists('il_qpl_qst_qpisql_qsm')) {
    $fields = array(
    // The id of the question (first part of primary key and foreign key)
    'question_fi' => array(
      'type' => 'integer',
      'length' => 4
    ),
    // The type of the scoring metric (second part of the primary key - has to be unique for a single question)
    'type' => array(
      'type' => 'text',
      'length' => 128
    ),
    'points' => array(
      'type' => 'integer'
    ),
    'value' => array(
      'type' => 'clob'
    ),
  );

    $ilDB->createTable("il_qpl_qst_qpisql_qsm", $fields);
    $ilDB->addPrimaryKey("il_qpl_qst_qpisql_qsm", array("question_fi","type"));
}
?>
<#3>
<?php
/**
 * Third part:
 * Updating the sequences to support bigger SQL statements without being cropped
 *
 * Supported data types in ilDB:
 * text, integer, float, date, time, timestamp, clob, blob in
 */

/**
 * Table "il_qpl_qst_qpisql_qd"
 */
if ($ilDB->tableExists('il_qpl_qst_qpisql_qd')) {
   $ilDB->modifyTableColumn('il_qpl_qst_qpisql_qd', 'sequence_a', array('type' => 'clob'));
   $ilDB->modifyTableColumn('il_qpl_qst_qpisql_qd', 'sequence_b', array('type' => 'clob'));
   $ilDB->modifyTableColumn('il_qpl_qst_qpisql_qd', 'sequence_c', array('type' => 'clob'));
}
?>
<#4>
<?php
/**
 * 4th part:
 * Something went totally wrong with the commits - so we have to inclode No. 3 a second time
 *
 * Supported data types in ilDB:
 * text, integer, float, date, time, timestamp, clob, blob in
 */

/**
 * Table "il_qpl_qst_qpisql_qd"
 */
if ($ilDB->tableExists('il_qpl_qst_qpisql_qd')) {
   $ilDB->modifyTableColumn('il_qpl_qst_qpisql_qd', 'sequence_a', array('type' => 'clob'));
   $ilDB->modifyTableColumn('il_qpl_qst_qpisql_qd', 'sequence_b', array('type' => 'clob'));
   $ilDB->modifyTableColumn('il_qpl_qst_qpisql_qd', 'sequence_c', array('type' => 'clob'));
}
?>
<#5>
<?php
/**
 * Insert plugin name into qpl_qst_type
 * The `id` (c.f. plugin.php) is added automatically, but not the `plugin_name`.
 * Without it, question imports fail, as ilAssQuestionType::getPluginName() fails.
 */
if($ilDB->tableColumnExists('qpl_qst_type', 'plugin_name'))
{
    $ilDB->manipulate("UPDATE qpl_qst_type set plugin_name = type_tag WHERE type_tag ='assSQLQuestion'");
}
?>