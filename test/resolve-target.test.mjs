import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveTarget } from '../scripts/resolve-target.mjs';

test('resolveTarget returns the .nsd path unchanged when no .wrk exists', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'specman-'));
  const nsdPath = path.join(dir, 'SUC-001.nsd');
  writeFileSync(nsdPath, 'irrelevant');
  try {
    const result = resolveTarget(nsdPath);
    assert.equal(result.path, nsdPath);
    assert.equal(result.usingWorkingCopy, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveTarget prefers the .wrk when it exists (Specman autoload in progress)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'specman-'));
  const nsdPath = path.join(dir, 'SUC-001.nsd');
  const wrkPath = `${nsdPath}.wrk`;
  writeFileSync(nsdPath, 'irrelevant');
  writeFileSync(wrkPath, 'irrelevant');
  try {
    const result = resolveTarget(nsdPath);
    assert.equal(result.path, wrkPath);
    assert.equal(result.usingWorkingCopy, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveTarget fails clearly when the .nsd itself does not exist', () => {
  const result = resolveTarget('C:/nonexistent/SUC-999.nsd');
  assert.equal(result.ok, false);
  assert.match(result.error, /nicht gefunden/);
});
