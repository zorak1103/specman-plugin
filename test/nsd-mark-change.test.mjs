import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyMarkChange } from '../scripts/nsd-mark-change.mjs';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';

const src =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'mainSequence {\n' +
  '    simple(1, 5582897d, `a`, plain=`a`);\n' +
  '    while(2, e81623e9, `loop`, plain=`loop`) {\n' +
  '        simple(2.1, a6c0af76, `inner`, plain=`inner`);\n' +
  '    }\n' +
  '}\n';

test('applyMarkChange sets change=(added, changeset) on a simple step', () => {
  const result = applyMarkChange(src, { stepSelector: '1', kind: 'added', changeset: 'yellow' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.deepEqual(ast.mainSequence.steps[0].change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
});

test('applyMarkChange sets change=(removed, changeset) on a structured step (grammar update allows this now)', () => {
  const result = applyMarkChange(src, { stepSelector: 'e81623e9', kind: 'removed', changeset: 'blue' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.equal(ast.mainSequence.steps[1].change.kind, 'removed');
});

test('applyMarkChange clears an existing change mark', () => {
  const marked = applyMarkChange(src, { stepSelector: '1', kind: 'added', changeset: 'yellow' });
  const cleared = applyMarkChange(marked.text, { stepSelector: '1', kind: 'clear' });
  const ast = parseDiagram(cleared.text);
  assert.equal(ast.mainSequence.steps[0].change, undefined);
});

test('applyMarkChange refuses source/target (not supported in v1 — see plan)', () => {
  const result = applyMarkChange(src, { stepSelector: '1', kind: 'source', changeset: 'orange' });
  assert.equal(result.ok, false);
  assert.match(result.error, /source|target/i);
});

test('applyMarkChange reports a clear error for an unknown step', () => {
  const result = applyMarkChange(src, { stepSelector: '99', kind: 'added', changeset: 'yellow' });
  assert.equal(result.ok, false);
  assert.match(result.error, /not found/);
});
