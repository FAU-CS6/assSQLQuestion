import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const source = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = mkdtempSync(path.join(tmpdir(), 'asssql-qss-build-'));
try {
    for (const name of ['src', 'upstream', 'cost-catalog.json', 'package.json', 'rollup.config.mjs']) cpSync(path.join(source, name), path.join(temporary, name), {recursive: true});
    symlinkSync(path.join(source, 'node_modules'), path.join(temporary, 'node_modules'), 'dir');
    execFileSync(process.execPath, [path.join(source, 'node_modules/rollup/dist/bin/rollup'), '--config'], {cwd: temporary, stdio: 'pipe'});
    for (const name of ['qss.js', 'worker.qss.js']) {
        const expected = readFileSync(path.join(source, name)), rebuilt = readFileSync(path.join(temporary, name));
        assert.ok(expected.equals(rebuilt), name + ' differs from the clean source build; run npm run build.');
        console.log(name + ': ' + createHash('sha256').update(rebuilt).digest('hex'));
    }
} finally { rmSync(temporary, {recursive: true, force: true}); }
