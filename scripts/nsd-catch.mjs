#!/usr/bin/env node
// nsd-catch.mjs — creates, re-heads and removes the `catch` block that belongs to a `break` step.
// A catch lives in the `catchArea` of the break's own sequence or of an ancestor sequence (only
// main, while, subsequence and if/else branches may hold one — not doWhile, case/default branches
// or catch bodies) and is tied to the break by its step number; the sanitizer keeps both in sync
// when it renumbers. A new catch gets one placeholder `simple` step (the grammar demands `step+`)
// — fill it via nsd-set-text and add further handler steps via nsd-insert-step with the returned
// `bodyKey` as `--parent`. `coCatch` is not supported.
//
// `--head` is plain text (escaped here); `--head-html` passes prepared HTML through.
//
// Usage:
//   node nsd-catch.mjs --file <path> --op add --break <stepId> (--head <text> | --head-html <html>) [--parent <sequenceKey>] --json
//   node nsd-catch.mjs --file <path> --op set-head --break <stepId> (--head <text> | --head-html <html>) --json
//   node nsd-catch.mjs --file <path> --op remove --break <stepId> --json

import { readFileSync, writeFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram, serializeDiagram, assertValidHtml } from './lib/nsd-ast.mjs';
import { findStep, listSequences, catchTargetFor } from './lib/nsd-paths.mjs';
import { collectStepIds, collectStepNums, makePlaceholderStep } from './lib/nsd-build.mjs';
import { escapeText } from './lib/nsd-html.mjs';

function headHtmlFrom({ head, headHtml }) {
  if (head === undefined && headHtml === undefined) throw new Error('nsd-catch: --head or --head-html is required.');
  if (head !== undefined && headHtml !== undefined) throw new Error('nsd-catch: --head and --head-html are mutually exclusive.');
  if (headHtml !== undefined) { assertValidHtml(headHtml); return headHtml; }
  return escapeText(head);
}

function findCatch(ast, breakStepNum) {
  for (const { holder } of listSequences(ast)) {
    const catches = holder?.catchArea?.catches ?? [];
    const index = catches.findIndex((c) => c.breakStepNum === breakStepNum);
    if (index !== -1) return { holder, index, block: catches[index] };
  }
  return null;
}

function requireBreak(ast, breakId) {
  const found = findStep(ast, { stepId: breakId });
  if (!found) throw new Error(`Step not found: ${breakId}`);
  if (found.step.kind !== 'break') throw new Error(`nsd-catch: '${breakId}' is not a break step.`);
  return found.step;
}

function addCatch(ast, { breakId, parentKey, ...heads }) {
  const breakStep = requireBreak(ast, breakId);
  const html = headHtmlFrom(heads);
  if (findCatch(ast, breakStep.stepNum)) {
    throw new Error(`nsd-catch: a catch block already exists for break step '${breakId}'.`);
  }
  const target = catchTargetFor(ast, breakId, parentKey);
  const placeholderStepIds = [];
  const body = [makePlaceholderStep(collectStepNums(ast), collectStepIds(ast), placeholderStepIds)];
  if (!target.holder.catchArea) target.holder.catchArea = { collapsed: undefined, cols: undefined, catches: [] };
  const area = target.holder.catchArea;
  area.catches.push({
    breakStepNum: breakStep.stepNum,
    content: { head: { html, plain: undefined, markups: [] }, tail: [] },
    change: undefined,
    headingWidth: undefined,
    coCatches: [],
    body,
  });
  const bodyKey = `${target.key}.catch[${area.catches.length - 1}].body`;
  return { ok: true, ownerKey: target.key, bodyKey, placeholderStepIds };
}

function setHead(ast, { breakId, ...heads }) {
  const breakStep = requireBreak(ast, breakId);
  const html = headHtmlFrom(heads);
  const found = findCatch(ast, breakStep.stepNum);
  if (!found) throw new Error(`nsd-catch: there is no catch block for break step '${breakId}'.`);
  found.block.content.head = { html, plain: undefined, markups: [] };
  return { ok: true };
}

function removeCatch(ast, { breakId }) {
  const breakStep = requireBreak(ast, breakId);
  const found = findCatch(ast, breakStep.stepNum);
  if (!found) throw new Error(`nsd-catch: there is no catch block for break step '${breakId}'.`);
  const area = found.holder.catchArea;
  area.catches.splice(found.index, 1);
  if (area.catches.length === 0) found.holder.catchArea = undefined;
  return { ok: true };
}

const OPS = { add: addCatch, 'set-head': setHead, remove: removeCatch };

export function applyCatch(text, opts) {
  const op = OPS[opts.op];
  if (!op) return { ok: false, error: `nsd-catch: unknown --op '${opts.op}' (expected: ${Object.keys(OPS).join(', ')}).` };
  let ast;
  try {
    ast = parseDiagram(text);
  } catch (e) {
    return { ok: false, error: e.message };
  }
  try {
    const result = op(ast, opts);
    return { ...result, text: serializeDiagram(ast) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  for (const required of ['file', 'op', 'break']) {
    if (args[required] === undefined) { report({ ok: false, error: `--${required} is required.` }, { json }); return; }
  }
  let text;
  try {
    text = readFileSync(args.file, 'utf8');
  } catch (e) {
    report({ ok: false, error: `File not readable: ${args.file} (${e.message})` }, { json });
    return;
  }
  const result = applyCatch(text, {
    op: args.op, breakId: args.break, parentKey: args.parent, head: args.head, headHtml: args['head-html'],
  });
  if (result.ok) writeFileSync(args.file, result.text);
  const { text: _omit, ...rest } = result;
  report(result.ok ? rest : result, {
    json,
    plainText: (r) => (r.placeholderStepIds?.length
      ? `catch created, bodyKey: ${r.bodyKey}, placeholders (fill in immediately): ${r.placeholderStepIds.join(', ')}`
      : 'geschrieben.'),
  });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
