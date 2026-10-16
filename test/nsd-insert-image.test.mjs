import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyInsertImage } from '../scripts/nsd-insert-image.mjs';
import { parseDiagram } from '../scripts/lib/nsd-ast.mjs';
import { TINY_PNG } from './helpers/docx.mjs';

const TEMPLATE = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'reference', 'suc-template.nsd'), 'utf8',
);
const STEP_ID = parseDiagram(TEMPLATE).mainSequence.steps[0].stepId; // survives template updates

test('applyInsertImage appends a PNG to a step tail and round-trips', () => {
  const result = applyInsertImage(TEMPLATE, { stepSelector: STEP_ID, png: TINY_PNG, scalePercent: 50 });
  assert.equal(result.ok, true, result.error);
  const image = parseDiagram(result.text).mainSequence.steps[0].content.tail.at(-1);
  assert.equal(image.kind, 'image');
  assert.equal(image.scalePercent, '50%');
  assert.equal(image.raw, `[base64:${TINY_PNG.toString('base64')}]`);
});

test('applyInsertImage can target outro/intro and honours positions', () => {
  const start = applyInsertImage(TEMPLATE, { stepSelector: 'outro', png: TINY_PNG, position: 'start' });
  assert.equal(parseDiagram(start.text).outro.tail[0].kind, 'image');
  const after = applyInsertImage(TEMPLATE, { stepSelector: 'intro', png: TINY_PNG, position: 'after:tail[0]' });
  assert.equal(parseDiagram(after.text).intro.tail[1].kind, 'image');
  assert.equal(after.areaKey, 'tail[1]');
});

test('applyInsertImage reports unknown steps, bad positions and non-PNG data', () => {
  assert.match(applyInsertImage(TEMPLATE, { stepSelector: 'deadbeef', png: TINY_PNG }).error, /nicht gefunden/);
  assert.match(applyInsertImage(TEMPLATE, { stepSelector: STEP_ID, png: TINY_PNG, position: 'sideways' }).error, /position/);
  assert.match(applyInsertImage(TEMPLATE, { stepSelector: STEP_ID, png: Buffer.from('nope-not-a-png') }).error, /PNG/);
  assert.match(applyInsertImage(TEMPLATE, { stepSelector: STEP_ID, png: TINY_PNG, position: 'after:tail[9]' }).error, /nicht existierenden Index/);
});
