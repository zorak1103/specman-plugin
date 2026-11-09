// nsd-plantuml.mjs: read (`get`), replace (`set`) and insert PlantUML image areas in Specman 1.4 specs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { applyPlantuml } from '../scripts/nsd-plantuml.mjs';

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
