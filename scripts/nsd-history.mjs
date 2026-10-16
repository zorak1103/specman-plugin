#!/usr/bin/env node
// nsd-history.mjs — reads and maintains the "Dokumentenhistorie / UC-Lifecycle" table inside a
// diagram's `intro` block (columns: Version | Aktivität | Autor | Datum | Folgeaktion/Ergebnis).
// This table lives outside any step, so none of the step-addressing scripts
// (nsd-locate/nsd-set-text/nsd-insert-step) can reach it — this script is the only way in.
//
// The table is located by content, not by a fixed index: the first `table` area in `intro.tail`
// whose header row mentions Aktivität/Autor/Datum. A miss is a hard error rather than a guess —
// writing into the wrong table (e.g. outro's Issue/Prio/Status table) would silently corrupt it.
//
// New cell text is escaped by this script itself (plain text in, Specman-style HTML out) — unlike
// nsd-set-text.mjs, whose callers already hand it prepared HTML. `plain=` is never written (the
// sanitizer regenerates it), consistent with nsd-set-text.mjs.
//
// No change tracking: the grammar (SpecmanModel_V002.g4, tableRow/tableCell) has no changeParam at
// row or cell level, so a history row cannot be marked added/removed like a step can.
//
// Usage:
//   node nsd-history.mjs --file <path> --mode read --json
//   node nsd-history.mjs --file <path> --mode fill-initial --author <name> [--date <TT.MM.JJJJ>] [--followup <-|Review>] --json
//   node nsd-history.mjs --file <path> --mode append --version <v> --activity <text> --author <name> --followup <-|Review> [--date <TT.MM.JJJJ>] --json
//   node nsd-history.mjs --file <path> --mode import --rows-file <json> --json   (replaces all data rows; JSON = [[version, activity, author, date, followup], ...])

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram } from './lib/nsd-ast.mjs';

const HEADER_MARKERS = ['Aktivität', 'Autor', 'Datum'];

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
    if (HEADER_MARKERS.every((marker) => headerTexts.some((t) => t.includes(marker)))) {
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
    throw new Error(`nsd-history: Zellinhalt darf keinen Backtick enthalten: '${text}'`);
  }
  return { content: { head: { html: escapeCellText(text), plain: undefined, markups: [] }, tail: [] } };
}

export function todayDate() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

const NOT_FOUND_ERROR =
  'Keine Dokumentenhistorie-Tabelle im intro-Block gefunden (Kopfzeile muss Aktivität/Autor/Datum enthalten).';

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
    return { ok: false, error: `--followup muss '-' oder 'Review' sein, erhalten: '${followup}'.` };
  }
  let ast;
  try { ast = parseDiagram(text); } catch (e) { return { ok: false, error: e.message }; }
  const found = findHistoryTable(ast);
  if (!found) return { ok: false, error: NOT_FOUND_ERROR };
  const dataRows = found.area.rows.slice(1);
  if (dataRows.length !== 1) {
    return {
      ok: false,
      error: `fill-initial erwartet genau eine bestehende Datenzeile (Vorlagenzustand), gefunden: ${dataRows.length}. Für weitere Zeilen 'append' verwenden.`,
    };
  }
  const row = dataRows[0];
  const columnCount = found.headerTexts.length;
  if (row.cells.length !== columnCount) {
    return { ok: false, error: `Zeile hat ${row.cells.length} Zellen, Kopfzeile hat ${columnCount}.` };
  }
  // Folgeaktion defaults to 'Review' on purpose: a freshly planned spec is waiting for review. That is a
  // follow-up marker, not a review row (those are written by hand after an actual review).
  // Spalten: Version | Aktivität | Autor | Datum | Folgeaktion — Version/Aktivität kommen bereits
  // als "0.1"/"Initiale Erstellung" aus der Vorlage und werden nicht angefasst.
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
      error: `Erwarte ${columnCount} Werte (Version/Aktivität/Autor/Datum/Folgeaktion), erhalten: ${values.length}.`,
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
    return { ok: false, error: 'import erwartet mindestens eine Zeile.' };
  }
  const columnCount = found.headerTexts.length;
  const built = [];
  for (const [i, row] of rows.entries()) {
    if (!Array.isArray(row) || row.length !== columnCount) {
      return { ok: false, error: `Zeile ${i} hat ${Array.isArray(row) ? row.length : 'keine'} Zellen, erwartet ${columnCount}.` };
    }
    try { built.push({ cells: row.map(makeCell) }); } catch (e) { return { ok: false, error: e.message }; }
  }
  found.area.rows.splice(1, found.area.rows.length - 1, ...built);
  return { ok: true, text: serializeDiagram(ast) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  if (!args.file) { report({ ok: false, error: '--file ist Pflicht.' }, { json }); return; }
  if (!args.mode) { report({ ok: false, error: '--mode ist Pflicht (read|fill-initial|append|import).' }, { json }); return; }

  let text;
  try {
    text = readFileSync(args.file, 'utf8');
  } catch (e) {
    report({ ok: false, error: `Datei nicht lesbar: ${args.file} (${e.message})` }, { json });
    return;
  }

  if (args.mode === 'read') {
    report(readHistory(text), { json });
    return;
  }

  if (args.mode === 'fill-initial') {
    if (!args.author) { report({ ok: false, error: '--author ist Pflicht.' }, { json }); return; }
    const result = fillInitial(text, { author: args.author, date: args.date || todayDate(), followup: args.followup });
    if (result.ok) writeFileSync(args.file, result.text);
    report(result.ok ? { ok: true } : result, { json, plainText: () => 'Historie befüllt.' });
    return;
  }

  if (args.mode === 'append') {
    for (const required of ['version', 'activity', 'author', 'followup']) {
      if (args[required] === undefined) {
        report({ ok: false, error: `--${required} ist Pflicht.` }, { json });
        return;
      }
    }
    const result = appendRow(text, {
      version: args.version, activity: args.activity, author: args.author,
      date: args.date || todayDate(), followup: args.followup,
    });
    if (result.ok) writeFileSync(args.file, result.text);
    report(result.ok ? { ok: true } : result, { json, plainText: () => 'Historienzeile angehängt.' });
    return;
  }

  if (args.mode === 'import') {
    if (!args['rows-file']) { report({ ok: false, error: '--rows-file ist Pflicht (JSON: Array von 5-Zellen-Arrays).' }, { json }); return; }
    let rows;
    try { rows = JSON.parse(readFileSync(args['rows-file'], 'utf8')); } catch (e) {
      report({ ok: false, error: `--rows-file nicht lesbar/parsebar: ${e.message}` }, { json });
      return;
    }
    const result = importRows(text, { rows });
    if (result.ok) writeFileSync(args.file, result.text);
    report(result.ok ? { ok: true, rowCount: rows.length } : result, { json, plainText: (r) => `${r.rowCount} Historienzeile(n) übernommen.` });
    return;
  }

  report({ ok: false, error: `Unbekannter --mode: ${args.mode} (erwartet read|fill-initial|append|import)` }, { json });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
