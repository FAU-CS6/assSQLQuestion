/* Browser-only private sampling benchmark; no login, SQL/QSS deadline, or server execution.
 * NODE_PATH=<playwright> CHROME_CDP_URL=http://localhost:9235 \
 * ILIAS_CORPUS_DIRECTORY=/private/corpus node tests/browser/qss-benchmark.cjs
 */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { chromium } = require('playwright');
const mutations = require('../qss/fixture-mutations.cjs');

const directory = path.resolve(process.env.ILIAS_CORPUS_DIRECTORY || '/corpus');
const output = path.resolve(process.env.QSS_BENCHMARK_DIRECTORY || 'test-results/qss/benchmark');
const base = process.env.ILIAS_TEST_URL || 'http://localhost:8080';
const plugin = '/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion';
const workerPath = plugin + '/lib/qss/worker.qss.js';
const expectedHash = process.env.QSS_EXPECTED_WORKER_SHA256 ||
  digest(fs.readFileSync(path.join(__dirname, '../../lib/qss/worker.qss.js')));
const engine = 'sqlite-syntax-edit-graph-v1';
const sampleSize = 20;
let context;
function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

async function selectQuestions() {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8'));
  const positions = new Map(manifest.pools.map(pool => [String(pool.key), new Set([0, Math.floor(pool.count / 2), pool.count - 1])]));
  const offsets = new Map(), edges = [], special = new Map();
  const input = readline.createInterface({ input: fs.createReadStream(path.join(directory, 'questions.jsonl')), crlfDelay: Infinity });
  for await (const line of input) {
    const row = JSON.parse(line), pool = String(row.pool), index = offsets.get(pool) || 0;
    offsets.set(pool, index + 1);
    if (positions.get(pool).has(index)) edges.push({ row, tag: index === 0 ? 'pool-first' : index === Math.floor(manifest.pools.find(p => String(p.key) === pool).count / 2) ? 'pool-middle' : 'pool-last' });
    const m = row.metadata, tokens = mutations.tokens(m.SEQUENCE_B).filter(t => t.type !== 'comment');
    const words = tokens.filter(t => t.type === 'word').map(t => t.upper);
    for (const [tag, matches] of [
      ['group-having', words.includes('GROUP') && words.includes('HAVING')],
      ['subquery', words.filter(w => w === 'SELECT').length > 1],
      ['dml', ['INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(words[0])],
      ['ddl', ['CREATE', 'ALTER', 'DROP'].includes(words[0])]
    ]) if (matches && !special.has(tag)) special.set(tag, row);
    if (!special.has('largest-a') || m.SEQUENCE_A.length > special.get('largest-a').metadata.SEQUENCE_A.length) special.set('largest-a', row);
    if (!special.has('longest-b') || m.SEQUENCE_B.length > special.get('longest-b').metadata.SEQUENCE_B.length) special.set('longest-b', row);
  }
  const selected = new Map();
  const add = (row, tag) => {
    if (!selected.has(row.key)) selected.set(row.key, { row, tags: [] });
    selected.get(row.key).tags.push(tag);
  };
  for (const item of edges.filter(item => item.tag !== 'pool-last')) add(item.row, item.tag);
  for (const [tag, row] of special) add(row, tag);
  for (const item of edges.filter(item => item.tag === 'pool-last')) {
    if (selected.size >= sampleSize) break;
    add(item.row, item.tag);
  }
  // Feature cases may overlap edge cases. Fill deterministically if necessary.
  if (selected.size < sampleSize) {
    const extra = readline.createInterface({ input: fs.createReadStream(path.join(directory, 'questions.jsonl')), crlfDelay: Infinity });
    for await (const line of extra) {
      const row = JSON.parse(line);
      if (!selected.has(row.key)) add(row, 'deterministic-fill');
      if (selected.size === sampleSize) break;
    }
  }
  assert.equal(selected.size, sampleSize);
  for (const tag of ['largest-a', 'longest-b', 'group-having', 'subquery', 'dml', 'ddl']) assert.ok(special.has(tag), 'Missing selection feature: ' + tag);
  return [...selected.values()];
}

async function install(page) {
  await page.evaluate(({ plugin, engine }) => {
    const sqlUrl = plugin + '/lib/sql.js/worker.sql.js', qssUrl = plugin + '/lib/qss/worker.qss.js';
    let nextId = 0, sql;
    function rpc(url) {
      const worker = new Worker(url);
      let active;
      worker.onmessage = ({ data }) => {
        if (!active || data.id !== active.id || data.type === 'progress') return;
        const pending = active; active = null; pending.resolve(data);
      };
      worker.onerror = event => { event.preventDefault(); if (active) { const pending = active; active = null; pending.resolve({ error: 'worker-error' }); } };
      return { worker, call: data => new Promise(resolve => { const id = ++nextId; active = { id, resolve }; worker.postMessage({ ...data, id }); }) };
    }
    const fresh = async buffer => {
      sql?.worker.terminate(); sql = rpc(sqlUrl);
      return sql.call({ action: 'open', ...(buffer ? { buffer } : {}) });
    };
    const exec = statement => statement.trim() ? sql.call({ action: 'exec', sql: statement }) : Promise.resolve({ results: [] });
    const relation = result => result.results?.length ? result.results.at(-1) : null;
    const semantic = value => value ? JSON.stringify({ columns: value.columns, rows: value.values.map(row => JSON.stringify(row)).sort() }) : null;
    async function prepare(a) {
      await fresh();
      const initial = await exec(a);
      if (initial.error) return { error: 'preparation-error' };
      const fk = relation(await exec('PRAGMA foreign_keys;'))?.values?.[0]?.[0] || 0;
      const snapshot = await sql.call({ action: 'export' });
      if (!snapshot.buffer) return { error: 'snapshot-error' };
      const tables = [];
      const names = await exec("SELECT name,type FROM sqlite_master WHERE type IN ('table','view') ORDER BY name;");
      if (names.error) return { error: 'schema-error' };
      for (const [name, type] of relation(names)?.values || []) {
        const info = await exec('PRAGMA table_info("' + name.replaceAll('"', '""') + '");');
        if (info.error) return { error: 'column-schema-error' };
        tables.push({ name, type, columns: (relation(info)?.values || []).map(row => ({ name: row[1], type: row[2], notNull: !!row[3], primaryKey: Number(row[5]) })) });
      }
      return { buffer: snapshot.buffer, fk, schema: { tables } };
    }
    async function execute(prepared, b, c) {
      await fresh(prepared.buffer);
      await exec('PRAGMA foreign_keys=' + (prepared.fk ? 1 : 0));
      const result = await exec(b);
      if (result.error) return { error: 'answer-execution-error' };
      const control = await exec(c);
      if (control.error) return { error: 'control-execution-error' };
      const output = relation(control) || relation(result);
      return output ? { relation: output } : { error: 'no-visible-result' };
    }
    function measure(reference, answer, schema, maxPoints) {
      // Every measurement includes construction, fetch/cache access, parsing and
      // startup of a new worker. Browser/network caches are not forcibly cleared.
      const started = performance.now(), worker = new Worker(qssUrl), id = ++nextId;
      return new Promise(resolve => {
        worker.onmessage = ({ data }) => {
          if (data.id !== id || data.type === 'progress') return;
          const elapsed = performance.now() - started, result = data.result || {};
          worker.terminate();
          resolve({ cold_worker_ms: elapsed, status: result.status || 'error', code: result.code || null,
            visited: Number.isFinite(result.visited) ? result.visited : null,
            distance: result.distance ?? null, lowerBound: result.lowerBound ?? null,
            points: result.points ?? null, exactWithinModel: result.exactWithinModel ?? null });
        };
        worker.onerror = event => {
          event.preventDefault(); const elapsed = performance.now() - started; worker.terminate();
          resolve({ cold_worker_ms: elapsed, status: 'error', code: 'worker-error', visited: null, distance: null, points: null });
        };
        // Match production scoring cutoff; no exact-distance override or deadline.
        worker.postMessage({ type: 'evaluate', id, reference, answer, schema, maxPoints, engine,
          referenceExecutionValid: true, answerExecutionValid: true });
      });
    }
    window.qssBenchmark = async row => {
      const start = performance.now(), prepared = await prepare(row.a);
      if (prepared.error) { sql?.worker.terminate(); return { status: prepared.error }; }
      const preparedAt = performance.now(), reference = await execute(prepared, row.b, row.c);
      if (reference.error) { sql?.worker.terminate(); return { status: reference.error }; }
      const executedAt = performance.now(), expected = semantic(reference.relation);
      const self = await measure(row.b, row.b, prepared.schema, row.maxPoints);
      let selected = null, invalid = 0, unchanged = 0, attempted = 0;
      const validationStart = performance.now();
      for (const candidate of row.candidates) {
        const changed = await execute(prepared, candidate.answer, row.c); attempted++;
        if (changed.error) { invalid++; continue; }
        if (semantic(changed.relation) === expected) { unchanged++; continue; }
        selected = candidate; break;
      }
      const validationMs = performance.now() - validationStart;
      const wrong = selected ? { mutation: selected.kind, ...await measure(row.b, selected.answer, prepared.schema, row.maxPoints) } :
        { status: 'skipped-no-valid-visible-change', cold_worker_ms: null, visited: null };
      sql?.worker.terminate(); sql = null;
      return { status: 'reference-executed', preparation_ms: preparedAt - start, reference_sql_ms: executedAt - preparedAt,
        candidate_validation_ms: validationMs, candidate_attempts: attempted, invalid_candidates: invalid,
        unchanged_candidates: unchanged, schema_tables: prepared.schema.tables.length, self, wrong };
    };
  }, { plugin, engine });
}

function distribution(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b), n = sorted.length;
  if (!n) return { n: 0, median: null, p95: null, max: null };
  return { n, median: n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2,
    p95: sorted[Math.ceil(n * 0.95) - 1], max: sorted[n - 1] };
}

async function main() {
  assert.ok(process.env.CHROME_CDP_URL, 'Supply the explicitly owned installed Chrome endpoint.');
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const selected = await selectQuestions();
  const browser = await chromium.connectOverCDP(process.env.CHROME_CDP_URL, { timeout: 120000 });
  context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage(); page.setDefaultTimeout(0);
  await page.route(`${base}/__qss_benchmark__`, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Private QSS latency sample</title>' }));
  await page.goto(`${base}/__qss_benchmark__`);
  assert.match(await page.evaluate(() => navigator.userAgent), /HeadlessChrome\//);
  const served = await page.request.get(base + workerPath); assert.equal(served.status(), 200);
  assert.equal(digest(await served.body()), expectedHash, 'Served worker hash differs from the pinned benchmark state.');
  await install(page);
  const report = { format: 1, engine, worker_sha256: expectedHash, browser: await browser.version(), headless: true,
    started_at: new Date().toISOString(), requested_questions: sampleSize, selected_questions: selected.length, results: [],
    methodology: { fresh_worker_per_measurement: true, interval: 'Before Worker constructor to final result event; includes startup.',
      cache: 'Fresh isolated browser context; later worker requests may use warmed browser/network caches.',
      execution: 'A establishes a real browser SQLite schema; B and C and each candidate run on fresh SQLite workers from its snapshot.',
      wrong_cases: 'One bounded literal/projection/comparison mutation, successful B+C and changed visible relation; no column-column predicate flips or join-structure changes.',
      no_execution_deadline: true, production_default_scoring_cutoff: true, p95: 'nearest rank',
      limitations: ['Purposive 20-question sample; not a statistical estimate for all questions.', 'Other exhaustive browser runs are active concurrently; CPU contention affects wall-clock latency.', 'Cold worker does not imply cold operating-system/browser HTTP caches.', 'Timing only; no grading fairness conclusion.'] } };
  const save = () => fs.writeFileSync(path.join(output, 'benchmark-report.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  save();
  for (const { row, tags } of selected) {
    const m = row.metadata, metrics = JSON.parse(m.SOLUTION_METRICS).map(v => typeof v === 'string' ? JSON.parse(v) : v);
    const input = { a: m.SEQUENCE_A, b: m.SEQUENCE_B, c: m.SEQUENCE_C,
      maxPoints: metrics.reduce((sum, metric) => sum + Number(metric.points), 0),
      candidates: mutations.errorCandidates(m.SEQUENCE_B).filter(c => ['literal', 'projection_expression', 'comparison'].includes(c.kind)) };
    const result = await page.evaluate(row => window.qssBenchmark(row), input);
    report.results.push({ key: row.key, pool: String(row.pool), selection: tags, a_characters: input.a.length, b_characters: input.b.length, ...result });
    save(); console.log('PASS: sample ' + report.results.length + '/20 key=' + row.key + ' self=' + result.self?.status + ' wrong=' + result.wrong?.status);
  }
  const finalWorker = await page.request.get(base + workerPath); assert.equal(digest(await finalWorker.body()), expectedHash);
  report.completed_at = new Date().toISOString();
  report.reference_statuses = {}; report.wrong_statuses = {};
  for (const row of report.results) {
    report.reference_statuses[row.status] = (report.reference_statuses[row.status] || 0) + 1;
    const status = row.wrong?.status || 'not-evaluated'; report.wrong_statuses[status] = (report.wrong_statuses[status] || 0) + 1;
  }
  report.self_cold_worker_ms = distribution(report.results.map(row => row.self?.cold_worker_ms));
  report.wrong_cold_worker_ms = distribution(report.results.map(row => row.wrong?.cold_worker_ms));
  report.self_graph_visited = distribution(report.results.map(row => row.self?.visited));
  report.wrong_graph_visited = distribution(report.results.map(row => row.wrong?.visited));
  save();
  console.log(JSON.stringify({ questions: report.results.length, self_ms: report.self_cold_worker_ms, wrong_ms: report.wrong_cold_worker_ms, wrong_statuses: report.wrong_statuses }));
}

main().then(async () => { await context?.close(); process.exit(0); }).catch(async error => {
  console.error('Benchmark failed: ' + error.message); await context?.close(); process.exit(1);
});
