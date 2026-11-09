#!/usr/bin/env node
// nsd-edit-settings.mjs — reads/sets scalar fields on the diagram's top-level `settings` block and
// its nested `pdfOptions`. Both are already fully parsed/serialized by `nsd-ast.mjs`
// (parseSettings/parsePdfOptions, serializeSettings) — this script only adds the missing piece:
// a mechanical way to change one field without hand-editing the DSL. Creates `settings`/
// `pdfOptions` if either is absent from the file.
//
// Usage:
//   node nsd-edit-settings.mjs --file <path> --mode read --json
//   node nsd-edit-settings.mjs --file <path> --mode set --key <key> --value <value> --json
//
// <key> is one of: width, zoom, changeModeEnabled, changeSetName,
// pdfOptions.filename, pdfOptions.modelFilename, pdfOptions.pageSize, pdfOptions.portrait, pdfOptions.paging

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram } from './lib/nsd-ast.mjs';

const TOP_LEVEL_TYPES = { width: 'int', zoom: 'int', changeModeEnabled: 'bool', changeSetName: 'ident' };
const PDF_OPTION_TYPES = { filename: 'string', modelFilename: 'string', pageSize: 'ident', portrait: 'bool', paging: 'bool' };

function coerce(type, raw) {
  if (type === 'int') {
    const n = Number(raw);
    if (!Number.isInteger(n)) return { ok: false, error: `Expected an integer, got: '${raw}'` };
    return { ok: true, value: n };
  }
  if (type === 'bool') {
    if (raw === 'true') return { ok: true, value: true };
    if (raw === 'false') return { ok: true, value: false };
    return { ok: false, error: `Expected 'true' or 'false', got: '${raw}'` };
  }
  if (type === 'ident') {
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(raw)) return { ok: false, error: `Invalid identifier: '${raw}'` };
    return { ok: true, value: raw };
  }
  // 'string' — becomes a BACKTICK_STRING on serialization (see serializeSettings); the grammar
  // forbids a literal backtick inside one.
  if (String(raw).includes('`')) return { ok: false, error: `Value must not contain a backtick: '${raw}'` };
  return { ok: true, value: raw };
}

export function readSettings(text) {
  let ast;
  try { ast = parseDiagram(text); } catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, settings: ast.settings ?? {} };
}

export function setSetting(text, { key, value }) {
  let ast;
  try { ast = parseDiagram(text); } catch (e) { return { ok: false, error: e.message }; }
  if (!ast.settings) ast.settings = {};
  const settings = ast.settings;

  if (key.startsWith('pdfOptions.')) {
    const sub = key.slice('pdfOptions.'.length);
    const type = PDF_OPTION_TYPES[sub];
    if (!type) {
      return { ok: false, error: `Unknown pdfOptions key: '${sub}' (expected: ${Object.keys(PDF_OPTION_TYPES).join('|')})` };
    }
    const coerced = coerce(type, value);
    if (!coerced.ok) return coerced;
    if (!settings.pdfOptions) settings.pdfOptions = {};
    settings.pdfOptions[sub] = coerced.value;
    return { ok: true, text: serializeDiagram(ast) };
  }

  const type = TOP_LEVEL_TYPES[key];
  if (!type) {
    return {
      ok: false,
      error: `Unknown settings key: '${key}' (expected: ${Object.keys(TOP_LEVEL_TYPES).join('|')} or pdfOptions.<${Object.keys(PDF_OPTION_TYPES).join('|')}>)`,
    };
  }
  const coerced = coerce(type, value);
  if (!coerced.ok) return coerced;
  settings[key] = coerced.value;
  return { ok: true, text: serializeDiagram(ast) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  if (!args.file) { report({ ok: false, error: '--file is required.' }, { json }); return; }
  if (!args.mode) { report({ ok: false, error: '--mode is required (read|set).' }, { json }); return; }

  let text;
  try {
    text = readFileSync(args.file, 'utf8');
  } catch (e) {
    report({ ok: false, error: `File not readable: ${args.file} (${e.message})` }, { json });
    return;
  }

  if (args.mode === 'read') {
    report(readSettings(text), { json });
    return;
  }

  if (args.mode === 'set') {
    if (!args.key) { report({ ok: false, error: '--key is required.' }, { json }); return; }
    if (args.value === undefined) { report({ ok: false, error: '--value is required.' }, { json }); return; }
    const result = setSetting(text, { key: args.key, value: args.value });
    if (result.ok) writeFileSync(args.file, result.text);
    report(result.ok ? { ok: true } : result, { json, plainText: () => 'set.' });
    return;
  }

  report({ ok: false, error: `Unknown --mode: ${args.mode} (expected read|set)` }, { json });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
