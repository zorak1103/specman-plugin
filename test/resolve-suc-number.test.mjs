import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { proposeSucNumber } from '../scripts/resolve-suc-number.mjs';

function withTempDir(fn) {
  const dir = mkdtempSync(path.join(tmpdir(), 'specman-suc-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('proposes the first top-level number in an empty directory', () => {
  withTempDir((dir) => {
    const result = proposeSucNumber(dir, { parent: undefined });
    assert.equal(result.ok, true);
    assert.equal(result.number, '1');
  });
});

test('proposes the first top-level number from an explicit base (e.g. a 9xx-topic folder)', () => {
  withTempDir((dir) => {
    const result = proposeSucNumber(dir, { parent: undefined, base: 900 });
    assert.equal(result.number, '901');
  });
});

test('proposes the next free top-level number after existing ones', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'SUC-901 Administration anzeigen.nsd'), '');
    writeFileSync(path.join(dir, 'SUC-902 Formeleditor anzeigen.nsd'), '');
    const result = proposeSucNumber(dir, { parent: undefined });
    assert.equal(result.number, '903');
  });
});

test('proposes the first sub-number for a given parent', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'SUC-902 Formeleditor anzeigen.nsd'), '');
    const result = proposeSucNumber(dir, { parent: '902' });
    assert.equal(result.number, '902.1');
  });
});

test('proposes the next free sub-number, skipping used ones at that exact nesting level', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'SUC-902.1.1 Testbilanz laden.nsd'), '');
    writeFileSync(path.join(dir, 'SUC-902.1.2 Formel testen.nsd'), '');
    writeFileSync(path.join(dir, 'SUC-902.2 Formelsatz freigeben.nsd'), '');
    const result = proposeSucNumber(dir, { parent: '902' });
    assert.equal(result.number, '902.3');
  });
});

test('proposes the next free grandchild sub-number under a specific parent', () => {
  withTempDir((dir) => {
    writeFileSync(path.join(dir, 'SUC-902.1.1 Testbilanz laden.nsd'), '');
    writeFileSync(path.join(dir, 'SUC-902.1.2 Formel testen.nsd'), '');
    const result = proposeSucNumber(dir, { parent: '902.1' });
    assert.equal(result.number, '902.1.3');
  });
});

test('reports a clear error when the directory does not exist', () => {
  const result = proposeSucNumber('C:/nonexistent/dir', { parent: undefined });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/);
});
