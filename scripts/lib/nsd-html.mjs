// nsd-html.mjs — small HTML helpers for the text areas of intro/outro (and anywhere else a caller
// hands over plain text). Callers give plain text; this module produces Specman-style markup
// (same span/font wrapper the template uses) and escapes it, so no skill ever hand-writes HTML.

const SPAN_OPEN = '<span style="background-color: rgba(255, 255, 255, 0.0)"><font color="#000000">';
const SPAN_CLOSE = '</font></span>';
const HEADING_RE = /<h([1-6])\b[^>]*>[\s\S]*?<\/h\1>/g;
const FOLLOWING_DIVS_RE = /^(\s*<div\b[^>]*>[\s\S]*?<\/div>)+/;

/** Plain text in, Specman-style HTML text out: &, <, > escaped, non-ASCII as numeric entities. */
export function escapeText(text) {
  const s = String(text);
  if (s.includes('`')) throw new Error(`nsd-html: Text darf keinen Backtick enthalten: '${s}'`);
  const escaped = s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return Array.from(escaped).map((ch) => (ch.codePointAt(0) > 127 ? `&#${ch.codePointAt(0)};` : ch)).join('');
}

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function headingHtml(text) {
  return `<h2>\n      ${SPAN_OPEN}${escapeText(text)}${SPAN_CLOSE}\n    </h2>`;
}

export function paragraphHtml(text) {
  return `<div>\n      ${SPAN_OPEN}${escapeText(text)}${SPAN_CLOSE}\n    </div>`;
}

/** A heading followed by one paragraph per line of `text` (optional) — a complete new section. */
export function sectionHtml(heading, text) {
  const paragraphs = text ? String(text).split('\n').map(paragraphHtml).join('\n    ') : '';
  return paragraphs ? `${headingHtml(heading)}\n    ${paragraphs}` : headingHtml(heading);
}

/** Replaces only the content of the first `<h1>` (the title of an intro head). */
export function setTitle(headHtml, text) {
  const m = headHtml.match(/(<h1\b[^>]*>)[\s\S]*?(<\/h1>)/);
  if (!m) throw new Error('nsd-html: der head enthält keine h1-Überschrift (Titel).');
  return headHtml.replace(m[0], `${m[1]}\n      ${SPAN_OPEN}${escapeText(text)}${SPAN_CLOSE}\n    ${m[2]}`);
}

function headings(html) {
  return [...html.matchAll(HEADING_RE)].map((m) => ({
    text: stripTags(m[0]), start: m.index, end: m.index + m[0].length,
  }));
}

/** Plain texts of all headings (h1-h6) inside one text area's HTML, in document order. */
export function listSections(html) {
  return headings(html).map((h) => h.text);
}

/**
 * Replaces the paragraph(s) following the heading `heading` with one `<div>` per line of `text`
 * (inserts them when the heading has none). Everything else in the HTML is left untouched.
 */
export function setSection(html, heading, text) {
  const all = headings(html);
  const target = all.find((h) => h.text === heading);
  if (!target) {
    throw new Error(`nsd-html: Überschrift '${heading}' nicht gefunden (vorhanden: ${all.map((h) => `'${h.text}'`).join(', ') || 'keine'}).`);
  }
  const rest = html.slice(target.end);
  const old = rest.match(FOLLOWING_DIVS_RE);
  const paragraphs = String(text).split('\n').map(paragraphHtml).join('\n    ');
  return `${html.slice(0, target.end)}\n    ${paragraphs}${old ? rest.slice(old[0].length) : rest.replace(/^/, '')}`;
}
