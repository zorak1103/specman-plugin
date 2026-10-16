import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate } from '../scripts/nsd-locate.mjs';

const src =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'mainSequence {\n' +
  '    simple(1, 5582897d, `a`, plain=`a`);\n' +
  '    while(2, e81623e9, `loop`, plain=`loop`) {\n' +
  '        simple(2.1, a6c0af76, `inner`, plain=`inner`);\n' +
  '    }\n' +
  '}\n';

test('locate without a step selector lists sequences only', () => {
  const result = locate(src, undefined);
  assert.equal(result.ok, true);
  assert.ok(result.sequences.some((s) => s.key === 'main'));
  assert.equal(result.step, undefined);
});

test('locate always reports the diagram settings (changeModeEnabled, changeSetName)', () => {
  const withSettings =
    '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'settings {\n    changeModeEnabled=true\n    changeSetName=yellow\n}\n' +
    'mainSequence {\n    simple(1, 5582897d, `a`, plain=`a`);\n}\n';
  const result = locate(withSettings, undefined);
  assert.equal(result.settings.changeModeEnabled, true);
  assert.equal(result.settings.changeSetName, 'yellow');
});

test('locate reports settings as absent (not an error) when the diagram has no settings block', () => {
  const result = locate(src, undefined);
  assert.equal(result.settings, undefined);
});

test('locate with a step number selector finds the step and its parent key', () => {
  const result = locate(src, '2.1');
  assert.equal(result.ok, true);
  assert.equal(result.step.stepId, 'a6c0af76');
  assert.equal(result.parentKey, 'step:e81623e9.body');
});

test('locate with an 8-hex-char selector treats it as a step ID, not a number', () => {
  const result = locate(src, '5582897d');
  assert.equal(result.ok, true);
  assert.equal(result.step.stepNum, '1');
});

test('locate reports a clear error for an unknown step', () => {
  const result = locate(src, '99');
  assert.equal(result.ok, false);
  assert.match(result.error, /nicht gefunden/);
});

test('locate reports a clear error for an unparseable file instead of throwing', () => {
  const result = locate('not a valid nsd file at all', '1');
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('locate reports tailAreas alongside areas for a step with a table in its tail', () => {
  const withTable =
    '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'mainSequence {\n' +
    '    simple(1, 5582897d, `a`, plain=`a`) {\n' +
    '        table(width=100%) {\n' +
    '            row { cell(`x`, plain=`x`) }\n' +
    '        }\n' +
    '    }\n' +
    '}\n';
  const result = locate(withTable, '1');
  assert.equal(result.ok, true);
  assert.deepEqual(result.tailAreas, [{ key: 'tail[0]', kind: 'table', rowCount: 1, colCount: 1 }]);
});

test('locate reports an empty tailAreas list for a step with no tail content', () => {
  const src =
    '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'mainSequence {\n    simple(1, 5582897d, `a`, plain=`a`);\n}\n';
  const result = locate(src, '1');
  assert.deepEqual(result.tailAreas, []);
});

// ---------------------------------------------------------------------------
// intro/outro, sections, catches
// ---------------------------------------------------------------------------

const full =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'intro(`<h1>Titel</h1><h2>Dokumentenhistorie</h2>`, plain=`x`) {\n' +
  '    text(`<h2>Beschreibung</h2><div>-</div>`, plain=`x`)\n' +
  '    list(ordered=false) {\n        item(`i`, plain=`i`)\n    }\n' +
  '}\n' +
  'mainSequence {\n' +
  '    break(1, 6131450e, `brk`, plain=`brk`);\n' +
  '}\n' +
  'outro(`<h2>Geschäftsregeln</h2>`, plain=`x`) {\n' +
  '    table(width=100%) {\n        row { cell(`a`, plain=`a`) }\n    }\n' +
  '    text(`<h2>Bemerkungen</h2>`, plain=`x`)\n' +
  '}\n';

test('locate without a selector lists present blocks, catches and uncaught breaks', () => {
  const result = locate(full, undefined);
  assert.deepEqual(result.blocks, ['intro', 'outro']);
  assert.deepEqual(result.catches, []);
  assert.deepEqual(result.uncaughtBreaks.map((b) => b.stepId), ['6131450e']);
});

test('locate intro returns areas, tail areas and the headings of its text areas', () => {
  const result = locate(full, 'intro');
  assert.equal(result.ok, true);
  assert.equal(result.block, 'intro');
  assert.deepEqual(result.areas.map((a) => a.key), ['head', 'tail[0]', 'tail[1].items[0]']);
  assert.deepEqual(result.tailAreas.map((a) => a.kind), ['text', 'list']);
  assert.deepEqual(result.sections, [
    { areaKey: 'head', heading: 'Titel' },
    { areaKey: 'head', heading: 'Dokumentenhistorie' },
    { areaKey: 'tail[0]', heading: 'Beschreibung' },
  ]);
});

test('locate outro reports several tail areas (table, text) in order', () => {
  const result = locate(full, 'outro');
  assert.deepEqual(result.tailAreas.map((a) => a.kind), ['table', 'text']);
  assert.deepEqual(result.sections.map((s) => s.heading), ['Geschäftsregeln', 'Bemerkungen']);
});

test('locate fails clearly for a missing block', () => {
  assert.equal(locate(src, 'outro').ok, false);
  assert.match(locate(src, 'outro').error, /outro/);
});
