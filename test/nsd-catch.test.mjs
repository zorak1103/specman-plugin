import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCatch } from '../scripts/nsd-catch.mjs';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';
import { listCatches, listSequences } from '../scripts/lib/nsd-paths.mjs';

const src =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'mainSequence {\n' +
  '    simple(1, 5582897d, `a`, plain=`a`);\n' +
  '    break(2, 6131450e, `brk`, plain=`brk`);\n' +
  '    while(3, e81623e9, `loop`, plain=`loop`) {\n' +
  '        break(3.1, 79866663, `inner`, plain=`inner`);\n' +
  '    }\n' +
  '    doWhile(4, fde99ef2, `dw`, plain=`dw`) {\n' +
  '        break(4.1, 074ad64c, `dwb`, plain=`dwb`);\n' +
  '    }\n' +
  '}\n';

test('add creates a catchArea and a catch with one placeholder body step', () => {
  const r = applyCatch(src, { op: 'add', breakId: '6131450e', head: 'Fehler beim Speichern' });
  assert.equal(r.ok, true);
  assert.equal(r.bodyKey, 'main.catch[0].body');
  assert.equal(r.placeholderStepIds.length, 1);
  const ast = parseDiagram(r.text);
  const c = ast.mainSequence.catchArea.catches[0];
  assert.equal(c.breakStepNum, '2');
  assert.match(c.content.head.html, /Fehler beim Speichern/);
  assert.equal(c.body.length, 1);
  assert.equal(c.body[0].stepId, r.placeholderStepIds[0]);
});

test('add escapes plain-text heads; --head-html passes raw markup through', () => {
  const r1 = applyCatch(src, { op: 'add', breakId: '6131450e', head: 'Größe <1' });
  assert.match(parseDiagram(r1.text).mainSequence.catchArea.catches[0].content.head.html, /Gr&#246;&#223;e &lt;1/);
  const r2 = applyCatch(src, { op: 'add', breakId: '6131450e', headHtml: '<b>Ausnahme</b>' });
  assert.equal(parseDiagram(r2.text).mainSequence.catchArea.catches[0].content.head.html, '<b>Ausnahme</b>');
});

test('the catch body key is a sequence nsd-locate/nsd-insert-step can address', () => {
  const r = applyCatch(src, { op: 'add', breakId: '6131450e', head: 'x' });
  const ast = parseDiagram(r.text);
  assert.ok(listSequences(ast).some((s) => s.key === r.bodyKey));
  assert.deepEqual(listCatches(ast).uncaughtBreaks.map((b) => b.stepId), ['79866663', '074ad64c']);
});

test('add defaults to the nearest sequence that may hold a catchArea; --parent picks a higher one', () => {
  const near = applyCatch(src, { op: 'add', breakId: '79866663', head: 'x' });
  assert.equal(near.bodyKey, 'step:e81623e9.body.catch[0].body');
  const high = applyCatch(src, { op: 'add', breakId: '79866663', head: 'x', parentKey: 'main' });
  assert.equal(high.bodyKey, 'main.catch[0].body');
});

test('add for a break inside a doWhile falls back to the enclosing main sequence (doWhile has no catchArea)', () => {
  const r = applyCatch(src, { op: 'add', breakId: '074ad64c', head: 'x' });
  assert.equal(r.bodyKey, 'main.catch[0].body');
});

test('add refuses a non-break step, an unknown step, a duplicate catch and a bad --parent', () => {
  assert.match(applyCatch(src, { op: 'add', breakId: '5582897d', head: 'x' }).error, /break/);
  assert.equal(applyCatch(src, { op: 'add', breakId: 'deadbeef', head: 'x' }).ok, false);
  const once = applyCatch(src, { op: 'add', breakId: '6131450e', head: 'x' });
  const twice = applyCatch(once.text, { op: 'add', breakId: '6131450e', head: 'y' });
  assert.equal(twice.ok, false);
  assert.match(twice.error, /already exists/);
  assert.equal(applyCatch(src, { op: 'add', breakId: '6131450e', head: 'x', parentKey: 'step:e81623e9.body' }).ok, false);
});

test('add requires --head or --head-html', () => {
  assert.equal(applyCatch(src, { op: 'add', breakId: '6131450e' }).ok, false);
});

test('set-head replaces the catch heading', () => {
  const added = applyCatch(src, { op: 'add', breakId: '6131450e', head: 'alt' });
  const r = applyCatch(added.text, { op: 'set-head', breakId: '6131450e', head: 'neu' });
  assert.equal(r.ok, true);
  const c = parseDiagram(r.text).mainSequence.catchArea.catches[0];
  assert.match(c.content.head.html, /neu/);
  assert.equal(c.content.head.plain, undefined);
});

test('remove drops the catch and the catchArea once it is empty', () => {
  const added = applyCatch(src, { op: 'add', breakId: '6131450e', head: 'x' });
  const r = applyCatch(added.text, { op: 'remove', breakId: '6131450e' });
  assert.equal(r.ok, true);
  assert.equal(parseDiagram(r.text).mainSequence.catchArea, undefined);
});

test('remove/set-head fail when there is no catch for the break', () => {
  assert.equal(applyCatch(src, { op: 'remove', breakId: '6131450e' }).ok, false);
  assert.equal(applyCatch(src, { op: 'set-head', breakId: '6131450e', head: 'x' }).ok, false);
});

test('unknown op is refused', () => {
  assert.match(applyCatch(src, { op: 'zap', breakId: '6131450e' }).error, /op/);
});
