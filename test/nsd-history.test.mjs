import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHistory, fillInitial, appendRow } from '../scripts/nsd-history.mjs';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';

function withHistoryTable(dataRows) {
  const rows = [
    'row { cell(`Ver-\nsion`) | cell(`Aktivität`) | cell(`Autor`) | cell(`Datum`) | cell(`Folgeaktion`) }',
    ...dataRows,
  ];
  return (
    '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
    'intro(`SUC-000 Titel`) {\n' +
    '    table(width=100%) {\n' +
    `        ${rows.join('\n        ')}\n` +
    '    }\n' +
    '}\n' +
    'mainSequence {\n' +
    '    simple(1, 5582897d, `x`, plain=`x`);\n' +
    '}\n'
  );
}

const initialTemplateSrc = withHistoryTable([
  'row { cell(`0.1`) | cell(`Initiale \nErstellung`) | cell(``) | cell(``) | cell(``) }',
]);

const noTableSrc =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'mainSequence {\n' +
  '    simple(1, 5582897d, `x`, plain=`x`);\n' +
  '}\n';

test('readHistory returns header and data rows from the intro table', () => {
  const result = readHistory(initialTemplateSrc);
  assert.equal(result.ok, true);
  assert.equal(result.columnCount, 5);
  assert.deepEqual(result.rows, [['0.1', 'Initiale \nErstellung', '', '', '']]);
});

test('readHistory reports a clear error when no matching table exists', () => {
  const result = readHistory(noTableSrc);
  assert.equal(result.ok, false);
  assert.match(result.error, /Dokumentenhistorie/);
});

test('fillInitial writes author, date and Review into the empty template row', () => {
  const result = fillInitial(initialTemplateSrc, { author: 'M. Mustermann', date: '17.09.2026' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const row = ast.intro.tail[0].rows[1];
  assert.equal(row.cells[0].content.head.html, '0.1');
  assert.equal(row.cells[2].content.head.html, 'M. Mustermann');
  assert.equal(row.cells[3].content.head.html, '17.09.2026');
  assert.equal(row.cells[4].content.head.html, 'Review');
});

test('fillInitial never writes plain= on the cells it touches', () => {
  const result = fillInitial(initialTemplateSrc, { author: 'M. Mustermann', date: '17.09.2026' });
  const ast = parseDiagram(result.text);
  const row = ast.intro.tail[0].rows[1];
  assert.equal(row.cells[2].content.head.plain, undefined);
});

test('fillInitial refuses when the table already has more than one data row', () => {
  const src = withHistoryTable([
    'row { cell(`0.1`) | cell(`Initiale Erstellung`) | cell(`M. Mustermann`) | cell(`01.01.2026`) | cell(`Review`) }',
    'row { cell(`0.2`) | cell(`Etwas geändert`) | cell(`M. Mustermann`) | cell(`02.01.2026`) | cell(`Review`) }',
  ]);
  const result = fillInitial(src, { author: 'M. Mustermann', date: '17.09.2026' });
  assert.equal(result.ok, false);
  assert.match(result.error, /append/);
});

test('appendRow adds a new row with escaped umlauts and ampersand', () => {
  const src = withHistoryTable([
    'row { cell(`0.1`) | cell(`Initiale Erstellung`) | cell(`M. Mustermann`) | cell(`01.01.2026`) | cell(`Review`) }',
  ]);
  const result = appendRow(src, {
    version: '0.2', activity: 'Prüfzeile mit Umlaut ä & Ampersand', author: 'M. Mustermann',
    date: '17.09.2026', followup: 'Review',
  });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  const rows = ast.intro.tail[0].rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[2].cells[1].content.head.html, 'Pr&#252;fzeile mit Umlaut &#228; &amp; Ampersand');
  assert.equal(rows[2].cells[4].content.head.html, 'Review');
});

test('appendRow round-trips through parse/serialize/parse without throwing', () => {
  const src = withHistoryTable([
    'row { cell(`0.1`) | cell(`Initiale Erstellung`) | cell(`M. Mustermann`) | cell(`01.01.2026`) | cell(`Review`) }',
  ]);
  const result = appendRow(src, {
    version: '0.2', activity: 'Kleine Korrektur', author: 'M. Mustermann', date: '17.09.2026', followup: '-',
  });
  assert.doesNotThrow(() => parseDiagram(result.text));
});

test('appendRow rejects a literal backtick in a value', () => {
  const src = withHistoryTable([
    'row { cell(`0.1`) | cell(`Initiale Erstellung`) | cell(`M. Mustermann`) | cell(`01.01.2026`) | cell(`Review`) }',
  ]);
  const result = appendRow(src, {
    version: '0.2', activity: 'Enthält `Backtick`', author: 'M. Mustermann', date: '17.09.2026', followup: 'Review',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Backtick/);
});

test('appendRow reports a clear error when no matching table exists', () => {
  const result = appendRow(noTableSrc, {
    version: '0.2', activity: 'x', author: 'x', date: '17.09.2026', followup: '-',
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /Dokumentenhistorie/);
});

test('fillInitial writes the given followup instead of the Review default', () => {
  const result = fillInitial(initialTemplateSrc, { author: 'M. Mustermann', date: '17.09.2026', followup: '-' });
  assert.equal(result.ok, true);
  const row = readHistory(result.text).rows[0];
  assert.equal(row[4], '-');
});

test('fillInitial refuses an unknown followup value', () => {
  const result = fillInitial(initialTemplateSrc, { author: 'M. Mustermann', date: '17.09.2026', followup: 'Sofort' });
  assert.equal(result.ok, false);
  assert.match(result.error, /followup/i);
});

test('importRows replaces all data rows and keeps empty cells (Review rows)', async () => {
  const { importRows } = await import('../scripts/nsd-history.mjs');
  const result = importRows(initialTemplateSrc, {
    rows: [
      ['0.1', 'Initiale Erstellung', 'S. Becker', '11.11.2025', ''],
      ['-', 'Review', 'J.Vieth', '31.03.2026', '-'],
    ],
  });
  assert.equal(result.ok, true);
  const rows = parseDiagram(result.text).intro.tail[0].rows;
  assert.equal(rows.length, 3);
  assert.equal(rows[1].cells[4].content.head.html, '');
  assert.equal(rows[2].cells[1].content.head.html, 'Review');
  assert.equal(rows[2].cells[2].content.head.plain, undefined);
});

test('importRows refuses empty input and rows with the wrong cell count', async () => {
  const { importRows } = await import('../scripts/nsd-history.mjs');
  assert.match(importRows(initialTemplateSrc, { rows: [] }).error, /mindestens eine Zeile/);
  assert.match(importRows(initialTemplateSrc, { rows: [['0.1', 'x']] }).error, /Zeile 0 hat 2 Zellen/);
});

test('importRows reports a clear error when no matching table exists and rejects backticks', async () => {
  const { importRows } = await import('../scripts/nsd-history.mjs');
  assert.match(importRows(noTableSrc, { rows: [['a', 'b', 'c', 'd', 'e']] }).error, /Dokumentenhistorie/);
  assert.match(importRows(initialTemplateSrc, { rows: [['0.1', 'a`b', 'c', 'd', 'e']] }).error, /Backtick/);
});
