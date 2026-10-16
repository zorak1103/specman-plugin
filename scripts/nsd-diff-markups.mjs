#!/usr/bin/env node
// nsd-diff-markups.mjs — computes `markups=[(from,to,Changed,changeset)]` for a text edit by
// diffing the OLD plain text against the NEW plain text (the new plain text should come from the
// sanitizer's authoritative regeneration, not a guess — see the `edit` skill's two-pass flow: (1)
// write new HTML with no markups, (2) run --sanitize, which regenerates plain= exactly the way
// Specman's own Swing renderer would, (3) read that plain= back, (4) call this script).
//
// Deliberately conservative v1 scope, chosen over a fine-grained multi-span diff:
//   - Exactly one `Changed` span per edit, covering the whole prefix/suffix-trimmed changed
//     region — never an attempt to split at HTML tag boundaries the way Specman's own editor
//     does (splitting requires exactly reproducing Specman's HTML->plain-text rendering, which is
//     not reliably reproducible outside its Swing HTMLEditorKit — see VENDORING.md).
//   - A pure deletion with no new characters left in the changed region produces NO markup at
//     all (not an error) — there's nothing left in the new plain text to attach a span to, since
//     this script never fabricates retroactive <strike> markup for text the caller already
//     removed outright.
//   - Every computed span is self-validated against the actual new plain text's bounds before
//     being trusted — fail closed (no markup, clear error) rather than write a wrong span.
//
// Usage: node nsd-diff-markups.mjs --file <path> --step <num-or-id> --area <key> --old-plain <text> --changeset <name> --json
// (--old-plain is the area's plain= value captured by nsd-locate BEFORE the edit; the script
// reads the area's CURRENT plain= from the file as "new".)

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram } from './lib/nsd-ast.mjs';
import { findStep, resolveArea } from './lib/nsd-paths.mjs';

export function diffPlainText(oldPlain, newPlain) {
  if (oldPlain === newPlain) return null;
  const maxPrefix = Math.min(oldPlain.length, newPlain.length);
  let prefixLen = 0;
  while (prefixLen < maxPrefix && oldPlain[prefixLen] === newPlain[prefixLen]) prefixLen++;
  const maxSuffix = Math.min(oldPlain.length, newPlain.length) - prefixLen;
  let suffixLen = 0;
  while (
    suffixLen < maxSuffix &&
    oldPlain[oldPlain.length - 1 - suffixLen] === newPlain[newPlain.length - 1 - suffixLen]
  ) suffixLen++;
  const from = prefixLen;
  const to = newPlain.length - suffixLen - 1;
  if (to < from) return null; // pure deletion: nothing new left in the changed region to mark
  return { from, to };
}

export function computeMarkups({ oldPlain, newPlain, changeset, __forceSpan }) {
  const span = __forceSpan ?? diffPlainText(oldPlain, newPlain);
  if (span === null) return { ok: true, markups: [] };
  if (span.from < 0 || span.to >= newPlain.length || span.to < span.from) {
    return { ok: false, error: `berechneter Markup-Bereich liegt außerhalb (out of range) von plain=: ${JSON.stringify(span)}` };
  }
  return { ok: true, markups: [{ from: span.from, to: span.to, type: 'Changed', changeset }] };
}

export function applyDiffMarkups(text, { stepSelector, areaKey, oldPlain, changeset }) {
  let ast;
  try {
    ast = parseDiagram(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const selector = /^[0-9a-f]{8}$/.test(stepSelector) ? { stepId: stepSelector } : { stepNum: stepSelector };
  const found = findStep(ast, selector);
  if (!found) return { ok: false, error: `Schritt nicht gefunden: ${stepSelector}` };

  let area;
  try {
    area = resolveArea(found.step, areaKey);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  if (area.plain === undefined) {
    return {
      ok: false,
      error: 'plain= ist auf diesem Bereich nicht gesetzt — erst sanitizen, damit plain= aktuell ist, dann erneut aufrufen.',
    };
  }

  const computed = computeMarkups({ oldPlain, newPlain: area.plain, changeset });
  if (!computed.ok) return computed;

  area.markups = computed.markups;
  return { ok: true, text: serializeDiagram(ast), markupsWritten: computed.markups.length };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['file', 'step', 'area', 'old-plain', 'changeset']) {
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
  const result = applyDiffMarkups(text, {
    stepSelector: args.step, areaKey: args.area, oldPlain: args['old-plain'], changeset: args.changeset,
  });
  if (result.ok) writeFileSync(args.file, result.text);
  report(
    result.ok ? { ok: true, markupsWritten: result.markupsWritten } : result,
    { json: !!args.json, plainText: (r) => `${r.markupsWritten} Markup(s) geschrieben.` },
  );
}

if (isMainModule(import.meta.url, process.argv[1])) main();
