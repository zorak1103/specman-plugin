// nsd-plantuml.mjs: read (`get`), replace (`set`) and insert PlantUML image areas in Specman 1.4 specs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyPlantuml } from '../scripts/nsd-plantuml.mjs';
import { parseDiagram, serializeDiagram } from '../scripts/lib/nsd-ast.mjs';
import { resolveTarget } from '../scripts/lib/nsd-paths.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templatePath = path.join(__dirname, '..', 'reference', 'suc-template.nsd');

const ENVELOPE_14 = '// {"specmanVersion":"1.4.0","modelType":"specman.model.v002.DiagramModel_V002"}\n';

// One step (5582897d) whose tail holds: tail[0] text, tail[1] plantuml, tail[2] plantuml with
// change=(added, yellow) + backup, tail[3] png.
const DEFAULT_BODY =
  '    simple(1, 5582897d, `img`, plain=`img`) {\n' +
  '        text(`intro`, plain=`intro`)\n' +
  '        image(scale=100%, type=plantuml) { `@startuml\nA -> B\n@enduml` }\n' +
  '        image(scale=50%, type=plantuml, change=(added, yellow)) { `@startuml\nA -> C\n@enduml`, backup=(yellow, `@startuml\nA -> B\n@enduml`) }\n' +
  '        image(scale=100%, type=png) { [base64:QUJD] }\n' +
  '    }\n';

function diagram14(body = DEFAULT_BODY) {
  return `${ENVELOPE_14}settings {\n    width=700\n}\n\nmainSequence {\n${body}}\n`;
}

// ---------------------------------------------------------------- get

test('get: returns the unwrapped source and scale of a plain PlantUML area', () => {
  const r = applyPlantuml(diagram14(), { op: 'get', stepSelector: '5582897d', areaKey: 'tail[1]' });
  assert.equal(r.ok, true);
  assert.equal(r.areaKey, 'tail[1]');
  assert.equal(r.source, '@startuml\nA -> B\n@enduml');
  assert.equal(r.scalePercent, '100%');
  assert.equal(r.backup, undefined);
  assert.equal(r.change, undefined);
  assert.equal(r.text, undefined);
});

test('get: exposes change and the unwrapped backup of a changed PlantUML area', () => {
  const r = applyPlantuml(diagram14(), { op: 'get', stepSelector: '5582897d', areaKey: 'tail[2]' });
  assert.equal(r.ok, true);
  assert.equal(r.source, '@startuml\nA -> C\n@enduml');
  assert.equal(r.scalePercent, '50%');
  assert.equal(r.change.kind, 'added');
  assert.equal(r.change.changeset, 'yellow');
  assert.deepEqual(r.backup, { changeset: 'yellow', source: '@startuml\nA -> B\n@enduml' });
});

test('get: works by step number as well as by step ID', () => {
  const r = applyPlantuml(diagram14(), { op: 'get', stepSelector: '1', areaKey: 'tail[1]' });
  assert.equal(r.ok, true);
  assert.equal(r.source, '@startuml\nA -> B\n@enduml');
});

test('get: a text area and a png area are refused as not PlantUML', () => {
  for (const areaKey of ['tail[0]', 'tail[3]']) {
    const r = applyPlantuml(diagram14(), { op: 'get', stepSelector: '5582897d', areaKey });
    assert.equal(r.ok, false, areaKey);
    assert.match(r.error, /not a PlantUML/, areaKey);
  }
});

test('get: an out-of-range area key reports the missing tail area', () => {
  const r = applyPlantuml(diagram14(), { op: 'get', stepSelector: '5582897d', areaKey: 'tail[9]' });
  assert.equal(r.ok, false);
  assert.match(r.error, /no tail area/);
});

test('get: a missing --area is an error', () => {
  const r = applyPlantuml(diagram14(), { op: 'get', stepSelector: '5582897d' });
  assert.equal(r.ok, false);
  assert.match(r.error, /--area/);
});

test('get: a spec older than Specman 1.4.0 is refused with a hint to re-save it', () => {
  const r = applyPlantuml(readFileSync(templatePath, 'utf8'), { op: 'get', stepSelector: 'intro', areaKey: 'tail[0]' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Specman 1\.4\.0/);
});

test('get: an unknown step is reported', () => {
  const r = applyPlantuml(diagram14(), { op: 'get', stepSelector: 'deadbeef', areaKey: 'tail[1]' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Step not found/);
});

test('an unknown op is refused', () => {
  const r = applyPlantuml(diagram14(), { op: 'frobnicate', stepSelector: '5582897d' });
  assert.equal(r.ok, false);
  assert.equal(r.error, "nsd-plantuml: unknown --op 'frobnicate' (expected: get, set, insert).");
});

test('get: a spec with CRLF line endings yields LF-only source and backup.source', () => {
  const crlf = diagram14().replace(/\n/g, '\r\n');
  assert.ok(crlf.includes('@startuml\r\nA -> B'), 'fixture really contains CRLF inside the backtick source');
  const plain = applyPlantuml(crlf, { op: 'get', stepSelector: '5582897d', areaKey: 'tail[1]' });
  assert.equal(plain.ok, true);
  assert.equal(plain.source, '@startuml\nA -> B\n@enduml');
  const changed = applyPlantuml(crlf, { op: 'get', stepSelector: '5582897d', areaKey: 'tail[2]' });
  assert.equal(changed.ok, true);
  assert.equal(changed.source, '@startuml\nA -> C\n@enduml');
  assert.equal(changed.backup.source, '@startuml\nA -> B\n@enduml');
  assert.equal(changed.source.includes('\r'), false);
  assert.equal(changed.backup.source.includes('\r'), false);
});

// ---------------------------------------------------------------- set

const NEW_SOURCE = '@startuml\nA -> C\n@enduml';
const OLD_RAW = '`@startuml\nA -> B\n@enduml`';

function setOpts(extra = {}) {
  return { op: 'set', stepSelector: '5582897d', areaKey: 'tail[1]', source: NEW_SOURCE, ...extra };
}

function tailOf(text, i) {
  return resolveTarget(parseDiagram(text), '5582897d').step.content.tail[i];
}

function singleImageBody(imageLine) {
  return (
    '    simple(1, 5582897d, `img`, plain=`img`) {\n' +
    `        ${imageLine}\n` +
    '    }\n'
  );
}

test('set: an untracked set replaces only the source', () => {
  const r = applyPlantuml(diagram14(), setOpts());
  assert.equal(r.ok, true);
  assert.equal(r.areaKey, 'tail[1]');
  assert.equal(r.backupWritten, false);
  const area = tailOf(r.text, 1);
  assert.equal(area.raw, '`@startuml\nA -> C\n@enduml`');
  assert.equal(area.backup, undefined);
  assert.equal(area.change, undefined);
  assert.equal(area.scalePercent, '100%');
});

test('set: an untracked set leaves existing change and backup untouched', () => {
  const r = applyPlantuml(diagram14(), setOpts({ areaKey: 'tail[2]', source: '@startuml\nX -> Y\n@enduml' }));
  assert.equal(r.ok, true);
  assert.equal(r.backupWritten, false);
  const area = tailOf(r.text, 2);
  assert.equal(area.raw, '`@startuml\nX -> Y\n@enduml`');
  assert.equal(area.change.kind, 'added');
  assert.equal(area.change.changeset, 'yellow');
  assert.deepEqual(area.backup, { changeset: 'yellow', raw: OLD_RAW });
});

test('set: a tracked set writes the old source as backup and no change mark', () => {
  const r = applyPlantuml(diagram14(), setOpts({ changeset: 'blue' }));
  assert.equal(r.ok, true);
  assert.equal(r.backupWritten, true);
  const area = tailOf(r.text, 1);
  assert.equal(area.raw, '`@startuml\nA -> C\n@enduml`');
  assert.deepEqual(area.backup, { changeset: 'blue', raw: OLD_RAW });
  assert.equal(area.change, undefined);
});

test('set: a tracked set in the same changeset keeps the existing backup', () => {
  const r = applyPlantuml(diagram14(), setOpts({ areaKey: 'tail[2]', changeset: 'yellow', source: '@startuml\nX -> Y\n@enduml' }));
  assert.equal(r.ok, true);
  assert.equal(r.backupWritten, false);
  const area = tailOf(r.text, 2);
  assert.equal(area.raw, '`@startuml\nX -> Y\n@enduml`');
  assert.deepEqual(area.backup, { changeset: 'yellow', raw: OLD_RAW });
  assert.equal(area.change.kind, 'added');
});

test('set: a tracked set in another changeset than the existing backup is refused', () => {
  const r = applyPlantuml(diagram14(), setOpts({ areaKey: 'tail[2]', changeset: 'blue' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /backup/);
  assert.equal('text' in r, false);
});

test('set: a tracked set on a removed area is refused', () => {
  const body = singleImageBody('image(scale=100%, type=plantuml, change=(removed, blue)) { `@startuml\nA -> B\n@enduml` }');
  const r = applyPlantuml(diagram14(body), setOpts({ areaKey: 'tail[0]', changeset: 'blue' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /removed/);
  assert.equal('text' in r, false);
});

test('set: a tracked set on an area added in the same changeset writes no backup', () => {
  const body = singleImageBody('image(scale=100%, type=plantuml, change=(added, blue)) { `@startuml\nA -> B\n@enduml` }');
  const r = applyPlantuml(diagram14(body), setOpts({ areaKey: 'tail[0]', changeset: 'blue' }));
  assert.equal(r.ok, true);
  assert.equal(r.backupWritten, false);
  const area = tailOf(r.text, 0);
  assert.equal(area.raw, '`@startuml\nA -> C\n@enduml`');
  assert.equal(area.backup, undefined);
  assert.equal(area.change.kind, 'added');
  assert.equal(area.change.changeset, 'blue');
});

test('set: a tracked set on an area added in another changeset writes a backup', () => {
  const body = singleImageBody('image(scale=100%, type=plantuml, change=(added, yellow)) { `@startuml\nA -> B\n@enduml` }');
  const r = applyPlantuml(diagram14(body), setOpts({ areaKey: 'tail[0]', changeset: 'blue' }));
  assert.equal(r.ok, true);
  assert.equal(r.backupWritten, true);
  assert.deepEqual(tailOf(r.text, 0).backup, { changeset: 'blue', raw: OLD_RAW });
});

test('set: a source containing a backtick is refused', () => {
  const r = applyPlantuml(diagram14(), setOpts({ source: '@startuml\nA -> `B`\n@enduml' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /backtick/);
  assert.equal('text' in r, false);
});

test('set: a source without @start...@end is refused', () => {
  for (const source of ['hello', '@startuml\nA -> B', 'A -> B\n@enduml', '   ']) {
    const r = applyPlantuml(diagram14(), setOpts({ source }));
    assert.equal(r.ok, false, JSON.stringify(source));
    assert.match(r.error, /@start/, JSON.stringify(source));
    assert.equal('text' in r, false);
  }
});

test('set: a missing source or a missing --area names the missing option', () => {
  const noSource = applyPlantuml(diagram14(), { op: 'set', stepSelector: '5582897d', areaKey: 'tail[1]' });
  assert.equal(noSource.ok, false);
  assert.match(noSource.error, /--source-file/);
  const noArea = applyPlantuml(diagram14(), { op: 'set', stepSelector: '5582897d', source: NEW_SOURCE });
  assert.equal(noArea.ok, false);
  assert.match(noArea.error, /--area/);
});

test('set: CRLF in the new source is stored as LF and surrounding whitespace is trimmed', () => {
  const r = applyPlantuml(diagram14(), setOpts({ source: '\r\n  @startuml\r\nA -> C\r\n@enduml  \r\n\r\n' }));
  assert.equal(r.ok, true);
  const raw = tailOf(r.text, 1).raw;
  assert.equal(raw, '`@startuml\nA -> C\n@enduml`');
  assert.equal(raw.includes('\r'), false);
});

test('set: the old raw is saved verbatim into the backup, also from a CRLF spec', () => {
  const crlf = diagram14().replace(/\n/g, '\r\n');
  const r = applyPlantuml(crlf, setOpts({ changeset: 'blue' }));
  assert.equal(r.ok, true);
  assert.equal(tailOf(r.text, 1).backup.raw, '`@startuml\r\nA -> B\r\n@enduml`');
});

test('set: a png and a text area are refused as not PlantUML', () => {
  for (const areaKey of ['tail[0]', 'tail[3]']) {
    const r = applyPlantuml(diagram14(), setOpts({ areaKey }));
    assert.equal(r.ok, false, areaKey);
    assert.match(r.error, /not a PlantUML/, areaKey);
    assert.equal('text' in r, false);
  }
});

test('set: a spec older than Specman 1.4.0 is refused', () => {
  const r = applyPlantuml(readFileSync(templatePath, 'utf8'), setOpts({ stepSelector: 'intro', areaKey: 'tail[0]' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /Specman 1\.4\.0/);
  assert.equal('text' in r, false);
});

test('set: a successful set round-trips through parse and serialize', () => {
  for (const opts of [setOpts(), setOpts({ changeset: 'blue' }), setOpts({ areaKey: 'tail[2]', changeset: 'yellow' })]) {
    const r = applyPlantuml(diagram14(), opts);
    assert.equal(r.ok, true);
    assert.equal(serializeDiagram(parseDiagram(r.text)), r.text);
  }
});

test('set: never mutates its input and changes nothing but the addressed area', () => {
  const input = diagram14();
  const copy = String(input);
  const r = applyPlantuml(input, setOpts());
  assert.equal(input, copy);
  assert.equal(r.text.replace('A -> C', 'A -> B'), serializeDiagram(parseDiagram(input)));
});

// ---------------------------------------------------------------- insert

const INS_SOURCE = '@startuml\nX -> Y\n@enduml';
const INS_RAW = '`@startuml\nX -> Y\n@enduml`';

function insOpts(extra = {}) {
  return { op: 'insert', stepSelector: '5582897d', source: INS_SOURCE, ...extra };
}

// A 1.4.0 spec with an intro and an outro block, each carrying one text area, plus one step.
function diagramWithBlocks() {
  return (
    `${ENVELOPE_14}settings {\n    width=700\n}\n\n` +
    'intro(`i`, plain=`i`) {\n    text(`intro text`, plain=`intro text`)\n}\n\n' +
    'mainSequence {\n    simple(1, 5582897d, `s`, plain=`s`);\n}\n\n' +
    'outro(`o`, plain=`o`) {\n    text(`outro text`, plain=`outro text`)\n}\n'
  );
}

function blockTail(text, name) {
  return parseDiagram(text)[name].tail;
}

test('insert: defaults to the end, 100% and no change mark or backup', () => {
  const r = applyPlantuml(diagram14(), insOpts());
  assert.equal(r.ok, true);
  assert.equal(r.areaKey, 'tail[4]');
  const area = tailOf(r.text, 4);
  assert.equal(area.kind, 'image');
  assert.equal(area.imageType, 'plantuml');
  assert.equal(area.scalePercent, '100%');
  assert.equal(area.change, undefined);
  assert.equal(area.backup, undefined);
  assert.equal(area.raw, INS_RAW);
});

test('insert: scalePercent 50 is stored as 50%', () => {
  const r = applyPlantuml(diagram14(), insOpts({ scalePercent: 50 }));
  assert.equal(r.ok, true);
  assert.equal(tailOf(r.text, 4).scalePercent, '50%');
});

test('insert: a percentage outside (0, 100] or not a number is refused', () => {
  for (const scalePercent of [0, 101, -5, NaN]) {
    const r = applyPlantuml(diagram14(), insOpts({ scalePercent }));
    assert.equal(r.ok, false, String(scalePercent));
    assert.match(r.error, /percentage/, String(scalePercent));
    assert.equal('text' in r, false);
  }
});

test('insert: position start goes to tail[0]', () => {
  const r = applyPlantuml(diagram14(), insOpts({ position: 'start' }));
  assert.equal(r.ok, true);
  assert.equal(r.areaKey, 'tail[0]');
  assert.equal(tailOf(r.text, 0).raw, INS_RAW);
  assert.equal(tailOf(r.text, 1).kind, 'text');
});

test('insert: position after:tail[1] lands at tail[2] and shifts the following areas', () => {
  const before = tailOf(diagram14(), 2);
  const r = applyPlantuml(diagram14(), insOpts({ position: 'after:tail[1]' }));
  assert.equal(r.ok, true);
  assert.equal(r.areaKey, 'tail[2]');
  assert.equal(tailOf(r.text, 2).raw, INS_RAW);
  assert.deepEqual(tailOf(r.text, 3), before);
});

test('insert: a non-existent after index and an invalid position are refused', () => {
  const missing = applyPlantuml(diagram14(), insOpts({ position: 'after:tail[9]' }));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /non-existent index/);
  assert.equal('text' in missing, false);
  const invalid = applyPlantuml(diagram14(), insOpts({ position: 'middle' }));
  assert.equal(invalid.ok, false);
  assert.match(invalid.error, /invalid position/);
  assert.equal('text' in invalid, false);
});

test('insert: with a changeset the area carries an added change mark and no backup', () => {
  const r = applyPlantuml(diagram14(), insOpts({ changeset: 'blue' }));
  assert.equal(r.ok, true);
  const area = tailOf(r.text, 4);
  assert.deepEqual(area.change, { kind: 'added', changeset: 'blue', sourceStep: undefined });
  assert.equal(area.backup, undefined);
});

test('insert: works on the intro and the outro block', () => {
  for (const name of ['intro', 'outro']) {
    const r = applyPlantuml(diagramWithBlocks(), insOpts({ stepSelector: name }));
    assert.equal(r.ok, true, name);
    assert.equal(r.areaKey, 'tail[1]', name);
    const tail = blockTail(r.text, name);
    assert.equal(tail.length, 2, name);
    assert.equal(tail[1].imageType, 'plantuml', name);
    assert.equal(tail[1].raw, INS_RAW, name);
  }
});

test('insert: a spec older than Specman 1.4.0 is refused', () => {
  const r = applyPlantuml(readFileSync(templatePath, 'utf8'), insOpts({ stepSelector: 'intro' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /Specman 1\.4\.0/);
  assert.equal('text' in r, false);
});

test('insert: a backtick in the source, a bad source and a missing source are refused', () => {
  const tick = applyPlantuml(diagram14(), insOpts({ source: '@startuml\nA -> `B`\n@enduml' }));
  assert.equal(tick.ok, false);
  assert.match(tick.error, /backtick/);
  const bad = applyPlantuml(diagram14(), insOpts({ source: 'hello' }));
  assert.equal(bad.ok, false);
  assert.match(bad.error, /@start/);
  const none = applyPlantuml(diagram14(), { op: 'insert', stepSelector: '5582897d' });
  assert.equal(none.ok, false);
  assert.match(none.error, /--source-file/);
});

test('insert: an unknown step is reported', () => {
  const r = applyPlantuml(diagram14(), insOpts({ stepSelector: 'deadbeef' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /Step not found/);
});

test('insert: CRLF and surrounding whitespace in the source are normalised', () => {
  const r = applyPlantuml(diagram14(), insOpts({ source: '\r\n @startuml\r\nX -> Y\r\n@enduml \r\n' }));
  assert.equal(r.ok, true);
  assert.equal(tailOf(r.text, 4).raw, INS_RAW);
});

test('insert: results round-trip through parse and serialize', () => {
  const variants = [insOpts(), insOpts({ position: 'start', scalePercent: 25 }), insOpts({ position: 'after:tail[0]', changeset: 'blue' })];
  for (const opts of variants) {
    const r = applyPlantuml(diagram14(), opts);
    assert.equal(r.ok, true);
    assert.equal(serializeDiagram(parseDiagram(r.text)), r.text);
  }
  for (const name of ['intro', 'outro']) {
    const r = applyPlantuml(diagramWithBlocks(), insOpts({ stepSelector: name, changeset: 'blue' }));
    assert.equal(serializeDiagram(parseDiagram(r.text)), r.text);
  }
});

test('insert: never mutates its input', () => {
  const input = diagram14();
  const copy = String(input);
  applyPlantuml(input, insOpts());
  assert.equal(input, copy);
});

// ---------------------------------------------------------------- changeset validation

test('a changeset that is not a non-empty string is refused for set and insert, naming --changeset', () => {
  for (const changeset of [true, '', 5]) {
    const set = applyPlantuml(diagram14(), setOpts({ changeset }));
    assert.equal(set.ok, false, `set ${String(changeset)}`);
    assert.match(set.error, /--changeset/);
    assert.equal('text' in set, false);
    const ins = applyPlantuml(diagram14(), insOpts({ changeset }));
    assert.equal(ins.ok, false, `insert ${String(changeset)}`);
    assert.match(ins.error, /--changeset/);
    assert.equal('text' in ins, false);
  }
});
