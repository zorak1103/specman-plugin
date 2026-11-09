import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify, normalize } from '../scripts/migrate-verify.mjs';
import { buildFromPlan } from '../scripts/lib/nsd-plan.mjs';
import { extractDocx } from '../scripts/lib/docx-reader.mjs';
import { makeDocx, para } from './helpers/docx.mjs';

const TEMPLATE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reference', 'suc-template.nsd'), 'utf8',
);

const extract = extractDocx(makeDocx(para('Der User klickt auf „Speichern“.') + para('Das System prüft die Eingabe.') + para('Label')));
const plan = {
  number: 'SUC-777', title: 'T',
  main: { steps: [{ kind: 'simple', content: { ref: 'p1' } }, { kind: 'simple', content: { ref: 'p2' } }] },
  ignored: [{ ids: ['p3'], reason: 'Beschriftung' }],
};

test('normalize unifies quotes, dashes, whitespace and nbsp', () => {
  assert.equal(normalize('„a“ – b   c'), '"a" - b c');
});

test('verify passes for a faithful migration and counts what it checked', () => {
  const built = buildFromPlan({ templateText: TEMPLATE, plan, extract });
  assert.equal(built.ok, true, built.error);
  const result = verify({ extract, nsdText: built.text, plan });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.checkedParagraphs, 2);
  assert.equal(result.excusedByPlan, 1);
});

test('verify reports a paragraph that is missing from the nsd', () => {
  const built = buildFromPlan({ templateText: TEMPLATE, plan, extract });
  const tampered = built.text.replace('Das System pr&#252;ft die Eingabe.', 'Etwas ganz anderes.');
  const result = verify({ extract, nsdText: tampered, plan });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.map((m) => m.id), ['p2']);
});

test('verify detects a changed number of steps against the plan', () => {
  const built = buildFromPlan({ templateText: TEMPLATE, plan, extract });
  const shorter = { ...plan, main: { steps: [plan.main.steps[0]] } };
  const result = verify({ extract, nsdText: built.text, plan: shorter });
  assert.equal(result.ok, false);
  assert.match(result.error, /Steps: plan 1\/0/);
});

test('verify detects a differing image count', () => {
  const built = buildFromPlan({ templateText: TEMPLATE, plan, extract });
  const withImage = { ...extract, images: [{ id: 'i1' }] };
  const result = verify({ extract: withImage, nsdText: built.text });
  assert.equal(result.ok, false);
  assert.match(result.error, /Images: docx 1, \.nsd 0/);
});

test('verify tolerates reflowed text (paragraphs merged into one step)', () => {
  const merged = {
    ...plan,
    main: { steps: [{ kind: 'simple', content: { ref: ['p1', 'p2'] } }] },
  };
  const built = buildFromPlan({ templateText: TEMPLATE, plan: merged, extract });
  assert.equal(verify({ extract, nsdText: built.text, plan: merged }).ok, true);
});

test('verify reports unparsable nsd text', () => {
  assert.equal(verify({ extract, nsdText: 'kein nsd' }).ok, false);
});

test('verify excuses reworded paragraphs but lists them separately from the ignored ones', () => {
  const reworded = {
    ...plan,
    main: { steps: [{ kind: 'simple', content: { ref: 'p1' } }, { kind: 'simple', content: 'Wird die Eingabe geprüft?' }] },
    reworded: [{ ids: ['p2'], reason: 'Zu Frage umformuliert (Freigabe des Nutzers)' }],
  };
  const built = buildFromPlan({ templateText: TEMPLATE, plan: reworded, extract });
  assert.equal(built.ok, true, built.error);
  const result = verify({ extract, nsdText: built.text, plan: reworded });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.reworded.map((r) => r.id), ['p2']);
  assert.equal(result.excusedByPlan, 1);
  assert.equal(result.checkedParagraphs, 1);
});

test('verify without reworded reports the rephrased paragraph as missing', () => {
  const built = buildFromPlan({
    templateText: TEMPLATE,
    plan: { ...plan, main: { steps: [{ kind: 'simple', content: { ref: 'p1' } }, { kind: 'simple', content: { ref: 'p2' } }] } },
    extract,
  });
  const rephrased = built.text.replace('Das System pr&#252;ft die Eingabe.', 'Wird die Eingabe gepr&#252;ft?');
  const result = verify({ extract, nsdText: rephrased, plan });
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing.map((m) => m.id), ['p2']);
});
