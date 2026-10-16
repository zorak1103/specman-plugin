// Acceptance example: builds a complete specification from reference/suc-template.nsd using only the
// nsd-* script functions (no hand-written DSL) — title, description, trigger/result lists, business
// rules, an acceptance-criteria table, open points, a step with a fixed ID, a break with a catch —
// and, when SPECMAN_JAR is set, proves the result survives the real sanitizer and is idempotent.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { locate } from '../scripts/nsd-locate.mjs';
import { applySetText } from '../scripts/nsd-set-text.mjs';
import { applyArea } from '../scripts/nsd-area.mjs';
import { applyInsertStep } from '../scripts/nsd-insert-step.mjs';
import { applyCatch } from '../scripts/nsd-catch.mjs';
import { fillInitial, readHistory } from '../scripts/nsd-history.mjs';
import { sanitizeUntilStable, runSanitize } from '../scripts/sanitize.mjs';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';
import { listCatches } from '../scripts/lib/nsd-paths.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const template = readFileSync(join(here, '..', 'reference', 'suc-template.nsd'), 'utf8');
const FIXED_ID = 'c0de1234';

// Each call mirrors one CLI call: apply, require ok, hand back the full result.
function step(text, fn) {
  const result = fn(text);
  assert.equal(result.ok, true, result.error);
  return result;
}

function sectionKey(text, target, heading) {
  const found = locate(text, target).sections.find((s) => s.heading === heading);
  assert.ok(found, `Abschnitt '${heading}' in ${target} nicht gefunden`);
  return found.areaKey;
}

function buildSpec() {
  let text = template;
  const edit = (fn) => { text = step(text, fn).text; };

  // intro: title, description, trigger and result lists
  edit((t) => applySetText(t, { stepSelector: 'intro', title: 'SUC-228.3 Mandant anlegen' }));
  edit((t) => applySetText(t, {
    stepSelector: 'intro', areaKey: sectionKey(t, 'intro', 'Beschreibung'), section: 'Beschreibung',
    sectionText: 'Ein Mandant wird mit Pflichtfeldern angelegt.\nDoppelte Namen werden abgelehnt.',
  }));
  const lists = locate(text, 'intro').tailAreas.filter((a) => a.kind === 'list').map((a) => a.key);
  assert.equal(lists.length, 2);
  edit((t) => applySetText(t, { stepSelector: 'intro', areaKey: `${lists[0]}.items[0]`, newHtml: 'Nutzer hat das Recht Mandantenverwaltung' }));
  edit((t) => applyArea(t, { stepSelector: 'intro', op: 'add-item', areaKey: lists[0], position: 'end', html: 'Kein Mandant gleichen Namens existiert' }));
  edit((t) => applySetText(t, { stepSelector: 'intro', areaKey: `${lists[1]}.items[0]`, newHtml: 'Mandant ist angelegt' }));

  // outro: business rules, acceptance criteria (heading + table), open points
  edit((t) => applySetText(t, { stepSelector: 'outro', areaKey: 'head', section: 'Geschäftsregeln', sectionText: 'Mandantennamen sind eindeutig.' }));
  const openPoints = locate(text, 'outro').tailAreas.find((a) => a.kind === 'table').key;
  edit((t) => applyArea(t, { stepSelector: 'outro', op: 'add-row', areaKey: openPoints, position: 'end', cells: ['Max. Namenslänge klären', 'mittel', 'offen'] }));
  const heading = step(text, (t) => applyArea(t, { stepSelector: 'outro', op: 'insert', kind: 'text', position: `after:${openPoints}`, heading: 'Akzeptanzkriterien' }));
  text = heading.text;
  edit((t) => applyArea(t, {
    stepSelector: 'outro', op: 'insert', kind: 'table', position: `after:${heading.areaKey}`, cols: ['10%', '90%'],
    rows: [['Nr', 'Kriterium'], ['1', 'Mandant erscheint nach dem Anlegen in der Liste'], ['2', 'Doppelter Name wird mit Fehlermeldung abgelehnt']],
  }));

  // main: a step with a fixed ID, a break with a catch and handler steps
  const sub = locate(text).sequences.find((s) => s.key.endsWith('.body')).key;
  edit((t) => applyInsertStep(t, { parentKey: sub, position: 'end', kind: 'simple', html: 'Mandant speichern', id: FIXED_ID }));
  const brk = step(text, (t) => applyInsertStep(t, { parentKey: sub, position: 'end', kind: 'break', html: 'Name bereits vergeben' }));
  text = brk.text;
  const caught = step(text, (t) => applyCatch(t, { op: 'add', breakId: brk.insertedStepId, head: 'Name bereits vergeben' }));
  text = caught.text;
  edit((t) => applySetText(t, { stepSelector: caught.placeholderStepIds[0], areaKey: 'head', newHtml: 'Fehlermeldung anzeigen' }));
  edit((t) => applyInsertStep(t, { parentKey: caught.bodyKey, position: 'end', kind: 'simple', html: 'Eingabe erneut anbieten' }));

  // history: a freshly planned spec waits for review
  edit((t) => fillInitial(t, { author: 'M. Mustermann', date: '08.10.2026' }));
  return { text, breakId: brk.insertedStepId };
}

test('the example builds a complete spec from the template without hand-written DSL', () => {
  const { text, breakId } = buildSpec();
  const ast = parseDiagram(text);

  assert.match(ast.intro.head.html, /SUC-228\.3 Mandant anlegen/);
  assert.doesNotMatch(ast.intro.head.html, /Template/);
  assert.match(ast.intro.head.html, /Dokumentenhistorie/);
  assert.deepEqual(readHistory(text).rows[0].slice(2), ['M. Mustermann', '08.10.2026', 'Review']);

  const introLists = ast.intro.tail.filter((a) => a.kind === 'list');
  assert.equal(introLists[0].items.length, 2);
  assert.match(ast.intro.tail.find((a) => a.kind === 'text').content.html, /Mandant wird mit Pflichtfeldern/);

  assert.match(ast.outro.head.html, /Mandantennamen sind eindeutig/);
  assert.deepEqual(ast.outro.tail.map((a) => a.kind), ['table', 'text', 'table', 'text']);
  assert.equal(ast.outro.tail[0].rows.length, 3);
  assert.equal(ast.outro.tail[2].rows.length, 3);

  assert.ok(text.includes(`, ${FIXED_ID}, `));
  const { catches, uncaughtBreaks } = listCatches(ast);
  assert.equal(catches.length, 1);
  assert.equal(catches[0].breakStepId, breakId);
  assert.equal(catches[0].stepCount, 2);
  assert.equal(uncaughtBreaks.length, 0);
  assert.doesNotMatch(text, /TODO/);
});

const workDirs = [];
after(() => { for (const d of workDirs) rmSync(d, { recursive: true, force: true }); });

test('the example survives the real sanitizer and is idempotent', { skip: !process.env.SPECMAN_JAR }, () => {
  const jar = process.env.SPECMAN_JAR;
  const dir = mkdtempSync(join(here, '.tmp-example-'));
  workDirs.push(dir);
  const file = join(dir, 'SUC-228.3 Mandant anlegen.nsd');
  writeFileSync(file, buildSpec().text);

  const first = sanitizeUntilStable(() => runSanitize(jar, file), () => readFileSync(file, 'utf8'));
  assert.equal(first.ok, true, first.message);
  assert.equal(first.stable, true);

  const settled = readFileSync(file, 'utf8');
  const again = runSanitize(jar, file);
  assert.equal(again.ok, true, again.message);
  assert.equal(readFileSync(file, 'utf8'), settled);

  // the fixed ID survived renumbering, and catch and break stayed linked
  assert.ok(settled.includes(`, ${FIXED_ID}, `));
  const { catches, uncaughtBreaks } = listCatches(parseDiagram(settled));
  assert.equal(catches.length, 1);
  assert.equal(uncaughtBreaks.length, 0);
});
