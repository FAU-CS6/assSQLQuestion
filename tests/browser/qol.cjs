/* Focused browser regressions for cancellation, worker cleanup and untrusted SQL output. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function main() {
  const browser = process.env.ILIAS_CHROME_CDP
    ? await chromium.connectOverCDP(process.env.ILIAS_CHROME_CDP)
    : await chromium.launch({ headless: true, ...(process.env.ILIAS_CHROME_CHANNEL ? { channel: process.env.ILIAS_CHROME_CHANNEL } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<main id="result"></main>');
    const sources = [
      'SQL/class.SQLResult.js', 'SQL/class.SQLRun.js', 'SQL/Errors/class.SQLRunErrorAbstract.js',
      'SQL/Errors/class.SQLRunErrorDBCreation.js', 'SQL/Errors/class.SQLRunErrorIntegrityCheck.js',
      'SQL/Errors/class.SQLRunErrorNoExecution.js', 'SQL/Errors/class.SQLRunErrorNoVisibleResult.js',
      'SQL/Errors/class.SQLRunErrorRunningSequence.js', 'class.ExecutionHandler.js',
      'ExecutionOutputs/class.ExecutionOutput.js', 'ExecutionOutputs/class.OutputAreaOutput.js'
    ];
    for (const source of sources) {
      await page.addScriptTag({ content: fs.readFileSync(path.resolve(__dirname, '../../js/classes', source), 'utf8') });
    }
    const rendering = await page.evaluate(() => {
      const result = new SQLResult({ columns: ['<img src=x onerror=alert(1)>', 'literal & column'],
        values: [['<svg onload=alert(1)>', null], ['', 'text']] });
      const container = document.getElementById('result');
      result.renderInto(container);
      const safe = !container.querySelector('img, svg, script') && container.textContent.includes('<svg onload=alert(1)>');
      const special = [...container.querySelectorAll('.qpisql-special-value')].map(cell => cell.textContent);
      const escaped = result.toHTMLTable().includes('&lt;img') && result.toHTMLTable().includes('&lt;svg');
      const many = new SQLResult({ columns: ['id'], values: Array.from({ length: 201 }, (_, i) => [i]) });
      many.renderInto(container);
      const first = container.querySelectorAll('tbody tr').length;
      container.querySelectorAll('button')[1].click();
      const secondStart = container.querySelector('tbody td').textContent;
      container.querySelectorAll('button')[1].click();
      const last = container.querySelectorAll('tbody tr').length;
      return { safe, special, escaped, first, secondStart, last, fullRows: JSON.parse(many.toJSON()).values.length };
    });
    assert.deepEqual(rendering, { safe: true, special: ['NULL', "''"], escaped: true, first: 100, secondStart: '100', last: 1, fullRows: 201 });
    console.log('PASS: SQL output is text, special values are explicit, and pagination retains all grading rows');

    const lifecycle = await page.evaluate(() => {
      window.QPISQL_URL_PATH = '';
      const instances = [];
      window.Worker = class {
        constructor() { this.terminated = false; instances.push(this); }
        postMessage(message) { this.message = message; }
        terminate() { this.terminated = true; }
      };
      const events = [];
      const callback = { onResult: result => events.push(['result', result.getNumberOfRows()]), onError: error => events.push(['error', error.errorType]) };
      const success = new SQLRun('', 'SELECT 1', '', false, callback);
      instances[0].onmessage({ data: { results: [{ columns: ['one'], values: [[1]] }] } });
      const successfulCleanup = instances[0].terminated && success.finished && success.worker === null;
      const pending = new SQLRun('SELECT long_running_query', '', '', false, callback);
      const lateMessage = instances[1].onmessage;
      pending.cancel('Cancelled by user');
      lateMessage({ data: { results: [{ columns: ['late'], values: [[1]] }] } });
      const cancellationCleanup = instances[1].terminated && pending.finished;
      const invalid = new SQLRun('', 'SELECT missing', '', false, callback);
      let prevented = false;
      instances[2].onerror({ message: 'missing', preventDefault() { prevented = true; } });
      const invalidCleanup = instances[2].terminated && invalid.finished;
      new SQLRun('', 'UPDATE people SET id = 1', '', true, callback);
      const integrityCleanup = instances[3].terminated;
      const handler = new ExecutionHandler();
      handler.inputs = [
        { getName: () => 'sequence_a', getValue: () => '' },
        { getName: () => 'sequence_b', getValue: () => 'SELECT 1' },
        { getName: () => 'sequence_c', getValue: () => '' },
        { getName: () => 'integrity_check', getValue: () => false }
      ];
      handler.execute(); handler.execute();
      const concurrentCount = instances.length;
      handler.cancel();
      const handlerReady = !handler.running && handler.activeRun === null && instances[4].terminated;
      return { events, successfulCleanup, cancellationCleanup, invalidCleanup, integrityCleanup, prevented, concurrentCount, handlerReady };
    });
    assert.deepEqual(lifecycle.events, [['result', 1], ['error', 'SQLRunErrorCancelled'], ['error', 'SQLRunErrorRunningSequence'], ['error', 'SQLRunErrorIntegrityCheck']]);
    for (const key of ['successfulCleanup', 'cancellationCleanup', 'invalidCleanup', 'integrityCleanup', 'prevented', 'handlerReady']) assert.equal(lifecycle[key], true, key);
    assert.equal(lifecycle.concurrentCount, 5);
    console.log('PASS: manual cancellation, late-message suppression, worker cleanup and repeated-run guard');

    const stored = await page.evaluate(() => {
      const container = document.getElementById('result');
      container.replaceChildren();
      for (const name of ['error', 'relation']) {
        const element = document.createElement('div'); element.className = 'qpisql-output-area-' + name; container.appendChild(element);
      }
      container.dataset.labels = JSON.stringify({ notExecuted: 'Not executed', sequenceError: 'SQL failed', failed: 'Failed' });
      container.dataset.errorBool = 'true';
      container.dataset.error = JSON.stringify({ errorType: 'SQLRunErrorNoExecution', errorMessage: '' });
      OutputAreaOutput.renderStored(container);
      const notExecuted = container.querySelector('.qpisql-output-area-error').textContent;
      container.dataset.error = JSON.stringify({ errorType: 'SQLRunErrorRunningSequence', errorMessage: '<img src=x onerror=alert(1)>', sequence: 'B' });
      OutputAreaOutput.renderStored(container);
      return { notExecuted, errorText: container.textContent, injectedNodes: container.querySelectorAll('img').length };
    });
    assert.equal(stored.notExecuted, 'Not executed');
    assert.match(stored.errorText, /\(B\) SQL failed <img/);
    assert.equal(stored.injectedNodes, 0);
    console.log('PASS: stored unexecuted answers have visible feedback and stored SQL errors cannot inject HTML');

    const autosave = await page.evaluate(() => {
      const events = {};
      window.jQuery = () => ({ off() { return this; }, on(name, callback) { events[name] = callback; return this; } });
      const form = document.createElement('form');
      for (const [name, value] of Object.entries({ sequence_b: 'SELECT 1', error_bool: 'false', error: '', executed_bool: 'true', output_relation: '' })) {
        const input = document.createElement('input'); input.type = 'hidden'; input.name = name; input.id = 'qpisql-' + name.replaceAll('_', '-'); input.value = value; form.appendChild(input);
      }
      const labels = { notExecuted: 'Not executed', success: 'Executed', unsaved: 'Unsaved', saved: 'Draft saved', saveFailed: 'Save failed', failed: 'Failed', autosaveSuccess: 'Stored by ILIAS' };
      const area = document.createElement('div'); area.id = 'qpisql-output-area'; area.dataset.labels = JSON.stringify(labels); form.appendChild(area);
      for (const id of ['qpisql-execution-status', 'qpisql-save-status', 'qpisql-output-area-error', 'qpisql-output-area-relation', 'qpisql-output-area-execution-running']) {
        const element = document.createElement('div'); element.id = id; area.appendChild(element);
      }
      document.body.appendChild(form);
      let changes = 0; form.addEventListener('change', () => changes++);
      const output = new OutputAreaOutput();
      output.restore('false', '', 'true', JSON.stringify({ columns: ['value'], values: [[1]] }));
      const restoredChanges = changes;
      form.elements.sequence_b.value = 'SELECT 2'; output.onChange();
      const settings = { url: '/ilias.php?cmd=autosave&test_answer_changed=1', data: new URLSearchParams(new FormData(form)).toString() };
      events['ajaxSuccess.qpisqlAutosave']({}, { responseText: 'Stored by ILIAS' }, settings);
      const confirmed = document.getElementById('qpisql-save-status').textContent.startsWith('Draft saved');
      form.elements.sequence_b.value = 'SELECT 3'; output.onChange();
      events['ajaxSuccess.qpisqlAutosave']({}, { responseText: 'Stored older draft' }, settings);
      const staleIgnored = document.getElementById('qpisql-save-status').textContent === 'Unsaved';
      const current = { ...settings, data: new URLSearchParams(new FormData(form)).toString() };
      events['ajaxSuccess.qpisqlAutosave']({}, { responseText: 'Autosave failed: session expired' }, current);
      const failedHTTP200 = document.getElementById('qpisql-save-status').textContent === 'Save failed';
      events['ajaxError.qpisqlAutosave']({}, {}, current);
      const failureVisible = document.getElementById('qpisql-save-status').textContent === 'Save failed';
      events['ajaxSuccess.qpisqlAutosave']({}, { responseText: '-IGNORE-' }, current);
      const ignoredResponse = document.getElementById('qpisql-save-status').textContent === 'Save failed';
      const lfSQL = ['SELECT 1;', 'SELECT 2;'].join(String.fromCharCode(10));
      const crlfSQL = ['SELECT 1;', 'SELECT 2;'].join(String.fromCharCode(13, 10));
      form.elements.sequence_b.value = lfSQL;
      const sentMultiline = new URLSearchParams(new FormData(form)); sentMultiline.set('sequence_b', crlfSQL);
      events['ajaxSuccess.qpisqlAutosave']({}, { responseText: 'Stored by ILIAS' }, { ...settings, data: sentMultiline.toString() });
      const normalizedNewlines = lfSQL.includes(String.fromCharCode(10)) && crlfSQL.includes(String.fromCharCode(13, 10))
        && document.getElementById('qpisql-save-status').textContent.startsWith('Draft saved');
      return { restoredChanges, changes, confirmed, staleIgnored, failedHTTP200, failureVisible, ignoredResponse, normalizedNewlines };
    });
    assert.deepEqual(autosave, { restoredChanges: 0, changes: 2, confirmed: true, staleIgnored: true, failedHTTP200: true, failureVisible: true, ignoredResponse: true, normalizedNewlines: true });
    console.log('PASS: saved feedback requires a confirmed current ILIAS autosave response, and failures remain visible');
    const lifecycleBinding = await page.evaluate(() => {
      const originalJQuery = window.jQuery;
      const originalReadyState = Object.getOwnPropertyDescriptor(document, 'readyState');
      Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'loading' });
      delete window.jQuery;
      const output = new OutputAreaOutput();
      const deferredUntilReady = output.autosaveJQuery === null;
      let bindings = 0;
      const deferredHandlers = {};
      const readyJQuery = () => ({ off() { return this; }, on(name, callback) { bindings++; deferredHandlers[name] = callback; return this; } });
      window.jQuery = readyJQuery;
      document.dispatchEvent(new Event('DOMContentLoaded'));
      window.dispatchEvent(new Event('load'));
      const boundOnce = bindings === 2 && output.autosaveJQuery === readyJQuery;
      delete window.jQuery;
      const stale = new OutputAreaOutput();
      const area = document.getElementById('qpisql-output-area');
      area.replaceWith(area.cloneNode(true));
      window.jQuery = readyJQuery;
      document.dispatchEvent(new Event('DOMContentLoaded'));
      window.dispatchEvent(new Event('load'));
      const staleIgnored = bindings === 2 && stale.autosaveJQuery === null;
      document.getElementById('qpisql-save-status').textContent = 'Keep newer question state';
      deferredHandlers['ajaxSuccess.qpisqlAutosave']({}, { responseText: 'Stored by ILIAS' }, { url: '/ilias.php?test_answer_changed=1', data: new URLSearchParams(new FormData(document.querySelector('form'))).toString() });
      const boundOldHandlerIgnored = document.getElementById('qpisql-save-status').textContent === 'Keep newer question state';
      if (originalReadyState) Object.defineProperty(document, 'readyState', originalReadyState);
      else delete document.readyState;
      window.jQuery = originalJQuery;
      return { deferredUntilReady, boundOnce, staleIgnored, boundOldHandlerIgnored };
    });
    assert.deepEqual(lifecycleBinding, { deferredUntilReady: true, boundOnce: true, staleIgnored: true, boundOldHandlerIgnored: true });
    assert.deepEqual(errors, []);
    console.log('PASS: autosave listeners bind after late jQuery initialization once, and obsolete AJAX instances remain unbound');
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
