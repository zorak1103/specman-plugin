import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySetText } from '../scripts/nsd-set-text.mjs';
import { parseDiagram, serializeDiagram } from '../scripts/lib/nsd-ast.mjs';

const src =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'mainSequence {\n' +
  '    simple(1, 5582897d, `old text`, plain=`old text`, markups=[(0,2,Changed,yellow)]);\n' +
  '}\n';

test('applySetText replaces the head html of the addressed step', () => {
  const result = applySetText(src, { stepSelector: '1', areaKey: 'head', newHtml: '<b>new text</b>' });
  assert.equal(result.ok, true);
  const ast = parseDiagram(result.text);
  assert.equal(ast.mainSequence.steps[0].content.head.html, '<b>new text</b>');
});

test('applySetText clears plain= and existing markups since they described the old text', () => {
  const result = applySetText(src, { stepSelector: '1', areaKey: 'head', newHtml: 'new' });
  const ast = parseDiagram(result.text);
  const head = ast.mainSequence.steps[0].content.head;
  assert.equal(head.plain, undefined);
  assert.deepEqual(head.markups, []);
});

test('applySetText produces text the AST can re-parse cleanly (serializer round trip)', () => {
  const result = applySetText(src, { stepSelector: '1', areaKey: 'head', newHtml: 'brand new' });
  assert.doesNotThrow(() => parseDiagram(result.text));
});

test('applySetText reports a clear error for an unknown step', () => {
  const result = applySetText(src, { stepSelector: '99', areaKey: 'head', newHtml: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.error, /nicht gefunden/);
});

test('applySetText reports a clear error for an unknown area key', () => {
  const result = applySetText(src, { stepSelector: '1', areaKey: 'tail[5]', newHtml: 'x' });
  assert.equal(result.ok, false);
});

test('applySetText rejects new HTML containing a backtick', () => {
  const result = applySetText(src, { stepSelector: '1', areaKey: 'head', newHtml: 'a `quote`' });
  assert.equal(result.ok, false);
  assert.match(result.error, /Backtick/);
});

// ---------------------------------------------------------------------------
// intro/outro, --title, --section
// ---------------------------------------------------------------------------

const blockSrc =
  '// {"specmanVersion":"1.3.0","modelType":"specman.model.v002.DiagramModel_V002"}\n' +
  'intro(`<h1>SUC-000 Template</h1><h2>Dokumentenhistorie</h2>`, plain=`x`) {\n' +
  '    text(`<h2>Beschreibung</h2><div>-</div><h2>Auslöser</h2>`, plain=`x`)\n' +
  '    list(ordered=false) {\n        item(`-`, plain=`-`)\n    }\n' +
  '}\n' +
  'mainSequence {\n    simple(1, 5582897d, `a`, plain=`a`);\n}\n' +
  'outro(`<h2>Geschäftsregeln</h2><div></div>`, plain=`x`) {\n' +
  '    text(`<h2>Bemerkungen</h2>`, plain=`x`)\n}\n';

test('set-text replaces a list item inside intro', () => {
  const r = applySetText(blockSrc, { stepSelector: 'intro', areaKey: 'tail[1].items[0]', newHtml: 'Neuer Auslöser' });
  assert.equal(r.ok, true);
  assert.equal(parseDiagram(r.text).intro.tail[1].items[0].content.head.html, 'Neuer Auslöser');
});

test('set-text replaces the outro head', () => {
  const r = applySetText(blockSrc, { stepSelector: 'outro', areaKey: 'head', newHtml: '<div>neu</div>' });
  assert.equal(parseDiagram(r.text).outro.head.html, '<div>neu</div>');
});

test('set-text fails for a missing block', () => {
  const noOutro = blockSrc.replace(/outro\([\s\S]*$/, '');
  const r = applySetText(noOutro, { stepSelector: 'outro', areaKey: 'head', newHtml: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /outro/);
});

test('--title changes only the h1 of the intro head', () => {
  const r = applySetText(blockSrc, { stepSelector: 'intro', title: 'SUC-228.3 Prüfung' });
  assert.equal(r.ok, true);
  const head = parseDiagram(r.text).intro.head;
  assert.match(head.html, /SUC-228\.3 Pr&#252;fung/);
  assert.match(head.html, /Dokumentenhistorie/);
  assert.equal(head.plain, undefined);
});

test('--title is refused on a step and on the outro', () => {
  assert.equal(applySetText(blockSrc, { stepSelector: '1', title: 'x' }).ok, false);
  assert.equal(applySetText(blockSrc, { stepSelector: 'outro', title: 'x' }).ok, false);
});

test('--section/--text replaces the paragraph under one heading only', () => {
  const r = applySetText(blockSrc, { stepSelector: 'intro', areaKey: 'tail[0]', section: 'Beschreibung', sectionText: 'Ein Satz.\nNoch einer.' });
  assert.equal(r.ok, true);
  const html = parseDiagram(r.text).intro.tail[0].content.html;
  assert.match(html, /Ein Satz\./);
  assert.match(html, /Noch einer\./);
  assert.match(html, /<h2>Ausl/);
});

test('--section fails on an unknown heading', () => {
  const r = applySetText(blockSrc, { stepSelector: 'intro', areaKey: 'tail[0]', section: 'Nope', sectionText: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /Beschreibung/);
});

test('--section works on the outro head', () => {
  const r = applySetText(blockSrc, { stepSelector: 'outro', areaKey: 'head', section: 'Geschäftsregeln', sectionText: 'Regel 1' });
  assert.match(parseDiagram(r.text).outro.head.html, /Regel 1/);
});
