/* Exhaustive, opt-in REAL Chrome + regular student-exam regression for private pools.
 * Requires native imports from tests/ilias11/pool-corpus.php and an authenticated
 * disposable Chrome profile exposed over CDP. No execution deadline is imposed.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { chromium } = require('playwright');

const base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
const directory = path.resolve(process.env.ILIAS_CORPUS_DIRECTORY || '/corpus');
// Use installed Google Chrome without visible windows by default.
const cdp = process.env.CHROME_CDP_URL || 'http://localhost:9223';
const pluginPath = '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion';
const prefix = process.env.ILIAS_CORPUS_EXAM_PREFIX || '';
const start = Number(process.env.ILIAS_CORPUS_START || 0);
const count = Number(process.env.ILIAS_CORPUS_COUNT || Infinity);
const verifyQSS = process.env.ILIAS_CORPUS_QSS === '1';
const canonical = value => JSON.stringify(value);
// Both legacy HTML textareas and CodeMirror use normalized browser newlines.
const normalizeSQL = sql => sql.replace(/\r\n?/g, '\n');
// The HTML parser ignores one initial LF immediately after a textarea start tag.
const normalizeHiddenTextareaSQL = sql => normalizeSQL(sql).replace(/^\n/, '');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');

/** Validate the native exam against original source keys before opening a test. */
async function examSourceCoverage(exam) {
  const keys = Object.keys(exam.questions);
  assert.ok(keys.length > 0, 'The native exam must contain questions.');
  const ids = Object.values(exam.questions).map(row => row.question_id);
  assert.ok(ids.every(id => Number.isSafeInteger(id) && id > 0), 'Native test question IDs must be positive integers.');
  assert.equal(new Set(ids).size, ids.length, 'Native test question IDs must be unique.');
  if (!Object.hasOwn(exam, 'source_start')) return { declared: false, expected_questions: keys.length };
  for (const field of ['source_start', 'source_count', 'source_end_exclusive', 'source_total_questions']) {
    assert.ok(Number.isSafeInteger(exam[field]) && exam[field] >= 0, `Invalid exam ${field}`);
  }
  assert.ok(exam.source_count > 0 && exam.source_total_questions > 0);
  assert.equal(exam.source_start + exam.source_count, exam.source_end_exclusive);
  assert.ok(exam.source_end_exclusive <= exam.source_total_questions);
  assert.equal(exam.source_count, keys.length, 'Declared source count matches this exam.');
  assert.equal(exam.source_keys_sha256, hash(canonical(keys)), 'Declared source-key coverage hash.');
  if (process.env.ILIAS_CORPUS_SOURCE_START !== undefined) {
    assert.match(process.env.ILIAS_CORPUS_SOURCE_START, /^(0|[1-9][0-9]*)$/);
    assert.equal(Number(process.env.ILIAS_CORPUS_SOURCE_START), exam.source_start, 'Requested source start matches the native exam.');
  }
  let originalKeys;
  if (exam.source_kind === 'teacher-owned-example') {
    originalKeys = ['example:1', 'example:2'];
    assert.equal(exam.source_total_questions, originalKeys.length);
    assert.equal(exam.source_questions_sha256, null);
  } else {
    assert.equal(exam.source_kind, 'original-corpus');
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
    assert.equal(exam.source_total_questions, manifest.questions, 'Declared total matches the complete source corpus.');
    const digest = crypto.createHash('sha256');
    const source = fs.createReadStream(path.join(directory, 'questions.jsonl'));
    source.on('data', chunk => digest.update(chunk));
    const lines = readline.createInterface({ input: source, crlfDelay: Infinity });
    originalKeys = [];
    for await (const line of lines) originalKeys.push(JSON.parse(line).key);
    assert.equal(originalKeys.length, manifest.questions);
    assert.equal(new Set(originalKeys).size, originalKeys.length, 'Original source keys must be unique.');
    assert.equal(digest.digest('hex'), exam.source_questions_sha256, 'The exam was seeded from this exact original corpus.');
    const originals = Object.values(exam.questions).map(row => row.original_question_id);
    assert.ok(originals.every(id => Number.isSafeInteger(id) && id > 0), 'Original teacher question IDs must be positive integers.');
    assert.equal(new Set(originals).size, originals.length, 'Original teacher questions must not be cloned within a range.');
  }
  assert.deepEqual(keys, originalKeys.slice(exam.source_start, exam.source_end_exclusive), 'Exact original source-key range in original order.');
  const runtime = readline.createInterface({ input: fs.createReadStream(path.join(directory, prefix + 'exam-runtime.jsonl')), crlfDelay: Infinity });
  let index = 0;
  for await (const line of runtime) {
    const row = JSON.parse(line);
    assert.equal(row.key, keys[index], 'Runtime row belongs to the exact selected source range.');
    assert.equal(row.original_source_ordinal, exam.source_start + index + 1, 'Runtime retains the original one-based source ordinal.');
    assert.deepEqual({ question_id: row.question_id, original_question_id: row.original_question_id, original_source_ordinal: row.original_source_ordinal }, exam.questions[row.key]);
    ++index;
  }
  assert.equal(index, keys.length, 'Every selected source has exactly one runtime row.');
  return { declared: true, source_kind: exam.source_kind, corpus_total_questions: exam.source_total_questions,
    source_start: exam.source_start, source_end_exclusive: exam.source_end_exclusive,
    expected_questions: keys.length, expected_source_keys_sha256: exam.source_keys_sha256,
    source_questions_sha256: exam.source_questions_sha256, completed_questions: 0, completed: false };
}

async function login(page, account) {
  await page.goto(`${base}/login.php?client_id=default`, { waitUntil: 'domcontentloaded' });
  if (await page.locator('input[type="password"]').count()) {
    assert.ok(account?.password, 'Provide the private synthetic student-account state.');
    await page.locator('input[name^="login_form/"][type="text"]').fill(account.login);
    await page.locator('input[type="password"]').fill(account.password);
    await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.getByRole('button', { name: /^(Login|Anmelden)$/ }).click()]);
  }
}

async function baselinePage(context) {
  const page = await context.newPage();
  await page.route(`${base}/__asssql_corpus_baseline__`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Previous plugin SQL baseline</title>' }));
  await page.goto(`${base}/__asssql_corpus_baseline__`);
  await page.evaluate(url => { window.QPISQL_URL_PATH = url; }, pluginPath);
  const scripts = [
    'SQL/class.SQLFunctionalDependency.js', 'SQL/class.SQLResult.js',
    'SQL/Errors/class.SQLRunErrorAbstract.js', 'SQL/Errors/class.SQLRunErrorDBCreation.js',
    'SQL/Errors/class.SQLRunErrorIntegrityCheck.js', 'SQL/Errors/class.SQLRunErrorNoExecution.js',
    'SQL/Errors/class.SQLRunErrorNoVisibleResult.js', 'SQL/Errors/class.SQLRunErrorRunningSequence.js',
    'SQL/class.SQLRun.js'
  ];
  for (const script of scripts) {
    await page.addScriptTag({ content: fs.readFileSync(path.join(directory, 'baseline/js/classes', script), 'utf8') });
  }
  return page;
}

async function executeBaseline(page, row) {
  return page.evaluate(({ sequences, integrity, output_relation, metrics }) => new Promise(resolve => {
    let run;
    const dispose = () => { if (run && run.worker) run.worker.terminate(); };
    const callback = {
      onResult(result) {
        dispose();
        resolve({ relation: JSON.parse(result.toJSON()), metrics: {
          result_lines: String(result.getNumberOfRows()),
          column_names: result.getColumnNamesAsJSON(),
          functional_dependencies: JSON.stringify(JSON.parse(result.toJSON())) === JSON.stringify(JSON.parse(output_relation))
            ? metrics.functional_dependencies.value : result.getAllMinimalFunctionalDependenciesAsJSON()
        } });
      },
      onError(error) {
        dispose();
        resolve({ error: JSON.parse(error.toJSON()) });
      }
    };
    run = new SQLRun(...sequences, integrity, callback);
  }), row);
}

async function waitForAutosave(page, sql, executed) {
  return page.waitForResponse(response => {
    if (!/[?&]test_answer_changed=/.test(response.url()) || response.status() !== 200) return false;
    const sent = new URLSearchParams(response.request().postData() || '');
    return normalizeSQL(sent.get('sequence_b') || '') === normalizeSQL(sql)
      && sent.get('executed_bool') === String(executed);
  }, { timeout: 30000 }).catch(async error => {
    console.log('OWN_AUTOSAVE_WAIT_DIAGNOSTIC', JSON.stringify(await page.evaluate(() => ({ status: document.getElementById('qpisql-save-status')?.textContent, executed: document.getElementById('qpisql-executed-bool')?.value, jquery: !!window.jQuery, handlers: (window.jQuery?._data(document, 'events')?.ajaxSuccess || []).map(h => h.namespace), passive: window.__corpusAjaxDiagnostic, config: [...document.scripts].flatMap(s => s.textContent.match(/autosaveInterval.{0,30}/g) || []), bindSource: OutputAreaOutput.prototype.bindAutosave.toString() }))));
    throw error;
  });
}

async function confirmSaved(page, saved) {
  try {
    await page.waitForFunction(label => document.getElementById('qpisql-save-status').textContent.startsWith(label + ' · '), saved);
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      saveStatus: document.getElementById('qpisql-save-status').textContent,
      jquery: !!window.jQuery,
      handlers: (window.jQuery?._data(document, 'events')?.ajaxSuccess || []).map(handler => handler.namespace),
      passive: window.__corpusAjaxDiagnostic,
      bindSource: OutputAreaOutput.prototype.bindAutosave.toString()
    }));
    console.log('OWN_STUDENT_AUTOSAVE_DIAGNOSTIC', JSON.stringify(diagnostic));
    throw error;
  }
}

async function waitNativeReady(page) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => typeof window.editor_sequence_b !== 'undefined'
    && getComputedStyle(document.body).pointerEvents !== 'none'
    && document.querySelector('.ilTstNavigationBtn_Next button:not([disabled]), .ilTstNavigationBtn_Prev button:not([disabled])'));
}

async function nativeIdentity(page, expectedSequence, expectedQuestionId, sequenceQuestionIds) {
  await waitNativeReady(page);
  const identity = await page.evaluate(() => {
    const url = new URL(location.href);
    const form = new URL(document.getElementById('taForm').action, location.href);
    const configSource = [...document.scripts].map(s => s.textContent).join('\n');
    const match = configSource.match(/"autosaveUrl"\s*:\s*("(?:\\.|[^"\\])*")/);
    const autosave = match ? new URL(JSON.parse(match[1]), location.href) : null;
    return { sequence: Number(url.searchParams.get('sequence')), form_sequence: Number(form.searchParams.get('sequence')),
      autosave_sequence: autosave ? Number(autosave.searchParams.get('sequence')) : null };
  });
  assert.equal(identity.sequence, expectedSequence, 'Actual native question URL sequence');
  assert.equal(identity.form_sequence, expectedSequence, 'Actual server-rendered question form sequence');
  assert.equal(identity.autosave_sequence, expectedSequence, 'Actual server-rendered autosave question sequence');
  identity.question_id = sequenceQuestionIds[identity.sequence - 1];
  assert.equal(identity.question_id, expectedQuestionId, 'Actual native sequence maps to this exact imported test question');
  return identity;
}

async function executeStudent(page, row, verifyAutosave) {
  await waitNativeReady(page);
  if (verifyAutosave) await page.evaluate(() => {
    window.__corpusAjaxDiagnostic = { installed: !!window.jQuery };
    if (!window.jQuery) return;
    window.jQuery(document).on('ajaxSuccess.corpusAcceptance', (event, xhr, settings) => {
      if (!/[?&]test_answer_changed=/.test(settings.url || '')) return;
      const sent = new URLSearchParams(settings.data || '');
      const normalize = value => String(value).replace(/\r\n?/g, '\n');
      window.__corpusAjaxDiagnostic = { response: xhr.responseText, fields: ['sequence_b', 'executed_bool', 'error_bool', 'error', 'output_relation'].map(name => {
        const input = document.querySelector(`[name="${name}"]`);
        return { name, inputLength: input?.value.length, sentLength: sent.get(name)?.length, equal: normalize(input?.value) === normalize(sent.get(name)) };
      }) };
    });
  });
  const draftSQL = normalizeSQL(row.sequences[1]) + (verifyAutosave ? `\n-- Autosave acceptance draft ${Date.now()}\n` : '');
  const draftAutosave = verifyAutosave ? waitForAutosave(page, draftSQL, false) : null;
  await page.evaluate(sql => {
    const view = window.editor_sequence_b.codeMirrorView;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } });
  }, draftSQL);
  assert.equal(await page.locator('#sequence_b').inputValue(), draftSQL, `${row.key}: actual editor/form SQL`);
  const autosaveProof = {};
  if (draftAutosave) {
    const response = await draftAutosave;
    const labels = await page.evaluate(() => JSON.parse(document.getElementById('qpisql-output-area').dataset.labels));
    assert.equal((await response.text()).trim(), labels.autosaveSuccess);
    await confirmSaved(page, labels.saved);
    autosaveProof.draft = await page.locator('#qpisql-save-status').innerText();
    assert.equal(await page.locator('#qpisql-executed-bool').inputValue(), 'false');
    await page.evaluate(sql => { const view = window.editor_sequence_b.codeMirrorView; view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: sql } }); }, row.sequences[1]);
    assert.equal(await page.locator('#sequence_b').inputValue(), normalizeSQL(row.sequences[1]));
  }
  const executedAutosave = verifyAutosave ? waitForAutosave(page, row.sequences[1], true) : null;
  await page.locator('#qpisql-execute-button').click();
  await page.waitForFunction(() => !window.EXECUTE_HANDLER.running && (document.querySelector('#qpisql-executed-bool').value === 'true'
    || document.querySelector('#qpisql-error-bool').value === 'true'), null, { timeout: 0 });
  const execution = await page.evaluate(() => {
    const field = name => document.querySelector(`[name="${name}"]`)?.value || '';
    if (field('error_bool') === 'true') return { error: JSON.parse(field('error')) };
    return { relation: JSON.parse(field('output_relation')), metrics: {
      result_lines: field('value_result_lines'), column_names: field('value_column_names'),
      functional_dependencies: field('value_functional_dependencies')
    }, qss: field('qss_evaluation') ? JSON.parse(field('qss_evaluation')) : null,
    qssProgress: window.__qssProgress || [],
    displayed_rows: document.querySelectorAll('#qpisql-output-area-relation tbody tr').length };
  });
  if (verifyQSS) {
    assert.equal(execution.qss?.status, 'exact', `${row.key}: parallel QSS must finish`);
    assert.equal(execution.qss.engine, 'graph-qss-sqlite-v2', `${row.key}: paper-style graph engine must be used`);
    assert.equal(execution.qss.version, '2.1.1');
    assert.equal(execution.qss.rubric, 'paper-linear-v2');
    assert.equal(execution.qss.scale, row.maximum_points / 5);
    assert.equal(execution.qss.points, row.maximum_points, `${row.key}: model answer must receive full parallel points`);
    assert.equal(execution.qss.distance, 0, `${row.key}: model answer has distance zero`);
    assert.ok(execution.qssProgress.length > 0, `${row.key}: actual worker progress must be shown before the table`);
    assert.ok(execution.qssProgress.every(state => state.resultHidden && state.nextDisabled), `${row.key}: result and next remain gated while evaluating`);
    assert.match(execution.qss.answerDigest, /^[a-f0-9]{64}$/);
    assert.match(execution.qss.referenceRevision, /^[a-f0-9]{64}$/);
  }
  if (executedAutosave) {
    const response = await executedAutosave;
    const labels = await page.evaluate(() => JSON.parse(document.getElementById('qpisql-output-area').dataset.labels));
    assert.equal((await response.text()).trim(), labels.autosaveSuccess);
    await confirmSaved(page, labels.saved);
    autosaveProof.executed = await page.locator('#qpisql-save-status').innerText();
    execution.autosave = autosaveProof;
  }
  return execution;
}

async function refreshFinalStudentOverview(page, exam, databaseReport, summary) {
  assert.equal(databaseReport.saved_authorized_answers, Object.keys(exam.questions).length);
  assert.deepEqual(databaseReport.failures, []);
  const url = new URL(databaseReport.native_attempt_details_url, base);
  url.searchParams.set('cmd', 'outUserResultsOverview');
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.body.innerText.includes('Overview of Test Attempts'));
  const table = page.locator('table').filter({ hasText: 'Point Score' });
  const cells = await table.locator('tbody tr').first().locator('td').allTextContents();
  const answered = cells[3].trim(), score = cells[4].trim();
  assert.match(answered, new RegExp(`^${Object.keys(exam.questions).length}\\s+Of\\s+${Object.keys(exam.questions).length}$`, 'i'));
  const points = score.match(/([\d.,]+)\s+Of\s+([\d.,]+)/i);
  assert.ok(points);
  const earned = Number(points[1].replaceAll(',', '')), maximum = Number(points[2].replaceAll(',', ''));
  assert.equal(earned, databaseReport.points);
  assert.equal(maximum, databaseReport.maximum_points);
  assert.equal(earned, maximum, 'All original model solutions must receive exactly their maximum points');
  if (!summary.before_native_recalculation) summary.before_native_recalculation = {
    ui_score: summary.ui_score, ui_answered: summary.ui_answered, result_rows: summary.result_rows
  };
  summary.ui_score = score;
  summary.ui_answered = answered;
  summary.result_rows = await table.locator('tbody tr').allTextContents();
  summary.student_result_refreshed_after_native_recalculation = true;
  fs.writeFileSync(path.join(directory, prefix + 'browser-report.json'), JSON.stringify(summary, null, 2) + '\n');
  await page.screenshot({ path: path.join(directory, prefix + 'student-recalculated-overview.png'), fullPage: true });
}

async function verifyFinalResultTypes(page, exam, databaseReport) {
  assert.equal(databaseReport.saved_authorized_answers, Object.keys(exam.questions).length);
  assert.deepEqual(databaseReport.failures, []);
  page.setDefaultNavigationTimeout(180000);
  await page.goto(new URL(databaseReport.native_attempt_details_url, base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle');
  const labels = await page.evaluate(() => {
    const types = [], ids = [];
    for (const row of document.querySelectorAll('.il-listing-characteristic-value-row')) {
      const label = row.querySelector('.il-listing-characteristic-value-label')?.textContent.trim().replace(/:$/, '');
      const item = row.querySelector('.il-listing-characteristic-value-item')?.textContent.trim();
      if (/^Question[\s-]*Type$/i.test(label)) types.push(item);
      if (/^Question[\s-]*ID$/i.test(label)) ids.push(Number(item));
    }
    return { types, ids: [...new Set(ids)], untranslated: document.body.textContent.includes('-assSQLQuestion-') };
  });
  const language = fs.readFileSync(path.resolve(__dirname, '../../lang/ilias_en.lang'), 'utf8');
  const expected = language.split(/\r?\n/).find(line => line.startsWith('gi_name#:#')).split('#:#')[1];
  assert.ok(labels.types.length > 0, 'Native detail rows expose question-type labels');
  assert.equal(labels.untranslated, false, 'No untranslated plugin type tag may appear');
  assert.deepEqual([...new Set(labels.types)], [expected]);
  assert.deepEqual(labels.ids.sort((a, b) => a - b), Object.values(exam.questions).map(row => row.question_id).sort((a, b) => a - b));
  const result = { questions: labels.ids.length, type_occurrences: labels.types.length, translated_type: expected, untranslated_type_found: false,
    browser: await page.evaluate(() => navigator.userAgent) };
  await page.screenshot({ path: path.join(directory, prefix + 'student-final-result-types.png'), fullPage: false });
  fs.writeFileSync(path.join(directory, prefix + 'results-view-report.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}

async function main() {
  assert.ok(cdp, 'CHROME_CDP_URL is required: this test must use installed Google Chrome.');
  assert.ok(Number.isSafeInteger(start) && start >= 0, 'ILIAS_CORPUS_START must be a nonnegative local resume index.');
  assert.ok(count === Infinity || Number.isSafeInteger(count) && count > 0, 'ILIAS_CORPUS_COUNT must be a positive local end count.');
  const accounts = JSON.parse(fs.readFileSync(process.env.ILIAS_CHROME_STATE || '/tmp/asssql-chrome-accounts.json', 'utf8'));
  const exam = JSON.parse(fs.readFileSync(path.join(directory, prefix + 'exam-state.json'), 'utf8'));
  const sourceCoverage = await examSourceCoverage(exam);
  assert.ok(start < Object.keys(exam.questions).length, 'Resume index must be within this exam.');
  const browser = await chromium.connectOverCDP(cdp, { timeout: 120000 });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  if (verifyQSS) await context.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.__qssProgress = [];
    window.Worker = class extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        if (String(url).includes('/lib/qss/worker.qss.js')) this.addEventListener('message', event => {
          if (event.data?.type !== 'progress') return;
          const result = document.getElementById('qpisql-output-area-relation');
          const next = document.querySelector('.ilTstNavigationBtn_Next button');
          window.__qssProgress.push({ phase: event.data.phase,
            resultHidden: result?.style.display === 'none', nextDisabled: !next || next.disabled });
        });
      }
    };
  });
  context.setDefaultTimeout(30000);
  context.setDefaultNavigationTimeout(60000);
  const page = await context.newPage();
  page.on('requestfailed', request => { if (/[?&]test_answer_changed=/.test(request.url())) console.log('OWN_AUTOSAVE_NETWORK_FAILURE', request.failure()?.errorText); });
  await login(page, accounts.student);
  if (process.env.ILIAS_CORPUS_RESULTS_ONLY === '1') {
    const summary = JSON.parse(fs.readFileSync(path.join(directory, prefix + 'browser-report.json'), 'utf8'));
    assert.equal(summary.finished, true, 'Only inspect results after the real test is finished');
    const database = JSON.parse(fs.readFileSync(path.join(directory, prefix + 'student-database-report.json'), 'utf8'));
    await refreshFinalStudentOverview(page, exam, database, summary);
    // Native details eagerly render every full user/model solution card. Review
    // types on a separate small completed test when the full corpus is large.
    if (process.env.ILIAS_CORPUS_OVERVIEW_ONLY !== '1') await verifyFinalResultTypes(page, exam, database);
    else console.log(JSON.stringify({ questions: Object.keys(exam.questions).length, ui_score: summary.ui_score,
      ui_answered: summary.ui_answered, overview_verified: true, detail_cards_opened: false }, null, 2));
    await page.close();
    await context.close();
    return;
  }
  const roleChecks = [];
  for (const [action, url] of Object.entries(exam.role_check_urls || {})) {
    const response = await page.goto(new URL(url, base).href, { waitUntil: 'domcontentloaded' });
    const text = await page.locator('body').innerText();
    const denied = /no permission|not authorized|access denied|permission denied|not accessible|do not have access|No Access/i.test(text);
    if (!denied && response.status() !== 403) console.log('OWN_STUDENT_ROLE_CHECK', JSON.stringify({ action, url: page.url(), text: text.slice(0, 2000) }));
    assert.ok(denied || response.status() === 403, `Ordinary student must not access source pool ${action}`);
    assert.equal(await page.locator('#sequence_b, input[type="file"]').count(), 0, `Source pool ${action} must not expose editing/import controls`);
    roleChecks.push({ action, denied: true, status: response.status() });
  }
  await page.screenshot({ path: path.join(directory, prefix + 'student-source-pool-denied.png'), fullPage: true });
  await page.goto(exam.url, { waitUntil: 'domcontentloaded' });
  const startLink = page.getByRole('link', { name: /^(Start Test|Resume Test|Start the Test|Continue Test)$/i });
  const startButton = page.getByRole('button', { name: /^(Start Test|Resume Test|Start the Test|Continue Test)$/i });
  if (await startLink.count()) await startLink.first().click();
  else if (await startButton.count()) await startButton.first().click();
  else if (!(await page.locator('#sequence_b').count())) {
    throw new Error('No native test start/resume control: ' + (await page.locator('body').innerText()).slice(0, 1500));
  }
  await page.waitForFunction(() => typeof window.editor_sequence_b !== 'undefined');
  const baseline = await baselinePage(context);
  const userAgent = await page.evaluate(() => navigator.userAgent);
  assert.match(userAgent, /Chrome\//, 'Expected actual Google Chrome');
  const bundle = await context.request.get(`${base}${pluginPath}/lib/codemirror/codemirror_sqlquestion.bundle.js`);
  assert.equal(bundle.status(), 200);
  const runtimeJavaScript = await context.request.get(`${base}${pluginPath}/js/min.js.php`);
  assert.equal(runtimeJavaScript.status(), 200);
  const report = { runtime_javascript_sha256: hash(await runtimeJavaScript.body()), browser: await browser.version(), user_agent: userAgent,
    headless: /HeadlessChrome/.test(userAgent), bundle_sha256: hash(await bundle.body()), role_checks: roleChecks, student_id: accounts.student.id, test_id: exam.test_id, questions: 0, ui_question_pages: 0, ui_answer_submissions: 0,
    same_execution: 0, same_metrics: 0, old_workers_executed: 0, source_coverage: sourceCoverage,
    hidden_textarea_initial_lf_normalizations: [], source_result_mismatches: [], source_metric_mismatches: [], failures: [], pools: {} };
  if (verifyQSS) {
    const worker = await context.request.get(`${base}${pluginPath}/lib/qss/worker.qss.js`);
    assert.equal(worker.status(), 200);
    report.qss_worker_sha256 = hash(await worker.body());
  }
  if (start) {
    const previous = JSON.parse(fs.readFileSync(path.join(directory, prefix + 'browser-report.json'), 'utf8'));
    assert.equal(previous.test_id, exam.test_id, 'Resume the same actual test');
    assert.equal(previous.questions, start);
    assert.equal(previous.ui_answer_submissions, start);
    assert.equal(previous.runtime_javascript_sha256, report.runtime_javascript_sha256, 'Resume only the identical final runtime');
    assert.equal(previous.bundle_sha256, report.bundle_sha256, 'Resume only the identical final editor bundle');
    if (verifyQSS) assert.equal(previous.qss_worker_sha256, report.qss_worker_sha256, 'Resume only the identical final QSS worker');
    if (sourceCoverage.declared) {
      assert.equal(previous.source_coverage?.expected_source_keys_sha256, sourceCoverage.expected_source_keys_sha256);
      assert.equal(previous.source_coverage?.source_questions_sha256, sourceCoverage.source_questions_sha256);
    }
    assert.deepEqual(previous.failures, []);
    const records = fs.readFileSync(path.join(directory, prefix + 'browser-results.jsonl'), 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
    assert.equal(records.length, start, 'Existing proof contains every previously submitted answer');
    assert.deepEqual(records.map(row => row.key), Object.keys(exam.questions).slice(0, start), 'Resumed proof covers precisely the earlier source keys.');
    Object.assign(report, previous);
    report.resume_segments = [...(previous.resume_segments || []), { resumed_at_sequence: start + 1, already_submitted: start }];
  }
  const output = fs.createWriteStream(path.join(directory, prefix + 'browser-results.jsonl'), { flags: start ? 'a' : 'w' });
  const lines = readline.createInterface({ input: fs.createReadStream(path.join(directory, prefix + 'exam-runtime.jsonl')), crlfDelay: Infinity });
  const sequenceQuestionIds = Object.values(exam.questions).map(row => row.question_id);
  let index = 0;
  try {
    for await (const line of lines) {
      if (index++ < start || report.questions >= count) continue;
      const row = JSON.parse(line);
      console.log(`RUN ${index}: ${row.key}`);
      const identity = await nativeIdentity(page, index, row.question_id, sequenceQuestionIds);
      const normalizedFields = [0, 2].filter(i => normalizeSQL(row.sequences[i]).startsWith('\n')).map(i => i === 0 ? 'A' : 'C');
      if (normalizedFields.length) report.hidden_textarea_initial_lf_normalizations.push({ key: row.key, fields: normalizedFields });
      const dataset = await page.evaluate(async () => {
        const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(b => b.toString(16).padStart(2, '0')).join('');
        return { a: await digest(window.EXECUTE_HANDLER.getSequenceA()), c: await digest(window.EXECUTE_HANDLER.getSequenceC()), integrity: window.EXECUTE_HANDLER.getIntegrityCheck() };
      });
      assert.equal(dataset.a, hash(normalizeHiddenTextareaSQL(row.sequences[0])), `${row.key}: actual student preparation sequence`);
      assert.equal(dataset.c, hash(normalizeHiddenTextareaSQL(row.sequences[2])), `${row.key}: actual student control sequence`);
      assert.equal(dataset.integrity, row.integrity, `${row.key}: actual integrity mode`);
      const [old, current] = await Promise.all([executeBaseline(baseline, { ...row, sequences: [normalizeHiddenTextareaSQL(row.sequences[0]), normalizeSQL(row.sequences[1]), normalizeHiddenTextareaSQL(row.sequences[2])] }), executeStudent(page, row, report.questions === 0)]);
      if (current.autosave) report.first_question_autosave = current.autosave;
      report.old_workers_executed++;
      if (old.relation && current.metrics && old.metrics.functional_dependencies !== current.metrics.functional_dependencies) {
        const recalculated = await baseline.evaluate(relation => new SQLResult(relation).getAllMinimalFunctionalDependenciesAsJSON(), old.relation);
        if (recalculated !== old.metrics.functional_dependencies) report.source_metric_mismatches.push({ key: row.key, type: 'functional_dependencies' });
        old.metrics.functional_dependencies = recalculated;
      }
      report.questions++;
      if (verifyQSS) report.qss_completed = (report.qss_completed || 0) + 1;
      report.ui_question_pages++;
      report.pools[row.pool] = (report.pools[row.pool] || 0) + 1;
      const sameExecution = canonical(old.error || old.relation) === canonical(current.error || current.relation);
      const sameMetrics = canonical(old.metrics) === canonical(current.metrics);
      if (sameExecution) report.same_execution++;
      else report.failures.push({ key: row.key, kind: 'execution_regression', baseline_error: old.error, current_error: current.error });
      if (sameMetrics) report.same_metrics++;
      else report.failures.push({ key: row.key, kind: 'metric_regression' });
      const stored = JSON.parse(row.output_relation || 'null');
      if (canonical(current.relation) !== canonical(stored)) report.source_result_mismatches.push({ key: row.key, error: current.error });
      const result = { key: row.key, original_source_ordinal: row.original_source_ordinal,
        question_id: row.question_id, original_question_id: row.original_question_id, actual_native_identity: identity, baseline: { metrics: old.metrics, error: old.error },
        current: { metrics: current.metrics, error: current.error }, qss: current.qss, qss_progress: current.qssProgress,
        ui_points: current.ui_points, ui_maximum: current.ui_maximum,
        result_rows: current.relation?.values.length, displayed_rows: current.displayed_rows,
        baseline_result_sha256: hash(canonical(old.error || old.relation)), current_result_sha256: hash(canonical(current.error || current.relation)) };
      if (index < Object.keys(exam.questions).length) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
          page.locator('.ilTstNavigationBtn_Next button').first().click()
        ]);
        await page.waitForURL(url => Number(url.searchParams.get('sequence')) === index + 1);
        await nativeIdentity(page, index + 1, sequenceQuestionIds[index], sequenceQuestionIds);
      } else {
        await page.getByRole('button', { name: /Finish.*Test/i }).first().click();
        const dialog = page.getByRole('dialog').filter({ hasText: /Finish.*Test/i });
        await dialog.waitFor({ state: 'visible' });
        await dialog.getByRole('button', { name: /Finish|Submit|Confirm/i }).first().click();
        await page.waitForFunction(() => document.body.innerText.includes('Overview of Test Attempts'));
        report.finished = true;
        report.result_rows = await page.locator('table').filter({ hasText: 'Point Score' }).locator('tbody tr').allTextContents();
        const cells = await page.locator('table').filter({ hasText: 'Point Score' }).locator('tbody tr').first().locator('td').allTextContents();
        report.ui_answered = cells[3]?.trim();
        report.ui_score = cells[4]?.trim();
      }
      report.ui_answer_submissions++;
      if (sourceCoverage.declared) {
        report.source_coverage.completed_questions = report.ui_answer_submissions;
        report.source_coverage.completed_source_keys_sha256 = hash(canonical(Object.keys(exam.questions).slice(0, report.ui_answer_submissions)));
        report.source_coverage.completed = report.ui_answer_submissions === Object.keys(exam.questions).length && report.finished === true;
      }
      output.write(JSON.stringify(result) + '\n');
      fs.writeFileSync(path.join(directory, prefix + 'browser-report.json'), JSON.stringify(report, null, 2) + '\n');
      if (report.questions % 10 === 0) console.log(`PASS ${report.questions}: ${report.same_execution} equivalent executions, ${report.same_metrics} equivalent metrics`);
    }
    await page.screenshot({ path: path.join(directory, prefix + 'last-question-chrome.png'), fullPage: true });
  } finally {
    await new Promise(resolve => output.end(resolve));
    await page.close();
    await baseline.close();
    await context.close();
    // CDP belongs to the caller's disposable Chrome profile. Do not close it.
  }
  const expected = sourceCoverage.declared ? Object.keys(exam.questions).length
    : JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')).questions;
  if (!Number.isFinite(count) || sourceCoverage.declared && count >= expected) {
    assert.equal(report.questions, expected, 'Every exported question must be tested.');
    assert.equal(report.ui_answer_submissions, expected, 'Every answer must be submitted through native UI.');
    assert.equal(report.finished, true, 'The ordinary student must finish the actual test.');
    if (sourceCoverage.declared) {
      assert.equal(report.source_coverage.completed, true, 'Every question in this declared source range was finished.');
      assert.equal(report.source_coverage.completed_source_keys_sha256, report.source_coverage.expected_source_keys_sha256);
    }
  }
  console.log(JSON.stringify(report, null, 2));
  assert.deepEqual(report.failures, []);
}
module.exports = { examSourceCoverage };
if (require.main === module) main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
