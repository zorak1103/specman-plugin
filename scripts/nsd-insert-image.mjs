#!/usr/bin/env node
// nsd-insert-image.mjs — inserts a PNG as a wireframe image area into the content tail of a step or
// of the intro/outro block. Until this script existed, image blocks could only be round-tripped,
// never created (`nsd-area.mjs` covers text/list/table, not images). The bytes go into the
// `[base64:...]` block unchanged; nothing about the picture is interpreted beyond the PNG signature.
//
// Positions follow nsd-area.mjs: `start`, `end` (default) or `after:tail[<i>]`.
//
// Usage: node nsd-insert-image.mjs --file <path> --step <num-or-id|intro|outro> --png <datei.png> [--scale <1-100>] [--position start|end|after:tail[i]] --json

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram } from './lib/nsd-ast.mjs';
import { resolveTarget } from './lib/nsd-paths.mjs';
import { buildArea } from './lib/nsd-areas.mjs';

function insertIndex(position, length) {
  if (position === 'start') return 0;
  if (position === 'end') return length;
  const m = typeof position === 'string' && position.match(/^after:tail\[(\d+)\]$/);
  if (!m) throw new Error(`nsd-insert-image: invalid position '${position}' (expected: start, end, or after:tail[<i>]).`);
  const after = Number(m[1]);
  if (!(after >= 0 && after < length)) {
    throw new Error(`nsd-insert-image: position '${position}' refers to a non-existent index (0..${length - 1}).`);
  }
  return after + 1;
}

export function applyInsertImage(text, { stepSelector, png, scalePercent, position = 'end' }) {
  let ast;
  try { ast = parseDiagram(text); } catch (e) { return { ok: false, error: e.message }; }

  let found;
  try { found = resolveTarget(ast, stepSelector); } catch (e) { return { ok: false, error: e.message }; }
  if (!found) return { ok: false, error: `Step not found: ${stepSelector}` };

  try {
    const area = buildArea({ kind: 'image', png, scalePercent });
    const index = insertIndex(position, found.step.content.tail.length);
    found.step.content.tail.splice(index, 0, area);
    return { ok: true, text: serializeDiagram(ast), areaKey: `tail[${index}]` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  for (const required of ['file', 'step', 'png']) {
    if (args[required] === undefined) { report({ ok: false, error: `--${required} is required.` }, { json }); return; }
  }
  let text;
  let png;
  try {
    text = readFileSync(args.file, 'utf8');
    png = readFileSync(args.png);
  } catch (e) {
    report({ ok: false, error: `File not readable: ${e.message}` }, { json });
    return;
  }
  const result = applyInsertImage(text, {
    stepSelector: args.step, png, position: args.position,
    scalePercent: args.scale !== undefined ? Number(args.scale) : undefined,
  });
  if (result.ok) writeFileSync(args.file, result.text);
  report(result.ok ? { ok: true, areaKey: result.areaKey } : result, { json, plainText: (r) => `Image inserted (${r.areaKey}).` });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
