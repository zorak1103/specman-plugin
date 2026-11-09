import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readZip, parseXml, extractDocx, renderOutline, allParagraphs } from '../scripts/lib/docx-reader.mjs';
import { makeZip, makeDocx, para, cell, row, table, NUMBERING, TINY_PNG } from './helpers/docx.mjs';

test('readZip lists and reads stored entries', () => {
  const zip = readZip(makeZip({ 'a.txt': 'hallo', 'dir/b.txt': 'welt' }));
  assert.deepEqual(zip.names(), ['a.txt', 'dir/b.txt']);
  assert.equal(zip.get('dir/b.txt').toString(), 'welt');
  assert.equal(zip.get('missing'), undefined);
});

test('readZip rejects non-zip input', () => {
  assert.throws(() => readZip(Buffer.from('definitely not a zip file, just text')), /not a valid ZIP/);
});

test('parseXml handles attributes, entities, self-closing tags and comments', () => {
  const root = parseXml('<?xml version="1.0"?><a x="1 &amp; 2"><!-- c --><b/><c>t&lt;u</c></a>');
  assert.equal(root.attrs.x, '1 & 2');
  assert.equal(root.children[0].name, 'b');
  assert.equal(root.children[1].children[0].text, 't<u');
});

test('parseXml rejects mismatched tags', () => {
  assert.throws(() => parseXml('<a><b></a>'), /end tag/);
});

test('extractDocx returns paragraphs with style, formatting and ids', () => {
  const doc = makeDocx(para('Titel', { style: 'berschrift' }) + para('fett', { bold: true }));
  const { blocks, stats } = extractDocx(doc);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].id, 'p1');
  assert.equal(blocks[0].style, 'berschrift');
  assert.equal(blocks[1].runs[0].b, true);
  assert.equal(stats.paragraphs, 2);
});

test('extractDocx keeps insertions, drops deletions and ignores comments (final state)', () => {
  const body = '<w:p><w:r><w:t xml:space="preserve">vorher </w:t></w:r>' +
    '<w:ins w:id="1"><w:r><w:t>neu</w:t></w:r></w:ins>' +
    '<w:del w:id="2"><w:r><w:delText>alt</w:delText></w:r></w:del>' +
    '<w:r><w:commentReference w:id="0"/></w:r></w:p>';
  const { blocks, stats } = extractDocx(makeDocx(body));
  assert.equal(blocks[0].text, 'vorher neu');
  assert.equal(stats.insertions, 1);
  assert.equal(stats.deletions, 1);
  assert.equal(stats.comments, 1);
});

test('extractDocx drops table rows marked as deleted', () => {
  const kept = row(cell(para('bleibt')));
  const deleted = '<w:tr><w:trPr><w:del w:id="9"/></w:trPr><w:tc><w:p><w:r><w:t>weg</w:t></w:r></w:p></w:tc></w:tr>';
  const { blocks } = extractDocx(makeDocx(table(kept, deleted)));
  assert.equal(blocks[0].rows.length, 1);
  assert.deepEqual(allParagraphs(blocks).map((p) => p.text), ['bleibt']);
});

test('extractDocx resolves list kind from numbering.xml', () => {
  const body = para('Punkt', { num: { id: 1 } }) + para('Eins', { num: { id: 2 } });
  const { blocks } = extractDocx(makeDocx(body, { 'word/numbering.xml': NUMBERING }));
  assert.deepEqual(blocks[0].list, { numId: '1', level: 0, ordered: false });
  assert.equal(blocks[1].list.ordered, true);
});

test('extractDocx reads tables with spans and nested content', () => {
  const body = table(
    row(cell(para('A'), 2)),
    row(cell(para('B')), cell(table(row(cell(para('inner')))))),
  );
  const { blocks } = extractDocx(makeDocx(body));
  assert.equal(blocks[0].type, 'table');
  assert.equal(blocks[0].rows[0].cells[0].gridSpan, 2);
  assert.equal(blocks[0].rows[1].cells[1].blocks[0].type, 'table');
  assert.deepEqual(allParagraphs(blocks).map((p) => p.text), ['A', 'B', 'inner']);
});

test('extractDocx finds embedded images, writes them via the sink and warns for non-PNG', () => {
  const drawing = (rid) => `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="952500" cy="476250"/><a:graphic><a:blip r:embed="${rid}"/></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  const doc = makeDocx(drawing('rId1') + drawing('rId2'), {
    'word/media/image1.png': TINY_PNG,
    'word/media/image2.jpeg': Buffer.from('jpegdata'),
  }, '<Relationship Id="rId1" Target="media/image1.png"/><Relationship Id="rId2" Target="media/image2.jpeg"/>');
  const written = [];
  const { images, blocks, warnings } = extractDocx(doc, { imageSink: (name, bytes) => { written.push([name, bytes.length]); return `/out/${name}`; } });
  assert.equal(images.length, 2);
  assert.deepEqual(blocks[0].images, ['i1']);
  assert.equal(images[0].widthPx, 100);
  assert.equal(images[0].file, '/out/i1.png');
  assert.deepEqual(written[0], ['i1.png', TINY_PNG.length]);
  assert.match(warnings.join('\n'), /jpeg.*not PNG/);
});

test('extractDocx takes only the Choice branch of mc:AlternateContent (no duplicated drawings)', () => {
  const body = '<w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing><a:blip r:embed="rId1"/></w:drawing></mc:Choice>' +
    '<mc:Fallback><w:pict><v:imagedata xmlns:v="x" r:id="rId1"/></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>';
  const { images } = extractDocx(makeDocx(body, { 'word/media/image1.png': TINY_PNG }, '<Relationship Id="rId1" Target="media/image1.png"/>'));
  assert.equal(images.length, 1);
});

test('extractDocx detects the history table and its header paragraphs', () => {
  const body = table(
    row(cell(para('Version')), cell(para('Aktivität')), cell(para('Autor')), cell(para('Datum')), cell(para('Folgeaktion'))),
    row(cell(para('0.1')), cell(para('Initiale Erstellung')), cell(para('A. B.')), cell(para('01.01.2026')), cell(para('Review'))),
    row(cell(para('-')), cell(para('Review')), cell(para('C. D.')), cell('<w:p/>'), cell(para('-'))),
  );
  const { history } = extractDocx(makeDocx(body));
  assert.equal(history.tableId, 't1');
  assert.deepEqual(history.rows[0], ['0.1', 'Initiale Erstellung', 'A. B.', '01.01.2026', 'Review']);
  assert.equal(history.rows[1][3], '');
  assert.equal(history.headerParagraphIds.length, 5);
});

test('extractDocx rejects archives without document.xml', () => {
  assert.throws(() => extractDocx(makeZip({ 'other.xml': '<a/>' })), /document\.xml/);
});

test('renderOutline lists ids so a plan can reference them', () => {
  const { blocks } = extractDocx(makeDocx(para('Hallo', { style: 'X' }) + table(row(cell(para('Zelle'))))));
  const text = renderOutline(blocks).join('\n');
  assert.match(text, /p1 \[X\] Hallo/);
  assert.match(text, /t1 TABLE/);
  assert.match(text, /p2 \[-\] Zelle/);
});

test('extractDocx detects a history table with English headers', () => {
  const body = table(
    row(cell(para('Version')), cell(para('Activity')), cell(para('Author')), cell(para('Date')), cell(para('Follow-up'))),
    row(cell(para('0.1')), cell(para('Initial creation')), cell(para('A. B.')), cell(para('01.01.2026')), cell(para('Review'))),
  );
  const { history } = extractDocx(makeDocx(body));
  assert.equal(history.tableId, 't1');
  assert.equal(history.rows[0][1], 'Initial creation');
});
