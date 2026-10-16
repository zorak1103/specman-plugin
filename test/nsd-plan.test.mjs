import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFromPlan, ignoredIds } from '../scripts/lib/nsd-plan.mjs';
import { extractDocx } from '../scripts/lib/docx-reader.mjs';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';
import { makeDocx, para, cell, row, table, NUMBERING, TINY_PNG } from './helpers/docx.mjs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TEMPLATE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reference', 'suc-template.nsd'), 'utf8',
);

// p1 Beschreibung, p2 Vorbedingung, p3 Nachbedingung, p4..p6 Schritte, p7 Titel-Rest
function fixture(extraBody = '', extra = {}, rels = '') {
  const body = para('Beschreibung des Ablaufs') + para('Der User ist angemeldet.', { num: { id: 1 } }) +
    para('Ergebnis liegt vor.', { num: { id: 1 } }) + para('Der User klickt.') + para('Das System speichert.') +
    para('Fehlerfall: Eingabe ungültig.') + extraBody;
  return extractDocx(makeDocx(body, { 'word/numbering.xml': NUMBERING, ...extra }, rels), {
    imageSink: (name, bytes) => {
      const dir = mkdtempSync(join(tmpdir(), 'plan-test-'));
      const file = join(dir, name);
      writeFileSync(file, bytes);
      return file;
    },
  });
}

const basePlan = () => ({
  number: 'SUC-777',
  title: 'Testfall',
  intro: {
    description: [{ ref: 'p1' }],
    actors: 'User, System',
    preconditions: [{ ref: 'p2' }],
    postconditions: [{ ref: 'p3' }],
  },
  main: {
    steps: [
      { kind: 'simple', content: { ref: 'p4' } },
      { kind: 'simple', content: { ref: 'p5' } },
    ],
  },
  ignored: [{ ids: ['p6'], reason: 'wird in einem eigenen Test verwendet' }],
});

test('buildFromPlan fills title, description, actors, conditions and steps', () => {
  const result = buildFromPlan({ templateText: TEMPLATE, plan: basePlan(), extract: fixture() });
  assert.equal(result.ok, true, result.error);
  const ast = parseDiagram(result.text);
  assert.match(ast.intro.head.html, /SUC-777 Testfall/);
  const desc = ast.intro.tail[1].content.html;
  assert.match(desc, /Beschreibung des Ablaufs/);
  assert.match(desc, /<b>Akteur\(e\):<\/b> User, System/);
  assert.match(desc, /Ausl&#246;ser/); // heading after the description is preserved
  assert.equal(ast.intro.tail[2].items[0].content.head.html, 'Der User ist angemeldet.');
  assert.equal(ast.intro.tail[4].items[0].content.head.html, 'Ergebnis liegt vor.');
  assert.equal(ast.mainSequence.steps.length, 2);
  assert.equal(ast.mainSequence.steps[0].content.head.html, 'Der User klickt.');
});

test('buildFromPlan refuses System/User as label — step texts carry no actor prefix', () => {
  for (const label of ['System', 'SYSTEM:', 'User', ' user ', 'Benutzer']) {
    const plan = basePlan();
    plan.main.steps[0].content = { ref: 'p4', label };
    const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
    assert.equal(result.ok, false, label);
    assert.match(result.error, /ohne Präfix 'System:'\/'User:'/);
  }
});

test('buildFromPlan still allows a non-actor label', () => {
  const plan = basePlan();
  plan.main.steps[0].content = { ref: 'p4', label: 'Hinweis' };
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, true, result.error);
  assert.equal(parseDiagram(result.text).mainSequence.steps[0].content.head.html, '<b>Hinweis:</b> Der User klickt.');
});

test('buildFromPlan fails when docx content is neither used nor ignored — no logic may be lost', () => {
  const plan = basePlan();
  plan.ignored = [];
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, false);
  assert.match(result.error, /es darf keine Logik verloren gehen/);
  assert.deepEqual(result.unreferenced.map((u) => u.id), ['p6']);
});

test('buildFromPlan requires a reason for every ignore entry', () => {
  const plan = basePlan();
  plan.ignored = [{ ids: ['p6'], reason: '  ' }];
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, false);
  assert.match(result.error, /reason/);
});

test('buildFromPlan supports ignored ranges and reports ignored texts grouped by reason', () => {
  const plan = basePlan();
  plan.main.steps.pop();
  plan.ignored = [{ from: 'p5', to: 'p6', reason: 'Bereich' }];
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.ignored[0].reason, 'Bereich');
  assert.deepEqual(result.ignored[0].entries.map((e) => e.id), ['p5', 'p6']);
});

test('buildFromPlan rejects unknown extract ids', () => {
  const plan = basePlan();
  plan.main.steps[0].content = { ref: 'p99' };
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, false);
  assert.match(result.error, /p99/);
});

test('buildFromPlan builds ifElse with branch heads and uses defaults only when none given', () => {
  const plan = basePlan();
  plan.main.steps = [
    { kind: 'simple', content: { ref: 'p4' } },
    {
      kind: 'ifElse', content: 'Ist alles gut?',
      ifBranch: { head: 'Ja', body: [{ kind: 'simple', content: { ref: 'p5' } }] },
      elseBranch: { body: [{ kind: 'simple', content: 'Abbruch' }] },
    },
  ];
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, true, result.error);
  const step = parseDiagram(result.text).mainSequence.steps[1];
  assert.equal(step.kind, 'ifElse');
  assert.equal(step.elseBranch.content.head.html, 'Nein');
  assert.equal(result.summary.defaultedBranchHeads, 1);
});

test('buildFromPlan builds case (default + >=2 branches) and loops', () => {
  const plan = basePlan();
  plan.main.steps = [
    { kind: 'simple', content: { ref: 'p4' } },
    {
      kind: 'case', content: 'Welche Art?',
      defaultBranch: { head: 'Sonst', body: [{ kind: 'simple', content: 'x' }] },
      caseBranches: [
        { head: 'A', body: [{ kind: 'simple', content: { ref: 'p5' } }] },
        { head: 'B', body: [{ kind: 'while', content: 'Solange', body: [{ kind: 'simple', content: 'y' }] }] },
      ],
    },
  ];
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, true, result.error);
  const step = parseDiagram(result.text).mainSequence.steps[1];
  assert.equal(step.caseBranches.length, 2);
  assert.equal(step.caseBranches[1].body[0].kind, 'while');
});

test('buildFromPlan refuses structures the grammar forbids (empty body, case with one branch)', () => {
  const emptyBody = basePlan();
  emptyBody.main.steps = [{ kind: 'subsequence', content: 'x', body: [] }];
  assert.match(buildFromPlan({ templateText: TEMPLATE, plan: emptyBody, extract: fixture() }).error, /mindestens einen Schritt/);

  const oneCase = basePlan();
  oneCase.main.steps = [{ kind: 'case', content: 'x', defaultBranch: { body: [{ kind: 'simple', content: 'a' }] }, caseBranches: [{ body: [{ kind: 'simple', content: 'b' }] }] }];
  assert.match(buildFromPlan({ templateText: TEMPLATE, plan: oneCase, extract: fixture() }).error, /mindestens 2 caseBranches/);
});

test('buildFromPlan wires break steps to catch blocks (incl. coCatches) in the main sequence', () => {
  const plan = basePlan();
  plan.main = {
    steps: [
      { kind: 'simple', content: { ref: 'p4' } },
      { kind: 'break', id: 'ungueltig', content: 'Eingabe ungültig' },
      { kind: 'break', id: 'abbruch', content: 'Abbruch' },
    ],
    catches: [{ breakIds: ['ungueltig', 'abbruch'], content: { ref: 'p6' }, body: [{ kind: 'simple', content: 'Meldung anzeigen' }] }],
  };
  plan.ignored = [{ ids: ['p5'], reason: 'nicht Teil dieses Tests' }];
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, true, result.error);
  const ast = parseDiagram(result.text);
  const [first, second] = ast.mainSequence.steps.slice(1);
  const catchBlock = ast.mainSequence.catchArea.catches[0];
  assert.equal(catchBlock.breakStepNum, first.stepNum);
  assert.equal(catchBlock.coCatches[0].breakStepNum, second.stepNum);
  assert.equal(result.summary.catches, 1);
});

test('buildFromPlan rejects a catch for an unknown or foreign break', () => {
  const plan = basePlan();
  plan.main.catches = [{ breakId: 'gibtsnicht', content: 'x', body: [{ kind: 'simple', content: 'y' }] }];
  assert.match(buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() }).error, /unbekannter Abbruch-Schritt/);
});

test('buildFromPlan turns list paragraphs of a step ref into a list area and nests are flattened with a warning', () => {
  const extra = para('Haupt', { num: { id: 1 } }) + para('Unterpunkt', { num: { id: 1, level: 1 } });
  const extract = fixture(extra);
  const plan = basePlan();
  plan.main.steps[1].content = { ref: ['p5', 'p7', 'p8'] };
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract });
  assert.equal(result.ok, true, result.error);
  const list = parseDiagram(result.text).mainSequence.steps[1].content.tail[0];
  assert.equal(list.kind, 'list');
  assert.equal(list.items.length, 2);
  assert.match(list.items[1].content.head.html, /^(&#160;)+- Unterpunkt$/);
  assert.match(result.warnings.join('\n'), /verschachtelte Listenebenen/);
});

test('buildFromPlan converts an extract table, resolves merged cells with a warning', () => {
  const tbl = table(row(cell(para('Feld')), cell(para('Bedingung'))), row(cell(para('Zusammen'), 2)));
  const extract = fixture(tbl);
  const plan = basePlan();
  plan.main.steps[1].content = { ref: ['p5', 't1'] };
  plan.ignored = [{ ids: ['p6'], reason: 'unbenutzt' }];
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract });
  assert.equal(result.ok, true, result.error);
  const area = parseDiagram(result.text).mainSequence.steps[1].content.tail[0];
  assert.equal(area.kind, 'table');
  assert.equal(area.rows[1].cells.length, 2);
  assert.match(result.warnings.join('\n'), /verbundene Zellen/);
});

test('buildFromPlan embeds an extracted image and fails if an image is left unreferenced', () => {
  const drawing = '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="4762500" cy="952500"/><a:graphic><a:blip r:embed="rId1"/></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  const extract = fixture(drawing, { 'word/media/image1.png': TINY_PNG }, '<Relationship Id="rId1" Target="media/image1.png"/>');
  const plan = basePlan();

  const missing = buildFromPlan({ templateText: TEMPLATE, plan, extract });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.unreferenced.map((u) => u.id), ['i1']);

  plan.outro = { sections: [{ heading: 'Wireframes', areas: [{ kind: 'image', ref: 'i1' }] }] };
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract });
  assert.equal(result.ok, true, result.error);
  const tail = parseDiagram(result.text).outro.tail;
  assert.match(tail.at(-2).content.html, /Wireframes/);
  assert.equal(tail.at(-1).kind, 'image');
  assert.equal(tail.at(-1).scalePercent, '68%'); // 500px of a 731px diagram
  assert.equal(result.summary.images, 1);
});

test('buildFromPlan takes the history rows from the extract and marks its paragraphs as consumed', () => {
  const hist = table(
    row(cell(para('Version')), cell(para('Aktivität')), cell(para('Autor')), cell(para('Datum')), cell(para('Folge'))),
    row(cell(para('0.1')), cell(para('Initiale Erstellung')), cell(para('A. B.')), cell(para('01.01.2026')), cell(para('Review'))),
  );
  const extract = fixture(hist);
  const result = buildFromPlan({ templateText: TEMPLATE, plan: basePlan(), extract });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.historyRows, [['0.1', 'Initiale Erstellung', 'A. B.', '01.01.2026', 'Review']]);
});

test('buildFromPlan escapes plain text content (umlauts, ampersand, backtick)', () => {
  const plan = basePlan();
  plan.main.steps = [{ kind: 'simple', content: 'Prüfen & `speichern`' }];
  plan.ignored = [{ from: 'p4', to: 'p6', reason: 'unbenutzt' }];
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, true, result.error);
  assert.equal(parseDiagram(result.text).mainSequence.steps[0].content.head.html, 'Pr&#252;fen &amp; &#96;speichern&#96;');
});

test('ignoredIds expands table ids to the paragraphs inside', () => {
  const extract = fixture(table(row(cell(para('in Tabelle')))));
  const result = ignoredIds(extract, [{ ids: ['t1'], reason: 'ganze Tabelle' }]);
  assert.equal(result.ok, true);
  assert.equal(result.ids.has('p7'), true);
});

test('buildFromPlan flatLists on a ref makes a single list paragraph the step text instead of an empty-headed list', () => {
  const extract = fixture(para('Eigener Schritt als Stichpunkt', { num: { id: 1 } }));
  const plan = basePlan();
  plan.main.steps[1].content = { ref: 'p7' };
  plan.ignored = [{ ids: ['p5', 'p6'], reason: 'unbenutzt' }];
  const warned = buildFromPlan({ templateText: TEMPLATE, plan, extract });
  assert.equal(warned.ok, true, warned.error);
  assert.match(warned.warnings.join(' '), /leeren Schritttext.*flatLists/);

  plan.main.steps[1].content = { ref: 'p7', flatLists: true };
  const flat = buildFromPlan({ templateText: TEMPLATE, plan, extract });
  assert.equal(flat.ok, true, flat.error);
  const step = parseDiagram(flat.text).mainSequence.steps[1];
  assert.equal(step.content.head.html, 'Eigener Schritt als Stichpunkt');
  assert.equal(step.content.tail.length, 0);
  assert.deepEqual(flat.warnings, []);
});

test('buildFromPlan accepts reworded paragraphs as covered and reports them separately from ignored', () => {
  const plan = basePlan();
  plan.main.steps[1].content = 'Wurde der Ablauf gespeichert?';
  plan.reworded = [{ ids: ['p5'], reason: 'Zu Frage umformuliert (Freigabe des Nutzers)' }];
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.reworded[0].entries.map((e) => e.id), ['p5']);
  assert.deepEqual(result.ignored.flatMap((g) => g.entries.map((e) => e.id)), ['p6']);
  assert.equal(result.summary.rewordedTexts, 1);
});

test('buildFromPlan without reworded still fails when own text replaces a paragraph', () => {
  const plan = basePlan();
  plan.main.steps[1].content = 'Wurde der Ablauf gespeichert?';
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, false);
  assert.deepEqual(result.unreferenced.map((u) => u.id), ['p5']);
});

test('buildFromPlan refuses an id that is both reworded and ignored', () => {
  const plan = basePlan();
  plan.reworded = [{ ids: ['p6'], reason: 'x' }];
  const result = buildFromPlan({ templateText: TEMPLATE, plan, extract: fixture() });
  assert.equal(result.ok, false);
  assert.match(result.error, /reworded.*ignored/);
});
