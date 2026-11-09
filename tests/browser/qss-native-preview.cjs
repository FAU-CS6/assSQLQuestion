/* Actual teacher editing and native preview, with private existing pool data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
const directory = process.env.ILIAS_CORPUS_DIRECTORY || '/tmp/asssql-pool-corpus';
const out = path.resolve(process.env.QSS_REPORT_DIRECTORY || 'test-results/qss/native-preview');
async function main() {
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const accounts = JSON.parse(fs.readFileSync(process.env.ILIAS_CHROME_STATE || '/tmp/asssql-chrome-accounts.json', 'utf8'));
  const exam = JSON.parse(fs.readFileSync(path.join(directory, 'exam-state.json'), 'utf8'));
  const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL || 'http://127.0.0.1:9235');
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const run = async () => {
    await page.locator('#qpisql-execute-button').click();
    await page.waitForFunction(() => !window.EXECUTE_HANDLER.running, null, { timeout: 0 });
    return page.evaluate(() => ({ evaluation: JSON.parse(document.getElementById('qpisql-qss-evaluation').value),
      error: document.getElementById('qpisql-error-bool').value, relationVisible: document.getElementById('qpisql-output-area-relation').style.display,
      stopped: window.EXECUTE_HANDLER.activeRun === null && window.EXECUTE_HANDLER.qss.worker === null,
      labels: document.getElementById('qpisql-qss-shadow').textContent }));
  };
  try {
    await page.goto(base + '/login.php?client_id=default');
    await page.locator('input[name^="login_form/"][type="text"]').fill(accounts.teacher.login);
    await page.locator('input[type="password"]').fill(accounts.teacher.password);
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.getByRole('button', { name: /^(Login|Anmelden)$/ }).click()]);
    await page.goto(new URL(exam.role_check_urls.edit_url, base).href);
    await page.waitForFunction(() => window.editor_sequence_b && document.querySelectorAll('.cm-editor').length === 3);
    const author = await run();
    assert.equal(author.error, 'false'); assert.equal(author.evaluation.status, 'exact');
    assert.equal(author.evaluation.points, author.evaluation.maxPoints); assert.equal(author.evaluation.distance, 0); assert.equal(author.stopped, true);
    assert.doesNotMatch(author.labels, /-qss_[a-z]+-/);
    await page.screenshot({ path: path.join(out, 'teacher-author.png'), fullPage: true });
    const weights = page.locator('select[name^="points_"]');
    const originalWeight = await weights.first().inputValue();
    const alternatives = await weights.first().locator('option').evaluateAll(options => options.map(option => option.value));
    const changedWeight = alternatives.find(value => Number(value) > Number(originalWeight));
    assert.ok(changedWeight, 'Authoring form exposes editable scoring weights');
    await weights.first().selectOption(changedWeight);
    const changed = await run();
    const actualMaximum = await weights.evaluateAll(selects => selects.reduce((sum, select) => sum + Number(select.value), 0));
    assert.equal(changed.evaluation.maxPoints, actualMaximum, 'Parallel authoring points follow unsaved select changes');
    await weights.first().selectOption(originalWeight);
    const preview = await page.locator('a[href*="ilassquestionpreviewgui" i]').first().getAttribute('href');
    assert.ok(preview, 'Native teacher preview tab must exist');
    await page.goto(new URL(preview, base).href);
    await page.waitForFunction(() => window.editor_sequence_b && document.getElementById('qpisql-qss-config'));
    const config = await page.evaluate(() => QSSShadow.configuration());
    assert.equal(config.context, 'participant');
    const set = sql => page.evaluate(sql => {
      const view = window.editor_sequence_b.codeMirrorView;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } });
    }, sql);
    await set(config.referenceSql + '\n-- equivalent formatting for QSS preview\n');
    const equivalent = await run();
    assert.equal(equivalent.evaluation.status, 'exact'); assert.equal(equivalent.evaluation.distance, 0);
    assert.equal(equivalent.evaluation.points, config.maxPoints); assert.equal(equivalent.relationVisible, 'block');
    await page.screenshot({ path: path.join(out, 'teacher-preview-equivalent.png'), fullPage: true });
    await set('SELECT 999 AS qss_wrong_answer;');
    const wrong = await run();
    if (wrong.error === 'true') {
      assert.equal(wrong.evaluation.status, 'unsupported');
      assert.equal(wrong.evaluation.points, null, 'Known SQL pipeline errors have no invented shadow score');
    } else {
      assert.ok(['exact', 'score-zero-certified'].includes(wrong.evaluation.status));
      assert.ok(wrong.evaluation.points < config.maxPoints);
    }
    assert.equal(wrong.stopped, true);
    await page.screenshot({ path: path.join(out, 'teacher-preview-wrong.png'), fullPage: true });
    await set(config.referenceSql);
    const repeated = await run();
    assert.equal(repeated.evaluation.distance, 0); assert.equal(repeated.evaluation.points, config.maxPoints); assert.equal(repeated.stopped, true);
    assert.deepEqual(errors, []);
    const report = { browser: await browser.version(), teacher_id: accounts.teacher.id, author: author.evaluation,
      equivalent: equivalent.evaluation, wrong: wrong.evaluation, repeated: repeated.evaluation, page_errors: errors };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ teacher_id: accounts.teacher.id, author: 'passed', preview_runs: 3, correct_distance: 0,
      wrong_points: wrong.evaluation.points, max_points: config.maxPoints, page_errors: errors }));
  } finally { await context.close(); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
