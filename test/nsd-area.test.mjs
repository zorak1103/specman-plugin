import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyArea } from '../scripts/nsd-area.mjs';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';
import { addressableAreas, findStep } from '../scripts/lib/nsd-paths.mjs';

function minimalDiagram(mainSequenceBody) {
  return (
    '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'mainSequence {\n' + mainSequenceBody + '}\n'
  );
}

const emptyTailSrc = minimalDiagram('    simple(1, 5582897d, `head`, plain=`head`);\n');

// ---------------------------------------------------------------------------
// insert: text
// ---------------------------------------------------------------------------

test('insert text turns an empty tail (";") into a brace-tail with one text area', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'text', position: 'end', html: 'trailing note',
  });
  assert.equal(result.ok, true);
  assert.equal(result.areaKey, 'tail[0]');
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail.length, 1);
  assert.equal(step.content.tail[0].kind, 'text');
  assert.equal(step.content.tail[0].content.html, 'trailing note');
});

test('insert text at start places the new area before existing ones', () => {
  const src = minimalDiagram(
    '    simple(1, 5582897d, `head`, plain=`head`) {\n' +
    '        text(`existing`, plain=`existing`)\n' +
    '    }\n',
  );
  const result = applyArea(src, { stepSelector: '1', op: 'insert', kind: 'text', position: 'start', html: 'new first' });
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail[0].content.html, 'new first');
  assert.equal(step.content.tail[1].content.html, 'existing');
});

test('insert text after:tail[0] places the new area right after it', () => {
  const src = minimalDiagram(
    '    simple(1, 5582897d, `head`, plain=`head`) {\n' +
    '        text(`first`, plain=`first`)\n' +
    '        text(`third`, plain=`third`)\n' +
    '    }\n',
  );
  const result = applyArea(src, { stepSelector: '1', op: 'insert', kind: 'text', position: 'after:tail[0]', html: 'second' });
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.deepEqual(step.content.tail.map((a) => a.content.html), ['first', 'second', 'third']);
});

test('insert text with a changeset marks the new area as added', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'text', position: 'end', html: 'x', changeset: 'yellow',
  });
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.deepEqual(step.content.tail[0].change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
});

// ---------------------------------------------------------------------------
// insert: list
// ---------------------------------------------------------------------------

test('insert list creates the area with every given item and reports their area keys', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'list', position: 'end', ordered: false, items: ['a', 'b'],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.itemAreaKeys, ['tail[0].items[0]', 'tail[0].items[1]']);
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail[0].kind, 'list');
  assert.equal(step.content.tail[0].ordered, false);
  assert.deepEqual(step.content.tail[0].items.map((it) => it.content.head.html), ['a', 'b']);
  const keys = addressableAreas(step).map((a) => a.key);
  assert.deepEqual(keys, ['head', 'tail[0].items[0]', 'tail[0].items[1]']);
});

test('insert list rejects an empty items array', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'list', position: 'end', ordered: true, items: [],
  });
  assert.equal(result.ok, false);
});

test('insert list requires an explicit boolean --ordered (no silent default)', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'list', position: 'end', items: ['a'],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /ordered/);
});

test('insert list with a changeset marks every initial item as added (the list area itself has no change slot)', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'list', position: 'end', ordered: true, items: ['a'], changeset: 'yellow',
  });
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.deepEqual(step.content.tail[0].items[0].change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
});

// ---------------------------------------------------------------------------
// insert: table
// ---------------------------------------------------------------------------

test('insert table creates rows/cells and reports cell area keys', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'table', position: 'end',
    rows: [['h1', 'h2'], ['a', 'b']], cols: ['30%', '70%'],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cellAreaKeys, [
    'tail[0].rows[0].cells[0]', 'tail[0].rows[0].cells[1]',
    'tail[0].rows[1].cells[0]', 'tail[0].rows[1].cells[1]',
  ]);
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail[0].kind, 'table');
  assert.equal(step.content.tail[0].widthPercent, '100%');
  assert.deepEqual(step.content.tail[0].cols, ['30%', '70%']);
  assert.equal(step.content.tail[0].rows.length, 2);
  assert.equal(step.content.tail[0].rows[0].cells[1].content.head.html, 'h2');
});

test('insert table defaults width to 100% and accepts an explicit --width', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'table', position: 'end', rows: [['a']], width: '50%',
  });
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail[0].widthPercent, '50%');
});

test('insert table with a changeset marks the table area as added', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'table', position: 'end', rows: [['a']], changeset: 'yellow',
  });
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.deepEqual(step.content.tail[0].change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
});

test('insert table rejects a non-rectangular rows array', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'table', position: 'end', rows: [['a', 'b'], ['c']],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /rechteckig|rectangular/i);
});

test('insert table rejects an empty rows array', () => {
  const result = applyArea(emptyTailSrc, { stepSelector: '1', op: 'insert', kind: 'table', position: 'end', rows: [] });
  assert.equal(result.ok, false);
});

test('insert table rejects cols whose length does not match the column count', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'table', position: 'end', rows: [['a', 'b']], cols: ['100%'],
  });
  assert.equal(result.ok, false);
});

test('insert table rejects a malformed percent value in cols', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'table', position: 'end', rows: [['a']], cols: ['fifty'],
  });
  assert.equal(result.ok, false);
});

test('insert table rejects a malformed --width', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'table', position: 'end', rows: [['a']], width: '100',
  });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// insert: shared validation
// ---------------------------------------------------------------------------

test('insert rejects HTML containing a backtick', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'text', position: 'end', html: 'a `quote`',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Backtick/);
});

test('insert rejects an unknown kind', () => {
  const result = applyArea(emptyTailSrc, { stepSelector: '1', op: 'insert', kind: 'image', position: 'end' });
  assert.equal(result.ok, false);
});

test('insert reports a clear error for an unknown step', () => {
  const result = applyArea(emptyTailSrc, { stepSelector: '99', op: 'insert', kind: 'text', position: 'end', html: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /nicht gefunden/);
});

test('insert rejects an out-of-range after: position', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'text', position: 'after:tail[3]', html: 'x',
  });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// add-row
// ---------------------------------------------------------------------------

function tableSrc() {
  return minimalDiagram(
    '    simple(1, 5582897d, `head`, plain=`head`) {\n' +
    '        table(width=100%) {\n' +
    '            row { cell(`a1`, plain=`a1`) | cell(`a2`, plain=`a2`) }\n' +
    '        }\n' +
    '    }\n',
  );
}

test('add-row appends a row with matching cell count and reports untracked:true', () => {
  const result = applyArea(tableSrc(), {
    stepSelector: '1', op: 'add-row', areaKey: 'tail[0]', position: 'end', cells: ['b1', 'b2'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.untracked, true);
  assert.deepEqual(result.cellAreaKeys, ['tail[0].rows[1].cells[0]', 'tail[0].rows[1].cells[1]']);
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail[0].rows.length, 2);
  assert.equal(step.content.tail[0].rows[1].cells[0].content.head.html, 'b1');
});

test('add-row at start inserts before existing rows', () => {
  const result = applyArea(tableSrc(), {
    stepSelector: '1', op: 'add-row', areaKey: 'tail[0]', position: 'start', cells: ['b1', 'b2'],
  });
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail[0].rows[0].cells[0].content.head.html, 'b1');
});

test('add-row rejects a cell count that does not match the table\'s column count', () => {
  const result = applyArea(tableSrc(), {
    stepSelector: '1', op: 'add-row', areaKey: 'tail[0]', position: 'end', cells: ['only-one'],
  });
  assert.equal(result.ok, false);
});

test('add-row rejects targeting a non-table area', () => {
  const src = minimalDiagram(
    '    simple(1, 5582897d, `head`, plain=`head`) {\n        text(`t`, plain=`t`)\n    }\n',
  );
  const result = applyArea(src, { stepSelector: '1', op: 'add-row', areaKey: 'tail[0]', position: 'end', cells: ['x'] });
  assert.equal(result.ok, false);
});

test('add-row on an emptied table still validates cell count against cols', () => {
  // Insert a 2-column table, then remove its only row -- the table now has zero rows, but
  // `cols` still names 2 columns. `area.rows[0]?.cells.length` alone can no longer see the
  // column count once rows.length === 0, so the check must fall back to `cols`.
  const inserted = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'table', position: 'end', rows: [['a', 'b']], cols: ['30%', '70%'],
  });
  const emptied = applyArea(inserted.text, { stepSelector: '1', op: 'remove-row', areaKey: 'tail[0].rows[0]' });
  const ast0 = parseDiagram(emptied.text);
  assert.equal(findStep(ast0, { stepId: '5582897d' }).step.content.tail[0].rows.length, 0);

  const result = applyArea(emptied.text, { stepSelector: '1', op: 'add-row', areaKey: 'tail[0]', position: 'end', cells: ['only-one'] });
  assert.equal(result.ok, false);
});

test('add-row on an emptied table without cols allows any cell count', () => {
  const inserted = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'table', position: 'end', rows: [['a']],
  });
  const emptied = applyArea(inserted.text, { stepSelector: '1', op: 'remove-row', areaKey: 'tail[0].rows[0]' });
  const result = applyArea(emptied.text, { stepSelector: '1', op: 'add-row', areaKey: 'tail[0]', position: 'end', cells: ['x', 'y', 'z'] });
  assert.equal(result.ok, true);
});

// ---------------------------------------------------------------------------
// add-item
// ---------------------------------------------------------------------------

function listSrc() {
  return minimalDiagram(
    '    simple(1, 5582897d, `head`, plain=`head`) {\n' +
    '        list(ordered=false) {\n' +
    '            item(`i1`, plain=`i1`)\n' +
    '        }\n' +
    '    }\n',
  );
}

test('add-item appends a new item and reports its area key', () => {
  const result = applyArea(listSrc(), { stepSelector: '1', op: 'add-item', areaKey: 'tail[0]', position: 'end', html: 'i2' });
  assert.equal(result.ok, true);
  assert.equal(result.itemAreaKey, 'tail[0].items[1]');
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.deepEqual(step.content.tail[0].items.map((it) => it.content.head.html), ['i1', 'i2']);
});

test('add-item with a changeset marks the new item as added', () => {
  const result = applyArea(listSrc(), {
    stepSelector: '1', op: 'add-item', areaKey: 'tail[0]', position: 'end', html: 'i2', changeset: 'yellow',
  });
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.deepEqual(step.content.tail[0].items[1].change, { kind: 'added', changeset: 'yellow', sourceStep: undefined });
});

test('add-item rejects targeting a non-list area', () => {
  const result = applyArea(tableSrc(), { stepSelector: '1', op: 'add-item', areaKey: 'tail[0]', position: 'end', html: 'x' });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------

test('remove deletes a text area outright when no changeset is given', () => {
  const src = minimalDiagram(
    '    simple(1, 5582897d, `head`, plain=`head`) {\n        text(`t`, plain=`t`)\n    }\n',
  );
  const result = applyArea(src, { stepSelector: '1', op: 'remove', areaKey: 'tail[0]' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail.length, 0);
});

test('remove with a changeset marks a table area as removed instead of deleting it', () => {
  const result = applyArea(tableSrc(), { stepSelector: '1', op: 'remove', areaKey: 'tail[0]', changeset: 'yellow' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail.length, 1);
  assert.deepEqual(step.content.tail[0].change, { kind: 'removed', changeset: 'yellow', sourceStep: undefined });
});

test('remove with a changeset on a list area is refused (list areas have no change slot in the grammar)', () => {
  const result = applyArea(listSrc(), { stepSelector: '1', op: 'remove', areaKey: 'tail[0]', changeset: 'yellow' });
  assert.equal(result.ok, false);
});

test('remove without a changeset deletes a list area outright', () => {
  const result = applyArea(listSrc(), { stepSelector: '1', op: 'remove', areaKey: 'tail[0]' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail.length, 0);
});

test('remove refuses to target an image area', () => {
  const src = minimalDiagram(
    '    simple(1, 5582897d, `head`, plain=`head`) {\n' +
    '        image(scale=100%, type=png) {\n            [base64:YWJj]\n        }\n' +
    '    }\n',
  );
  const result = applyArea(src, { stepSelector: '1', op: 'remove', areaKey: 'tail[0]' });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// remove-item / remove-row
// ---------------------------------------------------------------------------

test('remove-item deletes the item outright when no changeset is given', () => {
  const result = applyArea(listSrc(), { stepSelector: '1', op: 'remove-item', areaKey: 'tail[0].items[0]' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail[0].items.length, 0);
});

test('remove-item with a changeset marks the item as removed instead of deleting it', () => {
  const result = applyArea(listSrc(), { stepSelector: '1', op: 'remove-item', areaKey: 'tail[0].items[0]', changeset: 'yellow' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail[0].items.length, 1);
  assert.deepEqual(step.content.tail[0].items[0].change, { kind: 'removed', changeset: 'yellow', sourceStep: undefined });
});

test('remove-row deletes the row when no changeset is given', () => {
  const result = applyArea(tableSrc(), { stepSelector: '1', op: 'remove-row', areaKey: 'tail[0].rows[0]' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const step = findStep(ast, { stepId: '5582897d' }).step;
  assert.equal(step.content.tail[0].rows.length, 0);
});

test('remove-row refuses a changeset (tableRow has no changeParam in the grammar)', () => {
  const result = applyArea(tableSrc(), { stepSelector: '1', op: 'remove-row', areaKey: 'tail[0].rows[0]', changeset: 'yellow' });
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// misc
// ---------------------------------------------------------------------------

test('rejects an unknown op', () => {
  const result = applyArea(emptyTailSrc, { stepSelector: '1', op: 'bogus' });
  assert.equal(result.ok, false);
});

test('produces text the AST can re-parse cleanly after every mutation', () => {
  const result = applyArea(emptyTailSrc, {
    stepSelector: '1', op: 'insert', kind: 'table', position: 'end', rows: [['a', 'b']],
  });
  assert.doesNotThrow(() => parseDiagram(result.text));
});

// ---------------------------------------------------------------------------
// intro/outro blocks and --heading
// ---------------------------------------------------------------------------

const outroSrc =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'intro(`<h1>T</h1>`, plain=`T`) {\n' +
  '    list(ordered=false) {\n        item(`-`, plain=`-`)\n    }\n' +
  '}\n' +
  'mainSequence {\n    simple(1, 5582897d, `a`, plain=`a`);\n}\n' +
  'outro(`<h2>Offene Punkte</h2>`, plain=`x`) {\n' +
  '    table(width=100%, cols=[75%, 25%]) {\n        row { cell(`ISSUE`, plain=`ISSUE`) | cell(`PRIO`, plain=`PRIO`) }\n    }\n' +
  '    text(`<h2>Bemerkungen</h2>`, plain=`x`)\n' +
  '}\n';

test('add-item and remove-item work on a list in intro', () => {
  const added = applyArea(outroSrc, { stepSelector: 'intro', op: 'add-item', areaKey: 'tail[0]', position: 'end', html: 'Zweite Vorbedingung' });
  assert.equal(added.ok, true);
  assert.equal(added.itemAreaKey, 'tail[0].items[1]');
  const removed = applyArea(added.text, { stepSelector: 'intro', op: 'remove-item', areaKey: 'tail[0].items[0]' });
  const list = parseDiagram(removed.text).intro.tail[0];
  assert.deepEqual(list.items.map((i) => i.content.head.html), ['Zweite Vorbedingung']);
});

test('outro can hold table, text, table: insert text+table after the existing table', () => {
  const r1 = applyArea(outroSrc, { stepSelector: 'outro', op: 'insert', kind: 'text', position: 'after:tail[0]', heading: 'Akzeptanzkriterien' });
  assert.equal(r1.ok, true);
  assert.equal(r1.areaKey, 'tail[1]');
  const r2 = applyArea(r1.text, { stepSelector: 'outro', op: 'insert', kind: 'table', position: 'after:tail[1]', rows: [['Nr', 'Kriterium'], ['1', 'Titel gesetzt']], cols: ['10%', '90%'] });
  assert.equal(r2.areaKey, 'tail[2]');
  const outro = parseDiagram(r2.text).outro;
  assert.deepEqual(outro.tail.map((a) => a.kind), ['table', 'text', 'table', 'text']);
  assert.match(outro.tail[1].content.html, /<h2>[\s\S]*Akzeptanzkriterien/);
});

test('insert text with --heading and --text builds heading plus paragraph', () => {
  const r = applyArea(outroSrc, { stepSelector: 'outro', op: 'insert', kind: 'text', position: 'end', heading: 'Hinweis', html: undefined, text: 'Zeile eins\nZeile zwei' });
  const html = parseDiagram(r.text).outro.tail[2].content.html;
  assert.match(html, /<h2>[\s\S]*Hinweis[\s\S]*<\/h2>/);
  assert.match(html, /Zeile eins/);
  assert.match(html, /Zeile zwei/);
});

test('insert text needs either --html or --heading', () => {
  const r = applyArea(outroSrc, { stepSelector: 'outro', op: 'insert', kind: 'text', position: 'end' });
  assert.equal(r.ok, false);
  assert.match(r.error, /html|heading/i);
});

test('add-row works on the outro Offene-Punkte table', () => {
  const r = applyArea(outroSrc, { stepSelector: 'outro', op: 'add-row', areaKey: 'tail[0]', position: 'end', cells: ['Frage?', 'hoch'] });
  assert.equal(r.ok, true);
  assert.equal(parseDiagram(r.text).outro.tail[0].rows.length, 2);
});

test('area ops refuse a missing block', () => {
  const noOutro = outroSrc.replace(/outro\([\s\S]*$/, '');
  const r = applyArea(noOutro, { stepSelector: 'outro', op: 'insert', kind: 'text', position: 'end', html: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /outro/);
});
