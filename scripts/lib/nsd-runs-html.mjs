// nsd-runs-html.mjs — turns plain text and formatted runs (from a .docx) into the HTML fragments
// Specman stores in its `html` fields, and back to plain text for comparisons. Used by the
// migration (nsd-areas, nsd-plan, migrate-verify). Deliberately separate from nsd-html.mjs, which
// owns the template-style heading/section helpers for intro/outro editing.
//
// Two invariants matter for the DSL, not just for HTML correctness:
//   * a literal backtick would terminate the backtick string the HTML is stored in, so it is always
//     emitted as `&#96;`;
//   * everything outside ASCII is written as a numeric entity (same convention Specman itself and
//     nsd-history.mjs use), which keeps the file encoding-independent.

export function escapeText(text) {
  const s = String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/`/g, '&#96;');
  return Array.from(s)
    .map((ch) => (ch.codePointAt(0) > 127 ? `&#${ch.codePointAt(0)};` : ch))
    .join('');
}

/** Reverse of escapeText plus tag stripping — used to compare stored HTML against plain text. */
export function htmlToText(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

const FORMAT_KEYS = ['b', 'i', 'u', 'strike', 'hl', 'sup', 'sub'];

function sameFormat(a, b) {
  return FORMAT_KEYS.every((k) => !!a[k] === !!b[k]);
}

function mergeRuns(runs) {
  const merged = [];
  for (const run of runs) {
    if (!run.text) continue;
    const last = merged[merged.length - 1];
    if (last && sameFormat(last, run)) last.text += run.text;
    else merged.push({ ...run });
  }
  return merged;
}

function runHtml(run) {
  let inner = escapeText(run.text)
    .replace(/\t/g, '&#160;&#160;&#160;&#160;')
    .replace(/\n/g, '<br>');
  if (run.sub) inner = `<sub>${inner}</sub>`;
  if (run.sup) inner = `<sup>${inner}</sup>`;
  if (run.hl) inner = `<span style="background-color: #ffff00">${inner}</span>`;
  if (run.strike) inner = `<strike>${inner}</strike>`;
  if (run.u) inner = `<u>${inner}</u>`;
  if (run.i) inner = `<i>${inner}</i>`;
  if (run.b) inner = `<b>${inner}</b>`;
  return inner;
}

/** Runs `[{ text, b, i, u, strike, hl, sup, sub }]` -> inline HTML (no wrapping block element). */
export function runsToHtml(runs) {
  return mergeRuns(runs).map(runHtml).join('');
}

/** Several paragraphs (each a runs array) -> one `<div>` per non-empty paragraph. */
export function paragraphsToHtml(paragraphs) {
  return paragraphs
    .map((runs) => runsToHtml(runs))
    .filter((html) => html !== '')
    .map((html) => `<div>${html}</div>`)
    .join('\n');
}

export function assertNoBacktick(html, where) {
  if (String(html).includes('`')) {
    throw new Error(`${where}: HTML darf keinen Backtick enthalten (als &#96; schreiben).`);
  }
}
