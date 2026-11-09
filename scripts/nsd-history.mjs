#!/usr/bin/env node
// nsd-history.mjs — reads and maintains the "document history / UC lifecycle" table inside a
// diagram's `intro` block (columns: Version | Activity | Author | Date | Follow-up/result; the German
// template spells them Version | Aktivität | Autor | Datum | Folgeaktion).
// This table lives outside any step, so none of the step-addressing scripts
// (nsd-locate/nsd-set-text/nsd-insert-step) can reach it — this script is the only way in.
//
// The table is located by content, not by a fixed index: the first `table` area in `intro.tail`
// whose header row mentions Activity/Author/Date (or the German Aktivität/Autor/Datum). A miss is a
// hard error rather than a guess — writing into the wrong table (e.g. outro's Issue/Prio/Status
// table) would silently corrupt it.
//
// New cell text is escaped by this script itself (plain text in, Specman-style HTML out) — unlike
// nsd-set-text.mjs, whose callers already hand it prepared HTML. `plain=` is never written (the
// sanitizer regenerates it), consistent with nsd-set-text.mjs.
//
// No change tracking: although Specman 1.4 allows change= on a table cell, a history row is never
// marked added/removed here — the table is the change log itself.
//
// Usage:
//   node nsd-history.mjs --file <path> --mode read --json
//   node nsd-history.mjs --file <path> --mode fill-initial --author <name> [--date <DD.MM.YYYY>] [--followup <-|Review>] --json
//   node nsd-history.mjs --file <path> --mode append --version <v> --activity <text> --author <name> --followup <-|Review> [--date <DD.MM.YYYY>] --json
//   node nsd-history.mjs --file <path> --mode import --rows-file <json> --json   (replaces all data rows; JSON = [[version, activity, author, date, followup], ...])

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram } from './lib/nsd-ast.mjs';

// One entry per required header column; a column matches if it contains any alternative
// (case-insensitive): English first, then the German used by the vendored SUC template.
const HEADER_MARKERS = [
  ['activity', 'aktivität'],
  ['author', 'autor'],
  ['date', 'datum'],
];

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .trim();
}

function cellText(cell) {
  const { plain, html } = cell.content.head;
  return (plain !== undefined ? plain : stripTags(html)).trim();
}

function findHistoryTable(ast) {
  if (!ast.intro) return null;
  for (const area of ast.intro.tail) {
    if (area.kind !== 'table' || area.rows.length === 0) continue;
    const headerTexts = area.rows[0].cells.map(cellText);
    const lowered = headerTexts.map((t) => t.toLowerCase());
    if (HEADER_MARKERS.every((alts) => lowered.some((t) => alts.some((a) => t.includes(a))))) {
      return { area, headerTexts };
    }
  }
  return null;
}

function escapeCellText(text) {
  let s = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return Array.from(s)
    .map((ch) => (ch.codePointAt(0) > 127 ? `&#${ch.codePointAt(0)};` : ch))
    .join('');
}

function makeCell(text) {
  if (String(text).includes('`')) {
    throw new Error(`nsd-history: cell content must not contain a backtick: '${text}'`);
  }
  return { content: { head: { html: escapeCellText(text), plain: undefined, markups: [] }, tail: [] } };
}

export function todayDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const NOT_FOUND_ERROR =
  'No document history table found in the intro block (header row must contain Activity/Author/Date, or the German Aktivität/Autor/Datum).';

export function readHistory(text) {
  let ast;
  try { ast = parseDiagram(text); } catch (e) { return { ok: false, error: e.message }; }
  const found = findHistoryTable(ast);
  if (!found) return { ok: false, error: NOT_FOUND_ERROR };
  const rows = found.area.rows.slice(1).map((row) => row.cells.map(cellText));
  return { ok: true, columnCount: found.headerTexts.length, header: found.headerTexts, rows };
}

export function fillInitial(text, { author, date, followup = 'Review' }) {
  if (followup !== '-' && followup !== 'Review') {
    return { ok: false, error: `--followup must be '-' or 'Review', got: '${followup}'.` };
  }
  let ast;
  try { ast = parseDiagram(text); } catch (e) { return { ok: false, error: e.message }; }
  const found = findHistoryTable(ast);
  if (!found) return { ok: false, error: NOT_FOUND_ERROR };
  const dataRows = found.area.rows.slice(1);
  if (dataRows.length !== 1) {
    return {
      ok: false,
      error: `fill-initial expects exactly one existing data row (template state), found: ${dataRows.length}. Use 'append' for further rows.`,
    };
  }
  const row = dataRows[0];
  const columnCount = found.headerTexts.length;
  if (row.cells.length !== columnCount) {
    return { ok: false, error: `Row has ${row.cells.length} cells, header row has ${columnCount}.` };
  }
  // The follow-up column defaults to 'Review' on purpose: a freshly planned spec is waiting for review.
  // That is a follow-up marker, not a review row (those are written by hand after an actual review).
  // Columns: Version | Activity | Author | Date | Follow-up — Version/Activity already arrive as
  // "0.1"/"Initiale Erstellung" (initial creation) from the template and are left untouched.
  try {
    row.cells[2] = makeCell(author);
    row.cells[3] = makeCell(date);
    row.cells[4] = makeCell(followup);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  return { ok: true, text: serializeDiagram(ast) };
}

export function appendRow(text, { version, activity, author, date, followup }) {
  let ast;
  try { ast = parseDiagram(text); } catch (e) { return { ok: false, error: e.message }; }
  const found = findHistoryTable(ast);
  if (!found) return { ok: false, error: NOT_FOUND_ERROR };
  const columnCount = found.headerTexts.length;
  const values = [version, activity, author, date, followup];
  if (values.length !== columnCount) {
    return {
      ok: false,
      error: `Expected ${columnCount} values (version/activity/author/date/follow-up), got: ${values.length}.`,
    };
  }
  let cells;
  try { cells = values.map(makeCell); } catch (e) { return { ok: false, error: e.message }; }
  found.area.rows.push({ cells });
  return { ok: true, text: serializeDiagram(ast) };
}

// Replaces every data row (everything below the header) with `rows` — used once, when migrating a
// Word document whose history table has to arrive in the .nsd exactly as it was. Each row is five
// plain-text cells; empty strings are legitimate (Review rows have no version/activity). Unlike
// fill-initial this deliberately has no "template state" precondition, but it refuses an empty
// `rows` so a bad extract can never wipe the table.
export function importRows(text, { rows }) {
  let ast;
  try { ast = parseDiagram(text); } catch (e) { return { ok: false, error: e.message }; }
  const found = findHistoryTable(ast);
  if (!found) return { ok: false, error: NOT_FOUND_ERROR };
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: 'import expects at least one row.' };
  }
  const columnCount = found.headerTexts.length;
  const built = [];
  for (const [i, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length !== columnCount) {
      return { ok: false, error: `Row ${i} has ${Array.isArray(row) ? row.length : 'no'} cells, expected ${columnCount}.` };
    }
    try { built.push({ cells: row.map(makeCell) }); } catch (e) { return { ok: false, error: e.message }; }
  }
  found.area.rows.splice(1, found.area.rows.length - 1, ...built);
  return { ok: true, text: serializeDiagram(ast) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  if (!args.file) { report({ ok: false, error: '--file is required.' }, { json }); return; }
  if (!args.mode) { report({ ok: false, error: '--mode is required (read|fill-initial|append|import).' }, { json }); return; }

  let text;
  try {
    text = readFileSync(args.file, 'utf8');
  } catch (e) {
    report({ ok: false, error: `File not readable: ${args.file} (${e.message})` }, { json });
    return;
  }

  if (args.mode === 'read') {
    report(readHistory(text), { json });
    return;
  }

  if (args.mode === 'fill-initial') {
    if (!args.author) { report({ ok: false, error: '--author is required.' }, { json }); return; }
    const result = fillInitial(text, { author: args.author, date: args.date || todayDate(), followup: args.followup });
    if (result.ok) writeFileSync(args.file, result.text);
    report(result.ok ? { ok: true } : result, { json, plainText: () => 'History filled.' });
    return;
  }

  if (args.mode === 'append') {
    for (const required of ['version', 'activity', 'author', 'followup']) {
      if (args[required] === undefined) {
        report({ ok: false, error: `--${required} is required.` }, { json });
        return;
      }
    }
    const result = appendRow(text, {
      version: args.version, activity: args.activity, author: args.author,
      date: args.date || todayDate(), followup: args.followup,
    });
    if (result.ok) writeFileSync(args.file, result.text);
    report(result.ok ? { ok: true } : result, { json, plainText: () => 'History row appended.' });
    return;
  }

  if (args.mode === 'import') {
    if (!args['rows-file']) { report({ ok: false, error: '--rows-file is required (JSON: array of 5-cell arrays).' }, { json }); return; }
    let rows;
    try { rows = JSON.parse(readFileSync(args['rows-file'], 'utf8')); } catch (e) {
      report({ ok: false, error: `--rows-file not readable/parsable: ${e.message}` }, { json });
      return;
    }
    const result = importRows(text, { rows });
    if (result.ok) writeFileSync(args.file, result.text);
    report(result.ok ? { ok: true, rowCount: rows.length } : result, { json, plainText: (r) => `${r.rowCount} history row(s) imported.` });
    return;
  }

  report({ ok: false, error: `Unknown --mode: ${args.mode} (expected read|fill-initial|append|import)` }, { json });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
