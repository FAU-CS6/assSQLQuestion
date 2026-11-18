import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {observesSchemaMetadata, usesCustomOutputColumnNames} from '../../lib/qss/src/schema-observation.mjs';

test('standalone constraint-flag assignments do not inspect schema metadata', () => {
    for (const sql of ['PRAGMA foreign_keys=OFF; SELECT 1', 'PRAGMA main.foreign_keys = ON;',
        'PRAGMA defer_foreign_keys=1; PRAGMA recursive_triggers=TRUE', "PRAGMA ignore_check_constraints='OFF'",
        "SELECT 'PRAGMA table_info(t)' AS explanation", '-- PRAGMA table_info(t)\nSELECT 1']) {
        assert.equal(observesSchemaMetadata({controlSql: sql}), false, sql);
    }
});

test('foreign-key violation checks do not observe schema spelling or nullable flags', () => {
    for (const controlSql of ['PRAGMA foreign_key_check', 'PRAGMA main.foreign_key_check(child)',
        "SELECT * FROM pragma_foreign_key_check WHERE parent='parent'",
        "PRAGMA foreign_keys=OFF; SELECT fkid FROM pragma_foreign_key_check('child')"]) {
        assert.equal(observesSchemaMetadata({controlSql}), false, controlSql);
    }
    for (const controlSql of ['PRAGMA foreign_key_check; PRAGMA table_info(child)',
        'SELECT * FROM pragma_foreign_key_check JOIN pragma_foreign_key_list(\'child\')',
        'SELECT * FROM pragma_foreign_key_check_extra']) {
        assert.equal(observesSchemaMetadata({controlSql}), true, controlSql);
    }
});

test('direct metadata readers, opaque pragmas and views in setup withhold free DDL changes', () => {
    for (const request of [{controlSql: 'PRAGMA table_info(t)'}, {answer: 'PRAGMA foreign_key_list(t)'},
        {reference: 'PRAGMA main.table_xinfo(t)'}, {controlSql: 'PRAGMA foreign_keys'},
        {controlSql: 'PRAGMA foreign_keys=OFF; PRAGMA table_info(t)'},
        {controlSql: 'SELECT sql FROM sqlite_schema'}, {answer: "SELECT * FROM pragma_table_info('t')"},
        {schemaSql: 'CREATE VIEW metadata AS SELECT sql FROM sqlite_master', controlSql: 'SELECT * FROM metadata'},
        {schema: {tables: [{name: 'unknown_view', type: 'view'}]}}]) {
        assert.equal(observesSchemaMetadata(request), true, JSON.stringify(request));
    }
});

test('SQLite foreign-key diagnostics retain real violations across the guarded DDL spellings', () => {
    const ordinary = "CREATE TABLE child(id INTEGER PRIMARY KEY,pid REFERENCES parent(id),label TEXT DEFAULT 'unset')";
    const pairs = [[ordinary, ordinary.replace('PRIMARY KEY', 'PRIMARY KEY NOT NULL')],
        [ordinary, ordinary.replace("'unset'", '"unset"')],
        [ordinary, ordinary.replace('REFERENCES parent(id)', 'REFERENCES parent')],
        [ordinary + ';ALTER TABLE child ADD flag INTEGER', ordinary + ';ALTER TABLE child ADD COLUMN flag INTEGER']];
    const run = sql => {
        const db = new DatabaseSync(':memory:');
        try {
            db.exec('PRAGMA foreign_keys=OFF;CREATE TABLE parent(id INTEGER PRIMARY KEY);INSERT INTO parent VALUES(1);' + sql);
            db.exec('INSERT INTO child(id,pid) VALUES(NULL,999),(NULL,NULL),(NULL,1)');
            return db.prepare('SELECT * FROM pragma_foreign_key_check').all();
        } finally { db.close(); }
    };
    for (const [before, after] of pairs) {
        const violations = run(before);
        assert.equal(violations.length, 1, 'The diagnostic must observe a real violation, not two empty results.');
        assert.deepEqual(run(after), violations);
    }
});

test('column-name configuration is detected in setup as well as both answers and control', () => {
    for (const field of ['schemaSql', 'reference', 'answer', 'controlSql']) {
        for (const sql of ['PRAGMA full_column_names=ON', 'PRAGMA main.short_column_names=OFF',
            'PRAGMA temp."full_column_names"(1); SELECT 1']) {
            assert.equal(usesCustomOutputColumnNames({[field]: sql}), true, field + ': ' + sql);
        }
        for (const sql of ['PRAGMA foreign_keys=ON', "SELECT 'PRAGMA full_column_names=ON'",
            '-- PRAGMA short_column_names=OFF\nSELECT 1']) {
            assert.equal(usesCustomOutputColumnNames({[field]: sql}), false, field + ': ' + sql);
        }
    }
});
