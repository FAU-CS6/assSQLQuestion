/* Native finished-attempt display, using a small test instead of 699 giant cards. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
async function main() {
  const input = JSON.parse(fs.readFileSync(process.env.QSS_DATABASE_REPORT, 'utf8'));
  const accounts = JSON.parse(fs.readFileSync(process.env.ILIAS_CHROME_STATE || '/tmp/asssql-chrome-accounts.json', 'utf8'));
  const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL || 'http://127.0.0.1:9237');
  const context = await browser.newContext({viewport: {width: 1440, height: 1000}});
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(accounts.base_url + '/login.php?client_id=default');
    await page.locator('input[name^="login_form/"][type=text]').fill(accounts.student.login);
    await page.locator('input[type=password]').fill(accounts.student.password);
    await Promise.all([page.waitForNavigation({waitUntil: 'domcontentloaded'}), page.getByRole('button', {name: /^(Login|Anmelden)$/}).click()]);
    await page.goto(new URL(input.native_attempt_details_url, accounts.base_url).href, {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(expected => document.querySelectorAll('.qpisql-qss-shadow').length === expected, input.expected);
    const proof = await page.evaluate(() => ({
      cards: document.querySelectorAll('.qpisql-qss-shadow').length,
      scores: document.querySelectorAll('.qpisql-qss-score').length,
      editableConfigs: document.querySelectorAll('#qpisql-qss-config').length,
      stale: [...document.querySelectorAll('.qpisql-qss-shadow')].some(card => /stale|veraltet/i.test(card.textContent)),
      outputTables: document.querySelectorAll('.qpisql-output-area-relation table').length,
    }));
    assert.equal(proof.cards, input.expected); assert.equal(proof.scores, input.expected);
    assert.equal(proof.editableConfigs, 0); assert.equal(proof.stale, false);
    assert.equal(proof.outputTables, 2 * input.expected);
    assert.deepEqual(errors, []);
    const directory = path.resolve(process.env.QSS_REPORT_DIRECTORY || path.join(require('node:os').tmpdir(), 'asssql-private-artifacts', 'qss', 'stored-results'));
    fs.mkdirSync(directory, {recursive: true, mode: 0o700});
    const first = page.locator('.qpisql-qss-shadow').first();
    const firstRow = page.locator('.il-table-presentation-row').filter({has: page.locator('.qpisql-qss-shadow')}).first();
    await firstRow.locator('.il-table-presentation-row-header-headline').click();
    await first.waitFor({state: 'visible'});
    if (!(await first.isVisible())) {
      const ancestry = await first.evaluate(element => {
        const output = [];
        for (let node = element; node && output.length < 12; node = node.parentElement) output.push({tag: node.tagName, id: node.id,
          class: node.className, display: getComputedStyle(node).display, labelledBy: node.getAttribute('aria-labelledby'),
          previous: node.previousElementSibling ? {tag: node.previousElementSibling.tagName, class: node.previousElementSibling.className} : null});
        return output;
      });
      console.log('NATIVE_STORED_PANEL', JSON.stringify(ancestry));
    }
    await page.screenshot({path: path.join(directory, 'stored-overview.png'), fullPage: true});
    await first.screenshot({path: path.join(directory, 'stored-qss.png')});
    proof.firstCardVisible = await first.isVisible();
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify({browser: await browser.version(), ...proof, page_errors: errors}, null, 2));
    console.log(JSON.stringify(proof));
  } finally { await context.close(); }
}
main().then(() => process.exit(0)).catch(error => {console.error(error);process.exit(1);});
