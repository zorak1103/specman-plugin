import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyInsertStep } from '../scripts/nsd-insert-step.mjs';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';
import { addressableAreas, resolveArea } from '../scripts/lib/nsd-paths.mjs';

const src =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'mainSequence {\n' +
  '    simple(1, 5582897d, `first`, plain=`first`);\n' +
  '    simple(2, e0dc4407, `second`, plain=`second`);\n' +
  '}\n';

test('applyInsertStep inserts a new simple step at the start of a sequence', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'start', kind: 'simple', html: 'brand new' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.equal(ast.mainSequence.steps.length, 3);
  assert.equal(ast.mainSequence.steps[0].content.head.html, 'brand new');
});

test('applyInsertStep inserts after a named step', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'after:5582897d', kind: 'simple', html: 'middle' });
  const ast = parseDiagram(result.text);
  assert.equal(ast.mainSequence.steps[1].content.head.html, 'middle');
});

test('applyInsertStep inserts at the end of a sequence', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'break', html: 'last' });
  const ast = parseDiagram(result.text);
  assert.equal(ast.mainSequence.steps.length, 3);
  assert.equal(ast.mainSequence.steps[2].kind, 'break');
});

test('applyInsertStep assigns a fresh, unique step number and 8-hex step id', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'simple', html: 'x' });
  const ast = parseDiagram(result.text);
  const inserted = ast.mainSequence.steps[2];
  assert.match(inserted.stepId, /^[0-9a-f]{8}$/);
  assert.notEqual(inserted.stepNum, '1');
  assert.notEqual(inserted.stepNum, '2');
});

test('applyInsertStep produces text the sanitizer-compatible AST can re-parse', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'simple', html: 'x' });
  assert.doesNotThrow(() => parseDiagram(result.text));
});

test('applyInsertStep reports a clear error for an unknown parent key', () => {
  const result = applyInsertStep(src, { parentKey: 'step:nonexistent.body', position: 'end', kind: 'simple', html: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /nicht gefunden/);
});

test('applyInsertStep rejects an unknown kind', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'nonsense', html: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /kennt kein Kind/);
});

test('applyInsertStep rejects HTML containing a backtick', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'simple', html: 'a `quote`' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Backtick/);
});

test('applyInsertStep builds a while step with one placeholder step in its body', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'while', html: 'loop' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const inserted = ast.mainSequence.steps[2];
  assert.equal(inserted.kind, 'while');
  assert.equal(inserted.body.length, 1);
  assert.equal(inserted.body[0].content.head.html, 'TODO Schritt');
  assert.deepEqual(result.placeholderStepIds, [inserted.body[0].stepId]);
});

test('applyInsertStep builds a doWhile step with one placeholder step in its body', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'doWhile', html: 'loop' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.equal(ast.mainSequence.steps[2].kind, 'doWhile');
  assert.equal(ast.mainSequence.steps[2].body.length, 1);
});

test('applyInsertStep builds a subsequence step with one placeholder step in its body', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'subsequence', html: 'sub' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.equal(ast.mainSequence.steps[2].kind, 'subsequence');
  assert.equal(ast.mainSequence.steps[2].body.length, 1);
});

test('applyInsertStep builds an if step with one placeholder branch', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'if', html: 'cond' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const inserted = ast.mainSequence.steps[2];
  assert.equal(inserted.kind, 'if');
  assert.equal(inserted.ifBranch.content.head.html, 'TODO Ueberschrift');
  assert.equal(inserted.ifBranch.body.length, 1);
  assert.equal(result.placeholderStepIds.length, 1);
});

test('applyInsertStep builds an ifElse step with two placeholder branches', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'ifElse', html: 'cond' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const inserted = ast.mainSequence.steps[2];
  assert.equal(inserted.ifBranch.body.length, 1);
  assert.equal(inserted.elseBranch.body.length, 1);
  assert.equal(result.placeholderStepIds.length, 2);
  assert.notEqual(result.placeholderStepIds[0], result.placeholderStepIds[1]);
});

test('applyInsertStep builds a case step with a default branch and 2 case branches by default', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'case', html: 'switch' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const inserted = ast.mainSequence.steps[2];
  assert.equal(inserted.defaultBranch.body.length, 1);
  assert.equal(inserted.caseBranches.length, 2);
  assert.equal(result.placeholderStepIds.length, 3);
});

test('applyInsertStep builds a case step with a custom number of case branches', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'case', html: 'switch', branches: 4 });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.equal(ast.mainSequence.steps[2].caseBranches.length, 4);
});

test('applyInsertStep rejects fewer than 2 case branches', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'case', html: 'switch', branches: 1 });
  assert.equal(result.ok, false);
  assert.match(result.error, /mindestens 2/);
});

test('applyInsertStep produces structured steps whose branch headings are addressable and settable', () => {
  const result = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'ifElse', html: 'cond' });
  const ast = parseDiagram(result.text);
  const inserted = ast.mainSequence.steps[2];
  const areas = addressableAreas(inserted);
  assert.ok(areas.some((a) => a.key === 'ifBranch.head'));
  assert.ok(areas.some((a) => a.key === 'elseBranch.head'));
  assert.equal(resolveArea(inserted, 'ifBranch.head').html, 'TODO Ueberschrift');
});

// ---------------------------------------------------------------------------
// --id: caller-supplied stable step ID
// ---------------------------------------------------------------------------

test('--id keeps the given step ID on the inserted step', () => {
  const r = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'simple', html: 'moved', id: 'a1b2c3d4' });
  assert.equal(r.ok, true);
  assert.equal(r.insertedStepId, 'a1b2c3d4');
  assert.match(r.text, /simple\([^,]+, a1b2c3d4, `moved`/);
});

test('--id also works for a structured kind (id goes on the structured step, placeholders stay random)', () => {
  const r = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'while', html: 'loop', id: 'a1b2c3d4' });
  assert.equal(r.insertedStepId, 'a1b2c3d4');
  assert.equal(r.placeholderStepIds.length, 1);
  assert.notEqual(r.placeholderStepIds[0], 'a1b2c3d4');
});

test('--id must be 8 lowercase hex digits', () => {
  for (const bad of ['xyz', 'A1B2C3D4', 'a1b2c3d', 'a1b2c3d45']) {
    const r = applyInsertStep(src, { parentKey: 'main', position: 'end', kind: 'simple', html: 'x', id: bad });
    assert.equal(r.ok, false, bad);
    assert.match(r.error, /8/);
  }
});

test('--id must be unique diagram-wide, including inside catch bodies', () => {
  const withCatch =
    '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'mainSequence {\n    break(1, 6131450e, `b`, plain=`b`);\n    catchArea {\n        catch(1, `b`, plain=`b`) {\n            simple(1.1, 92dc561b, `h`, plain=`h`);\n        }\n    }\n}\n';
  for (const taken of ['6131450e', '92dc561b']) {
    const r = applyInsertStep(withCatch, { parentKey: 'main', position: 'end', kind: 'simple', html: 'x', id: taken });
    assert.equal(r.ok, false);
    assert.match(r.error, /eindeutig|bereits/);
  }
});
