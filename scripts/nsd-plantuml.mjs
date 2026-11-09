#!/usr/bin/env node
// nsd-plantuml.mjs — reads, replaces and inserts PlantUML image areas (`image(scale=…, type=plantuml)`)
// in the content tail of a step or of the intro/outro block. PlantUML areas are a Specman 1.4 feature,
// so specs older than 1.4.0 are refused (open and save them once in Specman 1.4.0+ first).
//
//   get     prints the source of one PlantUML area (plus scale, change mark and backup); never writes.
//   set     replaces the source of an existing PlantUML area; with --changeset the old source is kept as `backup=`.
//   insert  adds a new PlantUML area at a position in the tail; with --changeset it is marked `change=(added, <cs>)`.
//
// Areas are addressed by their tail key (`tail[<i>]`, as listed by nsd-locate / nsd-tail-areas). The
// source is the PlantUML text without the surrounding backticks; with `get` it comes back with `\n`
// newlines in the JSON result.
//
// Usage: node nsd-plantuml.mjs --file <path> --step <num-or-id|intro|outro> --op get|set|insert [--area tail[n]] [--source-file <path|->] [--position start|end|after:tail[i]] [--scale <1-100>] [--changeset <cs>] --json
//   (--block is accepted as an alias of --step, like in nsd-area.mjs; --scale and --position apply to insert only)

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram } from './lib/nsd-ast.mjs';
import { resolveTarget, resolveTailContainer } from './lib/nsd-paths.mjs';
import { compareVersions } from './lib/versions.mjs';

const MIN_VERSION = '1.4.0';
const OPS = ['get', 'set', 'insert'];
// Same shape as an ID/KEYWORD token in lib/nsd-lexer.mjs (letter, then letters/digits/_/-), which is what
// `expectIdent` accepts for a changeset name; exactly 8 lowercase hex chars would lex as a STEP_ID instead.
const CHANGESET_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;
const isIdentifierChangeset = (s) => CHANGESET_RE.test(s) && !/^[0-9a-f]{8}$/.test(s);

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
  // parseArgs yields `true` for a bare `--area`; resolveTailContainer would choke on it.
  if (!areaKey || typeof areaKey !== 'string') throw new Error('nsd-plantuml: --area <tail[n]> is required for this operation (a bare --area needs a value).');
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

/**
 * Normalises new PlantUML source for storage: trims, converts \r\n to \n, and throws a descriptive
 * Error if it contains a backtick (a backtick string has no escape) or is not an @start...@end<word> block.
 */
export function normalizeSource(source) {
  if (typeof source !== 'string') throw new Error('nsd-plantuml: the PlantUML source is required (--source-file <path|->).');
  const normalized = toLf(source.trim());
  if (normalized.includes('`')) {
    throw new Error('nsd-plantuml: the PlantUML source must not contain a backtick (`); the .nsd format has no escape for it.');
  }
  if (!/^@start/.test(normalized) || !/@end\w+$/.test(normalized)) {
    throw new Error('nsd-plantuml: the PlantUML source must start with @start... and end with @end... (e.g. @startuml ... @enduml).');
  }
  return normalized;
}

/** Resolves an insert position (`start`, `end` or `after:tail[<i>]`) to an index in a tail of `length` areas. */
function insertIndex(position, length) {
  if (position === 'start') return 0;
  if (position === 'end') return length;
  const m = typeof position === 'string' && position.match(/^after:tail\[(\d+)\]$/);
  if (!m) throw new Error(`nsd-plantuml: invalid position '${position}' (expected: start, end, or after:tail[<i>]).`);
  const after = Number(m[1]);
  if (!(after >= 0 && after < length)) {
    throw new Error(`nsd-plantuml: position '${position}' refers to a non-existent index (0..${length - 1}).`);
  }
  return after + 1;
}

/** Same rule as `percent()` in lib/nsd-areas.mjs: a number in (0, 100]. Returns the `<n>%` string. */
function scaleString(scalePercent) {
  // parseArgs yields `true` for a bare `--scale`.
  if (scalePercent === true) throw new Error('nsd-plantuml: --scale needs a value (a percentage in (0, 100]).');
  if (typeof scalePercent !== 'number' || !Number.isFinite(scalePercent) || scalePercent <= 0 || scalePercent > 100) {
    throw new Error(`nsd-plantuml: invalid percentage '${scalePercent}' (expected a number in (0, 100]).`);
  }
  return `${scalePercent}%`;
}

/**
 * Inserts a new PlantUML area into the tail at `position`. With a changeset it carries
 * `change=(added, <changeset>)` (no backup: there is nothing to restore). Returns `{ areaKey }`.
 */
function insertArea(found, source, position, scalePercent, changeset) {
  const raw = `\`${normalizeSource(source)}\``;
  const scale = scaleString(scalePercent);
  const tail = found.step.content.tail;
  const index = insertIndex(position, tail.length);
  const change = changeset ? { kind: 'added', changeset, sourceStep: undefined } : undefined;
  tail.splice(index, 0, { kind: 'image', scalePercent: scale, imageType: 'plantuml', change, raw });
  return { areaKey: `tail[${index}]` };
}

/**
 * Replaces the source of a PlantUML area in the parsed AST. With a changeset the old raw is kept as
 * `backup` unless one for the same changeset exists or the area is new in this changeset.
 * Returns `{ areaKey, backupWritten }`.
 */
function setArea(found, areaKey, source, changeset) {
  const { area, index } = resolvePlantumlArea(found, areaKey);
  const raw = `\`${normalizeSource(source)}\``;
  let backupWritten = false;
  if (changeset) {
    if (area.change?.kind === 'removed') {
      throw new Error(`nsd-plantuml: area 'tail[${index}]' is marked as removed; it cannot be edited in a changeset.`);
    } else if (area.backup && area.backup.changeset === changeset) {
      // keep: it already holds the pre-changeset source
    } else if (area.backup) {
      throw new Error(`nsd-plantuml: area 'tail[${index}]' already has a backup for changeset '${area.backup.changeset}'; refusing to overwrite it for changeset '${changeset}'.`);
    } else if (area.change?.kind === 'added' && area.change.changeset === changeset) {
      // new in this changeset: nothing to restore
    } else {
      area.backup = { changeset, raw: area.raw };
      backupWritten = true;
    }
  }
  area.raw = raw;
  return { areaKey: `tail[${index}]`, backupWritten };
}

export function applyPlantuml(text, { op, stepSelector, areaKey, source, position, scalePercent, changeset } = {}) {
  if (!OPS.includes(op)) {
    return { ok: false, error: `nsd-plantuml: unknown --op '${op}' (expected: ${OPS.join(', ')}).` };
  }
  try {
    // parseArgs yields `true` for a bare `--changeset`; refuse anything but a name the lexer reads back as an identifier.
    if (changeset !== undefined) {
      if (typeof changeset !== 'string' || changeset === '') {
        throw new Error('nsd-plantuml: --changeset needs a non-empty changeset name.');
      }
      if (!isIdentifierChangeset(changeset)) {
        throw new Error(`nsd-plantuml: invalid --changeset '${changeset}' (expected an identifier: a letter followed by letters, digits, '_' or '-'; not exactly 8 lowercase hex characters).`);
      }
    }
    // Scale and position only mean something for a new area; refuse them instead of silently ignoring them.
    if (op !== 'insert') {
      for (const [flag, value] of [['--scale', scalePercent], ['--position', position]]) {
        if (value !== undefined) throw new Error(`nsd-plantuml: ${flag} applies to --op insert only (it is not supported for --op ${op}).`);
      }
    }
    const ast = parseDiagram(text);
    requireV14(ast);
    const found = resolveTarget(ast, stepSelector);
    if (!found) return { ok: false, error: `Step not found: ${stepSelector}` };
    if (op === 'get') return getArea(found, areaKey);
    if (op === 'set') {
      const done = setArea(found, areaKey, source, changeset);
      return { ok: true, text: serializeDiagram(ast), ...done };
    }
    const done = insertArea(found, source, position ?? 'end', scalePercent ?? 100, changeset);
    return { ok: true, text: serializeDiagram(ast), ...done };
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
    if ((args.op === 'set' || args.op === 'insert') && args['source-file'] !== undefined) {
      source = readFileSync(args['source-file'] === '-' ? 0 : args['source-file'], 'utf8');
    }
  } catch (e) {
    report({ ok: false, error: `File not readable: ${e.message}` }, { json });
    return;
  }
  const result = applyPlantuml(text, {
    op: args.op, stepSelector: args.step, areaKey: args.area, source, position: args.position,
    // a bare `--scale` stays `true` so it is refused rather than becoming Number(true) === 1
    scalePercent: typeof args.scale === 'string' ? Number(args.scale) : args.scale,
    changeset: args.changeset,
  });
  if (result.ok && result.text !== undefined) writeFileSync(args.file, result.text);
  const { text: _written, ...printable } = result;
  report(result.ok ? printable : result, {
    json,
    plainText: (r) => (args.op === 'get' ? r.source : `PlantUML area ${r.areaKey} ${args.op === 'insert' ? 'inserted' : 'updated'}.`),
  });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
