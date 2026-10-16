#!/usr/bin/env node
// migrate-verify.mjs — fidelity check between the extract of a .docx and the migrated .nsd. It is
// the safety net behind the migration's core rule: NO LOGIC MAY BE LOST.
//
//   * Text: every non-trivial paragraph of the docx must occur (after whitespace/quote
//     normalisation) somewhere in the text of the .nsd. Reflowing, merging paragraphs into one
//     area or reordering into branches is fine; a paragraph that is gone is reported as `missing`.
//   * Reworded: paragraphs the plan lists in `reworded` (user-approved rephrasing) are excused from the
//     text check but reported separately (`reworded`), never folded into the ignored count.
//   * Images: number of image areas in the .nsd must equal the number of images in the docx.
//   * Steps: with --plan, the number of leaf/structured steps must equal what the plan declared.
//
// Run it AFTER sanitize.mjs so `plain=` is current; without `plain=` it falls back to stripping
// the stored HTML.
//
// Usage: node migrate-verify.mjs --extract <extract.json> --nsd <datei.nsd> [--plan <plan.json>] --json

import { readFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { parseDiagram } from './lib/nsd-ast.mjs';
import { htmlToText } from './lib/nsd-runs-html.mjs';
import { allParagraphs } from './lib/docx-reader.mjs';
import { ignoredIds, rewordedIds } from './lib/nsd-plan.mjs';

export function normalize(text) {
  return String(text)
    .replace(/[   ]/g, ' ')
    .replace(/[“”„«»]/g, '"')
    .replace(/[‘’‚]/g, "'")
    .replace(/[‐-―−]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
}

const contentText = (head) => (head.plain !== undefined ? head.plain : htmlToText(head.html));

/** All text segments of a parsed .nsd plus structural counts. */
export function collectNsd(ast) {
  const segments = [];
  const counts = { leaves: 0, structured: 0, images: 0 };

  const addContent = (content) => {
    segments.push(contentText(content.head));
    content.tail.forEach(addArea);
  };
  const addArea = (area) => {
    if (area.kind === 'text') segments.push(contentText(area.content));
    else if (area.kind === 'list') area.items.forEach((item) => addContent(item.content));
    else if (area.kind === 'table') area.rows.forEach((row) => row.cells.forEach((cell) => addContent(cell.content)));
    else if (area.kind === 'image') counts.images++;
  };
  const addBranch = (branch) => { if (branch) { addContent(branch.content); addSteps(branch.body); addCatches(branch.catchArea); } };
  const addCatches = (catchArea) => {
    for (const c of catchArea?.catches ?? []) {
      addContent(c.content);
      c.coCatches.forEach((cc) => segments.push(contentText(cc.content)));
      addSteps(c.body);
    }
  };
  const addSteps = (steps) => {
    for (const step of steps) {
      if (step.kind === 'simple' || step.kind === 'break') counts.leaves++; else counts.structured++;
      addContent(step.content);
      if (step.body) addSteps(step.body);
      addCatches(step.catchArea);
      addBranch(step.ifBranch);
      addBranch(step.elseBranch);
      addBranch(step.defaultBranch);
      (step.caseBranches ?? []).forEach(addBranch);
    }
  };

  if (ast.intro) { segments.push(contentText(ast.intro.head)); ast.intro.tail.forEach(addArea); }
  addSteps(ast.mainSequence.steps);
  addCatches(ast.mainSequence.catchArea);
  if (ast.outro) { segments.push(contentText(ast.outro.head)); ast.outro.tail.forEach(addArea); }
  return { haystack: normalize(segments.join(' ')), counts };
}

function isTrivial(text) {
  return !/[\p{L}\p{N}]/u.test(text); // "-", "•", empty separators carry no logic
}

export function verify({ extract, nsdText, plan }) {
  let ast;
  try { ast = parseDiagram(nsdText); } catch (e) { return { ok: false, error: e.message }; }
  const { haystack, counts } = collectNsd(ast);

  // Paragraphs the plan deliberately ignored (labels, headings the template already has) were
  // reviewed with a stated reason at build time — they are excused here, never silently.
  let excused = new Set();
  if (plan?.ignored) {
    const ignored = ignoredIds(extract, plan.ignored);
    if (!ignored.ok) return { ok: false, error: ignored.error };
    excused = ignored.ids;
  }

  // Deliberately reworded paragraphs (approved by the user beforehand) cannot be found verbatim;
  // they are excused but listed on their own so the deviation stays visible.
  const reworded = [];
  if (plan?.reworded) {
    const found = rewordedIds(extract, plan.reworded, plan.ignored);
    if (!found.ok) return { ok: false, error: found.error };
    const byId = new Map(allParagraphs(extract.blocks).map((p) => [p.id, p]));
    for (const id of found.ids) {
      const text = byId.get(id)?.text.trim() ?? '';
      if (text === '') continue;
      excused.add(id);
      reworded.push({ id, text: text.slice(0, 160) });
    }
  }

  // The history table's header row is replaced by the template's own header; its data rows are
  // imported and therefore still checked below.
  for (const id of extract.history?.headerParagraphIds ?? []) excused.add(id);

  const missing = [];
  let checked = 0;
  for (const p of allParagraphs(extract.blocks)) {
    const needle = normalize(p.text);
    if (needle === '' || isTrivial(needle) || excused.has(p.id)) continue;
    checked++;
    if (!haystack.includes(needle)) missing.push({ id: p.id, text: needle.slice(0, 160) });
  }

  const problems = [];
  if (missing.length > 0) problems.push(`${missing.length} Absatz/Absätze des docx fehlen im .nsd.`);
  const expectedImages = extract.images.length;
  if (counts.images !== expectedImages) {
    problems.push(`Bilder: docx ${expectedImages}, .nsd ${counts.images}.`);
  }
  if (plan) {
    const visit = (nodes, acc) => {
      for (const n of nodes ?? []) {
        if (n.kind === 'simple' || n.kind === 'break') acc.leaves++; else acc.structured++;
        visit(n.body, acc);
        for (const b of [n.ifBranch, n.elseBranch, n.defaultBranch, ...(n.caseBranches ?? [])]) if (b) { visit(b.body, acc); (b.catches ?? []).forEach((c) => visit(c.body, acc)); }
        (n.catches ?? []).forEach((c) => visit(c.body, acc));
      }
      return acc;
    };
    const planned = visit(plan.main?.steps, { leaves: 0, structured: 0 });
    (plan.main?.catches ?? []).forEach((c) => visit(c.body, planned));
    if (planned.leaves !== counts.leaves || planned.structured !== counts.structured) {
      problems.push(`Schritte: Plan ${planned.leaves}/${planned.structured} (Blatt/Struktur), .nsd ${counts.leaves}/${counts.structured}.`);
    }
  }

  return {
    ok: problems.length === 0,
    checkedParagraphs: checked,
    excusedByPlan: excused.size - reworded.length,
    reworded,
    missing,
    images: { docx: expectedImages, nsd: counts.images },
    steps: { leaves: counts.leaves, structured: counts.structured },
    ...(problems.length > 0 ? { error: problems.join(' ') } : {}),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  for (const required of ['extract', 'nsd']) {
    if (args[required] === undefined) { report({ ok: false, error: `--${required} ist Pflicht.` }, { json }); return; }
  }
  let extract, nsdText, plan;
  try {
    extract = JSON.parse(readFileSync(args.extract, 'utf8'));
    nsdText = readFileSync(args.nsd, 'utf8');
    if (args.plan) plan = JSON.parse(readFileSync(args.plan, 'utf8'));
  } catch (e) {
    report({ ok: false, error: `Eingabe nicht lesbar: ${e.message}` }, { json });
    return;
  }
  const result = verify({ extract, nsdText, plan });
  const lines = (result.missing ?? []).map((m) => `  ${m.id}: ${m.text}`);
  report(result, {
    json,
    plainText: (r) => `OK — ${r.checkedParagraphs} Absätze geprüft, ${r.images.nsd} Bild(er), ${r.steps.leaves + r.steps.structured} Schritte.`,
  });
  if (!json && !result.ok && lines.length > 0) console.error(lines.join('\n'));
}

if (isMainModule(import.meta.url, process.argv[1])) main();
