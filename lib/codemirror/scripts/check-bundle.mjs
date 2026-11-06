import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const directory = fileURLToPath(new URL('../', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'ass-sql-editor-'));
try {
  const output = join(temporary, 'bundle.js');
  execFileSync(process.execPath, [join(directory, 'node_modules/rollup/dist/bin/rollup'),
    '--config', '--file', output], {cwd: directory, stdio: 'inherit'});
  if (!readFileSync(output).equals(readFileSync(join(directory, 'codemirror_sqlquestion.bundle.js')))) {
    throw new Error('The checked-in editor bundle is stale. Run npm run build and commit the bundle.');
  }
  console.log('The checked-in editor bundle matches a clean build.');
} finally {
  rmSync(temporary, {recursive: true, force: true});
}
