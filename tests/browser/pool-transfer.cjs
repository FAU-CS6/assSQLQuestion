/* Native question-pool import/export acceptance on a locally installed Google Chrome.
 * Private inputs, accounts, downloads and screenshots must stay outside version control.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { chromium } = require('playwright');

const directory = path.resolve(process.env.ILIAS_CORPUS_DIR || '/tmp/asssql-pool-corpus');
const accountFile = process.env.ILIAS_CHROME_ACCOUNTS || '/tmp/asssql-chrome-accounts.json';
const storageFile = process.env.ILIAS_TEACHER_STORAGE || '/tmp/asssql-teacher-storage.json';
const artifacts = path.resolve(process.env.ILIAS_TEST_ARTIFACTS || 'test-results/chrome-transfer');
const phase = process.env.ILIAS_TRANSFER_PHASE || 'all';
const reportFile = path.join(artifacts, 'teacher-transfer-report.json');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
const accounts = JSON.parse(fs.readFileSync(accountFile, 'utf8'));
const base = accounts.base_url || 'http://localhost:8080';
fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 });
fs.chmodSync(artifacts, 0o700);
const report = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : { format: 1, account: accounts.teacher.login, category_ref_id: accounts.category_ref_id, pools: [] };
const save = () => fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const countQuestions = async page => {
  const match = (await page.locator('body').innerText()).match(/Number of Questions\s+(\d+)/);
  assert.ok(match, 'The native question list must report its total question count.');
  return Number(match[1]);
};

async function createPool(page, title) {
  await page.goto(`${base}/ilias.php?baseClass=ilrepositorygui&cmd=create&ref_id=${accounts.category_ref_id}&new_type=qpl`);
  await page.getByRole('textbox', { name: 'Title', exact: false }).fill(title);
  await page.getByRole('button', { name: 'Add Question Pool for Tests', exact: true }).click();
  await page.getByRole('button', { name: 'Create Question', exact: true }).waitFor();
  const ref = Number(new URL(page.url()).searchParams.get('ref_id'));
  const poolID = await page.locator('input[name^="vcqpt"]').first().getAttribute('name');
  return { pool_ref_id: ref, pool_id: Number(poolID.match(/^vcqpt(\d+)_/)[1]) };
}

async function importQuestions(page, pool, archive, expectedCount) {
  await page.goto(`${base}/goto.php/qpl/${pool.pool_ref_id}`);
  const currentCount = await countQuestions(page);
  if (currentCount === expectedCount) return; // Resume only after verifying the completed native list.
  assert.equal(currentCount, 0, 'Never import a corpus twice into a partially populated pool.');
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.locator('input[type=file]').setInputFiles(archive);
  // ILIAS queues uploads until the modal's submit action. Wait for its native verification page.
  await Promise.all([
    page.waitForURL(url => url.searchParams.get('fallbackCmd') === 'uploadQuestionsImport', { timeout: 600000 }),
    page.getByRole('button', { name: 'Import', exact: true }).last().click()
  ]);
  const choices = page.locator('input[type=checkbox][name^="form/"]');
  assert.equal(await choices.count(), expectedCount, 'Every source question must appear in the native import verification.');
  pool.source_item_ids = await choices.evaluateAll(inputs => inputs.map(input => input.value));
  for (const choice of await choices.all()) if (!(await choice.isChecked())) await choice.check();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('button', { name: 'Create Question', exact: true }).waitFor({ timeout: 600000 });
  assert.equal(await countQuestions(page), expectedCount, 'Every verified source question must be imported.');
}

async function exportQuestions(page, pool) {
  await page.goto(`${base}/goto.php/qpl/${pool.pool_ref_id}`);
  await page.getByRole('link', { name: 'Export', exact: true }).click();
  // The native export action and download links are resolved from the displayed page below.
  const create = page.getByRole('button', { name: /Create.*Export|Create Export File|Exportieren/i }).first();
  if (await create.count()) await create.click();
  else {
    const xmlExport = page.getByRole('button', { name: /Export.*XML|XML.*Export/i }).first();
    assert.ok(await xmlExport.count(), 'Expected native XML export action');
    await xmlExport.click();
  }
  await page.getByRole('button', { name: 'Actions', exact: true }).first().waitFor({ timeout: 600000 });
  await page.getByRole('button', { name: 'Actions', exact: true }).first().click();
  const download = page.getByRole('button', { name: 'Download', exact: true }).first();
  await download.waitFor({ timeout: 600000 });
  const [file] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), download.click()]);
  const filename = path.join(artifacts, file.suggestedFilename());
  await file.saveAs(filename);
  fs.chmodSync(filename, 0o600);
  assert.ok(fs.statSync(filename).size > 0);
  return filename;
}

async function main() {
  const browser = await chromium.connectOverCDP(process.env.ILIAS_CHROME_CDP || 'http://localhost:9223');
  const context = await browser.newContext({ acceptDownloads: true, ...(fs.existsSync(storageFile) ? { storageState: storageFile } : {}) });
  const page = await context.newPage();
  page.setDefaultTimeout(600000);
  page.setDefaultNavigationTimeout(600000);
  try {
    await page.goto(`${base}/goto.php/cat/${accounts.category_ref_id}`);
    if (await page.locator('input[type=password]').count()) {
      await page.locator('input[name^="login_form/"][type=text]').fill(accounts.teacher.login);
      await page.locator('input[type=password]').fill(accounts.teacher.password);
      await page.getByRole('button', { name: 'Login', exact: true }).click();
      await page.goto(`${base}/goto.php/cat/${accounts.category_ref_id}`);
    }
    report.browser = await browser.version();
    report.user_agent = await page.evaluate(() => navigator.userAgent);
    assert.match(report.user_agent, /HeadlessChrome\//, 'Native acceptance uses an invisible dedicated Chrome process.');
    report.headless = true;
    report.teacher_user_id = accounts.teacher.id;
    const workerURL = base + '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/lib/qss/worker.qss.js';
    const worker = await context.request.get(workerURL);
    assert.ok(worker.ok());
    const workerHash = hash(await worker.body());
    if (report.qss_worker_sha256) assert.equal(report.qss_worker_sha256, workerHash, 'Resume only against the same final QSS bundle.');
    report.qss_worker_sha256 = workerHash;
    report.source_archive_sha256 = {};
    for (const source of manifest.pools) {
      const actualHash = hash(fs.readFileSync(path.join(directory, source.archive)));
      if (source.sha256) assert.equal(actualHash, source.sha256, 'Import the unchanged private source ZIP.');
      report.source_archive_sha256[source.key] = actualHash;
    }
    if (phase !== 'roundtrip') {
      for (const source of manifest.pools) {
        let pool = report.pools.find(item => item.key === source.key);
        if (!pool) {
          pool = { key: source.key, expected_count: source.count, ...(await createPool(page, `Chrome source pool ${source.key}`)) };
          if (source.manifest === false) {
            pool.ui_destination_metadata_override = {
              title: `Chrome source pool ${source.key}`, description: '',
              reason: 'Native Import Questions for a legacy ZIP deliberately keeps the existing destination pool metadata.'
            };
          }
          report.pools.push(pool); save();
        }
        await importQuestions(page, pool, path.join(directory, source.archive), source.count);
        pool.imported_count = source.count;
        pool.chrome_mode = 'installed-google-chrome-headless';
        save();
        await page.screenshot({ path: path.join(artifacts, `source-${source.key}.png`), fullPage: true });
        console.log(`PASS: Chrome teacher imported pool ${source.key}: ${source.count} questions, ref ${pool.pool_ref_id}`);
      }
      report.imported_questions = report.pools.reduce((total, pool) => total + pool.imported_count, 0); save();
    }
    assert.equal(report.imported_questions, manifest.questions);
    if (phase !== 'imports') {
      for (const source of manifest.pools) {
        const pool = report.pools.find(item => item.key === source.key);
        if (!pool.export_file) {
          pool.export_file = await exportQuestions(page, pool);
          pool.export_chrome_mode = 'installed-google-chrome-headless';
          save();
        }
        if (!pool.reimport) { pool.reimport = await createPool(page, `Chrome roundtrip pool ${source.key}`); save(); }
        await importQuestions(page, pool.reimport, pool.export_file, source.count);
        pool.reimported_count = source.count;
        pool.reimport_pool_id = pool.reimport.pool_id;
        pool.reimport_pool_ref_id = pool.reimport.pool_ref_id;
        pool.reimport_chrome_mode = 'installed-google-chrome-headless';
        save();
        await page.screenshot({ path: path.join(artifacts, `roundtrip-${source.key}.png`), fullPage: true });
        console.log(`PASS: Chrome teacher exported and reimported pool ${source.key}: ${source.count} questions`);
      }
      report.reimported_questions = report.pools.reduce((total, pool) => total + pool.reimported_count, 0); save();
    }
    const finalWorker = await context.request.get(workerURL);
    report.qss_worker_unchanged = finalWorker.ok() && hash(await finalWorker.body()) === workerHash;
    save();
    assert.equal(report.qss_worker_unchanged, true, 'Import/export evidence must use one unchanged final plugin bundle.');
    await context.storageState({ path: storageFile }); fs.chmodSync(storageFile, 0o600);
  } catch (error) {
    console.error('Original Chrome transfer error:', error.stack || error);
    await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
    console.error('Chrome transfer failed at', page.url());
    console.error((await page.locator('body').innerText({ timeout: 5000 }).catch(() => '(No readable document body)')).slice(-1800));
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
