#!/usr/bin/env node
// sync-refs.mjs — finds `SUC-XXX Step N (ID: xxx)` references in Java Javadoc and TS/Angular
// JSDoc comments (the convention for referencing a spec step from code) and rewrites the step NUMBER
// portion when it has drifted from the step's CURRENT number in the actual .nsd file — resolved via
// the stable step ID, never by re-deriving it from memory.
//
// The keyword is `Step`; the legacy German `Schritt` is still recognised, and a comment keeps
// whichever keyword it already uses (only the number is rewritten).
//
// Usage: node sync-refs.mjs --file <source-file> --spec-dir <dir-containing-suc-nsd-files> --json

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';

const REF_RE = /SUC-(\d+(?:\.\d+)*)\s+(Step|Schritt)\s+(\S+)\s+\(ID:\s*([0-9a-f]{8})\)/g;

export function extractRefs(text) {
  const refs = [];
  for (const m of text.matchAll(REF_RE)) {
    refs.push({ fullMatch: m[0], sucNumber: m[1], keyword: m[2], stepNum: m[3], stepId: m[4] });
  }
  return refs;
}

// Every step line starts with `<kind>(<stepNum>, <stepId>, ...` (see SpecmanModel_V002.g4), so the
// current number of a step is found by its ID with a line-anchored match — no parser needed. The
// anchor keeps an ID that merely appears inside text content from matching.
export function resolveCurrentStepNum(nsdText, stepId) {
  const re = new RegExp(String.raw`^[ \t]*\w+\(\s*(\d+[a-z]?(?:\.\d+[a-z]?)*)\s*,\s*${stepId}\s*,`, 'm');
  const m = re.exec(nsdText);
  return m ? m[1] : null;
}

/** `findNsd(sucNumber)` returns the .nsd file's text content, or null/undefined if not found. */
export function applySyncRefs(text, findNsd) {
  const refs = extractRefs(text);
  let result = text;
  let changedCount = 0;
  const unresolved = [];

  for (const ref of refs) {
    const nsdText = findNsd(ref.sucNumber);
    if (!nsdText) { unresolved.push({ ...ref, reason: 'spec file not found' }); continue; }
    const currentStepNum = resolveCurrentStepNum(nsdText, ref.stepId);
    if (currentStepNum === null) { unresolved.push({ ...ref, reason: 'ID no longer present in the spec' }); continue; }
    if (currentStepNum === ref.stepNum) continue;
    const updated = `SUC-${ref.sucNumber} ${ref.keyword} ${currentStepNum} (ID: ${ref.stepId})`;
    result = result.split(ref.fullMatch).join(updated);
    changedCount++;
  }

  return { ok: true, text: result, changedCount, unresolved };
}

// Recursively searches `specDir` for a file named `SUC-<sucNumber> ....nsd` (exact number match
// on the leading token, any title after it) and returns its text, or null if none is found. If a
// `<file>.nsd.wrk` working copy exists the spec is open in Specman, so that copy is the current one.
export function findNsdInDir(specDir, sucNumber) {
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
        const wrk = `${full}.wrk`;
        return readFileSync(existsSync(wrk) ? wrk : full, 'utf8');
      }
    }
  }
  return null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['file', 'spec-dir']) {
    if (args[required] === undefined) {
      report({ ok: false, error: `--${required} is required.` }, { json: !!args.json });
      return;
    }
  }
  let text;
  try {
    text = readFileSync(args.file, 'utf8');
  } catch (e) {
    report({ ok: false, error: `File not readable: ${args.file} (${e.message})` }, { json: !!args.json });
    return;
  }
  const result = applySyncRefs(text, (sucNumber) => findNsdInDir(args['spec-dir'], sucNumber));
  if (result.changedCount > 0) writeFileSync(args.file, result.text);
  report(
    { ok: true, changedCount: result.changedCount, unresolved: result.unresolved },
    { json: !!args.json, plainText: (r) => `${r.changedCount} reference(s) updated, ${r.unresolved.length} unresolvable.` },
  );
}

if (isMainModule(import.meta.url, process.argv[1])) main();
