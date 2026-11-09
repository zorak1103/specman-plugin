#!/usr/bin/env node
// nsd-plantuml.mjs — reads, replaces and inserts PlantUML image areas (`image(scale=…, type=plantuml)`)
// in the content tail of a step or of the intro/outro block. PlantUML areas are a Specman 1.4 feature,
// so specs older than 1.4.0 are refused (open and save them once in Specman 1.4.0+ first).
//
//   get     prints the source of one PlantUML area (plus scale, change mark and backup); never writes.
//   set     replaces the source of an existing PlantUML area.            (not implemented yet)
//   insert  adds a new PlantUML area at a position in the tail.          (not implemented yet)
//
// Areas are addressed by their tail key (`tail[<i>]`, as listed by nsd-locate / nsd-tail-areas). The
// source is the PlantUML text without the surrounding backticks; with `get` it comes back with `\n`
// newlines in the JSON result.
//
// Usage: node nsd-plantuml.mjs --file <path> --step <num-or-id|intro|outro> --op get|set|insert [--area tail[n]] [--source-file <path|->] [--position start|end|after:tail[i]] [--scale <1-100>] [--changeset <cs>] --json
//   (--block is accepted as an alias of --step, like in nsd-area.mjs)

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram } from './lib/nsd-ast.mjs';
import { resolveTarget, resolveTailContainer } from './lib/nsd-paths.mjs';
import { compareVersions } from './lib/versions.mjs';

const MIN_VERSION = '1.4.0';
const OPS = ['get', 'set', 'insert'];

/** Throws unless the spec was written by Specman 1.4.0 or newer (PlantUML areas do not exist before). */
export function requireV14(ast) {
  const version = ast.envelope?.specmanVersion;
  if (!version || compareVersions(version, MIN_VERSION) < 0) {
    throw new Error(
      `nsd-plantuml: PlantUML areas need Specman ${MIN_VERSION} or newer, but this spec was saved by Specman ${version ?? 'unknown'}. ` +
      `Open and save the spec once in Specman ${MIN_VERSION}+ first.`,
    );
  }
}

/**
 * Resolves `areaKey` (`tail[<i>]`) in the step/block returned by `resolveTarget` to its PlantUML
 * image area. Returns `{ area, index }`. Throws a descriptive error if the key does not address a
 * tail area (resolveTailContainer's own message is passed through) or the area is not PlantUML.
 */
export function resolvePlantumlArea(found, areaKey) {
  if (!areaKey) throw new Error('nsd-plantuml: --area <tail[n]> is required for this operation.');
  const { area, index } = resolveTailContainer(found.step, areaKey);
  if (area.kind !== 'image' || area.imageType !== 'plantuml') {
    const what = area.kind === 'image' ? `a ${area.imageType} image` : `a ${area.kind} area`;
    throw new Error(`nsd-plantuml: area '${areaKey}' is not a PlantUML area (it is ${what}).`);
  }
  return { area, index };
}

/** Strips the surrounding backticks of an AST `raw` backtick string. */
export function unwrap(raw) {
  return raw.slice(1, -1);
}

// `get` reports LF newlines even for a spec saved with CRLF; `unwrap` stays raw for callers that compare/store.
const toLf = (s) => s.replace(/\r\n/g, '\n');

function getArea(found, areaKey) {
  const { area, index } = resolvePlantumlArea(found, areaKey);
  const result = { ok: true, areaKey: `tail[${index}]`, scalePercent: area.scalePercent, source: toLf(unwrap(area.raw)) };
  if (area.change) result.change = area.change;
  if (area.backup) result.backup = { changeset: area.backup.changeset, source: toLf(unwrap(area.backup.raw)) };
  return result;
}

export function applyPlantuml(text, { op, stepSelector, areaKey } = {}) {
  if (!OPS.includes(op)) {
    return { ok: false, error: `nsd-plantuml: unknown --op '${op}' (expected: ${OPS.join(', ')}).` };
  }
  try {
    const ast = parseDiagram(text);
    requireV14(ast);
    const found = resolveTarget(ast, stepSelector);
    if (!found) return { ok: false, error: `Step not found: ${stepSelector}` };
    if (op === 'get') return getArea(found, areaKey);
    return { ok: false, error: `nsd-plantuml: --op ${op} is not implemented yet.` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  args.step = args.step ?? args.block;
  for (const required of ['file', 'step', 'op']) {
    if (args[required] === undefined) { report({ ok: false, error: `--${required} is required.` }, { json }); return; }
  }
  let text;
  let source;
  try {
    text = readFileSync(args.file, 'utf8');
    if (args['source-file'] !== undefined) {
      source = readFileSync(args['source-file'] === '-' ? 0 : args['source-file'], 'utf8');
    }
  } catch (e) {
    report({ ok: false, error: `File not readable: ${e.message}` }, { json });
    return;
  }
  const result = applyPlantuml(text, {
    op: args.op, stepSelector: args.step, areaKey: args.area, source, position: args.position,
    scalePercent: args.scale !== undefined ? Number(args.scale) : undefined,
    changeset: args.changeset,
  });
  if (result.ok && result.text !== undefined) writeFileSync(args.file, result.text);
  const { text: _written, ...printable } = result;
  report(result.ok ? printable : result, {
    json,
    plainText: (r) => (args.op === 'get' ? r.source : `PlantUML area ${r.areaKey} updated.`),
  });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
