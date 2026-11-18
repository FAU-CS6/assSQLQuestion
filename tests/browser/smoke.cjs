const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
const editURL = process.env.ILIAS_EDIT_URL;
const previewURL = process.env.ILIAS_PREVIEW_URL;
const password = process.env.ILIAS_TEST_PASSWORD;
const pluginPath = '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion';
const artifacts = process.env.ILIAS_TEST_ARTIFACTS || path.join(require('node:os').tmpdir(), 'asssql-private-artifacts', 'chrome-smoke');

async function main() {
  assert.ok(editURL && previewURL && password, 'Set ILIAS_EDIT_URL, ILIAS_PREVIEW_URL and ILIAS_TEST_PASSWORD for the disposable test instance.');
  fs.mkdirSync(artifacts, { recursive: true });
  let proxy;
  // Docker can forward the configured localhost URL to the ILIAS service while
  // preserving the Host header checked by ILIAS's allowed_hosts configuration.
  if (process.env.ILIAS_PROXY_TARGET) {
    const target = new URL(process.env.ILIAS_PROXY_TARGET);
    proxy = http.createServer((request, response) => {
      const upstream = http.request({ hostname: target.hostname, port: target.port || 80,
        path: request.url, method: request.method, headers: request.headers }, result => {
        response.writeHead(result.statusCode, result.headers);
        result.pipe(response);
      });
      upstream.on('error', error => { response.writeHead(502); response.end(error.message); });
      request.pipe(upstream);
    });
    await new Promise(resolve => proxy.listen(new URL(base).port || 80, '127.0.0.1', resolve));
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.setDefaultTimeout(15000);
  const pageErrors = [];
  const failedPluginRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('response', response => {
    if (response.url().includes(pluginPath) && response.status() >= 400) {
      failedPluginRequests.push(`${response.status()} ${response.url()}`);
    }
  });
  const setSequence = async (name, sql) => {
    await page.evaluate(({ name, sql }) => {
      const adapter = window[`editor_${name}`];
      const view = adapter.codeMirrorView;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } });
    }, { name, sql });
  };
  const execute = async () => {
    await page.locator('#qpisql-execute-button').click();
    await page.waitForFunction(() => document.querySelector('#qpisql-executed-bool').value === 'true'
      || document.querySelector('#qpisql-error-bool').value === 'true');
  };

  try {
    await page.goto(`${base}/login.php?client_id=default`);
    await page.locator('input[name^="login_form/"][type="text"]').fill('root');
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: 'Login', exact: true }).click();
    await page.goto(new URL(editURL, base).href);
    await page.waitForFunction(() => document.querySelectorAll('.cm-editor').length === 3);
    await page.waitForFunction(() => document.querySelector('.js-is-loading').style.display === 'none');
    console.log('PASS: ILIAS login and SQL authoring form with three CodeMirror editors');

    const query = 'SELECT name FROM people WHERE id >= 2;';
    await setSequence('sequence_b', query);
    assert.equal(await page.locator('#sequence_b').inputValue(), query);
    assert.equal(await page.evaluate(() => new FormData(document.querySelector('#sequence_b').form).get('sequence_b')), query);
    assert.equal(await page.locator('#qpisql-executed-bool').inputValue(), 'false');
    console.log('PASS: edits reach the serialized form immediately and invalidate stale results');

    await execute();
    assert.equal(await page.locator('#qpisql-error-bool').inputValue(), 'false');
    assert.match(await page.locator('#qpisql-output-area-relation').innerText(), /Grace/);
    assert.equal(await page.locator('[name="value_result_lines"]').inputValue(), '1');
    assert.equal(await page.locator('[name="value_column_names"]').inputValue(), '["name"]');
    console.log('PASS: SQLite worker executes SQL and updates scoring metrics');

    await setSequence('sequence_b', 'SELECT missing_column FROM people;');
    await execute();
    assert.equal(await page.locator('#qpisql-error-bool').inputValue(), 'true');
    assert.match(await page.locator('#qpisql-error').inputValue(), /SQLRunErrorRunningSequence/);
    console.log('PASS: SQL errors are displayed');

    await page.locator('#qpisql-integrity-check').check();
    await setSequence('sequence_b', "UPDATE people SET name = 'Updated';");
    await execute();
    assert.match(await page.locator('#qpisql-error').inputValue(), /SQLRunErrorIntegrityCheck/);
    await page.locator('#qpisql-integrity-check').uncheck();
    await setSequence('sequence_c', 'SELECT name FROM people;');
    await execute();
    assert.match(await page.locator('#qpisql-output-area-relation').innerText(), /Updated/);
    console.log('PASS: integrity checking and modifying SQL followed by sequence C');

    await setSequence('sequence_b', query);
    await setSequence('sequence_c', '');
    await execute();
    await page.locator('[name="cmd[save]"]').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.cm-editor').length === 3);
    assert.equal(await page.locator('#sequence_b').inputValue(), query);
    assert.equal(await page.locator('#qpisql-executed-bool').inputValue(), 'true');
    await page.screenshot({ path: path.join(artifacts, 'ilias11-editor.png'), fullPage: true });
    console.log('PASS: saving and reloading the question preserve SQL and results');

    await page.goto(new URL(previewURL, base).href);
    await page.waitForFunction(() => document.querySelectorAll('.cm-editor').length === 1);
    await setSequence('sequence_b', query);
    await execute();
    assert.match(await page.locator('#qpisql-output-area-relation').innerText(), /Grace/);
    await page.locator('[name="cmd[instantResponse]"]').click();
    await page.waitForFunction(() => document.body.innerText.includes('You received 5 of 5 possible points'));
    assert.equal(await page.locator('#sequence_b').inputValue(), query);
    assert.equal(await page.locator('textarea[id^="sequence_b_"]').first().inputValue(), query);
    await setSequence('sequence_b', 'SELECT name FROM people WHERE id = 1;');
    await execute();
    assert.match(await page.locator('#qpisql-output-area-relation').innerText(), /Ada/);
    await page.screenshot({ path: path.join(artifacts, 'ilias11-preview.png'), fullPage: true });
    console.log('PASS: participant preview submits, restores and grades the answer, then allows further SQL execution alongside the model solution');

    await page.goto(`${base}${pluginPath}/js/tests/SpecRunner.html`);
    const result = page.locator('.jasmine-overall-result');
    await result.waitFor();
    const jasmineResult = await result.innerText();
    assert.match(jasmineResult, /0 failures/);
    console.log(`PASS: existing Jasmine tests: ${jasmineResult.trim()}`);

    // Worker SQL errors are handled in the error UI and prevented from becoming uncaught page errors.
    assert.deepEqual(pageErrors, [], 'Unexpected JavaScript errors');
    assert.deepEqual(failedPluginRequests, [], 'Failed plugin asset requests');
    console.log('PASS: no unexpected JavaScript errors or failed plugin assets');
  } catch (error) {
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
    console.error('Browser URL:', page.url());
    console.error('Frames:', page.frames().map(frame => frame.url()));
    console.error('Page text:', (await page.locator('body').innerText()).slice(0, 2000));
    console.error('JavaScript errors:', pageErrors);
    throw error;
  } finally {
    await browser.close();
    if (proxy) await new Promise(resolve => proxy.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
