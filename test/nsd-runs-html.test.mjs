import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeText, htmlToText, runsToHtml, paragraphsToHtml, assertNoBacktick } from '../scripts/lib/nsd-runs-html.mjs';

test('escapeText escapes markup characters, quotes, backticks and non-ASCII', () => {
  assert.equal(escapeText('a < b & "c" `d` ä'), 'a &lt; b &amp; &quot;c&quot; &#96;d&#96; &#228;');
});

test('htmlToText reverses escapeText and strips tags', () => {
  const html = `<b>${escapeText('Prüfen & "ok"')}</b><br>zweite Zeile`;
  assert.equal(htmlToText(html), 'Prüfen & "ok"\nzweite Zeile');
});

test('runsToHtml wraps formatting and merges adjacent runs with the same format', () => {
  const html = runsToHtml([
    { text: 'Fett', b: true }, { text: 'er', b: true }, { text: ' normal' }, { text: 'kursiv', i: true, u: true },
  ]);
  assert.equal(html, '<b>Fetter</b> normal<i><u>kursiv</u></i>');
});

test('runsToHtml turns newlines into <br> and drops empty runs', () => {
  assert.equal(runsToHtml([{ text: 'a\nb' }, { text: '' }]), 'a<br>b');
});

test('paragraphsToHtml emits one div per non-empty paragraph', () => {
  assert.equal(paragraphsToHtml([[{ text: 'eins' }], [], [{ text: 'zwei' }]]), '<div>eins</div>\n<div>zwei</div>');
});

test('assertNoBacktick rejects a literal backtick', () => {
  assert.throws(() => assertNoBacktick('a`b', 'x'), /Backtick/);
  assert.doesNotThrow(() => assertNoBacktick('a&#96;b', 'x'));
});
