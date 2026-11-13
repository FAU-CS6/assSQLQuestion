import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {rollup} from 'rollup';
import commonjs from '@rollup/plugin-commonjs';
import configurations from '../rollup.config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..'), qss = path.resolve(here, '..');
const tests = path.join(repo, 'tests/qss'), adapters = path.join(tests, 'browser');
const require = createRequire(path.join(repo, 'tests/browser/package.json'));
const {chromium} = require('playwright');
const reports = path.resolve(process.env.QSS_TEST_REPORT_DIR || path.join(repo, 'test-results/qss'));
mkdirSync(reports, {recursive: true});

// These tests validate report files and mocked transport only. All SQL, graph
// search and generated-answer tests are bundled for the browser below.
const nodeTests = ['catalog-oracle.test.cjs', 'student-variant-oracle.test.cjs',
    'student-variants-gate.test.cjs', 'student-variants-resume.test.cjs'];
const files = readdirSync(tests).filter(name => /\.test\.(mjs|cjs)$/.test(name)).sort();
assert.ok(nodeTests.every(name => files.includes(name)));
const browserTests = files.filter(name => !nodeTests.includes(name));
execFileSync(process.execPath, ['--test', ...nodeTests.map(name => path.join(tests, name))], {stdio: 'inherit'});

const modules = new Map([
    ['node:test', path.join(adapters, 'test.mjs')],
    ['node:sqlite', path.join(adapters, 'sqlite.mjs')],
    ['node:vm', path.join(adapters, 'vm.mjs')]
]);
const entry = '\0qss-browser-tests';
const bridge = {
    name: 'qss-browser-test-adapters',
    resolveId(source) {
        if (source === entry) return entry;
        if (source === 'util') return path.join(qss, 'node_modules/util/util.js');
        if (modules.has(source)) return modules.get(source);
        if (['node:assert/strict', 'node:fs', 'node:module'].includes(source)) return '\0' + source;
        if (source.startsWith('node:')) throw new Error('No browser test adapter for ' + source);
    },
    transform(code, id) {
        if (id.startsWith(tests + path.sep)) {
            return code.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(id).href));
        }
    },
    load(id) {
        if (id === entry) return browserTests.map(name => 'import ' + JSON.stringify(path.join(tests, name)) + ';').join('\n')
            + '\nexport {run} from ' + JSON.stringify(path.join(adapters, 'test.mjs')) + ';';
        if (id === '\0node:assert/strict') return 'import assert from '
            + JSON.stringify(path.join(qss, 'node_modules/assert/build/assert.js')) + '; export default assert.strict;';
        if (id === '\0node:module') return 'import fixtures from ' + JSON.stringify(path.join(tests, 'fixture-mutations.cjs')) + `;
            export const createRequire = () => name => {
                if (name === './fixture-mutations.cjs') return fixtures;
                throw new Error('Nested CDP oracle must run separately: ' + name);
            };`;
        if (id === '\0node:fs') {
            const contents = Object.fromEntries(['qss.js', 'worker.qss.js'].map(name =>
                [pathToFileURL(path.join(qss, name)).href, readFileSync(path.join(qss, name), 'utf8')]));
            return `const files = ${JSON.stringify(contents)};
                export function readFileSync(url, encoding) {
                    if (encoding !== 'utf8' || !Object.hasOwn(files, String(url))) throw new Error('Unexpected browser fs request: ' + url);
                    return files[String(url)];
                }`;
        }
    }
};
const bundle = await rollup({input: entry, plugins: [bridge, ...configurations[0].plugins.map(plugin =>
    plugin.name === 'commonjs' ? commonjs({requireReturnsDefault: 'preferred'}) : plugin)]});
let code;
try {
    const result = await bundle.generate({format: 'iife', name: 'QssBrowserTests',
        intro: 'var process = {env: {}}; var global = globalThis;'});
    code = result.output[0].code;
} finally { await bundle.close(); }

const assets = new Map([
    ['/', ['text/html', '<!doctype html><title>Isolated QSS tests</title>']],
    ['/tests.js', ['text/javascript', code]],
    ['/sql.js', ['text/javascript', readFileSync(path.join(repo, 'lib/sql.js/sql.js'))]]
]);
const server = http.createServer((req, res) => {
    const asset = assets.get(req.url);
    if (!asset) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {'Content-Type': asset[0]}); res.end(asset[1]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
    browser = await chromium.launch({channel: 'chrome', headless: true, timeout: 0});
    const context = await browser.newContext();
    context.setDefaultTimeout(0); context.setDefaultNavigationTimeout(0);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => {
        errors.push(error.stack || String(error));
        console.error(error.stack || String(error));
    });
    await page.exposeFunction('reportQssTest', result => {
        console.log((result.skipped ? 'SKIP ' : result.passed ? 'PASS ' : 'FAIL ') + result.name);
        if (result.error) console.error(result.error);
    });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.addScriptTag({url: '/sql.js'});
    const sqlite = await page.evaluate(() => {
        const db = new SQL.Database();
        try { return db.exec('SELECT sqlite_version()')[0].values[0][0]; }
        finally { db.close(); }
    });
    assert.equal(sqlite, '3.22.0', 'Use the shipped SQLite runtime.');
    await page.addScriptTag({url: '/tests.js'});
    assert.equal(errors.length, 0, 'Browser test bundle failed to load: ' + JSON.stringify(errors));
    const results = await page.evaluate(() => QssBrowserTests.run());
    const report = {at: new Date().toISOString(), chrome: browser.version(), sqlite, files: browserTests,
        tests: results.length, passed: results.filter(row => row.passed).length,
        skipped: results.filter(row => row.skipped).length, failed: results.filter(row => row.passed === false), errors, results};
    writeFileSync(path.join(reports, 'browser-tests.json'), JSON.stringify(report, null, 2) + '\n');
    assert.ok(results.length > 0, 'No browser tests registered.');
    assert.equal(errors.length, 0, JSON.stringify(errors));
    assert.equal(report.failed.length, 0, 'Browser test failures; see test-results/qss/browser-tests.json.');
    console.log(`${report.passed} browser tests passed; ${report.skipped} separately declared CDP oracles skipped; SQLite ${sqlite}.`);
} finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
}
