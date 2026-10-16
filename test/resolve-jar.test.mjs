import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveJarPath } from '../scripts/resolve-jar.mjs';

test('resolveJarPath returns the path when SPECMAN_JAR is set and the file exists', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'specman-'));
  const jarPath = path.join(dir, 'specman-1.3.0-jar-with-dependencies.jar');
  writeFileSync(jarPath, 'not a real jar, just needs to exist');
  try {
    const result = resolveJarPath({ SPECMAN_JAR: jarPath });
    assert.equal(result.ok, true);
    assert.equal(result.path, jarPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveJarPath fails clearly when SPECMAN_JAR is not set', () => {
  const result = resolveJarPath({});
  assert.equal(result.ok, false);
  assert.match(result.error, /SPECMAN_JAR/);
});

test('resolveJarPath fails clearly when SPECMAN_JAR points at a nonexistent file', () => {
  const result = resolveJarPath({ SPECMAN_JAR: 'C:/nonexistent/specman.jar' });
  assert.equal(result.ok, false);
  assert.match(result.error, /nicht gefunden/);
});
