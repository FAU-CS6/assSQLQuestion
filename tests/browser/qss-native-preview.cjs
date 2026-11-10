/* Actual teacher editing and native preview, with private existing pool data. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const mutations = require('../qss/fixture-mutations.cjs');
const base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
const directory = process.env.ILIAS_CORPUS_DIRECTORY || '/tmp/asssql-pool-corpus';
const out = path.resolve(process.env.QSS_REPORT_DIRECTORY || 'test-results/qss/native-preview');
const prefix = process.env.ILIAS_CORPUS_EXAM_PREFIX || '';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
async function main() {
  fs.mkdirSync(out, { recursive: true, mode: 0o700 });
  const accounts = JSON.parse(fs.readFileSync(process.env.ILIAS_CHROME_STATE || '/tmp/asssql-chrome-accounts.json', 'utf8'));
  const exam = JSON.parse(fs.readFileSync(path.join(directory, prefix + 'exam-state.json'), 'utf8'));
  const transfer = JSON.parse(fs.readFileSync(path.join(directory, 'teacher-transfer-report.json'), 'utf8'));
  const runtime = fs.readFileSync(path.join(directory, prefix + 'exam-runtime.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const selected = runtime.find(row => row.maximum_points >= 2
    && mutations.errorCandidates(row.sequences[1]).some(candidate => ['literal', 'comparison'].includes(candidate.kind)));
  assert.ok(selected, 'Use an existing question worth at least two points with a one-edit mutation.');
  const teacherPool = transfer.pools.find(pool => pool.key === selected.pool);
  assert.ok(teacherPool);
  const editURL = new URL(exam.role_check_urls.edit_url, base);
  // Existing native fixtures may refer to an earlier teacher-owned import than
  // the latest transfer report. Its role-check URL identifies the first pool.
  const poolRef=selected.original_pool_ref_id
    ||(selected.pool===runtime[0].pool?editURL.searchParams.get('ref_id'):teacherPool.pool_ref_id);
  editURL.searchParams.set('ref_id', String(poolRef));
  editURL.searchParams.set('q_id', String(selected.original_question_id));
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
      feedback: [...document.querySelectorAll('#qpisql-qss-shadow li')].map(item => item.textContent),
      labels: document.getElementById('qpisql-qss-shadow').textContent }));
  };
  try {
    await page.goto(base + '/login.php?client_id=default');
    await page.locator('input[name^="login_form/"][type="text"]').fill(accounts.teacher.login);
    await page.locator('input[type="password"]').fill(accounts.teacher.password);
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.getByRole('button', { name: /^(Login|Anmelden)$/ }).click()]);
    await page.goto(editURL.href);
    await page.waitForFunction(() => window.editor_sequence_b && document.querySelectorAll('.cm-editor').length === 3);
    const userAgent = await page.evaluate(() => navigator.userAgent);
    assert.match(userAgent, /HeadlessChrome\//);
    const workerURL = base + '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/lib/qss/worker.qss.js';
    const worker = await context.request.get(workerURL);
    assert.ok(worker.ok());
    const workerHash = hash(await worker.body());
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
    assert.ok(config.maxPoints >= 2, 'The selected native preview permits positive partial credit.');
    assert.equal(config.engine, 'graph-qss-sqlite-v2');
    const set = sql => page.evaluate(sql => {
      const view = window.editor_sequence_b.codeMirrorView;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } });
    }, sql);
    await set(config.referenceSql + '\n-- equivalent formatting for QSS preview\n');
    const equivalent = await run();
    assert.equal(equivalent.evaluation.status, 'exact'); assert.equal(equivalent.evaluation.distance, 0);
    assert.equal(equivalent.evaluation.points, config.maxPoints); assert.equal(equivalent.relationVisible, 'block');
    await page.screenshot({ path: path.join(out, 'teacher-preview-equivalent.png'), fullPage: true });
    const candidate = mutations.errorCandidates(config.referenceSql)
      .find(value => ['literal', 'comparison'].includes(value.kind));
    assert.ok(candidate);
    await set(candidate.answer);
    const oneEdit = await run();
    assert.equal(oneEdit.evaluation.status, 'exact');
    assert.equal(oneEdit.evaluation.distance, 1);
    assert.ok(oneEdit.evaluation.points > 0 && oneEdit.evaluation.points < config.maxPoints);
    assert.equal(oneEdit.evaluation.points, config.maxPoints - config.scale);
    assert.ok(oneEdit.evaluation.edits.length > 0);
    assert.equal(oneEdit.evaluation.edits.reduce((total, edit) => total + edit.cost, 0), 1);
    assert.ok(oneEdit.evaluation.edits.every(edit => edit.name && edit.description));
    assert.equal(oneEdit.feedback.length, oneEdit.evaluation.edits.length);
    for (const edit of oneEdit.evaluation.edits) {
      assert.ok(oneEdit.feedback.some(text => text.includes(edit.description) && text.includes(String(edit.cost))));
    }
    await page.locator('#qpisql-qss-shadow details > summary').click();
    await page.locator('#qpisql-qss-shadow li').first().waitFor({state: 'visible'});
    await page.screenshot({ path: path.join(out, 'teacher-preview-one-edit-feedback.png'), fullPage: true });
    await set('SELECT 999 AS qss_wrong_answer;');
    const wrong = await run();
    assert.ok(['exact', 'score-zero-certified'].includes(wrong.evaluation.status),
      'A parsable student B remains statically gradable even if the independent C fails');
    assert.ok(wrong.evaluation.points < config.maxPoints);
    assert.equal(wrong.evaluation.engine, 'graph-qss-sqlite-v2');
    assert.equal(wrong.stopped, true);
    await page.screenshot({ path: path.join(out, 'teacher-preview-wrong.png'), fullPage: true });
    await set(config.referenceSql);
    const repeated = await run();
    assert.equal(repeated.evaluation.distance, 0); assert.equal(repeated.evaluation.points, config.maxPoints); assert.equal(repeated.stopped, true);
    const finalWorker = await context.request.get(workerURL);
    const workerUnchanged = finalWorker.ok() && hash(await finalWorker.body()) === workerHash;
    assert.equal(workerUnchanged, true);
    assert.deepEqual(errors, []);
    const report = { browser: await browser.version(), user_agent: userAgent, headless: true,
      worker_sha256: workerHash, worker_unchanged: workerUnchanged,
      teacher_id: accounts.teacher.id, author: author.evaluation,
      equivalent: equivalent.evaluation, one_edit: { mutation_kind: candidate.kind, evaluation: oneEdit.evaluation,
        sql_error_flag: oneEdit.error, feedback: oneEdit.feedback },
      wrong: wrong.evaluation, repeated: repeated.evaluation, page_errors: errors };
    fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ teacher_id: accounts.teacher.id, author: 'passed', preview_runs: 4, correct_distance: 0,
      one_edit_distance: oneEdit.evaluation.distance, one_edit_points: oneEdit.evaluation.points,
      wrong_points: wrong.evaluation.points, max_points: config.maxPoints, page_errors: errors }));
  } finally { await context.close(); }
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
