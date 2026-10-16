import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeText, headingHtml, paragraphHtml, setTitle, setSection, listSections } from '../scripts/lib/nsd-html.mjs';

const introHead =
  '<h1 margin-top="0">\n      <span style="x"><font color="#000000">SUC-000 \n      Template</font></span>\n    </h1>\n' +
  '    <h2 margin-top="0">\n      <span style="x"><font color="#000000">Dokumentenhistorie \n      / UC-Lifecycle</font></span>\n    </h2>';

const textArea =
  '<h2>\n <span><font>Beschreibung</font></span>\n </h2>\n<div>\n <span><font>-</font></span>\n </div>\n' +
  '<h2>\n <span><font>Ausl&#246;ser \n / Vorbedingungen</font></span>\n </h2>';

test('escapeText escapes markup characters and non-ASCII as numeric entities', () => {
  assert.equal(escapeText('a<b>&"ä'), 'a&lt;b&gt;&amp;"&#228;');
});

test('escapeText refuses a backtick', () => {
  assert.throws(() => escapeText('a`b'), /Backtick/);
});

test('headingHtml/paragraphHtml produce escaped template-style markup', () => {
  assert.match(headingHtml('Akzeptanzkriterien'), /^<h2>[\s\S]*Akzeptanzkriterien[\s\S]*<\/h2>$/);
  assert.match(paragraphHtml('Zähler <1'), /<div>[\s\S]*Z&#228;hler &lt;1[\s\S]*<\/div>/);
});

test('setTitle replaces only the h1 content and keeps the rest of the head', () => {
  const out = setTitle(introHead, 'SUC-228.3 Prüfung');
  assert.match(out, /SUC-228\.3 Pr&#252;fung/);
  assert.doesNotMatch(out, /Template/);
  assert.match(out, /Dokumentenhistorie/);
  assert.match(out, /<h1 margin-top="0">/);
});

test('setTitle fails when there is no h1', () => {
  assert.throws(() => setTitle('<div>x</div>', 'T'), /h1/);
});

test('listSections returns heading plain texts with whitespace normalised', () => {
  assert.deepEqual(listSections(textArea), ['Beschreibung', 'Auslöser / Vorbedingungen']);
});

test('setSection replaces the paragraph after the heading and leaves other sections alone', () => {
  const out = setSection(textArea, 'Beschreibung', 'Neuer Text\nZweite Zeile');
  assert.match(out, /Neuer Text/);
  assert.match(out, /Zweite Zeile/);
  assert.doesNotMatch(out, /<font>-<\/font>/);
  assert.deepEqual(listSections(out), ['Beschreibung', 'Auslöser / Vorbedingungen']);
});

test('setSection inserts a paragraph when the heading has none (last heading)', () => {
  const out = setSection(textArea, 'Auslöser / Vorbedingungen', 'Bedingung');
  assert.match(out, /Bedingung/);
  assert.ok(out.indexOf('Bedingung') > out.indexOf('Vorbedingungen'));
});

test('setSection fails on an unknown heading and names the available ones', () => {
  assert.throws(() => setSection(textArea, 'Gibt es nicht', 'x'), /Beschreibung/);
});
