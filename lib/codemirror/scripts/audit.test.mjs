import assert from 'node:assert/strict';
import test from 'node:test';
import {auditFindings} from './audit.mjs';

const rejected = {url: 'https://github.com/advisories/GHSA-gcqx-w48m-w2h4'};
const active = {url: 'https://github.com/advisories/some-new-advisory'};

test('ignores the withdrawn CVE and only parents that propagate that finding', () => {
  assert.deepEqual(auditFindings({vulnerabilities: {
    deepmerge: {via: [rejected]},
    '@rollup/plugin-node-resolve': {via: ['deepmerge']}
  }}), {active: [], withdrawn: ['deepmerge', '@rollup/plugin-node-resolve']});
});

test('a new deepmerge advisory and its parents remain failures', () => {
  assert.deepEqual(auditFindings({vulnerabilities: {
    deepmerge: {via: [rejected, active]},
    '@rollup/plugin-node-resolve': {via: ['deepmerge']}
  }}).active, ['deepmerge', '@rollup/plugin-node-resolve']);
});

test('does not ignore the same URL on another package or unrelated findings', () => {
  assert.deepEqual(auditFindings({vulnerabilities: {
    other: {via: [rejected]}, rollup: {via: [active]}
  }}).active, ['other', 'rollup']);
});

test('incomplete dependency reports are treated as active findings', () => {
  assert.deepEqual(auditFindings({vulnerabilities: {parent: {via: ['missing']}}}).active, ['parent']);
});

test('network and invalid audit reports fail instead of being treated as clean', () => {
  assert.throws(() => auditFindings({error: {code: 'ENOTFOUND'}}));
  assert.throws(() => auditFindings({}));
});
