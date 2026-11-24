const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const {readFileSync} = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require('playwright');

async function main() {
  const assets = new Set(['lib/sql.js/sql.js', 'lib/sql.js/worker.sql.js', 'lib/qss/qss.js',
    'lib/qss/answer-digest.mjs', 'lib/qss/worker.qss.js', 'js/classes/class.QSSShadow.js',
    'js/classes/SQL/class.SQLResult.js', 'js/classes/SQL/class.SQLRun.js',
    ...['Abstract', 'RunningSequence', 'IntegrityCheck', 'NoVisibleResult', 'DBCreation']
      .map(name => 'js/classes/SQL/Errors/class.SQLRunError' + name + '.js')]);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://sql.test');
    if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      return res.end('<!doctype html><input id="qpisql-qss-evaluation">');
    }
    const file = url.pathname.slice(1);
    if (!assets.has(file)) { res.writeHead(404); return res.end(); }
    res.setHeader('Content-Type', 'application/javascript');
    res.end(readFileSync(path.resolve(__dirname, '../..', file)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({channel: 'chrome', headless: true, timeout: 0,
      args: ['--no-proxy-server', '--host-resolver-rules=MAP sql.test 127.0.0.1']});
    const page = await browser.newPage();
    page.setDefaultTimeout(0);
    await page.goto('http://sql.test:' + server.address().port);
    for (const file of assets) {
      if (file.startsWith('js/') || file === 'lib/qss/qss.js') await page.addScriptTag({url: '/' + file});
    }
    const results = await page.evaluate(async () => {
      window.QPISQL_URL_PATH = '';
      const run = (setup, answer, control = '', integrity = false) => new Promise(resolve =>
        new SQLRun(setup, answer, control, integrity, {
          onResult: value => resolve(value), onError: error => resolve(error.errorType)
        }));
      const setup = "CREATE TABLE sqlitebook(last_updated INTEGER); INSERT INTO sqlitebook VALUES(2);";
      const empty = await run(setup, 'SELECT last_updated FROM sqlitebook WHERE 0');
      const last = await run(setup, 'SELECT 9; SELECT last_updated FROM sqlitebook WHERE 0');
      const noRows = await run(setup, 'SELECT 9', 'SELECT last_updated AS "" FROM sqlitebook WHERE 0');
      const dml = await run(setup, 'UPDATE sqlitebook SET last_updated=3');
      const allowed = await run(setup, "/* UPDATE */ SELECT last_updated, 'delete from t' FROM sqlitebook", '', true);
      const blocked = await run(setup, 'UPDATE sqlitebook SET last_updated=3', '', true);
      const control = await run(setup, 'SELECT last_updated FROM sqlitebook',
        'UPDATE sqlitebook SET last_updated=3; SELECT last_updated FROM sqlitebook', true);
      const blob = await run('', "SELECT x'AF01', x'', 'AF01'");
      const text = relation => {
        const el = document.createElement('div');
        relation.renderInto(el);
        return Array.from(el.querySelectorAll('td'), cell => cell.textContent);
      };
      const restored = SQLResult.fromJSON(blob.toJSON());
      const old = SQLResult.fromJSON(JSON.stringify({columns: blob.columns, values: [[{0: 175, 1: 1}, {}, 'AF01']]}));
      const schema = await SQLRun.preparedSchema(setup, new AbortController().signal);
      const config = {engineVersion: QSS.VERSION, referenceRevision: 'review', context: 'participant',
        scale: 1, scaleMode: 'fixed', rubric: 'paper-linear-v2'};
      const shadow = new QSSShadow(config);
      const answer = 'SELECT last_updated AS n FROM sqlitebook';
      const reference = 'SELECT "last_updated" AS n FROM sqlitebook';
      await shadow.evaluate({answer, reference, schema, schemaSql: setup, maxPoints: 5});
      const evidence = JSON.parse(document.getElementById('qpisql-qss-evaluation').value);
      return {empty: [empty.columns, empty.values], last: [last.columns, last.values], noRows: [noRows.columns, noRows.values],
        dml, allowed: allowed.values, blocked, control: control.values, blob: [text(blob), text(restored), text(old)],
        secure: window.isSecureContext, points: evidence.points, status: evidence.status, answer, digest: evidence.answerDigest,
        unicodeDigest: await QSSShadow.digest('Grüße\r\n📚')};
    });
    assert.deepEqual(results.empty, [['last_updated'], []]);
    assert.deepEqual(results.last, results.empty);
    assert.deepEqual(results.noRows, [[''], []]);
    assert.equal(results.dml, 'SQLRunErrorNoVisibleResult');
    assert.deepEqual(results.allowed, [[2, 'delete from t']]);
    assert.equal(results.blocked, 'SQLRunErrorIntegrityCheck');
    assert.deepEqual(results.control, [[3]]);
    for (const cells of results.blob) assert.deepEqual(cells, ["X'AF01'", "X''", 'AF01']);
    assert.equal(results.secure, false);
    assert.equal(results.status, 'exact');
    assert.equal(results.points, 5);
    const hash = text => createHash('sha256').update(text).digest('hex');
    assert.equal(results.digest, hash(results.answer));
    assert.equal(results.unicodeDigest, hash('Grüße\n📚'));
    console.log('PASS: empty relations, read-only answers, BLOB round trips, schema lookup and grading over LAN HTTP');
  } finally {
    try { await browser?.close(); } finally { await new Promise(resolve => server.close(resolve)); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
