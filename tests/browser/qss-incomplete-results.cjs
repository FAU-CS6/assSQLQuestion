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
    assert.deepEqual(errors, []);
    console.log(`PASS: ${cases.length} released-result cases; cancelled evidence has no QSS score, historical and certified-zero grades remain visible`);
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => {console.error(error); process.exitCode = 1;});
