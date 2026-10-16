import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getConfigValue, setConfigValue, abbreviateName } from '../scripts/specman-config.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'specman-config-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('getConfigValue returns undefined when the config file does not exist', () => {
  withTempDir((dir) => {
    const configPath = path.join(dir, '.claude', 'specman.local.md');
    assert.equal(getConfigValue(configPath, 'author'), undefined);
  });
});

test('setConfigValue creates the file with frontmatter on first write', () => {
  withTempDir((dir) => {
    const configPath = path.join(dir, '.claude', 'specman.local.md');
    setConfigValue(configPath, 'author', 'M. Mustermann');
    assert.equal(existsSync(configPath), true);
    const text = readFileSync(configPath, 'utf8');
    assert.match(text, /^---\n/);
    assert.match(text, /author: M. Mustermann/);
    assert.equal(getConfigValue(configPath, 'author'), 'M. Mustermann');
  });
});

test('setConfigValue upserts a key without disturbing other existing keys', () => {
  withTempDir((dir) => {
    const configPath = path.join(dir, '.claude', 'specman.local.md');
    setConfigValue(configPath, 'specDir', '/some/dir');
    setConfigValue(configPath, 'defaultChangeset', 'yellow');
    setConfigValue(configPath, 'author', 'M. Mustermann');
    assert.equal(getConfigValue(configPath, 'specDir'), '/some/dir');
    assert.equal(getConfigValue(configPath, 'defaultChangeset'), 'yellow');
    assert.equal(getConfigValue(configPath, 'author'), 'M. Mustermann');

    setConfigValue(configPath, 'author', 'M. Driesner');
    assert.equal(getConfigValue(configPath, 'specDir'), '/some/dir');
    assert.equal(getConfigValue(configPath, 'author'), 'M. Driesner');
  });
});

test('abbreviateName abbreviates every given name but the surname', () => {
  assert.equal(abbreviateName('Max Mustermann'), 'M. Mustermann');
  assert.equal(abbreviateName('Anna Maria Schmidt'), 'A. M. Schmidt');
});

test('abbreviateName leaves a single-token name untouched', () => {
  assert.equal(abbreviateName('Mustermann'), 'Mustermann');
});

test('abbreviateName collapses extra whitespace', () => {
  assert.equal(abbreviateName('  Max   Mustermann  '), 'M. Mustermann');
});
