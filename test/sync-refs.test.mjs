import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractRefs, resolveCurrentStepNum, applySyncRefs } from '../scripts/sync-refs.mjs';

test('extractRefs finds a Java-Javadoc-style SUC reference', () => {
  const src = '/** SUC-902 Schritt 1.4.5 (ID: a6c0af76) */\nvoid doThing() {}\n';
  const refs = extractRefs(src);
  assert.equal(refs.length, 1);
  assert.deepEqual(refs[0], { fullMatch: 'SUC-902 Schritt 1.4.5 (ID: a6c0af76)', sucNumber: '902', keyword: 'Schritt', stepNum: '1.4.5', stepId: 'a6c0af76' });
});

test('extractRefs finds a TS/JSDoc-style SUC reference', () => {
  const src = '/**\n * Implements SUC-903.2 Schritt 3 (ID: e0dc4407)\n */\nexport function x() {}\n';
  const refs = extractRefs(src);
  assert.equal(refs.length, 1);
  assert.equal(refs[0].sucNumber, '903.2');
  assert.equal(refs[0].stepId, 'e0dc4407');
});

test('extractRefs finds multiple references in one file', () => {
  const src = 'SUC-1 Schritt 1 (ID: aaaaaaaa) and SUC-2 Schritt 2 (ID: bbbbbbbb)';
  const refs = extractRefs(src);
  assert.equal(refs.length, 2);
});

test('resolveCurrentStepNum finds the current step number for an id in a diagram', () => {
  const nsdText =
    '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'mainSequence {\n    simple(4, a6c0af76, `x`, plain=`x`);\n}\n';
  assert.equal(resolveCurrentStepNum(nsdText, 'a6c0af76'), '4');
});

test('resolveCurrentStepNum returns null when the id no longer exists', () => {
  const nsdText =
    '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'mainSequence {\n    simple(4, a6c0af76, `x`, plain=`x`);\n}\n';
  assert.equal(resolveCurrentStepNum(nsdText, 'ffffffff'), null);
});

test('applySyncRefs rewrites a stale step number and leaves a correct one untouched', () => {
  const src = 'SUC-1 Schritt 1.4.5 (ID: a6c0af76)\nSUC-1 Schritt 4 (ID: e0dc4407)\n';
  const findNsd = (sucNumber) => (sucNumber === '1' ? nsdWithTwoSteps : null);
  const result = applySyncRefs(src, findNsd);
  assert.equal(result.ok, true);
  assert.match(result.text, /SUC-1 Schritt 4 \(ID: a6c0af76\)/);
  assert.match(result.text, /SUC-1 Schritt 2 \(ID: e0dc4407\)/);
  assert.equal(result.changedCount, 2);
});

const nsdWithTwoSteps =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'mainSequence {\n    simple(4, a6c0af76, `x`, plain=`x`);\n    simple(2, e0dc4407, `y`, plain=`y`);\n}\n';

test('applySyncRefs leaves a reference alone (and reports it) when the spec file cannot be found', () => {
  const src = 'SUC-99 Schritt 1 (ID: a6c0af76)\n';
  const result = applySyncRefs(src, () => null);
  assert.equal(result.ok, true);
  assert.equal(result.changedCount, 0);
  assert.equal(result.unresolved.length, 1);
});

test('extractRefs recognises the English keyword and the legacy German one', () => {
  const refs = extractRefs('SUC-1 Step 2 (ID: aaaaaaaa) and SUC-2 Schritt 3 (ID: bbbbbbbb)');
  assert.deepEqual(refs.map((r) => r.keyword), ['Step', 'Schritt']);
  assert.deepEqual(refs.map((r) => r.stepNum), ['2', '3']);
});

test('applySyncRefs rewrites only the number and keeps the keyword each comment already uses', () => {
  const src = 'SUC-1 Step 1.4.5 (ID: a6c0af76)\nSUC-1 Schritt 4 (ID: e0dc4407)\n';
  const result = applySyncRefs(src, (n) => (n === '1' ? nsdWithTwoSteps : null));
  assert.match(result.text, /SUC-1 Step 4 \(ID: a6c0af76\)/);
  assert.match(result.text, /SUC-1 Schritt 2 \(ID: e0dc4407\)/);
});

test('applySyncRefs reports unresolved references in English', () => {
  const result = applySyncRefs('SUC-99 Step 1 (ID: a6c0af76)\n', () => null);
  assert.equal(result.unresolved[0].reason, 'spec file not found');
  const gone = applySyncRefs('SUC-1 Step 1 (ID: ffffffff)\n', (n) => (n === '1' ? nsdWithTwoSteps : null));
  assert.equal(gone.unresolved[0].reason, 'ID no longer present in the spec');
});
