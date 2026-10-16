#!/usr/bin/env node
// sync-refs.mjs — finds `SUC-XXX Schritt N (ID: xxx)` references in Java Javadoc and TS/Angular
// JSDoc comments (the convention from this repo's own CLAUDE.md for referencing a spec step from
// code) and rewrites the step NUMBER portion when it has drifted from the step's CURRENT number in
// the actual .nsd file — resolved via the stable step ID, never by re-deriving it from memory.
//
// Usage: node sync-refs.mjs --file <source-file> --spec-dir <dir-containing-suc-nsd-files> --json

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram } from './lib/nsd-ast.mjs';
import { findStep } from './lib/nsd-paths.mjs';

const REF_RE = /SUC-(\d+(?:\.\d+)*)\s+Schritt\s+(\S+)\s+\(ID:\s*([0-9a-f]{8})\)/g;

export function extractRefs(text) {
  const refs = [];
  for (const m of text.matchAll(REF_RE)) {
    refs.push({ fullMatch: m[0], sucNumber: m[1], stepNum: m[2], stepId: m[3] });
  }
  return refs;
}

export function resolveCurrentStepNum(nsdText, stepId) {
  let ast;
  try {
    ast = parseDiagram(nsdText);
  } catch {
    return null;
  }
  const found = findStep(ast, { stepId });
  return found ? found.step.stepNum : null;
}

/** `findNsd(sucNumber)` returns the .nsd file's text content, or null/undefined if not found. */
export function applySyncRefs(text, findNsd) {
  const refs = extractRefs(text);
  let result = text;
  let changedCount = 0;
  const unresolved = [];

  for (const ref of refs) {
    const nsdText = findNsd(ref.sucNumber);
    if (!nsdText) { unresolved.push({ ...ref, reason: 'Spec-Datei nicht gefunden' }); continue; }
    const currentStepNum = resolveCurrentStepNum(nsdText, ref.stepId);
    if (currentStepNum === null) { unresolved.push({ ...ref, reason: 'ID nicht mehr im Spec vorhanden' }); continue; }
    if (currentStepNum === ref.stepNum) continue;
    const updated = `SUC-${ref.sucNumber} Schritt ${currentStepNum} (ID: ${ref.stepId})`;
    result = result.split(ref.fullMatch).join(updated);
    changedCount++;
  }

  return { ok: true, text: result, changedCount, unresolved };
}

// Recursively searches `specDir` for a file named `SUC-<sucNumber> ....nsd` (exact number match
// on the leading token, any title after it) and returns its text, or null if none is found.
function findNsdInDir(specDir, sucNumber) {
  const wanted = `SUC-${sucNumber} `;
  const wantedExact = `SUC-${sucNumber}.nsd`;
  const stack = [specDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = readdirSync(dir); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry);
      let stat;
      try { stat = statSync(full); } catch { continue; }
      if (stat.isDirectory()) { stack.push(full); continue; }
      if (entry.endsWith('.nsd') && (entry.startsWith(wanted) || entry === wantedExact)) {
        return readFileSync(full, 'utf8');
      }
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['file', 'spec-dir']) {
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
  const result = applySyncRefs(text, (sucNumber) => findNsdInDir(args['spec-dir'], sucNumber));
  if (result.changedCount > 0) writeFileSync(args.file, result.text);
  report(
    { ok: true, changedCount: result.changedCount, unresolved: result.unresolved },
    { json: !!args.json, plainText: (r) => `${r.changedCount} Referenz(en) aktualisiert, ${r.unresolved.length} nicht auflösbar.` },
  );
}

if (isMainModule(import.meta.url, process.argv[1])) main();
