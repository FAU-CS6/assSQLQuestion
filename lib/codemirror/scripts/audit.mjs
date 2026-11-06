import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';

// CVE-2026-93753 was rejected by its CNA on 2026-11-02 because it does not
// describe a vulnerability. npm still lists its advisory and affected parents.
// This exception is limited to this advisory on deepmerge; any new advisory on
// the same package, and every other advisory at any severity, still fails.
// https://github.com/CVEProject/cvelistV5/blob/main/cves/2026/93xxx/CVE-2026-93753.json
const withdrawn = 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4';

export function auditFindings(report) {
  if (report.error || !report.vulnerabilities || typeof report.vulnerabilities !== 'object') {
    throw new Error(`npm audit did not return a vulnerability report: ${JSON.stringify(report.error || report)}`);
  }
  const entries = report.vulnerabilities;
  const isActive = (name, visited = new Set()) => {
    if (visited.has(name) || !entries[name]) return true;
    const parents = new Set(visited).add(name);
    return entries[name].via.some(via => typeof via === 'string'
      ? isActive(via, parents)
      : !(name === 'deepmerge' && via.url === withdrawn));
  };
  return {
    active: Object.keys(entries).filter(name => isActive(name)),
    withdrawn: Object.keys(entries).filter(name => !isActive(name))
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['audit', '--package-lock-only', '--json'], {
        cwd: fileURLToPath(new URL('../', import.meta.url)), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024
      });
    if (result.error) throw result.error;
    if (result.signal || ![0, 1].includes(result.status)) {
      throw new Error(`npm audit failed (${result.status || result.signal}): ${result.stderr || result.stdout}`);
    }
    const report = JSON.parse(result.stdout);
    const findings = auditFindings(report);
    for (const name of findings.withdrawn) {
      console.log(`WITHDRAWN: ${name} (only CVE-2026-93753 or its dependency propagation)`);
    }
    for (const name of findings.active) console.error(`ACTIVE: ${name} (${report.vulnerabilities[name].severity})`);
    if (findings.active.length) process.exitCode = 1;
    else console.log('No active npm security advisories.');
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
