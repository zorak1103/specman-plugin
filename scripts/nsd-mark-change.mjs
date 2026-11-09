#!/usr/bin/env node
// nsd-mark-change.mjs — sets or clears the `change=(added|removed, changeset)` annotation on a
// step, list item, or text/table/image area. Deliberately refuses `source`/`target`: Specman does
// not validate the bidirectional `sourceStep=` link at all (a missing or dangling reference
// crashes the GUI at load time with an unhandled exception, verified against the actual source —
// see VENDORING.md), so this plugin does not synthesize step-move-with-tracking pairs.
//
// Usage: node nsd-mark-change.mjs --file <path> --step <num-or-id> --kind added|removed|clear --changeset <name> --json

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram } from './lib/nsd-ast.mjs';
import { findStep } from './lib/nsd-paths.mjs';

const UNSUPPORTED_KINDS = new Set(['source', 'target']);

export function applyMarkChange(text, { stepSelector, kind, changeset }) {
  if (UNSUPPORTED_KINDS.has(kind)) {
    return {
      ok: false,
      error:
        `nsd-mark-change does not support '${kind}' — Specman does not validate the sourceStep= link ` +
        'anywhere and crashes on load when the reference is broken. Moving a step with ' +
        'tracking remains a manual Specman UI action (see VENDORING.md).',
    };
  }
  if (kind !== 'clear' && kind !== 'added' && kind !== 'removed') {
    return { ok: false, error: `Invalid kind: '${kind}' (expected: added, removed, or clear)` };
  }
  if (kind !== 'clear' && !changeset) {
    return { ok: false, error: '--changeset is required except with --kind clear.' };
  }

  let ast;
  try {
    ast = parseDiagram(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const selector = /^[0-9a-f]{8}$/.test(stepSelector) ? { stepId: stepSelector } : { stepNum: stepSelector };
  const found = findStep(ast, selector);
  if (!found) return { ok: false, error: `Step not found: ${stepSelector}` };

  found.step.change = kind === 'clear' ? undefined : { kind, changeset, sourceStep: undefined };

  return { ok: true, text: serializeDiagram(ast) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['file', 'step', 'kind']) {
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
  const result = applyMarkChange(text, { stepSelector: args.step, kind: args.kind, changeset: args.changeset });
  if (result.ok) writeFileSync(args.file, result.text);
  report(result.ok ? { ok: true } : result, { json: !!args.json, plainText: () => 'geschrieben.' });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
