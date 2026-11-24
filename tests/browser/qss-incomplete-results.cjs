/* Released QSS results must distinguish missing evidence from certified zero. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

async function main() {
  const browser = process.env.CHROME_CDP_URL
    ? await chromium.connectOverCDP(process.env.CHROME_CDP_URL)
    : await chromium.launch({channel: 'chrome', headless: true});
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.setContent('<!doctype html><title>Released QSS results</title>');
    await page.addScriptTag({content: fs.readFileSync(path.resolve(__dirname, '../../js/classes/class.QSSShadow.js'), 'utf8')});
    const cases = await page.evaluate(() => {
      const labels = {title: 'QSS', shadow: 'QSS assessment', notCompleted: 'No completed QSS assessment; an ILIAS zero is not a QSS certificate.',
        completed: 'Completed', points: 'Points', distance: 'Distance', details: 'Details', model: 'Model'};
      // A historical, completed submission remains valid after a plugin update.
      const model = {engine: 'graph-qss-sqlite-v2', engineVersion: '2.1.1', rubric: 'paper-linear-v2',
        scale: 2, maxPoints: 10, answerDigest: 'b'.repeat(64)};
      const exact = {status: 'exact', ...model, version: model.engineVersion, modelVersion: model.engineVersion,
        referenceRevision: 'a'.repeat(64), scoreCertifiedWithinModel: true, exactWithinModel: true,
        formula: 'max(maxPoints - distance * scale, 0)', distance: 1, points: 8};
      const samples = [
        ['cancelled-without-sidecar', null, true, false], ['malformed-sidecar', '{', true, false],
        ['cancelled-sidecar', {status: 'cancelled'}, true, false],
        ['worker-error', {status: 'error'}, true, false], ['unsupported', {status: 'unsupported'}, true, false],
        ['partial', {...exact, status: 'partial'}, true, false],
        ['wrong-answer', {...exact, answerDigest: 'c'.repeat(64)}, true, false],
        ['wrong-reference', {...exact, referenceRevision: 'c'.repeat(64)}, true, false],
        ['wrong-model', {...exact, version: '1.0.0'}, true, false],
        ['uncertified', {...exact, scoreCertifiedWithinModel: false}, true, false],
        ['wrong-maximum', {...exact, maxPoints: 9}, true, false],
        ['wrong-scale', {...exact, scale: 1}, true, false],
        ['invalid-distance', {...exact, distance: null}, true, false],
        ['historical-exact', exact, true, true],
        ['exact-zero', {...exact, distance: 5, points: 0}, true, true],
        ['certified-zero', {...exact, status: 'score-zero-certified', distance: null, lowerBound: 5, points: 0}, true, true],
        ['result-mode', null, false, false], ['model-answer', null, false, false],
      ];
      return samples.map(([name, result, required, completed]) => {
        const container = document.createElement('div');
        container.dataset.qssRequired = String(required);
        container.dataset.qssModel = JSON.stringify(model);
        container.dataset.qssReferenceRevision = 'a'.repeat(64);
        container.dataset.qssLabels = JSON.stringify(labels);
        container.dataset.qssEvaluation = result === null ? '' : typeof result === 'string' ? result : JSON.stringify(result);
        document.body.append(container);
        QSSShadow.renderStored(container); QSSShadow.renderStored(container);
        return {name, required, completed, cards: container.querySelectorAll('.qpisql-qss-shadow').length,
          scores: container.querySelectorAll('.qpisql-qss-score').length,
          pending: container.textContent.includes(labels.notCompleted), text: container.textContent};
      });
    });
    for (const row of cases) {
      assert.equal(row.cards, row.required ? 1 : 0, row.name);
      assert.equal(row.scores, row.completed ? 1 : 0, row.name);
      assert.equal(row.pending, row.required && !row.completed, row.name);
      if (row.name.endsWith('zero')) assert.match(row.text, /Points: 0 \/ 10/, row.name);
    }
    for (const file of ['class.QSSReviewPath.js', 'SQL/class.SQLRun.js']) {
      await page.addScriptTag({content: fs.readFileSync(path.resolve(__dirname, '../../js/classes', file), 'utf8')});
    }
    await page.evaluate(() => {
      window.workers = [];
      window.Worker = class {
        constructor(url) { this.url = url; this.messages = []; workers.push(this); }
        postMessage(message) { this.messages.push(message); }
        terminate() { this.terminated = true; }
      };
      const base = [...document.querySelectorAll('[data-qss-evaluation]')].find(el => {
        try { return JSON.parse(el.dataset.qssEvaluation)?.status === 'score-zero-certified'; } catch { return false; }
      });
      window.review = base.cloneNode(false);
      review.dataset.qssPathRequest = JSON.stringify({workerRevision: 7, questionText: 'example', costs: {baseRemoveStructural: 9},
        answer: 'SELECT 2', reference: 'SELECT 1', schemaSql: 'CREATE TABLE t(id)', controlSql: 'SELECT id FROM t'});
      document.body.append(review);
      window.savedEvidence = review.dataset.qssEvaluation;
      QSSShadow.renderStored(review);
    });
    const panel = page.locator('[data-qss-path-request]');
    const start = panel.getByRole('button', {name: 'findPath'});
    const cancel = panel.getByRole('button', {name: 'cancelPath'});
    assert.equal(await start.count(), 1);
    assert.equal(await page.evaluate(() => workers.length), 0);
    await start.click();
    await cancel.click();
    assert.equal(await panel.getByRole('status').innerText(), 'pathCancelled');
    assert.equal(await page.evaluate(() => workers[0].terminated), true);
    const prepare = async () => {
      await start.click();
      return page.evaluate(async () => {
        const sql = workers.at(-1);
        sql.onmessage({data: {results: []}}); // schema setup
        sql.onmessage({data: {results: [{values: [['t','table']]}]}}); // sqlite_master
        sql.onmessage({data: {results: [{values: [[0,'id','INTEGER',0,null,1]]}]}}); // PRAGMA table_info
        await new Promise(resolve => setTimeout(resolve, 0));
        return {sql: sql.messages.map(m => m.sql), terminated: sql.terminated, graph: workers.at(-1).messages[0]};
      });
    };
    const first = await prepare();
    assert.equal(first.terminated, true);
    assert.deepEqual(first.sql, ['CREATE TABLE t(id)', "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND lower(name) NOT GLOB 'sqlite_*' ORDER BY rowid", 'PRAGMA table_info("t")']);
    assert.equal(first.graph.exactDistance, true);
    assert.equal(first.graph.costs.baseRemoveStructural, 9);
    assert.equal(first.graph.schema.tables[0].columns[0].pk, 1);
    await cancel.click();
    assert.equal(await page.evaluate(() => workers.at(-1).terminated), true);
    await prepare();
    await page.evaluate(() => workers.at(-1).onmessage({data: {id: 1, type: 'result', result: {status: 'error'}}}));
    assert.equal(await panel.getByRole('status').innerText(), 'pathFailed');
    await prepare();
    await page.evaluate(() => {
      const result = {...JSON.parse(savedEvidence), status: 'exact', distance: 53, exactWithinModel: true, traceVerified: true,
        edits: Array.from({length: 53}, (_, i) => ({name: 'step' + i, description: 'Change ' + (i + 1), cost: 1}))};
      workers.at(-1).onmessage({data: {type: 'result', id: 1, result}});
    });
    assert.equal(await panel.locator('.qpisql-qss-changes li').count(), 53);
    assert.equal(await panel.locator('.qpisql-qss-distance').innerText(), '53');
    assert.equal(await page.evaluate(() => review.dataset.qssEvaluation === savedEvidence), true);
    await page.evaluate(() => QSSShadow.renderStored(review));
    await prepare();
    await page.evaluate(() => review.remove());
    await page.waitForFunction(() => workers.at(-1).terminated);
    console.log('PASS: on-demand path, historical costs, full trace, cancel/retry and panel disposal');
    assert.deepEqual(errors, []);
    console.log(`PASS: ${cases.length} released-result cases; cancelled evidence has no QSS score, historical and certified-zero grades remain visible`);
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
