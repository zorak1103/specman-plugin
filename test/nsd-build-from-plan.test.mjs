import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFile } from '../scripts/nsd-build-from-plan.mjs';
import { readHistory } from '../scripts/nsd-history.mjs';
import { extractDocx } from '../scripts/lib/docx-reader.mjs';
import { makeDocx, para } from './helpers/docx.mjs';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'build-test-'));
  const extract = extractDocx(makeDocx(para('Der User klickt.')));
  const plan = { number: 'SUC-777', title: 'T', main: { steps: [{ kind: 'simple', content: { ref: 'p1' } }] } };
  writeFileSync(join(dir, 'extract.json'), JSON.stringify(extract));
  writeFileSync(join(dir, 'plan.json'), JSON.stringify(plan));
  return { planPath: join(dir, 'plan.json'), extractPath: join(dir, 'extract.json'), outPath: join(dir, 'out.nsd') };
}

test('buildFile appends the migration row to the history when asked, also on a forced rebuild', () => {
  const paths = setup();
  const migration = { version: '3.0', author: 'M. Driesner', followup: '-', date: '01.02.2026' };
  assert.equal(buildFile({ ...paths, migration }).ok, true);
  const rebuilt = buildFile({ ...paths, force: true, migration });
  assert.equal(rebuilt.ok, true, rebuilt.error);
  const rows = readHistory(readFileSync(paths.outPath, 'utf8')).rows ?? [];
  const migrationRows = JSON.stringify(rows).match(/Migration von Word nach Specman/g) ?? [];
  assert.equal(migrationRows.length, 1);
});

test('buildFile without migration leaves the history alone', () => {
  const paths = setup();
  assert.equal(buildFile(paths).ok, true);
  assert.doesNotMatch(readFileSync(paths.outPath, 'utf8'), /Migration von Word/);
});
