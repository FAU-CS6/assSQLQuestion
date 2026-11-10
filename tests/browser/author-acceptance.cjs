/* Native author acceptance against a disposable ILIAS client.
 * Uses an isolated headless instance of installed Google Chrome by default.
 * Account passwords/storage remain in private files; only anonymous examples are created.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const accounts = JSON.parse(fs.readFileSync(process.env.ILIAS_CHROME_ACCOUNTS || '/tmp/asssql-chrome-accounts.json', 'utf8'));
const storageFile = process.env.ILIAS_TEACHER_STORAGE || '/tmp/asssql-teacher-storage.json';
const base = accounts.base_url || 'http://localhost:8080';
const artifacts = path.resolve(process.env.ILIAS_TEST_ARTIFACTS || path.join(require('node:os').tmpdir(), 'asssql-private-artifacts', 'chrome-author-runner'));
const reportFile = path.join(artifacts, 'author-acceptance-report.json');
const title = 'Anonymous SQL author acceptance';
const report = { format: 1, teacher_user_id: accounts.teacher.id, account: accounts.teacher.login,
  category_ref_id: accounts.category_ref_id, checks: {} };
fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 });
fs.chmodSync(artifacts, 0o700);
const saveReport = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });

async function main() {
  assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Use a disposable local ILIAS client.');
  const browser = process.env.ILIAS_CHROME_CDP
    ? await chromium.connectOverCDP(process.env.ILIAS_CHROME_CDP)
    : await chromium.launch({ channel: process.env.ILIAS_CHROME_CHANNEL || 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 },
    ...(fs.existsSync(storageFile) ? { storageState: storageFile } : {}) });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  report.browser = await browser.version();
  report.mode = 'installed-google-chrome-headless';
  const ready = async () => {
    await page.waitForFunction(() => window.editor_sequence_b && document.querySelectorAll('.cm-editor').length === 3);
    await page.waitForFunction(() => !document.querySelector('.js-is-loading') || document.querySelector('.js-is-loading').style.display === 'none');
  };
  const setSQL = async (name, sql) => {
    await page.evaluate(({ name, sql }) => window['editor_' + name].setValue(sql), { name, sql });
  };
  const clearSQL = async () => { for (const name of ['sequence_a', 'sequence_b', 'sequence_c']) await setSQL(name, ''); };
  const snapshot = async () => page.evaluate(() => ['sequence_a', 'sequence_b', 'sequence_c'].map(name => window['editor_' + name].getValue()));
  const waitExecution = async () => {
    await page.waitForFunction(() => document.getElementById('qpisql-executed-bool').value === 'true'
      || document.getElementById('qpisql-error-bool').value === 'true');
    assert.equal(await page.locator('#qpisql-error-bool').inputValue(), 'false', await page.locator('#qpisql-output-area-error').textContent());
    assert.equal(await page.locator('#qpisql-executed-bool').inputValue(), 'true');
    return JSON.parse(await page.locator('#qpisql-output-relation').inputValue());
  };
  const execute = async () => { await page.locator('#qpisql-execute-button').click(); return waitExecution(); };

  try {
    await page.goto(`${base}/goto.php/cat/${accounts.category_ref_id}`);
    if (await page.locator('input[type=password]').count()) {
      await page.locator('input[name^="login_form/"][type=text]').fill(accounts.teacher.login);
      await page.locator('input[type=password]').fill(accounts.teacher.password);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      await page.goto(`${base}/goto.php/cat/${accounts.category_ref_id}`);
    }
    await page.goto(`${base}/ilias.php?baseClass=ilrepositorygui&cmd=create&ref_id=${accounts.category_ref_id}&new_type=qpl`);
    await page.getByRole('textbox', { name: 'Title', exact: false }).fill('Anonymous SQL author acceptance pool');
    await page.getByRole('button', { name: 'Add Question Pool for Tests', exact: true }).click();
    await page.getByRole('button', { name: 'Create Question', exact: true }).waitFor();
    report.pool_ref_id = Number(new URL(page.url()).searchParams.get('ref_id'));
    await page.getByRole('button', { name: 'Create Question', exact: true }).click();
    await page.getByRole('combobox', { name: 'Question Type', exact: false }).selectOption({ label: 'Interactive SQL Question' });
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await ready();
    await page.locator('#title').fill(title);
    const author = page.locator('[name="author"]');
    if (!(await author.inputValue()).trim()) await author.fill('Anonymous acceptance lecturer');
    await page.evaluate(() => {
      const field = document.querySelector('[name="question"]');
      const editor = window.tinyMCE?.get(field.id);
      if (editor) { editor.setContent('<p>Work with the anonymous example database.</p>'); editor.save(); }
      else { field.value = 'Work with the anonymous example database.'; field.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    for (const details of await page.locator('#qpisql-editor-help details').all()) {
      if (!(await details.getAttribute('open'))) await details.locator('summary').click();
    }

    report.checks.examples = [];
    for (const [kind, expectedRows] of [['select', 2], ['update', 2], ['delete', 1], ['insert', 3]]) {
      await clearSQL();
      await page.locator('#qpisql-example').selectOption(kind);
      assert.equal(await page.locator('#qpisql-example-apply').isEnabled(), true);
      await page.locator('#qpisql-example-apply').click();
      assert.equal(await page.locator('#qpisql-integrity-check').isChecked(), kind === 'select');
      const sql = await snapshot();
      const result = await execute();
      assert.equal(result.values.length, expectedRows, kind);
      assert.equal(await page.locator('[name="value_result_lines"]').inputValue(), String(expectedRows));
      await page.locator('#qpisql-example').selectOption(kind === 'select' ? 'update' : 'select');
      assert.equal(await page.locator('#qpisql-example-apply').isDisabled(), true);
      assert.deepEqual(await snapshot(), sql, 'Selecting an example must not overwrite existing SQL.');
      report.checks.examples.push({ kind, rows: expectedRows, integrity: kind === 'select', preserved_existing_sql: true });
      console.log(`PASS: native author example ${kind}: ${expectedRows} rows and correct integrity mode`);
    }

    await page.locator('#qpisql-editor-assistance').check();
    const beforeSchema = await snapshot();
    await page.locator('#qpisql-schema-load').click();
    await page.waitForFunction(() => !document.getElementById('qpisql-schema-load').disabled
      && document.querySelectorAll('#qpisql-schema-tables li').length > 0);
    assert.match(await page.locator('#qpisql-schema-tables').innerText(), /scores.*id.*name.*points/);
    assert.deepEqual(await page.evaluate(() => window.editor_sequence_b.schema.scores), ['id', 'name', 'points']);
    assert.deepEqual(await snapshot(), beforeSchema);
    report.checks.schema_from_preparation = true;

    await setSQL('sequence_c', '');
    const keyboardSQL = 'SELECT name, points FROM scores ORDER BY id;';
    await setSQL('sequence_b', keyboardSQL);
    await page.evaluate(() => window.editor_sequence_b.codeMirrorView.focus());
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
    assert.equal((await waitExecution()).values.length, 2);
    assert.equal(await page.locator('#sequence_b').inputValue(), keyboardSQL);
    report.checks.shortcut_preserves_sql = true;
    console.log('PASS: opt-in schema from preparation and native execute shortcut preserve SQL');

    await clearSQL();
    const infiniteSQL = 'WITH RECURSIVE counter(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM counter) SELECT SUM(value) FROM counter;';
    await setSQL('sequence_b', infiniteSQL);
    await page.locator('#qpisql-integrity-check').check();
    await page.locator('#qpisql-execute-button').click();
    await page.locator('#qpisql-cancel-button').waitFor({ state: 'visible' });
    // Test automation presses the manual button after a known observation period.
    // The application has no automatic SQL execution timeout.
    await page.waitForTimeout(1500);
    await page.locator('#qpisql-cancel-button').click();
    assert.equal(JSON.parse(await page.locator('#qpisql-error').inputValue()).errorType, 'SQLRunErrorCancelled');
    assert.equal(await page.locator('#sequence_b').inputValue(), infiniteSQL);
    assert.equal(await page.evaluate(() => window.editor_sequence_b.codeMirrorView.state.readOnly), false);
    assert.equal(await page.locator('#qpisql-execute-button').isEnabled(), true);
    await setSQL('sequence_b', 'SELECT 7 AS value;');
    assert.deepEqual((await execute()).values, [[7]]);
    report.checks.manual_cancel = { observation_ms: 1500, sql_retained: true, editor_reusable: true };
    console.log('PASS: manual cancellation of infinite SQL retains text and permits a successful next execution');

    await page.evaluate(() => { window.__qpisql_injected = false; });
    const htmlSQL = `SELECT '<img src=x onerror=window.__qpisql_injected=true>' AS "<unsafe>", NULL AS missing, '' AS empty;`;
    await setSQL('sequence_b', htmlSQL);
    const safe = await execute();
    assert.deepEqual(safe.columns, ['<unsafe>', 'missing', 'empty']);
    assert.equal(await page.locator('#qpisql-output-area-relation img, #qpisql-output-area-relation svg, #qpisql-output-area-relation script, #qpisql-output-area-relation unsafe').count(), 0);
    assert.equal(await page.evaluate(() => window.__qpisql_injected), false);
    assert.match(await page.locator('#qpisql-output-area-relation').innerText(), /<img src=x/);
    assert.deepEqual(await page.locator('#qpisql-output-area-relation .qpisql-special-value').allTextContents(), ['NULL', "''"]);
    report.checks.untrusted_result_values_are_text = true;

    const boundedSQL = 'WITH RECURSIVE counter(value) AS (SELECT 1 UNION ALL SELECT value + 1 FROM counter WHERE value < 201) SELECT value FROM counter;';
    await setSQL('sequence_b', boundedSQL);
    assert.equal((await execute()).values.length, 201);
    const resultRows = page.locator('#qpisql-output-area-relation tbody tr');
    assert.equal(await resultRows.count(), 100);
    assert.match(await page.locator('#qpisql-output-area-relation .qpisql-result-summary').innerText(), /Rows 1[–-]100 of 201/);
    const pages = page.locator('#qpisql-output-area-relation .qpisql-result-pages button');
    await pages.nth(1).click();
    assert.equal(await resultRows.count(), 100);
    await pages.nth(1).click();
    assert.equal(await resultRows.count(), 1);
    assert.equal(await resultRows.locator('td').innerText(), '201');
    assert.equal(JSON.parse(await page.locator('#qpisql-output-relation').inputValue()).values.length, 201);
    assert.equal(await page.locator('[name="value_result_lines"]').inputValue(), '201');
    await pages.nth(0).click(); await pages.nth(0).click();
    report.checks.pagination = { stored_rows: 201, displayed_rows_per_page: 100, pages: 3, numeric_caption: true };
    await page.locator('[name="points_result_lines"]').selectOption('1');
    await page.locator('[name="points_column_names"]').selectOption('1');
    await page.locator('[name="points_functional_dependencies"]').selectOption('0');
    await page.screenshot({ path: path.join(artifacts, 'before-save.png'), fullPage: true });
    await page.locator('[name="cmd[save]"]').first().click();
    await ready();
    const action = await page.locator('form[id*="qpisql"]').getAttribute('action');
    const edit = new URL(action, base);
    report.question_id = Number(edit.searchParams.get('q_id'));
    assert.ok(report.question_id > 0, 'Read the created question ID from the updated form action.');
    edit.searchParams.set('cmd', 'editQuestion');
    edit.searchParams.delete('fallbackCmd');
    await page.goto(edit.href);
    await ready();
    assert.equal(await page.locator('#title').inputValue(), title);
    assert.equal(await page.locator('#qpisql-editor-assistance').isChecked(), true);
    assert.equal(await page.locator('#sequence_b').inputValue(), boundedSQL);
    assert.equal(await page.locator('#qpisql-executed-bool').inputValue(), 'true');
    assert.equal(JSON.parse(await page.locator('#qpisql-output-relation').inputValue()).values.length, 201);
    assert.match(await page.locator('#qpisql-output-area-relation .qpisql-result-summary').innerText(), /Rows 1[–-]100 of 201/);
    await page.screenshot({ path: path.join(artifacts, 'saved-and-reloaded.png'), fullPage: true });
    report.checks.native_save_and_get_reload = true;
    assert.deepEqual(pageErrors, [], 'No unexpected JavaScript errors during native author acceptance.');
    report.completed = true;
    report.completed_at = new Date().toISOString();
    saveReport();
    await context.storageState({ path: storageFile }); fs.chmodSync(storageFile, 0o600);
    console.log(`PASS: native save and GET reload preserve assistance, SQL and all 201 grading rows; question ${report.question_id}`);
  } catch (error) {
    report.completed = false; report.error = error.message; saveReport();
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
    console.error('Author acceptance failed at', page.url());
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
