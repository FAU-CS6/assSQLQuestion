/* Deterministic Chrome regressions for the SQL -> parallel assessment barrier. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><title>SQL QSS UI regression</title>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = process.env.CHROME_CDP_URL
    ? await chromium.connectOverCDP(process.env.CHROME_CDP_URL)
    : await chromium.launch({ channel: process.env.ILIAS_CHROME_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.setContent('<form id="answer"><div id="qpisql-qss-config"></div>'
      + '<input type="hidden" id="qpisql-qss-evaluation" name="qss_evaluation">'
      + '<textarea id="sequence_b" name="sequence_b">SELECT 1 AS value</textarea>'
      + '<input id="qpisql-error-bool" name="error_bool"><input id="qpisql-error" name="error">'
      + '<input id="qpisql-executed-bool" name="executed_bool"><input id="qpisql-output-relation" name="output_relation">'
      + '<button id="qpisql-execute-button" type="button">Execute</button><button id="qpisql-cancel-button" type="button" data-cancelled="Cancelled" hidden>Cancel</button>'
      + '<button id="next" type="submit">Next</button><input id="qpisql-scoring-metric-value-result_lines">'
      + '<div id="qpisql-output-area"><span id="qpisql-execution-status"></span><span id="qpisql-save-status"></span>'
      + '<div id="qpisql-output-area-error"></div><div id="qpisql-output-area-execution-running"></div><div id="qpisql-output-area-relation"></div></div></form>');
    const sources = ['SQL/class.SQLResult.js', 'SQL/class.SQLRun.js', 'SQL/Errors/class.SQLRunErrorAbstract.js',
      'SQL/Errors/class.SQLRunErrorDBCreation.js', 'SQL/Errors/class.SQLRunErrorIntegrityCheck.js',
      'SQL/Errors/class.SQLRunErrorNoExecution.js', 'SQL/Errors/class.SQLRunErrorNoVisibleResult.js',
      'SQL/Errors/class.SQLRunErrorRunningSequence.js', 'class.QSSShadow.js', 'class.ExecutionHandler.js',
      'ExecutionOutputs/class.ExecutionOutput.js', 'ExecutionOutputs/class.OutputAreaOutput.js',
      'ExecutionOutputs/class.ExecuteButtonOutput.js', 'ExecutionOutputs/class.ScoringMetricOutputQuestion.js'];
    for (const file of sources) await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../../js/classes', file), 'utf8') });
    await page.evaluate(() => {
      window.QPISQL_URL_PATH = '';
      window.workers = [];
      window.Worker = class {
        constructor(url) { this.url = url; this.terminated = false; workers.push(this); }
        postMessage(message) {
          this.message = message;
          if (/^SELECT name,\s*type FROM sqlite_master/.test(message.sql || '')) this.onmessage({ data: { results: [
            { columns: ['name', 'type'], values: [['items', 'table'], ['visible_items', 'view']] }
          ] } });
          if (message.sql?.startsWith('PRAGMA table_info(')) this.onmessage({ data: { results: [
            { columns: ['cid', 'name', 'type', 'notnull', 'default', 'pk'], values: [[0, 'id', 'INTEGER', 0, null, 0]] }
          ] } });
        }
        terminate() { this.terminated = true; }
      };
      const labels = { title: 'Parallel QSS', shadow: 'Does not change test points', sqlRunning: 'Running SQL',
        parsing: 'Parsing SQL', comparing: 'Comparing queries', completed: 'Completed', notEvaluated: 'Not evaluated',
        unsupported: 'Unsupported', failed: 'Failed', cancelled: 'Cancelled', waiting: 'Evaluating',
        visited: 'States', lowerBound: 'Distance lower bound', points: 'Points', distance: 'Distance', details: 'Details', model: 'Model', cost: 'Cost', stale: 'Outdated model or answer' };
      document.getElementById('qpisql-qss-config').dataset.config = JSON.stringify({ version: 2, mode: 'shadow', context: 'participant', enabled: true,
        engine: 'graph-qss-sqlite-v2', engineVersion: '2.1.0', rubric: 'paper-linear-v2', scale: 1, scaleMode:'fixed',
        referenceSql: 'SELECT 1 AS value', referenceRevision: 'a'.repeat(64), referenceExecutionValid: true, referenceRows: 1, maxPoints: 3, labels });
      document.getElementById('qpisql-output-area').dataset.labels = JSON.stringify({ running: 'Running SQL', success: 'Executed',
        notExecuted: 'Not executed', cancelled: 'Cancelled', failed: 'Failed', unsaved: 'Unsaved', sequenceError: 'SQL failed' });
      window.handler = new ExecutionHandler();
      for (const [name, value] of Object.entries({ sequence_a: '', sequence_c: '', integrity_check: false })) handler.registerInput({ getName: () => name, getValue: () => value });
      handler.registerInput({ getName: () => 'sequence_b', getValue: () => document.getElementById('sequence_b').value });
      handler.registerOutput(new OutputAreaOutput());
      handler.registerOutput(new ExecuteButtonOutput());
      handler.registerOutput(new ScoringMetricOutputQuestion('result_lines', result => result.getNumberOfRows()));
      handler.execute();
      workers[0].onmessage({ data: { results: [{ columns: ['value'], values: [[1]] }] } });
    });
    await page.waitForFunction(() => workers.length === 2);
    const pending = await page.evaluate(() => ({ running: handler.running, phase: handler.phase,
      visible: document.getElementById('qpisql-output-area-relation').style.display,
      executed: document.getElementById('qpisql-executed-bool').value, nextDisabled: document.getElementById('next').disabled,
      progress: !!document.querySelector('#qpisql-qss-shadow progress'), sqlTerminated: workers[0].terminated,
      references: [workers[1].message.referenceExecutionValid, workers[1].message.answerExecutionValid],
      rows: [workers[1].message.referenceRows, workers[1].message.answerRows],
      schemaTypes: workers[1].message.schema.tables.map(table => ({name: table.name, type: table.type})) }));
    assert.deepEqual(pending, { running: true, phase: 'qss', visible: 'none', executed: 'true', nextDisabled: true, progress: true,
      sqlTerminated: true, references: [true, true], rows: [1, 1], schemaTypes: [{name: 'items', type: 'table'}, {name: 'visible_items', type: 'view'}] });
    assert.equal(await page.locator('#qpisql-scoring-metric-value-result_lines').inputValue(), '1', 'The established grade remains available at the native test deadline');
    const guard = await page.evaluate(() => {
      const form = document.getElementById('answer');
      const user = new SubmitEvent('submit', { cancelable: true, submitter: document.getElementById('next') });
      const automatic = new SubmitEvent('submit', { cancelable: true });
      form.dispatchEvent(user); form.dispatchEvent(automatic);
      workers[1].onmessage({ data: { type: 'progress', id: workers[1].message.id, phase: 'comparing', visited: 42, lowerBound: 1 } });
      return { userBlocked: user.defaultPrevented, automaticBlocked: automatic.defaultPrevented, status: document.querySelector('.qpisql-qss-status').textContent };
    });
    assert.equal(guard.userBlocked, true); assert.equal(guard.automaticBlocked, false); assert.match(guard.status, /42/);
    await page.evaluate(() => workers[1].onmessage({ data: { type: 'result', id: workers[1].message.id,
      result: { status: 'exact', engine: 'graph-qss-sqlite-v2', version: '2.1.0', rubric: 'paper-linear-v2', scale: 1, distance: 0, points: 3, maxPoints: 3,
        exactWithinModel: true, limitations: ['<img src=x onerror=alert(1)>'],
        edits: [{ name: 'setLiteral', description: '<img src=x onerror=alert(1)>', cost: 1,
          operation: { root: { privateSql: 'never autosave a graph state' } } }] } } }));
    await page.waitForFunction(() => !handler.running);
    const completed = await page.evaluate(() => ({ visible: document.getElementById('qpisql-output-area-relation').style.display,
      executed: document.getElementById('qpisql-executed-bool').value, nextDisabled: document.getElementById('next').disabled,
      rows: document.querySelectorAll('#qpisql-output-area-relation tbody tr').length,
      points: JSON.parse(document.getElementById('qpisql-qss-evaluation').value).points,
      savedEdit: JSON.parse(document.getElementById('qpisql-qss-evaluation').value).edits[0],
      editFeedback: document.querySelector('#qpisql-qss-shadow li')?.textContent,
      digest: JSON.parse(document.getElementById('qpisql-qss-evaluation').value).answerDigest,
      terminated: workers.every(worker => worker.terminated), injected: document.querySelectorAll('#qpisql-qss-shadow img').length }));
    assert.equal(completed.visible, 'block'); assert.equal(completed.executed, 'true'); assert.equal(completed.nextDisabled, false);
    assert.equal(completed.rows, 1); assert.equal(completed.points, 3); assert.match(completed.digest, /^[a-f0-9]{64}$/);
    assert.equal(completed.terminated, true); assert.equal(completed.injected, 0);
    assert.deepEqual(completed.savedEdit, { name: 'setLiteral', description: '<img src=x onerror=alert(1)>', cost: 1 });
    assert.match(completed.editFeedback, /Cost: 1/);
    console.log('PASS: SQL result stays hidden, navigation stays disabled, progress updates, and result publication waits for QSS');

    await page.evaluate(() => { handler.execute(); workers[2].onmessage({ data: { results: [{ columns: ['value'], values: [[1]] }] } }); });
    await page.waitForFunction(() => workers.length === 4);
    const cancelled = await page.evaluate(() => {
      const late = workers[3].onmessage, id = workers[3].message.id;
      handler.cancel();
      late({ data: { type: 'result', id, result: { status: 'exact', points: 999 } } });
      return { running: handler.running, terminated: workers[3].terminated,
        sidecar: document.getElementById('qpisql-qss-evaluation').value, nextDisabled: document.getElementById('next').disabled,
        visible: document.getElementById('qpisql-output-area-relation').style.display,
        executed: document.getElementById('qpisql-executed-bool').value,
        rows: document.getElementById('qpisql-scoring-metric-value-result_lines').value };
    });
    assert.deepEqual(cancelled, { running: false, terminated: true, sidecar: '', nextDisabled: false, visible: 'block', executed: 'true', rows: '1' });
    console.log('PASS: cancellation terminates the QSS worker and suppresses its late result without a timeout');

    await page.evaluate(() => { document.getElementById('qpisql-qss-evaluation').value = '{"points":999}'; handler.onChange(); });
    assert.equal(await page.locator('#qpisql-qss-evaluation').inputValue(), '');

    await page.evaluate(() => { window.EXECUTE_HANDLER = handler; handler.execute(); });
    const sqlCancellation = await page.evaluate(() => {
      handler.cancel();
      return { busy: document.getElementById('qpisql-qss-shadow').getAttribute('aria-busy'),
        running: handler.running, terminated: workers[4].terminated, status: document.querySelector('.qpisql-qss-status').textContent };
    });
    assert.deepEqual(sqlCancellation, { busy: 'false', running: false, terminated: true, status: 'Cancelled' });
    await page.evaluate(() => { handler.execute(); workers[5].onmessage({ data: { results: [{ columns: ['value'], values: [[1]] }] } }); });
    await page.waitForFunction(() => workers.length === 7);
    const replaced = await page.evaluate(() => {
      const late = workers[6].onmessage, id = workers[6].message.id;
      const config = document.getElementById('qpisql-qss-config'); config.replaceWith(config.cloneNode(true));
      const area = document.getElementById('qpisql-output-area'), replacement = area.cloneNode(true);
      replacement.querySelector('.qpisql-qss-shadow').remove(); area.replaceWith(replacement);
      window.EXECUTE_HANDLER = new ExecutionHandler();
      document.getElementById('qpisql-qss-evaluation').value = 'new-question-sentinel';
      late({ data: { type: 'progress', id, phase: 'comparing', visited: 999 } });
      late({ data: { type: 'result', id, result: { status: 'exact', points: 999 } } });
      return { oldTerminated: workers[6].terminated, sidecar: document.getElementById('qpisql-qss-evaluation').value,
        cards: document.querySelectorAll('#qpisql-qss-shadow').length, leaked: replacement.textContent.includes('999') };
    });
    assert.deepEqual(replaced, { oldTerminated: true, sidecar: 'new-question-sentinel', cards: 1, leaked: false });

    const restored = await page.evaluate(() => {
      const container = document.createElement('div');
      container.dataset.labels = JSON.stringify({ notExecuted: 'Not executed' });
      container.dataset.qssLabels = JSON.stringify(QSSShadow.configuration().labels);
      container.dataset.qssReferenceRevision = 'a'.repeat(64);
      container.dataset.qssEvaluation = JSON.stringify({ status: 'exact', engine: 'graph-qss-sqlite-v2', version: '2.1.0', rubric: 'paper-linear-v2', scale: 0.6, points: 3, maxPoints: 3,
        distance: 0, referenceRevision: 'a'.repeat(64) });
      container.innerHTML = '<div class="qpisql-output-area-error"></div><div class="qpisql-output-area-relation"></div>';
      document.body.appendChild(container);
      OutputAreaOutput.renderStored(container); OutputAreaOutput.renderStored(container);
      const cards = container.querySelectorAll('.qpisql-qss-shadow').length;
      const currentPoints = !!container.querySelector('.qpisql-qss-score');
      const old = JSON.parse(container.dataset.qssEvaluation);
      old.engine = 'sqlite-syntax-edit-graph-v1'; old.version = '1.0.0';
      container.dataset.qssEvaluation = JSON.stringify(old); OutputAreaOutput.renderStored(container);
      const oldModelPoints = !!container.querySelector('.qpisql-qss-score');
      old.engine = 'graph-qss-sqlite-v2'; old.version = '2.0.0';
      container.dataset.qssEvaluation = JSON.stringify(old); OutputAreaOutput.renderStored(container);
      const oldVersionPoints = !!container.querySelector('.qpisql-qss-score');
      old.version = '2.1.0';
      container.dataset.qssEvaluation = JSON.stringify(old);
      container.dataset.qssReferenceRevision = 'b'.repeat(64); OutputAreaOutput.renderStored(container);
      return { cards, currentPoints, oldModelPoints, oldVersionPoints, stalePoints: !!container.querySelector('.qpisql-qss-score') };
    });
    assert.deepEqual(restored, { cards: 1, currentPoints: true, oldModelPoints: false, oldVersionPoints: false, stalePoints: false });

    const staleEditor = await page.evaluate(async () => {
      const saved = { status: 'exact', engine: 'sqlite-syntax-edit-graph-v1', version: '1.0.0',
        referenceRevision: 'a'.repeat(64), answerDigest: await QSSShadow.digest(document.getElementById('sequence_b').value),
        points: 99, maxPoints: 99, distance: 0 };
      document.getElementById('qpisql-qss-evaluation').value = JSON.stringify(saved);
      window.handler = window.EXECUTE_HANDLER = new ExecutionHandler();
      return { sidecar: document.getElementById('qpisql-qss-evaluation').value,
        score: !!document.querySelector('#qpisql-qss-shadow .qpisql-qss-score'),
        message: document.querySelector('#qpisql-qss-shadow .qpisql-qss-status').textContent };
    });
    assert.deepEqual(staleEditor, { sidecar: '', score: false, message: 'Outdated model or answer' });

    await page.evaluate(() => {
      for (const [name, value] of Object.entries({ sequence_a: '', sequence_c: '', integrity_check: false })) handler.registerInput({ getName: () => name, getValue: () => value });
      handler.registerInput({ getName: () => 'sequence_b', getValue: () => document.getElementById('sequence_b').value });
      handler.registerOutput(new OutputAreaOutput()); handler.registerOutput(new ExecuteButtonOutput());
      handler.registerOutput(new ScoringMetricOutputQuestion('result_lines', result => result.getNumberOfRows()));
      handler.execute(); workers.at(-1).onmessage({ data: { error: 'no such column: unknown' } });
    });
    await page.waitForFunction(() => workers.at(-1).url.endsWith('/worker.qss.js'));
    const errorComparison = await page.evaluate(() => {
      const worker = workers.at(-1);
      const requested = { engine: worker.message.engine, scale: worker.message.scale,
        answerExecutionValid: worker.message.answerExecutionValid, disabled: document.getElementById('next').disabled };
      worker.onmessage({ data: { type: 'result', id: worker.message.id, result: { status: 'exact',
        engine: 'graph-qss-sqlite-v2', version: '2.1.0', rubric: 'paper-linear-v2', scale: 1,
        distance: 1, points: 2, maxPoints: 3, edits: [{ name: 'setColumnReference', cost: 1 }] } } });
      return requested;
    });
    assert.deepEqual(errorComparison, { engine: 'graph-qss-sqlite-v2', scale: 1, answerExecutionValid: false, disabled: true });
    await page.waitForFunction(() => !handler.running);
    assert.equal(await page.locator('#qpisql-error-bool').inputValue(), 'true');
    assert.equal(await page.locator('#qpisql-executed-bool').inputValue(), 'false');
    assert.equal(await page.locator('#qpisql-scoring-metric-value-result_lines').inputValue(), 'false');
    assert.equal(JSON.parse(await page.locator('#qpisql-qss-evaluation').inputValue()).points, 2);
    assert.equal(await page.locator('#next').isDisabled(), false);
    assert.deepEqual(errors, []);
    console.log('PASS: edits invalidate parallel assessments; no page errors or HTML injection');
    console.log('PASS: SQL cancellation clears progress; AJAX replacement suppresses old workers; restored diagnoses are idempotent and revision-bound');
    console.log('PASS: previous syntax-model diagnostics are stale; SQL errors still receive a static QSS assessment without changing official error fields');
  } finally {
    await context.close();
    if (!process.env.CHROME_CDP_URL) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}
// A CDP connection must not keep the CLI alive or close the shared Chrome process.
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
