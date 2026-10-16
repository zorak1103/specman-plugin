#!/usr/bin/env node
// nsd-set-text.mjs — mechanically replaces one addressed text area's HTML content. Never writes
// `plain=` (the sanitizer regenerates it — grammar contract: "Agents must not write or update
// this field") and always clears any existing `markups=` on the area being replaced, since those
// offsets described the OLD text and would silently misrepresent the new content otherwise.
//
// `--step` accepts a step number/ID or `intro`/`outro` (alias `--block`). Three modes:
//   --area <key> --html <html>               replace the whole area's HTML
//   --title <text>                           intro only: replace just the h1 (spec title), keep the rest of the head
//   --area <key> --section <heading> --text <text>
//                                            replace only the paragraph(s) under one heading of a text area
//                                            (`\n` in --text starts a new paragraph); text is escaped here
//
// Usage:
//   node nsd-set-text.mjs --file <path> --step <num-or-id|intro|outro> --area <key-from-nsd-locate> --html <newHtml> --json
//   node nsd-set-text.mjs --file <path> --step intro --title <text> --json
//   node nsd-set-text.mjs --file <path> --step <...> --area <key> --section <heading> --text <text> --json

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram, assertValidHtml } from './lib/nsd-ast.mjs';
import { resolveTarget, resolveArea } from './lib/nsd-paths.mjs';
import { setTitle, setSection } from './lib/nsd-html.mjs';

function newHtmlFor(area, { title, section, sectionText, newHtml }, block) {
  if (title !== undefined) {
    if (block !== 'intro') throw new Error('nsd-set-text: --title gilt nur für den intro-Block.');
    return setTitle(area.html, title);
  }
  if (section !== undefined) return setSection(area.html, section, sectionText ?? '');
  assertValidHtml(newHtml);
  return newHtml;
}

export function applySetText(text, opts) {
  const { stepSelector, areaKey } = opts;
  let ast;
  try {
    ast = parseDiagram(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  let found;
  try {
    found = resolveTarget(ast, stepSelector);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  if (!found) return { ok: false, error: `Schritt nicht gefunden: ${stepSelector}` };

  try {
    const area = resolveArea(found.step, opts.title !== undefined ? 'head' : areaKey);
    area.html = newHtmlFor(area, opts, found.block);
    area.plain = undefined;
    area.markups = [];
    return { ok: true, text: serializeDiagram(ast) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// A shell passes `\n` as two characters; --text treats it as a paragraph break.
const lineBreaks = (v) => (typeof v === 'string' ? v.split('\\n').join('\n') : v);

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  const step = args.step ?? args.block;
  const mode = args.title !== undefined ? 'title' : args.section !== undefined ? 'section' : 'html';
  const required = { title: ['file'], section: ['file', 'area', 'text'], html: ['file', 'area', 'html'] }[mode];
  if (step === undefined) { report({ ok: false, error: '--step (oder --block) ist Pflicht.' }, { json }); return; }
  for (const key of required) {
    if (args[key] === undefined) { report({ ok: false, error: `--${key} ist Pflicht.` }, { json }); return; }
  }
  let text;
  try {
    text = readFileSync(args.file, 'utf8');
  } catch (e) {
    report({ ok: false, error: `Datei nicht lesbar: ${args.file} (${e.message})` }, { json });
    return;
  }
  const result = applySetText(text, {
    stepSelector: step, areaKey: args.area, newHtml: args.html,
    title: args.title, section: args.section, sectionText: lineBreaks(args.text),
  });
  if (result.ok) writeFileSync(args.file, result.text);
  report(result.ok ? { ok: true } : result, { json, plainText: () => 'geschrieben.' });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
