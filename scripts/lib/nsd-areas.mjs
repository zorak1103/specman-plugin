// nsd-areas.mjs — constructs AST area nodes (text / list / table / image) from plain data, in the
// exact shape nsd-ast.mjs parses and serializes. Callers decide *content*; this module owns the
// structural details (no `plain=` ever written — the sanitizer regenerates it; images only ever
// become a `[base64:...]` block built from real PNG bytes).
//
// Spec shapes (all `html` values are already-escaped HTML, see nsd-html.mjs):
//   { kind: 'text',  html }
//   { kind: 'list',  ordered, items: [{ html, tail?: [spec] }] }
//   { kind: 'table', widthPercent?, cols?: [percent], rows: [[{ html, tail?: [spec] }]] }
//   { kind: 'image', png: Buffer, scalePercent? }

import { assertNoBacktick } from './nsd-runs-html.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function makeHtmlContent(html) {
  assertNoBacktick(html, 'nsd-areas');
  return { html, plain: undefined, markups: [] };
}

function makeContent(html, tail) {
  return { head: makeHtmlContent(html), tail: (tail ?? []).map(buildArea) };
}

function percent(n, fallback) {
  const value = n === undefined ? fallback : n;
  if (!(Number(value) > 0 && Number(value) <= 100)) {
    throw new Error(`nsd-areas: Prozentwert muss in (0,100] liegen, erhalten: ${value}`);
  }
  return `${Number(value)}%`;
}

function buildTable(spec) {
  if (!Array.isArray(spec.rows) || spec.rows.length === 0) throw new Error('nsd-areas: table braucht mindestens eine Zeile.');
  const columnCount = spec.rows[0].length;
  if (columnCount === 0) throw new Error('nsd-areas: table-Zeile ohne Zellen.');
  spec.rows.forEach((row, r) => {
    if (row.length !== columnCount) {
      throw new Error(`nsd-areas: table-Zeile ${r} hat ${row.length} Zellen, Zeile 0 hat ${columnCount}.`);
    }
  });
  if (spec.cols && spec.cols.length !== columnCount) {
    throw new Error(`nsd-areas: cols hat ${spec.cols.length} Werte, die Tabelle ${columnCount} Spalten.`);
  }
  return {
    kind: 'table',
    widthPercent: percent(spec.widthPercent, 96),
    cols: spec.cols ? spec.cols.map((c) => percent(c)) : undefined,
    change: undefined,
    rows: spec.rows.map((row) => ({ cells: row.map((cell) => ({ content: makeContent(cell.html, cell.tail) })) })),
  };
}

function buildImage(spec) {
  const png = Buffer.isBuffer(spec.png) ? spec.png : Buffer.from(spec.png ?? []);
  if (png.length < PNG_SIGNATURE.length || !png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error('nsd-areas: image erwartet PNG-Daten (Signatur stimmt nicht) — andere Formate vorher nach PNG konvertieren.');
  }
  return {
    kind: 'image',
    scalePercent: percent(spec.scalePercent, 100),
    imageType: 'png',
    change: undefined,
    raw: `[base64:${png.toString('base64')}]`,
  };
}

export function buildArea(spec) {
  if (spec.kind === 'text') return { kind: 'text', content: makeHtmlContent(spec.html), change: undefined };
  if (spec.kind === 'list') {
    if (!Array.isArray(spec.items) || spec.items.length === 0) throw new Error('nsd-areas: list braucht mindestens ein Item.');
    return {
      kind: 'list',
      ordered: !!spec.ordered,
      items: spec.items.map((item) => ({ content: makeContent(item.html, item.tail), change: undefined })),
    };
  }
  if (spec.kind === 'table') return buildTable(spec);
  if (spec.kind === 'image') return buildImage(spec);
  throw new Error(`nsd-areas: unbekannte Area-Art '${spec.kind}' (erwartet text|list|table|image).`);
}
