#!/usr/bin/env node
// nsd-area.mjs — inserts a table/list/text area into a step's tail, appends a row to an existing
// table or an item to an existing list, or removes a whole area / one row / one item. Closes the
// gap `nsd-set-text.mjs` deliberately leaves open (it only ever replaces content inside an area
// that already exists) and that `nsd-insert-step.mjs` deliberately leaves open (a freshly inserted
// step always gets an empty tail, `tail: []`) — creating the structural content itself, so callers
// never need to hand-construct `table(...)`/`list(...)`/`text(...)` DSL syntax.
//
// Tracking note: the grammar gives `text`/`table` areas a `changeParam` slot but NOT `list` areas
// (only individual `item(...)`s inside a list can carry `change=`), and NOT `tableRow` (a row has
// no change slot at all — see reference/SpecmanModel_V002.g4 `listBlock`/`tableRow`). This script
// mirrors that asymmetry rather than papering over it: marking a whole list or a table row as
// removed is refused with a clear error instead of silently doing nothing.
//
// Usage:
//   (--step also accepts intro|outro, alias --block intro|outro — the same ops work on their tail areas)
//   node nsd-area.mjs --file <path> --step <num-or-id> --op insert --kind text --position start|end|after:tail[i] (--html <html> | --heading <text> [--text <paragraphs>]) [--changeset <cs>] --json
//   node nsd-area.mjs --file <path> --step <num-or-id> --op insert --kind list --position <pos> --ordered true|false --items <json-array> [--changeset <cs>] --json
//   node nsd-area.mjs --file <path> --step <num-or-id> --op insert --kind table --position <pos> --rows <json-2d-array> [--cols <json-array>] [--width <percent>] [--changeset <cs>] --json
//   node nsd-area.mjs --file <path> --step <num-or-id> --op add-row --area <key> --position start|end|after:<rowIndex> --cells <json-array> --json
//   node nsd-area.mjs --file <path> --step <num-or-id> --op add-item --area <key> --position start|end|after:<itemIndex> --html <html> [--changeset <cs>] --json
//   node nsd-area.mjs --file <path> --step <num-or-id> --op remove --area <key> [--changeset <cs>] --json
//   node nsd-area.mjs --file <path> --step <num-or-id> --op remove-item --area <key> [--changeset <cs>] --json
//   node nsd-area.mjs --file <path> --step <num-or-id> --op remove-row --area <key> --json

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram, assertValidHtml } from './lib/nsd-ast.mjs';
import { resolveTarget, addressableAreas, resolveTailContainer } from './lib/nsd-paths.mjs';
import { sectionHtml } from './lib/nsd-html.mjs';

const AREA_KINDS = new Set(['text', 'list', 'table']);
const PERCENT_RE = /^\d+(\.\d+)?%$/;

function emptyHtmlContent(html) {
  return { html, plain: undefined, markups: [] };
}

function addedChange(changeset) {
  return changeset ? { kind: 'added', changeset, sourceStep: undefined } : undefined;
}

function removedChange(changeset) {
  return { kind: 'removed', changeset, sourceStep: undefined };
}

// Resolves a `start`/`end`/`after:tail[i]` position against an array, returning the insertion
// index or throwing a descriptive error. `afterPrefix` is the literal prefix the `after:` form
// must start with, e.g. `tail[` for a step's own tail, so error messages name the right shape.
function resolveInsertIndex(position, arrayLength, afterPattern, describeAfter) {
  if (position === 'start') return 0;
  if (position === 'end') return arrayLength;
  const m = typeof position === 'string' && position.match(afterPattern);
  if (!m) throw new Error(`nsd-area: ungültige position '${position}' (erwartet: start, end, oder ${describeAfter}).`);
  const afterIndex = Number(m[1]);
  if (!(afterIndex >= 0 && afterIndex < arrayLength)) {
    throw new Error(`nsd-area: position '${position}' verweist auf einen nicht existierenden Index (0..${arrayLength - 1}).`);
  }
  return afterIndex + 1;
}

function validateRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('nsd-area: --rows braucht mindestens eine Zeile.');
  }
  const colCount = rows[0].length;
  if (colCount === 0) throw new Error('nsd-area: --rows-Zeilen brauchen mindestens eine Zelle.');
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== colCount) {
      throw new Error(`nsd-area: --rows ist nicht rechteckig — jede Zeile braucht ${colCount} Zellen.`);
    }
    for (const cell of row) assertValidHtml(cell);
  }
  return colCount;
}

function validateCols(cols, colCount) {
  if (cols === undefined) return;
  if (!Array.isArray(cols) || cols.length !== colCount) {
    throw new Error(`nsd-area: --cols muss genau ${colCount} Einträge haben (eine je Spalte).`);
  }
  for (const c of cols) {
    if (typeof c !== 'string' || !PERCENT_RE.test(c)) {
      throw new Error(`nsd-area: --cols-Eintrag '${c}' ist kein gültiger Prozentwert (z. B. '30%').`);
    }
  }
}

function validateWidth(width) {
  if (width === undefined) return '100%';
  if (typeof width !== 'string' || !PERCENT_RE.test(width)) {
    throw new Error(`nsd-area: --width '${width}' ist kein gültiger Prozentwert (z. B. '100%').`);
  }
  return width;
}

function buildTextArea(html, heading, text, changeset) {
  if (html === undefined && heading === undefined) {
    throw new Error('nsd-area: insert --kind text braucht --html oder --heading (optional mit --text).');
  }
  if (html !== undefined && heading !== undefined) {
    throw new Error('nsd-area: --html und --heading schließen sich aus.');
  }
  if (html !== undefined) assertValidHtml(html);
  else html = sectionHtml(heading, text);
  return { kind: 'text', content: emptyHtmlContent(html), change: addedChange(changeset) };
}

function buildListArea(ordered, items, changeset) {
  if (typeof ordered !== 'boolean') {
    throw new Error("nsd-area: --ordered ist Pflicht und muss 'true' oder 'false' sein (kein stiller Default).");
  }
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('nsd-area: --items braucht mindestens ein Element.');
  }
  for (const html of items) assertValidHtml(html);
  return {
    kind: 'list',
    ordered,
    items: items.map((html) => ({
      content: { head: emptyHtmlContent(html), tail: [] },
      change: addedChange(changeset),
    })),
  };
}

function buildTableArea(rows, cols, width, changeset) {
  const colCount = validateRows(rows);
  validateCols(cols, colCount);
  const widthPercent = validateWidth(width);
  return {
    kind: 'table',
    widthPercent,
    cols,
    change: addedChange(changeset),
    rows: rows.map((cells) => ({
      cells: cells.map((html) => ({ content: { head: emptyHtmlContent(html), tail: [] } })),
    })),
  };
}

function newAreaKeysUnder(step, tailIndex) {
  const prefix = `tail[${tailIndex}]`;
  return addressableAreas(step)
    .map((a) => a.key)
    .filter((k) => k === prefix || k.startsWith(`${prefix}.`));
}

function applyInsert(step, { kind, position, html, heading, text, ordered, items, rows, cols, width, changeset }) {
  if (!AREA_KINDS.has(kind)) {
    return { ok: false, error: `nsd-area: --op insert kennt kein Kind '${kind}' (erwartet: ${[...AREA_KINDS].join('|')}).` };
  }
  let area;
  try {
    if (kind === 'text') area = buildTextArea(html, heading, text, changeset);
    else if (kind === 'list') area = buildListArea(ordered, items, changeset);
    else area = buildTableArea(rows, cols, width, changeset);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  let index;
  try {
    index = resolveInsertIndex(position, step.content.tail.length, /^after:tail\[(\d+)\]$/, "'after:tail[<i>]'");
  } catch (e) {
    return { ok: false, error: e.message };
  }
  step.content.tail.splice(index, 0, area);

  const result = { ok: true, areaKey: `tail[${index}]` };
  if (kind === 'list') result.itemAreaKeys = newAreaKeysUnder(step, index);
  if (kind === 'table') result.cellAreaKeys = newAreaKeysUnder(step, index);
  return result;
}

function applyAddRow(step, { areaKey, position, cells }) {
  let resolved;
  try {
    resolved = resolveTailContainer(step, areaKey);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const { area, index: tailIndex } = resolved;
  if (area.kind !== 'table') return { ok: false, error: `nsd-area: '${areaKey}' ist keine Tabelle.` };
  if (!Array.isArray(cells)) return { ok: false, error: 'nsd-area: --cells muss ein JSON-Array sein.' };
  // area.rows[0] is undefined once every row has been removed — fall back to the table's own
  // `cols` (still authoritative for the column count even with zero rows) so a caller can't slip
  // a row with the wrong cell count past validation just because the table happens to be empty.
  const colCount = area.rows[0]?.cells.length ?? area.cols?.length;
  if (colCount !== undefined && cells.length !== colCount) {
    return { ok: false, error: `nsd-area: --cells braucht ${colCount} Einträge (Spaltenzahl der Tabelle), erhalten: ${cells.length}.` };
  }
  try {
    for (const html of cells) assertValidHtml(html);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  let rowIndex;
  try {
    rowIndex = resolveInsertIndex(position, area.rows.length, /^after:(\d+)$/, "'after:<rowIndex>'");
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const newRow = { cells: cells.map((html) => ({ content: { head: emptyHtmlContent(html), tail: [] } })) };
  area.rows.splice(rowIndex, 0, newRow);

  return {
    ok: true,
    // tableRow has no changeParam in the grammar (see file header) — a caller relying on
    // change tracking for this row must be told explicitly, not left to notice its absence.
    untracked: true,
    cellAreaKeys: cells.map((_, c) => `tail[${tailIndex}].rows[${rowIndex}].cells[${c}]`),
  };
}

function applyAddItem(step, { areaKey, position, html, changeset }) {
  let resolved;
  try {
    resolved = resolveTailContainer(step, areaKey);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const { area, index: tailIndex } = resolved;
  if (area.kind !== 'list') return { ok: false, error: `nsd-area: '${areaKey}' ist keine Liste.` };
  try {
    assertValidHtml(html);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  let itemIndex;
  try {
    itemIndex = resolveInsertIndex(position, area.items.length, /^after:(\d+)$/, "'after:<itemIndex>'");
  } catch (e) {
    return { ok: false, error: e.message };
  }
  area.items.splice(itemIndex, 0, { content: { head: emptyHtmlContent(html), tail: [] }, change: addedChange(changeset) });

  return { ok: true, itemAreaKey: `tail[${tailIndex}].items[${itemIndex}]` };
}

function applyRemove(step, { areaKey, changeset }) {
  let resolved;
  try {
    resolved = resolveTailContainer(step, areaKey);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const { area, index } = resolved;
  if (resolved.row !== undefined || resolved.item !== undefined) {
    return { ok: false, error: `nsd-area: '${areaKey}' adressiert eine Zeile oder ein Item, nicht eine ganze Area — nutze remove-row/remove-item.` };
  }
  if (area.kind === 'image') {
    return { ok: false, error: 'nsd-area: image-Areas werden von diesem Plugin nie verändert.' };
  }
  if (changeset) {
    if (area.kind === 'list') {
      return {
        ok: false,
        error: "nsd-area: eine 'list'-Area hat laut Grammatik keinen change-Slot — entferne einzelne Items per remove-item, oder ohne --changeset ganz löschen.",
      };
    }
    area.change = removedChange(changeset);
    return { ok: true };
  }
  step.content.tail.splice(index, 1);
  return { ok: true };
}

function applyRemoveItem(step, { areaKey, changeset }) {
  let resolved;
  try {
    resolved = resolveTailContainer(step, areaKey);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const { area, item, index } = resolved;
  if (item === undefined) return { ok: false, error: `nsd-area: '${areaKey}' adressiert kein Listen-Item.` };
  if (changeset) {
    item.change = removedChange(changeset);
    return { ok: true };
  }
  area.items.splice(index, 1);
  return { ok: true };
}

function applyRemoveRow(step, { areaKey, changeset }) {
  let resolved;
  try {
    resolved = resolveTailContainer(step, areaKey);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const { area, row, index } = resolved;
  if (row === undefined) return { ok: false, error: `nsd-area: '${areaKey}' adressiert keine Tabellenzeile.` };
  if (changeset) {
    return {
      ok: false,
      error: 'nsd-area: eine Tabellenzeile (tableRow) hat laut Grammatik keinen change-Slot — Zeilen-Entfernung mit Tracking bleibt eine manuelle Specman-Aktion.',
    };
  }
  area.rows.splice(index, 1);
  return { ok: true };
}

export function applyArea(text, opts) {
  let ast;
  try {
    ast = parseDiagram(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const { stepSelector } = opts;
  let found;
  try {
    found = resolveTarget(ast, stepSelector);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!found) return { ok: false, error: `Schritt nicht gefunden: ${stepSelector}` };

  let result;
  if (opts.op === 'insert') result = applyInsert(found.step, opts);
  else if (opts.op === 'add-row') result = applyAddRow(found.step, opts);
  else if (opts.op === 'add-item') result = applyAddItem(found.step, opts);
  else if (opts.op === 'remove') result = applyRemove(found.step, opts);
  else if (opts.op === 'remove-item') result = applyRemoveItem(found.step, opts);
  else if (opts.op === 'remove-row') result = applyRemoveRow(found.step, opts);
  else return { ok: false, error: `nsd-area: unbekannte --op '${opts.op}' (erwartet: insert, add-row, add-item, remove, remove-item, remove-row).` };

  if (!result.ok) return result;
  return { ...result, text: serializeDiagram(ast) };
}

function parseJsonArg(args, key) {
  if (args[key] === undefined) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(args[key]) };
  } catch (e) {
    return { ok: false, error: `--${key} ist kein gültiges JSON: ${e.message}` };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  args.step = args.step ?? args.block;
  for (const required of ['file', 'step', 'op']) {
    if (args[required] === undefined) {
      report({ ok: false, error: `--${required} ist Pflicht.` }, { json: !!args.json });
      return;
    }
  }
  let text;
  try {
    text = readFileSync(args.file, 'utf8');
  } catch (e) {
    report({ ok: false, error: `Datei nicht lesbar: ${args.file} (${e.message})` }, { json: !!args.json });
    return;
  }

  const jsonFields = ['items', 'rows', 'cols', 'cells'];
  const parsed = {};
  for (const key of jsonFields) {
    const r = parseJsonArg(args, key);
    if (!r.ok) { report(r, { json: !!args.json }); return; }
    parsed[key] = r.value;
  }

  const opts = {
    stepSelector: args.step,
    op: args.op,
    kind: args.kind,
    position: args.position,
    html: args.html,
    heading: args.heading,
    text: typeof args.text === 'string' ? args.text.split('\\n').join('\n') : args.text,
    ordered: args.ordered === 'true' ? true : args.ordered === 'false' ? false : undefined,
    items: parsed.items,
    rows: parsed.rows,
    cols: parsed.cols,
    cells: parsed.cells,
    width: args.width,
    areaKey: args.area,
    changeset: args.changeset,
  };

  const result = applyArea(text, opts);
  if (result.ok) writeFileSync(args.file, result.text);
  const { text: _omit, ...rest } = result;
  report(result.ok ? rest : result, { json: !!args.json, plainText: () => 'geschrieben.' });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
