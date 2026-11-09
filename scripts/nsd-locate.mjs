#!/usr/bin/env node
// nsd-locate.mjs — resolves a step number or step ID to its content, addressable text areas, and
// reports every valid insert-parent sequence key in the diagram. This is the read-only entry
// point every other nsd-* script's caller (a skill or the fast-edit subagent) is expected to run
// first — no other script accepts a hand-constructed area/sequence key, only ones copied verbatim
// from this script's output.
//
// Usage: node nsd-locate.mjs --file <path> [--step <num-or-id|intro|outro> | --block intro|outro] --json

import { readFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram } from './lib/nsd-ast.mjs';
import { resolveTarget, addressableAreas, listSequences, listTailAreas, listCatches } from './lib/nsd-paths.mjs';
import { listSections } from './lib/nsd-html.mjs';

export function locate(text, stepSelector) {
  let ast;
  try {
    ast = parseDiagram(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const sequences = listSequences(ast).map((s) => ({ key: s.key, stepCount: s.steps.length }));
  const settings = ast.settings;
  const { catches, uncaughtBreaks } = listCatches(ast);

  if (stepSelector === undefined) {
    const blocks = ['intro', 'outro'].filter((b) => ast[b]);
    return { ok: true, sequences, settings, blocks, catches, uncaughtBreaks };
  }

  if ((stepSelector === 'intro' || stepSelector === 'outro') && !ast[stepSelector]) {
    return { ok: false, error: `The specification has no ${stepSelector} block.` };
  }
  const found = resolveTarget(ast, stepSelector);
  if (found === null) {
    return { ok: false, error: `Step not found: ${stepSelector}` };
  }
  const areas = addressableAreas(found.step);
  const sections = areas
    .filter((a) => a.key === 'head' || /^tail\[\d+\]$/.test(a.key))
    .flatMap((a) => listSections(a.html).map((heading) => ({ areaKey: a.key, heading })));
  const target = found.block
    ? { block: found.block }
    : {
      step: { kind: found.step.kind, stepNum: found.step.stepNum, stepId: found.step.stepId },
      parentKey: found.parentKey,
    };
  return { ok: true, ...target, areas, tailAreas: listTailAreas(found.step), sections, sequences, settings, catches, uncaughtBreaks };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    report({ ok: false, error: '--file is required.' }, { json: !!args.json });
    return;
  }
  let text;
  try {
    text = readFileSync(args.file, 'utf8');
  } catch (e) {
    report({ ok: false, error: `File not readable: ${args.file} (${e.message})` }, { json: !!args.json });
    return;
  }
  const result = locate(text, args.step ?? args.block);
  report(result, { json: !!args.json });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
