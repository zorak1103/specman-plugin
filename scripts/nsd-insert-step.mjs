#!/usr/bin/env node
// nsd-insert-step.mjs — inserts a new step into a named sequence at a given position, with a
// fresh placeholder step number and freshly generated step ID(s). `--sanitize` renumbers the
// whole diagram afterwards (verified end-to-end against the real jar) — so the numbers assigned
// here only have to be structurally unique within the file, never meaningful on their own.
//
// Leaf kinds (`simple`/`break`) need no sub-structure. Structured kinds (`while`/`doWhile`/
// `subsequence`/`if`/`ifElse`/`case`) are grammatically required to have at least one step in
// every body/branch (`step+` — verified against SpecmanModel_V002.g4 and the real jar: an empty
// body or branch is a sanitizer ERROR, not just a lint warning); `case` additionally needs a
// default branch plus at least two case branches. This script fills every required slot with one
// placeholder `simple` step (content `PLACEHOLDER_STEP_HTML`) and, for branches, a placeholder
// heading (`PLACEHOLDER_BRANCH_HTML`) — both grammatically valid and structurally sufficient, but
// meaningless. The caller MUST immediately replace every placeholder via `nsd-set-text.mjs`,
// addressed by the step/branch keys this script returns — branch headings are addressable via
// `ifBranch.head`/`elseBranch.head`/`defaultBranch.head`/`caseBranch[n].head` on the *returned*
// `insertedStepId` (see `nsd-paths.mjs`), and each placeholder leaf step via its own ID in
// `placeholderStepIds`.
//
// `--id` keeps a step's ID when it moves between specs (code references `SUC-xxx Schritt N (ID: ...)`
// stay valid): optional, 8 lowercase hex digits, unique diagram-wide — otherwise an error, never a
// silently different ID. The step NUMBER stays a placeholder either way (the sanitizer renumbers).
//
// Usage:
//   node nsd-insert-step.mjs --file <path> --parent <key-from-nsd-locate> --position start|end|after:<stepId> --kind simple|break|while|doWhile|subsequence|if|ifElse|case [--branches <n>] --html <html> [--id <8 Hex>] --json

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram, assertValidHtml } from './lib/nsd-ast.mjs';
import { listSequences } from './lib/nsd-paths.mjs';
import {
  collectStepIds, collectStepNums, freshStepNum, freshStepId, reserveStepId, makePlaceholderStep,
} from './lib/nsd-build.mjs';

const LEAF_KINDS = new Set(['simple', 'break']);
const STRUCTURED_KINDS = new Set(['while', 'doWhile', 'subsequence', 'if', 'ifElse', 'case']);
const SUPPORTED_KINDS = new Set([...LEAF_KINDS, ...STRUCTURED_KINDS]);

const PLACEHOLDER_BRANCH_HTML = 'TODO Ueberschrift';
const DEFAULT_CASE_BRANCHES = 2;

function makePlaceholderBranch(usedNums, usedIds, placeholderStepIds) {
  return {
    content: { head: { html: PLACEHOLDER_BRANCH_HTML, plain: undefined, markups: [] }, tail: [] },
    change: undefined,
    body: [makePlaceholderStep(usedNums, usedIds, placeholderStepIds)],
    catchArea: undefined,
  };
}

function buildStructuredExtras(kind, usedNums, usedIds, placeholderStepIds, branchCount) {
  if (kind === 'while' || kind === 'doWhile' || kind === 'subsequence') {
    return { body: [makePlaceholderStep(usedNums, usedIds, placeholderStepIds)], catchArea: undefined };
  }
  if (kind === 'if') {
    return { ifBranch: makePlaceholderBranch(usedNums, usedIds, placeholderStepIds) };
  }
  if (kind === 'ifElse') {
    return {
      ifBranch: makePlaceholderBranch(usedNums, usedIds, placeholderStepIds),
      elseBranch: makePlaceholderBranch(usedNums, usedIds, placeholderStepIds),
    };
  }
  if (kind === 'case') {
    return {
      defaultBranch: makePlaceholderBranch(usedNums, usedIds, placeholderStepIds),
      caseBranches: Array.from({ length: branchCount }, () => makePlaceholderBranch(usedNums, usedIds, placeholderStepIds)),
    };
  }
  throw new Error(`nsd-insert-step: unhandled structured kind '${kind}'`);
}

export function applyInsertStep(text, { parentKey, position, kind, html, branches, id }) {
  if (!SUPPORTED_KINDS.has(kind)) {
    return {
      ok: false,
      error: `nsd-insert-step kennt kein Kind '${kind}' (erwartet: ${[...SUPPORTED_KINDS].join('|')}).`,
    };
  }
  try {
    assertValidHtml(html);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const branchCount = kind === 'case' ? (branches ?? DEFAULT_CASE_BRANCHES) : undefined;
  if (kind === 'case' && (!Number.isInteger(branchCount) || branchCount < 2)) {
    return { ok: false, error: `nsd-insert-step: 'case' braucht mindestens 2 Case-Branches (--branches, Default ${DEFAULT_CASE_BRANCHES}), erhalten: ${branches}.` };
  }

  let ast;
  try {
    ast = parseDiagram(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }

  const sequence = listSequences(ast).find((s) => s.key === parentKey);
  if (!sequence) return { ok: false, error: `Sequenz nicht gefunden: ${parentKey}` };

  const usedIds = collectStepIds(ast);
  const usedNums = collectStepNums(ast);
  const placeholderStepIds = [];

  let stepId;
  try {
    stepId = id !== undefined ? reserveStepId(id, usedIds) : freshStepId(usedIds);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  const newStep = {
    kind,
    stepNum: freshStepNum(usedNums),
    stepId,
    content: { head: { html, plain: undefined, markups: [] }, tail: [] },
    change: undefined,
    deco: undefined,
    shade: undefined,
  };
  if (STRUCTURED_KINDS.has(kind)) {
    Object.assign(newStep, buildStructuredExtras(kind, usedNums, usedIds, placeholderStepIds, branchCount));
  }

  if (position === 'start') {
    sequence.steps.unshift(newStep);
  } else if (position === 'end') {
    sequence.steps.push(newStep);
  } else if (position.startsWith('after:')) {
    const afterId = position.slice('after:'.length);
    const idx = sequence.steps.findIndex((s) => s.stepId === afterId);
    if (idx === -1) return { ok: false, error: `Schritt für 'after:' nicht in dieser Sequenz gefunden: ${afterId}` };
    sequence.steps.splice(idx + 1, 0, newStep);
  } else {
    return { ok: false, error: `Ungültige position: '${position}' (erwartet: start, end, oder after:<stepId>)` };
  }

  return {
    ok: true,
    text: serializeDiagram(ast),
    insertedStepId: newStep.stepId,
    placeholderStepIds,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['file', 'parent', 'position', 'kind', 'html']) {
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
  const branches = args.branches !== undefined ? Number(args.branches) : undefined;
  const result = applyInsertStep(text, {
    parentKey: args.parent, position: args.position, kind: args.kind, html: args.html, branches, id: args.id,
  });
  if (result.ok) writeFileSync(args.file, result.text);
  report(
    result.ok ? { ok: true, insertedStepId: result.insertedStepId, placeholderStepIds: result.placeholderStepIds } : result,
    {
      json: !!args.json,
      plainText: (r) => (r.placeholderStepIds.length > 0
        ? `eingefügt, neue ID: ${r.insertedStepId}, Platzhalter (bitte sofort befüllen): ${r.placeholderStepIds.join(', ')}`
        : `eingefügt, neue ID: ${r.insertedStepId}`),
    },
  );
}

if (isMainModule(import.meta.url, process.argv[1])) main();
