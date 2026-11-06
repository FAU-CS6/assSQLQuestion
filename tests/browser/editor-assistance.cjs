/* Test the shipped editor bundle independently of an ILIAS test instance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

async function testHelper(browser, bundle) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const template = fs.readFileSync(path.resolve(__dirname,
      '../../templates/SequenceArea/tpl.il_as_qpl_qpisql_sea_help.html'), 'utf8')
      .replace(/<script\b[\s\S]*?<\/script>/gi, '')
      .replace(/\{([A-Z_]+)\}/g, (_, key) => ({ENABLED: 'true', AUTHOR: 'true'}[key] || key));
    await page.setContent('<form><textarea id="sequence_a">CREATE TABLE people (id INTEGER);</textarea>' +
      '<textarea id="sequence_b">SELECT secret_model_solution;</textarea>' +
      '<textarea id="sequence_c">SELECT secret_control_query;</textarea>' +
      '<input type="checkbox" id="qpisql-integrity-check" name="integrity_check">' + template + '</form>');
    await page.addScriptTag({content: bundle});
    await page.evaluate(() => {
      window.QPISQL_URL_PATH = '/plugin';
      for (const details of document.querySelectorAll('#qpisql-editor-help details')) details.open = true;
      window.workers = [];
      window.rejectWorker = false;
      window.Worker = class {
        constructor(url) {
          if (window.rejectWorker) throw new Error('Worker blocked');
          this.url = url;
          this.messages = [];
          this.terminated = false;
          window.workers.push(this);
        }
        postMessage(message) {this.messages.push(message);}
        terminate() {this.terminated = true;}
      };
      window.editors = {};
      const inputs = ['sequence_a', 'sequence_b', 'sequence_c'].map(name => {
        const editor = codemirror_sqlquestion.editorFromTextArea(document.getElementById(name), () => {}, false);
        window.editors[name] = editor;
        return {editor, getName: () => name, getValue: () => editor.getValue()};
      });
      window.EXECUTE_HANDLER = {inputs, execute() {}};
      for (const letter of ['A', 'B', 'C']) {
        window.EXECUTE_HANDLER['getSequence' + letter] = () => window.editors['sequence_' + letter.toLowerCase()].getValue();
      }
      document.getElementById('qpisql-editor-assistance').checked = true;
    });
    await page.addScriptTag({content: fs.readFileSync(path.resolve(__dirname, '../../js/editor-assistance.js'), 'utf8')});
    await page.evaluate(() => window.QPISQL_ATTACH_HELP(document.getElementById('qpisql-editor-help')));

    const schema = await page.evaluate(() => {
      document.getElementById('qpisql-schema-load').click();
      const worker = window.workers[0];
      const setup = worker.messages[0].sql;
      worker.onmessage({data: {results: []}});
      const names = ['people', '__proto__', 'weird"<svg onload=alert(1)>'];
      worker.onmessage({data: {results: [{values: names.map(name => [name])}]}});
      for (const name of names) worker.onmessage({data: {results: [{values: [[0, name + '_column']]}]}});
      const state = window.editors.sequence_b.schema;
      return {
        setup, messages: worker.messages.map(message => message.sql),
        keys: Object.keys(state), nullPrototype: Object.getPrototypeOf(state) === null,
        prototypeColumns: state.__proto__, terminated: worker.terminated,
        rows: [...document.querySelectorAll('#qpisql-schema-tables li')].map(item => item.textContent),
        injected: document.querySelectorAll('#qpisql-schema-tables svg').length,
        loaded: !document.getElementById('qpisql-schema-load').disabled
      };
    });
    assert.equal(schema.setup, 'CREATE TABLE people (id INTEGER);');
    assert.equal(schema.messages.length, 5);
    assert.match(schema.messages[1], /sqlite_master/);
    assert.equal(schema.messages[4], 'PRAGMA table_info("weird""<svg onload=alert(1)>");');
    assert.deepEqual(schema.keys, ['people', '__proto__', 'weird"<svg onload=alert(1)>']);
    assert.equal(schema.nullPrototype, true);
    assert.deepEqual(schema.prototypeColumns, ['__proto___column']);
    assert.equal(schema.terminated, true);
    assert.equal(schema.loaded, true);
    assert.equal(schema.injected, 0);
    assert.match(schema.rows[2], /<svg onload/);
    assert.ok(schema.messages.every(sql => !sql.includes('secret_model_solution') && !sql.includes('secret_control_query')));
    console.log('PASS: helper loads schema from sequence A only, quotes SQL identifiers and safely handles __proto__/HTML table names');

    const lifecycle = await page.evaluate(() => {
      window.editors.sequence_a.setValue('CREATE TABLE changed (other INTEGER);');
      const invalidated = {
        schema: Object.keys(window.editors.sequence_b.schema),
        rows: document.querySelectorAll('#qpisql-schema-tables li').length,
        status: document.getElementById('qpisql-schema-status').textContent
      };
      document.getElementById('qpisql-schema-load').click();
      const worker = window.workers[1];
      const late = worker.onmessage;
      document.getElementById('qpisql-schema-cancel').click();
      late({data: {results: [{values: [['late']]}]}});
      return {invalidated, terminated: worker.terminated, messages: worker.messages.length,
        status: document.getElementById('qpisql-schema-status').textContent,
        loadReady: !document.getElementById('qpisql-schema-load').disabled,
        cancelHidden: document.getElementById('qpisql-schema-cancel').hidden};
    });
    assert.deepEqual(lifecycle, {invalidated: {schema: [], rows: 0, status: 'SCHEMA_CHANGED'},
      terminated: true, messages: 1, status: 'SCHEMA_CANCELLED', loadReady: true, cancelHidden: true});
    console.log('PASS: changing sequence A invalidates schema/completion, and manual schema cancellation ignores late messages');

    const examples = await page.evaluate(() => {
      const select = document.getElementById('qpisql-example');
      const apply = document.getElementById('qpisql-example-apply');
      const integrity = document.getElementById('qpisql-integrity-check');
      const snapshot = () => ['sequence_a', 'sequence_b', 'sequence_c'].map(name => window.editors[name].getValue());
      const old = snapshot();
      const initiallyDisabled = apply.disabled;
      apply.disabled = false;
      apply.click();
      const protectedExisting = JSON.stringify(old) === JSON.stringify(snapshot());
      const generated = [];
      for (const kind of ['select', 'update', 'delete', 'insert']) {
        for (const name of ['sequence_a', 'sequence_b', 'sequence_c']) window.editors[name].setValue('');
        select.value = kind;
        select.dispatchEvent(new Event('change'));
        integrity.checked = kind !== 'select';
        apply.click();
        generated.push({kind, sql: snapshot(), integrity: integrity.checked, disabled: apply.disabled});
      }
      return {initiallyDisabled, protectedExisting, generated};
    });
    assert.equal(examples.initiallyDisabled, true);
    assert.equal(examples.protectedExisting, true);
    for (const example of examples.generated) {
      assert.match(example.sql[0], /CREATE TABLE/);
      assert.match(example.sql[1], new RegExp('^' + example.kind.toUpperCase()));
      assert.equal(example.sql[2].startsWith('SELECT'), example.kind !== 'select');
      assert.equal(example.integrity, example.kind === 'select');
      assert.equal(example.disabled, true);
    }
    console.log('PASS: all four anonymous examples set SQL and integrity mode and never overwrite existing author SQL');

    await page.evaluate(() => {window.rejectWorker = true; document.getElementById('qpisql-schema-load').click();});
    assert.equal(await page.locator('#qpisql-schema-load').isEnabled(), true);
    assert.equal(await page.locator('#qpisql-schema-cancel').isHidden(), true);
    assert.match(await page.locator('#qpisql-schema-status').innerText(), /Worker blocked/);
    assert.deepEqual(errors, []);
    console.log('PASS: schema worker construction failures restore usable controls and show an error');
  } finally {
    await page.close();
  }
}

async function main() {
  const browser = await chromium.launch({headless: true,
    ...(process.env.ILIAS_CHROME_CHANNEL ? {channel: process.env.ILIAS_CHROME_CHANNEL} : {})});
  console.log(`Browser: ${await browser.version()} (${process.env.ILIAS_CHROME_CHANNEL || 'Chromium'})`);
  const bundle = fs.readFileSync(path.resolve(__dirname, '../../lib/codemirror/codemirror_sqlquestion.bundle.js'), 'utf8');
  try {
    for (const [platform, shortcut] of [['Linux x86_64', 'Control+Enter'], ['MacIntel', 'Meta+Enter']]) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.setContent('<form><textarea id="sql">SELECT 1;</textarea><textarea id="solution">SELECT 2;</textarea></form>');
        await page.evaluate(platform => {
          Object.defineProperty(navigator, 'platform', {value: platform, configurable: true});
          window.executions = 0;
          window.changes = 0;
          window.submits = 0;
          window.EXECUTE_HANDLER = {execute: () => window.executions++};
          document.querySelector('form').addEventListener('submit', event => {window.submits++; event.preventDefault();});
        }, platform);
        await page.addScriptTag({content: bundle});
        await page.evaluate(() => {
          window.editor = codemirror_sqlquestion.editorFromTextArea(document.getElementById('sql'), () => window.changes++, false);
          window.solution = codemirror_sqlquestion.editorFromTextArea(document.getElementById('solution'), () => window.changes++, true);
          window.editor.codeMirrorView.focus();
        });
        await page.keyboard.press(shortcut);
        assert.deepEqual(await page.evaluate(() => ({
          sql: window.editor.getValue(), hidden: document.getElementById('sql').value,
          executions: window.executions, changes: window.changes, submits: window.submits
        })), {sql: 'SELECT 1;', hidden: 'SELECT 1;', executions: 1, changes: 0, submits: 0});

        await page.evaluate(() => window.solution.codeMirrorView.focus());
        await page.keyboard.press(shortcut);
        assert.equal(await page.evaluate(() => window.executions), 1);
        assert.equal(await page.evaluate(() => window.solution.getValue()), 'SELECT 2;');
        console.log(`PASS: ${shortcut} executes exactly once, preserves SQL and ignores read-only solutions (${platform})`);

        await page.evaluate(() => {
          window.editor.setValue('SELECT * FROM pe');
          window.editor.setAssistance(true, {people: ['id', 'name']});
          window.editor.codeMirrorView.dispatch({selection: {anchor: window.editor.getValue().length}});
          window.editor.codeMirrorView.focus();
        });
        await page.keyboard.press('Control+Space');
        await page.locator('.cm-tooltip-autocomplete').waitFor();
        assert.match(await page.locator('.cm-tooltip-autocomplete').innerText(), /people/);
        await page.evaluate(() => window.editor.setAssistance(false));
        await page.locator('.cm-tooltip-autocomplete').waitFor({state: 'detached'});
        assert.equal(await page.evaluate(() => window.editor.getValue()), 'SELECT * FROM pe');
        assert.equal(await page.locator('#sql').inputValue(), 'SELECT * FROM pe');
        assert.deepEqual(errors, []);
        console.log(`PASS: opt-in schema completion suggests tables and can be disabled without changing SQL (${platform})`);
      } finally {
        await page.close();
      }
    }
    await testHelper(browser, bundle);
  } finally {
    await browser.close();
  }
}

main().catch(error => {console.error(error); process.exitCode = 1;});
