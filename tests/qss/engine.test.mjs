import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const sandbox = {setTimeout, clearTimeout, AbortController};
vm.createContext(sandbox);
vm.runInContext(readFileSync(new URL('../../lib/qss/qss.js', import.meta.url), 'utf8'), sandbox);
const QSS = sandbox.QSS;
const schema = {tables: [
    {name: 'items', columns: [{name: 'id', type: 'INTEGER'}, {name: 'amount', type: 'REAL'}, {name: 'name', type: 'TEXT'}]},
    {name: 'details', columns: [{name: 'item_id', type: 'INTEGER'}, {name: 'active', type: 'INTEGER'}]}
]};
const evaluate = (reference, answer, extra = {}) => QSS.evaluate({reference, answer, schema, maxPoints: 2, ...extra});
const plain = value => JSON.parse(JSON.stringify(value));
const editCost = result => result.edits.reduce((sum, edit) => sum + edit.cost, 0);

test('model identity, normalized formula and provisional status are explicit', async () => {
    const result = await evaluate('SELECT id FROM items', 'SELECT id FROM items');
    assert.equal(result.status, 'exact');
    assert.equal(result.distance, 0);
    assert.equal(result.points, 2);
    assert.equal(result.engine, 'sqlite-syntax-edit-graph-v1');
    assert.equal(result.exactWithinModel, true);
    assert.equal(result.provisionalRubric, true);
    assert.equal(result.rubric, 'provisional-cap-5-v1');
    assert.equal(result.normalizationDistance, Math.min(5, result.referenceDistance));
    assert.match(result.formula, /normalizationDistance/);
    assert.ok(result.limitations.some(x => x.includes('not the original')));
    assert.ok(result.limitations.some(x => x.includes('not been validated')));
});

test('whitespace, comments, keyword case and final semicolon have zero distance', async () => {
    const result = await evaluate('SELECT id FROM items', 'select /* safe */ id\nfrom items; -- trailing');
    assert.equal(result.distance, 0);
    assert.equal(result.points, 2);
});

test('safe table alias normalization preserves the referenced binding', async () => {
    const result = await evaluate('SELECT first.id FROM items first', 'SELECT second.id FROM items second');
    assert.equal(result.distance, 0);
    const wrongBinding = await evaluate('SELECT first.id FROM items first, details second', 'SELECT second.active FROM items first, details second');
    assert.ok(wrongBinding.points < 2);
});

test('correlated subquery aliases cannot collide with the outer scope', async () => {
    const reference = 'SELECT a.id FROM items a WHERE EXISTS(SELECT 1 FROM details d WHERE d.item_id=a.id);';
    const equivalent = 'SELECT x.id FROM items x WHERE EXISTS(SELECT 1 FROM details y WHERE y.item_id=x.id);';
    const wrong = 'SELECT a.id FROM items a WHERE EXISTS(SELECT 1 FROM details d WHERE d.item_id=d.active);';
    assert.equal((await evaluate(reference, equivalent)).distance, 0);
    assert.ok((await evaluate(reference, wrong)).points < 2);
    const noSchemaReference = 'SELECT a.id FROM items a WHERE EXISTS(SELECT 1 FROM details d WHERE d.item_id=id);';
    const noSchemaWrong = 'SELECT a.id FROM items a WHERE EXISTS(SELECT 1 FROM details d WHERE d.item_id=d.active);';
    assert.ok((await evaluate(noSchemaReference, noSchemaWrong, {schema: undefined})).points < 2);
});

test('leading underscore identifiers are valid SQLite syntax, not parser recovery', async () => {
    const result = await evaluate('SELECT 0 AS __qss_wrong_answer__;', 'SELECT 0 AS __qss_wrong_answer__;');
    assert.equal(result.status, 'exact');
    assert.equal(result.distance, 0);
});

test('pure AND reordering and mirrored column/literal comparisons normalize', async () => {
    const result = await evaluate('SELECT id FROM items WHERE id > 0 AND amount < 9', 'SELECT id FROM items WHERE amount < 9 AND 0 < id');
    assert.equal(result.distance, 0);
});

test('safe comparisons keep the column left so opposite operators cost exactly one operator edit', async () => {
    for (const [operator, opposite] of [['>', '<'], ['<', '>'], ['>=', '<='], ['<=', '>=']]) {
        const reference = `SELECT id FROM items WHERE amount${operator}10`;
        const wrong = await evaluate(reference, `SELECT id FROM items WHERE amount${opposite}10`, {exactDistance: true});
        assert.equal(wrong.status, 'exact');
        assert.equal(wrong.distance, 2);
        assert.equal(editCost(wrong), 2);
        assert.equal(wrong.points, 1.2);
        const equivalent = await evaluate(reference, `SELECT id FROM items WHERE 10${opposite}amount`);
        assert.equal(equivalent.distance, 0);
        assert.equal(equivalent.points, 2);
    }
});

test('NOT equality and inequality normalize, including SQL NULL expressions', async () => {
    for (const value of ['1', 'NULL']) {
        const result = await evaluate(`SELECT id FROM items WHERE id <> ${value}`, `SELECT id FROM items WHERE NOT(id = ${value})`);
        assert.equal(result.distance, 0);
    }
});

test('pure INNER JOIN conditions normalize to WHERE with explicit projections', async () => {
    const result = await evaluate('SELECT items.id FROM items INNER JOIN details ON items.id=details.item_id', 'SELECT items.id FROM items, details WHERE items.id=details.item_id');
    assert.equal(result.distance, 0);
});

test('outer joins and SELECT star are excluded from INNER JOIN normalization', async () => {
    for (const [reference, answer] of [
        ['SELECT items.id FROM items LEFT JOIN details ON items.id=details.item_id', 'SELECT items.id FROM items, details WHERE items.id=details.item_id'],
        ['SELECT * FROM items INNER JOIN details ON items.id=details.item_id', 'SELECT * FROM items, details WHERE items.id=details.item_id']
    ]) {
        const result = await evaluate(reference, answer);
        assert.ok(result.points < 2);
    }
});

test('normalization preserves Boolean precedence and does not invent equality associativity', async () => {
    for (const [reference, answer] of [
        ['SELECT id FROM items WHERE id=1 AND (amount=2 OR amount=3)', 'SELECT id FROM items WHERE (id=1 AND amount=2) OR amount=3'],
        ['SELECT ((2=1)=0) FROM items', 'SELECT (2=(1=0)) FROM items']
    ]) {
        const result = await evaluate(reference, answer);
        assert.ok(result.points < 2);
    }
});

test('one material label edit has exact trace cost and at least a twenty percent deduction', async () => {
    const result = await evaluate('SELECT id FROM items', 'SELECT amount FROM items', {exactDistance: true});
    assert.equal(result.distance, 1);
    assert.equal(editCost(result), 1);
    assert.equal(result.points, 1.6);
});

test('empty answer and score cutoff certify zero without inventing an exact distance', async () => {
    const limited = await evaluate('SELECT id FROM items', '');
    const exact = await evaluate('SELECT id FROM items', '', {exactDistance: true});
    assert.equal(limited.status, 'score-zero-certified');
    assert.equal(limited.distance, null);
    assert.equal(limited.points, 0);
    assert.ok(limited.lowerBound >= limited.normalizationDistance);
    assert.equal(exact.status, 'exact');
    assert.equal(exact.distance, exact.referenceDistance);
    assert.equal(editCost(exact), exact.distance);
    assert.equal(exact.points, 0);
});

test('literal spelling, literal case and large integers remain material', async () => {
    for (const [a, b] of [["'Text'", "'text'"], ['9007199254740993', '9007199254740992'], ['1.0', '1']]) {
        const result = await evaluate(`SELECT ${a} FROM items`, `SELECT ${b} FROM items`);
        assert.ok(result.points < 2, `${a} versus ${b}`);
    }
});

test('ASCII identifier folding uses SQLite rules without folding Unicode or quoted string fallback', async () => {
    assert.equal((await evaluate('SELECT id FROM items WHERE amount>10;', 'SELECT ID FROM ITEMS WHERE AMOUNT>10;')).distance, 0);
    assert.ok((await evaluate("SELECT 'X'", "SELECT 'x'")).points < 2);
    assert.ok((await evaluate('SELECT "X"', 'SELECT "x"')).points < 2);
    assert.ok((await evaluate('SELECT Ä FROM items', 'SELECT ä FROM items', {executionValid: true})).points < 2);
});

test('CASTs and explicit collations are preserved rather than generalized away', async () => {
    assert.ok((await evaluate('SELECT CAST(amount AS INTEGER) FROM items', 'SELECT CAST(amount AS TEXT) FROM items')).points < 2);
    assert.ok((await evaluate("SELECT name FROM items WHERE name COLLATE NOCASE='A'", "SELECT name FROM items WHERE name COLLATE BINARY='A'")).points < 2);
});

test('comparison mirroring cannot switch the precedence of two explicit SQLite collations', async () => {
    const reference = "SELECT id FROM items WHERE name COLLATE NOCASE > 'B' COLLATE BINARY";
    const wrong = "SELECT id FROM items WHERE 'B' COLLATE BINARY < name COLLATE NOCASE";
    const result = await evaluate(reference, wrong, {executionValid: true});
    assert.ok(['exact', 'score-zero-certified'].includes(result.status));
    assert.equal(typeof result.points, 'number');
    assert.ok(result.points < 2);
});

test('comparison mirroring excludes CAST-wrapped columns with unknown declared collations', async () => {
    const result = await evaluate('SELECT id FROM items WHERE CAST(name AS TEXT)>amount', 'SELECT id FROM items WHERE amount<CAST(name AS TEXT)', {executionValid: true});
    assert.ok(['exact', 'score-zero-certified'].includes(result.status));
    assert.ok(result.points < 2);
});

test('structural equality keys cannot be confused by delimiter-like SQL literal values', async () => {
    const result = await evaluate("SELECT 'Identifier:a[|]' FROM items", "SELECT 'Identifier:a[|]x' FROM items");
    assert.equal(result.distance, 1);
});

test('SQLite Unicode identifiers are represented losslessly, including quoted variants', async () => {
    const result = await evaluate('SELECT käufer FROM spieler', 'select "käufer" from spieler', {executionValid: true});
    assert.equal(result.status, 'exact');
    assert.equal(result.distance, 0);
});

test('CREATE, ALTER, INSERT, DELETE and multi-statement scripts use the explicit syntax graph', async () => {
    for (const sql of [
        'CREATE TABLE sample(id INTEGER PRIMARY KEY, name TEXT NOT NULL)',
        'ALTER TABLE sample ADD COLUMN score INTEGER',
        'INSERT INTO sample VALUES(1,\'name\')',
        'DELETE FROM sample WHERE id=1',
        'CREATE TABLE sample(id); INSERT INTO sample VALUES(1); DROP TABLE sample;'
    ]) {
        const result = await evaluate(sql, sql, {executionValid: true});
        assert.equal(result.status, 'exact');
        assert.equal(result.distance, 0);
        assert.equal(result.points, 2);
    }
});

test('a SQLite dialect gap requires successful browser execution and is disclosed', async () => {
    const sql = 'CREATE TABLE sample(id INTEGER REFERENCES other)';
    const unsupported = await evaluate(sql, sql);
    assert.equal(unsupported.status, 'unsupported');
    assert.equal(unsupported.points, null);
    const confirmed = await evaluate(sql, sql, {referenceExecutionValid: true, answerExecutionValid: true});
    assert.equal(confirmed.status, 'exact');
    assert.equal(confirmed.distance, 0);
    assert.equal(confirmed.validation.reference, 'browser-sqlite-confirmed-cst');
});

test('unterminated or unbalanced SQL is unsupported even with a runtime-valid flag', async () => {
    for (const answer of ["SELECT 'broken", 'SELECT (id FROM items', 'SELECT id /* unfinished', 'SELECT @@@']) {
        const result = await evaluate('SELECT id FROM items', answer, {executionValid: true});
        assert.equal(result.status, 'unsupported');
        assert.equal(result.points, null);
    }
});

test('unsupported syntax is never silently substituted or graded zero', async () => {
    const result = await evaluate('SELECT id FROM items', 'SELECT FROM');
    assert.equal(result.status, 'unsupported');
    assert.equal(result.distance, null);
    assert.equal(result.points, null);
    assert.equal((await evaluate('SELECT id FROM items', 'SELECT id FROM items', {engine: 'unknown'})).status, 'unsupported');
});

test('a known browser SQLite error is unresolved, including ambiguous DQS syntax', async () => {
    const result = await evaluate('SELECT "x"', 'SELECT x', {referenceExecutionValid: true, answerExecutionValid: false});
    assert.equal(result.status, 'unsupported');
    assert.equal(result.code, 'known-sql-execution-error');
    assert.equal(result.points, null);
    assert.match(result.message, /no comparison score is certified/);
});

test('the original graph is explicit, isolated and returns a genuine shortest edit path', async () => {
    const result = await evaluate('SELECT id FROM items', 'SELECT amount FROM items', {engine: QSS.ORIGINAL_ENGINE});
    assert.equal(result.engine, 'graph-qss-original-v1');
    assert.equal(result.status, 'exact');
    assert.equal(result.distance, 1);
    assert.equal(result.referenceDistance, 4);
    assert.equal(editCost(result), 1);
    assert.equal(result.points, 1.5);
    assert.ok(result.edits.every(e => e.type === 'original-edit'));
});

test('the original graph does not classify SQL equality as a cost-free associative rewrite', async () => {
    const result = await evaluate('SELECT ((2=1)=0) FROM items', 'SELECT (2=(1=0)) FROM items', {engine: QSS.ORIGINAL_ENGINE, maxPoints: 1, pointsPerEdit: 1});
    assert.equal(result.status, 'score-zero-certified');
    assert.equal(result.points, 0);
    assert.ok(result.lowerBound >= 1);
});

test('invalid original cost configurations fail safely, including on identity', async () => {
    for (const cost of [-1, 0.5, Infinity, NaN]) {
        const result = await evaluate('SELECT id FROM items', 'SELECT id FROM items', {engine: QSS.ORIGINAL_ENGINE, costs: {addFromElement: cost}});
        assert.equal(result.status, 'unsupported');
        assert.equal(result.points, null);
        assert.equal(result.code, 'invalid-costs');
    }
});

test('unsupported original constructs retain an explicit model boundary', async () => {
    for (const sql of ['UPDATE items SET amount=1', 'SELECT id FROM items WHERE id IN (1,2)', 'SELECT id FROM items UNION SELECT item_id FROM details']) {
        const result = await evaluate(sql, sql, {engine: QSS.ORIGINAL_ENGINE, executionValid: true});
        assert.equal(result.status, 'unsupported');
        assert.equal(result.points, null);
    }
});

test('manual cancellation neither certifies a grade nor cancels another evaluation', async () => {
    const controller = new AbortController();
    const fields = Array.from({length: 90}, (_, i) => 'a' + i).join(',');
    const other = Array.from({length: 90}, (_, i) => 'b' + i).join(',');
    const pending = QSS.evaluate({reference: 'SELECT ' + fields + ' FROM items', answer: 'SELECT ' + other + ' FROM items', maxPoints: 2}, progress => {
        if (progress.phase === 'syntax-edit-graph') controller.abort();
    }, {signal: controller.signal});
    const [cancelled, unaffected] = await Promise.all([pending, evaluate('SELECT id FROM items', 'SELECT id FROM items')]);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(cancelled.points, null);
    assert.equal(unaffected.points, 2);
});

test('worker cancellation and progress use per-request identifiers', () => {
    const handlers = [], messages = [];
    const local = {setTimeout, clearTimeout, AbortController, self: {addEventListener: (_, listener) => handlers.push(listener), postMessage: value => messages.push(plain(value))}};
    vm.createContext(local);
    vm.runInContext(readFileSync(new URL('../../lib/qss/worker.qss.js', import.meta.url), 'utf8'), local);
    assert.equal(handlers.length, 1);
    return handlers[0]({data: {type: 'evaluate', id: 'isolated', reference: 'SELECT 1', answer: 'SELECT 1', maxPoints: 1}}).then(() => {
        assert.equal(messages[0].id, 'isolated');
        assert.equal(messages.at(-1).type, 'result');
        assert.equal(messages.at(-1).result.points, 1);
    });
});
