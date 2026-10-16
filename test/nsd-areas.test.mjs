import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildArea } from '../scripts/lib/nsd-areas.mjs';
import { TINY_PNG } from './helpers/docx.mjs';

test('buildArea text never writes plain=', () => {
  const area = buildArea({ kind: 'text', html: 'Hallo' });
  assert.equal(area.content.html, 'Hallo');
  assert.equal(area.content.plain, undefined);
});

test('buildArea list builds items with optional tails', () => {
  const area = buildArea({ kind: 'list', ordered: true, items: [{ html: 'a' }, { html: 'b', tail: [{ kind: 'text', html: 'Detail' }] }] });
  assert.equal(area.ordered, true);
  assert.equal(area.items.length, 2);
  assert.equal(area.items[1].content.tail[0].kind, 'text');
});

test('buildArea table requires equal row lengths and matching cols', () => {
  assert.throws(() => buildArea({ kind: 'table', rows: [[{ html: 'a' }, { html: 'b' }], [{ html: 'c' }]] }), /Zeile 1 hat 1 Zellen/);
  assert.throws(() => buildArea({ kind: 'table', cols: [50], rows: [[{ html: 'a' }, { html: 'b' }]] }), /cols hat 1 Werte/);
  const table = buildArea({ kind: 'table', cols: [30, 70], rows: [[{ html: 'a' }, { html: 'b' }]] });
  assert.deepEqual(table.cols, ['30%', '70%']);
  assert.equal(table.widthPercent, '96%');
});

test('buildArea image embeds real PNG bytes as a base64 block', () => {
  const area = buildArea({ kind: 'image', png: TINY_PNG, scalePercent: 80 });
  assert.equal(area.scalePercent, '80%');
  assert.equal(area.imageType, 'png');
  assert.equal(area.raw, `[base64:${TINY_PNG.toString('base64')}]`);
});

test('buildArea image rejects non-PNG data', () => {
  assert.throws(() => buildArea({ kind: 'image', png: Buffer.from('GIF89a....') }), /PNG/);
});

test('buildArea rejects unknown kinds and out-of-range percentages', () => {
  assert.throws(() => buildArea({ kind: 'video' }), /unbekannte Area-Art/);
  assert.throws(() => buildArea({ kind: 'image', png: TINY_PNG, scalePercent: 150 }), /Prozentwert/);
});

test('buildArea rejects a backtick in html', () => {
  assert.throws(() => buildArea({ kind: 'text', html: 'a`b' }), /Backtick/);
});
