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
        `nsd-mark-change unterstützt kein '${kind}' — Specman validiert die sourceStep=-Verknüpfung ` +
        'nirgends und crasht bei einem fehlerhaften Verweis beim Laden. Schritt-Verschiebung mit ' +
        'Tracking bleibt eine manuelle Specman-UI-Aktion (siehe VENDORING.md).',
    };
  }
  if (kind !== 'clear' && kind !== 'added' && kind !== 'removed') {
    return { ok: false, error: `Ungültiger kind: '${kind}' (erwartet: added, removed, oder clear)` };
  }
  if (kind !== 'clear' && !changeset) {
    return { ok: false, error: '--changeset ist Pflicht außer bei --kind clear.' };
  }

  let ast;
  try {
    ast = parseDiagram(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const selector = /^[0-9a-f]{8}$/.test(stepSelector) ? { stepId: stepSelector } : { stepNum: stepSelector };
  const found = findStep(ast, selector);
  if (!found) return { ok: false, error: `Schritt nicht gefunden: ${stepSelector}` };

  found.step.change = kind === 'clear' ? undefined : { kind, changeset, sourceStep: undefined };

  return { ok: true, text: serializeDiagram(ast) };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['file', 'step', 'kind']) {
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
  const result = applyMarkChange(text, { stepSelector: args.step, kind: args.kind, changeset: args.changeset });
  if (result.ok) writeFileSync(args.file, result.text);
  report(result.ok ? { ok: true } : result, { json: !!args.json, plainText: () => 'geschrieben.' });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
