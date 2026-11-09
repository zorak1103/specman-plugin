// nsd-plan.mjs — builds a complete SUC .nsd from (a) the plugin's SUC template, (b) a migration plan
// (JSON written by the `migrate` skill) and (c) the extract of the source .docx.
//
// The plan decides *structure and wording choices*; this module owns every mechanical detail and,
// above all, enforces the migration's core promise — NO LOGIC MAY BE LOST:
//   * Content is normally taken from the extract by reference (`{ ref: "p12" }`), so text and run
//     formatting are copied, not retyped.
//   * Every non-empty paragraph and every image of the extract must end up either consumed by the
//     plan or listed in `ignored` with a reason. Anything else makes the build fail (ok:false) and
//     names the offenders — a build never "succeeds" while silently dropping source content.
//   * Constructions the target model cannot express (merged table cells, ...) are reported in
//     `warnings`, never hidden.
//
// Plan shape (see skills/migrate/SKILL.md for the full reference):
//   { number, title, history?, intro?, main: { steps, catches? }, outro?, ignored?, reworded? }
// A *content spec* is a string (plain text), { text }, { html } or { ref: id|[ids], label?, flatLists? }.
// `reworded` lists paragraphs the user explicitly approved to be phrased differently (e.g. a
// condition turned into a branch question): they count as covered but are reported separately.

import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseDiagram, serializeDiagram } from './nsd-ast.mjs';
import { allParagraphs, collectParagraphs } from './docx-reader.mjs';
import { escapeText, runsToHtml, assertNoBacktick } from './nsd-runs-html.mjs';
import { buildArea, makeHtmlContent } from './nsd-areas.mjs';

const DIAGRAM_WIDTH_PX = 731;
// Migrated step texts carry no actor prefix: the sentence already names who acts, and a repeated
// `System:`/`User:` in front of every step is exactly what the specs should not look like.
const FORBIDDEN_LABEL_RE = /^(system|user|benutzer|anwender)\s*:?$/i;
const LEAF_KINDS = new Set(['simple', 'break']);
const LOOP_KINDS = new Set(['while', 'doWhile']);
const STRUCTURED_KINDS = new Set(['subsequence', 'while', 'doWhile', 'if', 'ifElse', 'case']);

class PlanError extends Error {}
const fail = (path, message) => { throw new PlanError(`${path}: ${message}`); };

// ============================================================
// Context: extract index + coverage bookkeeping
// ============================================================

function createContext(extract) {
  const byId = new Map();
  const index = (block) => {
    byId.set(block.id, block);
    if (block.type === 'table') for (const row of block.rows) for (const cell of row.cells) cell.blocks.forEach(index);
  };
  extract.blocks.forEach(index);
  for (const image of extract.images) byId.set(image.id, { type: 'image', ...image });
  return {
    extract,
    byId,
    consumed: new Map(),
    consumedImages: new Set(),
    usedStepIds: new Set(),
    usedStepNums: new Set(),
    breakNums: new Map(),
    warnings: [],
    counts: { steps: 0, leaves: 0, structured: 0, breaks: 0, catches: 0, areas: 0, images: 0, defaultedBranchHeads: 0 },
  };
}

function freshStepId(ctx) {
  let id;
  do { id = randomBytes(4).toString('hex'); } while (ctx.usedStepIds.has(id));
  ctx.usedStepIds.add(id);
  return id;
}

// ============================================================
// Extract blocks -> content (head html + tail areas)
// ============================================================

function consumeParagraph(ctx, p, path) {
  const uses = (ctx.consumed.get(p.id) ?? 0) + 1;
  ctx.consumed.set(p.id, uses);
  if (uses === 2 && p.text.trim() !== '') ctx.warnings.push(`${path}: Paragraph ${p.id} is used more than once.`);
}

function imageScale(image) {
  if (!image.widthPx) return 100;
  return Math.min(100, Math.max(10, Math.round((image.widthPx / DIAGRAM_WIDTH_PX) * 100)));
}

function imageArea(ctx, imageId, overrides, path) {
  const image = ctx.byId.get(imageId);
  if (!image || image.type !== 'image') fail(path, `unknown image '${imageId}'.`);
  const file = overrides?.pngFile ?? image.file;
  if (!file) fail(path, `Image ${imageId} has no extracted file (run docx-extract with --out-dir).`);
  if (!overrides?.pngFile && image.ext !== 'png') fail(path, `Image ${imageId} is '${image.ext}', not PNG — convert it to PNG and set 'pngFile'.`);
  ctx.consumedImages.add(imageId);
  ctx.counts.images++;
  return { kind: 'image', png: readFileSync(file), scalePercent: overrides?.scale ?? imageScale(image) };
}

// Specman lists cannot nest (grammar: listItemTail excludes listBlock). Deeper Word list levels are
// therefore flattened into the same list with a visible indent and dash — all text stays, only the
// nesting is lost, and the build says so in `warnings`.
function buildListSpec(ctx, entries, path) {
  let flattened = false;
  const items = entries.map((entry) => {
    let html = runsToHtml(entry.runs);
    if (entry.level > 0) {
      flattened = true;
      html = `${'&#160;'.repeat(entry.level * 4)}- ${html}`;
    }
    return { html, tail: [] };
  });
  if (flattened) ctx.warnings.push(`${path}: nested list levels were indented into a flat list (Specman does not support nested lists).`);
  return { kind: 'list', ordered: entries[0].ordered, items };
}

function paragraphsHtml(paragraphRuns) {
  const parts = paragraphRuns.map((runs) => runsToHtml(runs));
  if (parts.length === 1) return parts[0];
  return parts.filter((h) => h !== '').map((h) => `<div>${h}</div>`).join('\n');
}

function tableSpec(ctx, table, path) {
  const maxColumns = Math.max(...table.rows.map((row) => row.cells.reduce((n, c) => n + c.gridSpan, 0)));
  let flattened = false;
  const rows = table.rows.map((row, r) => {
    const cells = [];
    for (const cell of row.cells) {
      if (cell.gridSpan > 1 || cell.vMerge) flattened = true;
      cells.push(blocksToContent(ctx, cell.blocks, `${path}.rows[${r}]`));
      for (let k = 1; k < cell.gridSpan; k++) cells.push({ html: '', tail: [] });
    }
    while (cells.length < maxColumns) cells.push({ html: '', tail: [] });
    return cells;
  });
  if (flattened) {
    ctx.warnings.push(`${path}: Table ${table.id} contains merged cells — resolved in the target model (content stays in the first cell, the others are left empty).`);
  }
  return { kind: 'table', rows };
}

/** Converts extract blocks into `{ html, tail }` — the head text plus any following areas. */
function blocksToContent(ctx, blocks, path, label, { flatLists = false } = {}) {
  if (label !== undefined && FORBIDDEN_LABEL_RE.test(String(label).trim())) {
    fail(path, `'label' must not be '${label}' — step texts carry no 'System:'/'User:' prefix (the actor is named in the sentence).`);
  }
  const chunks = [];
  const pushText = (runs) => {
    const last = chunks[chunks.length - 1];
    if (last && last.type === 'text') last.paragraphs.push(runs);
    else chunks.push({ type: 'text', paragraphs: [runs] });
  };
  const listEntries = [];
  const flushList = () => {
    if (listEntries.length === 0) return;
    chunks.push({ type: 'area', spec: buildListSpec(ctx, listEntries, path) });
    listEntries.length = 0;
  };
  for (const block of blocks) {
    if (block.type === 'image') {
      flushList();
      chunks.push({ type: 'area', spec: imageArea(ctx, block.id, undefined, path) });
    } else if (block.type === 'table') {
      flushList();
      chunks.push({ type: 'area', spec: tableSpec(ctx, block, path) });
    } else {
      consumeParagraph(ctx, block, path);
      if (block.list && !flatLists && block.text.trim() !== '') {
        listEntries.push({ level: block.list.level, ordered: block.list.ordered, runs: block.runs });
      } else {
        flushList();
        if (block.text.trim() !== '') pushText(block.runs);
      }
      if (block.images.length > 0) {
        flushList();
        for (const imageId of block.images) chunks.push({ type: 'area', spec: imageArea(ctx, imageId, undefined, path) });
      }
    }
  }
  flushList();

  let html = '';
  let rest = chunks;
  if (chunks[0]?.type === 'text') {
    const paragraphs = chunks[0].paragraphs.map((runs) => runs.slice());
    if (label && paragraphs.length > 0) paragraphs[0] = [{ text: `${label}:`, b: true }, { text: ' ' }, ...paragraphs[0]];
    html = paragraphsHtml(paragraphs);
    rest = chunks.slice(1);
  } else if (label) {
    html = runsToHtml([{ text: `${label}:`, b: true }]);
  }
  const tail = rest.map((chunk) => (chunk.type === 'text'
    ? { kind: 'text', html: chunk.paragraphs.map((runs) => `<div>${runsToHtml(runs)}</div>`).join('\n') }
    : chunk.spec));
  return { html, tail };
}

function idsOf(ref, path) {
  const ids = Array.isArray(ref) ? ref : [ref];
  if (ids.length === 0 || ids.some((id) => typeof id !== 'string')) fail(path, "'ref' needs an id or a list of ids.");
  return ids;
}

function refBlocks(ctx, ref, path) {
  return idsOf(ref, path).map((id) => {
    const block = ctx.byId.get(id);
    if (!block) fail(path, `unknown extract id '${id}'.`);
    return block;
  });
}

/**
 * Content spec -> `{ html, tail }`. `flatLists`: list paragraphs are plain text (item/cell/branch-head
 * contexts); a `ref` spec can request the same with `flatLists: true` (e.g. a bullet that is a step of its own).
 */
function resolveContent(ctx, spec, path, options) {
  if (typeof spec === 'string') return { html: escapeText(spec), tail: [] };
  if (spec === null || typeof spec !== 'object') fail(path, 'Content must be a string or an object.');
  if (spec.ref !== undefined) {
    const flatLists = options?.flatLists === true || spec.flatLists === true;
    return blocksToContent(ctx, refBlocks(ctx, spec.ref, path), path, spec.label, { ...options, flatLists });
  }
  if (typeof spec.html === 'string') { assertNoBacktick(spec.html, path); return { html: spec.html, tail: [] }; }
  if (typeof spec.text === 'string') return { html: escapeText(spec.text), tail: [] };
  return fail(path, "Content needs 'ref', 'html' or 'text'.");
}

function resolveHead(ctx, spec, path) {
  const content = resolveContent(ctx, spec, path, { flatLists: true });
  if (content.tail.length > 0) fail(path, 'This content must be plain text (list/table/image not possible here) — specify it as `areas` of the step.');
  return content.html;
}

/** Plan area spec -> array of low-level area specs. */
function resolveAreas(ctx, areas, path) {
  const out = [];
  (areas ?? []).forEach((area, n) => {
    const here = `${path}.areas[${n}]`;
    if (area.kind === 'image') {
      out.push(imageArea(ctx, area.ref, { pngFile: area.pngFile, scale: area.scale }, here));
    } else if (area.kind === 'refs') {
      const content = blocksToContent(ctx, refBlocks(ctx, area.ref, here), here);
      if (content.html !== '') out.push({ kind: 'text', html: content.html });
      out.push(...content.tail);
    } else if (area.kind === 'text') {
      out.push({ kind: 'text', html: resolveHead(ctx, area.content, here) });
    } else if (area.kind === 'list') {
      out.push({ kind: 'list', ordered: !!area.ordered, items: area.items.map((item, i) => itemContent(ctx, item, `${here}.items[${i}]`)) });
    } else if (area.kind === 'table') {
      out.push({ kind: 'table', widthPercent: area.widthPercent, cols: area.cols, rows: area.rows.map((row, r) => row.map((cell, c) => itemContent(ctx, cell, `${here}.rows[${r}][${c}]`))) });
    } else {
      fail(here, `unknown area kind '${area.kind}' (expected text|list|table|image|refs).`);
    }
  });
  ctx.counts.areas += out.length;
  return out;
}

function itemContent(ctx, item, path) {
  const isWrapped = item && typeof item === 'object' && item.content !== undefined;
  const content = resolveContent(ctx, isWrapped ? item.content : item, path, { flatLists: true });
  const extra = isWrapped ? resolveAreas(ctx, item.areas, path) : [];
  return { html: content.html, tail: [...content.tail, ...extra] };
}

// ============================================================
// Steps
// ============================================================

function contentOf(ctx, htmlAndTail, extraAreas) {
  const tail = [...htmlAndTail.tail, ...extraAreas].map(buildArea);
  return { head: makeHtmlContent(htmlAndTail.html), tail };
}

function nextNum(counter) {
  counter.n++;
  return counter.prefix ? `${counter.prefix}.${counter.n}` : String(counter.n);
}

function buildSteps(ctx, nodes, counter, path) {
  if (!Array.isArray(nodes) || nodes.length === 0) fail(path, 'needs at least one step.');
  return nodes.map((node, i) => buildNode(ctx, node, counter, `${path}[${i}]`));
}

function buildBranch(ctx, branch, defaultHead, counter, path) {
  if (!branch) fail(path, 'branch is missing.');
  let headHtml;
  if (branch.head === undefined) { headHtml = escapeText(defaultHead); ctx.counts.defaultedBranchHeads++; }
  else headHtml = resolveHead(ctx, branch.head, `${path}.head`);
  const body = buildSteps(ctx, branch.body, counter, `${path}.body`);
  const catchArea = buildCatchArea(ctx, branch.catches, body, counter, path);
  return {
    content: { head: makeHtmlContent(headHtml), tail: resolveAreas(ctx, branch.areas, path).map(buildArea) },
    change: undefined,
    body,
    catchArea,
  };
}

function containsBreak(steps, breakId, ctx) {
  const target = ctx.breakNums.get(breakId);
  if (target === undefined) return false;
  const visit = (list) => list.some((s) => s.stepNum === target
    || visit(s.body ?? []) || visit(s.ifBranch?.body ?? []) || visit(s.elseBranch?.body ?? [])
    || visit(s.defaultBranch?.body ?? []) || (s.caseBranches ?? []).some((b) => visit(b.body)));
  return visit(steps);
}

function buildCatchArea(ctx, catches, bodySteps, counter, path) {
  if (!catches || catches.length === 0) return undefined;
  const blocks = catches.map((c, n) => {
    const here = `${path}.catches[${n}]`;
    const ids = c.breakIds ?? (c.breakId !== undefined ? [c.breakId] : []);
    if (ids.length === 0) fail(here, "needs 'breakId' (or 'breakIds').");
    for (const id of ids) {
      if (!ctx.breakNums.has(id)) fail(here, `unknown break step '${id}' (must exist in the plan as kind:"break" with an id).`);
      if (!containsBreak(bodySteps, id, ctx)) fail(here, `break step '${id}' is not inside this container.`);
    }
    const headHtml = resolveHead(ctx, c.content, `${here}.content`);
    const body = buildSteps(ctx, c.body, counter, `${here}.body`);
    ctx.counts.catches++;
    return {
      breakStepNum: ctx.breakNums.get(ids[0]),
      content: { head: makeHtmlContent(headHtml), tail: resolveAreas(ctx, c.areas, here).map(buildArea) },
      change: undefined,
      headingWidth: undefined,
      coCatches: ids.slice(1).map((id) => ({ breakStepNum: ctx.breakNums.get(id), content: makeHtmlContent(headHtml), change: undefined })),
      body,
    };
  });
  return { collapsed: undefined, cols: undefined, catches: blocks };
}

function buildNode(ctx, node, counter, path) {
  const kind = node.kind;
  const isLeaf = LEAF_KINDS.has(kind);
  if (!isLeaf && !STRUCTURED_KINDS.has(kind)) fail(path, `unknown step kind '${kind}'.`);

  const stepNum = nextNum(counter);
  ctx.usedStepNums.add(stepNum);
  const step = {
    kind,
    stepNum,
    stepId: freshStepId(ctx),
    content: undefined,
    change: undefined,
    deco: undefined,
    shade: undefined,
  };
  ctx.counts.steps++;
  if (isLeaf) ctx.counts.leaves++; else ctx.counts.structured++;
  if (kind === 'break') {
    ctx.counts.breaks++;
    if (node.id !== undefined) {
      if (ctx.breakNums.has(node.id)) fail(path, `break id '${node.id}' is assigned twice.`);
      ctx.breakNums.set(node.id, stepNum);
    }
  }

  const head = resolveContent(ctx, node.content, `${path}.content`);
  if (isLeaf && head.html === '' && head.tail.length > 0) {
    ctx.warnings.push(`${path}: step ${stepNum} has an empty step text and its content sits only in areas (list/table/image) — for a bullet that is a step of its own, set 'flatLists: true' on the ref.`);
  }
  const extra = resolveAreas(ctx, node.areas, path);
  step.content = contentOf(ctx, head, extra);

  const childCounter = { prefix: stepNum, n: 0 };
  if (kind === 'subsequence' || LOOP_KINDS.has(kind)) {
    step.body = buildSteps(ctx, node.body, childCounter, `${path}.body`);
    step.catchArea = buildCatchArea(ctx, node.catches, step.body, childCounter, path);
    if (kind === 'subsequence' && node.flat) step.flat = true;
  } else if (kind === 'if') {
    step.ifBranch = buildBranch(ctx, node.ifBranch, 'Ja', childCounter, `${path}.ifBranch`);
  } else if (kind === 'ifElse') {
    step.ifBranch = buildBranch(ctx, node.ifBranch, 'Ja', childCounter, `${path}.ifBranch`);
    step.elseBranch = buildBranch(ctx, node.elseBranch, 'Nein', childCounter, `${path}.elseBranch`);
  } else if (kind === 'case') {
    if (!Array.isArray(node.caseBranches) || node.caseBranches.length < 2) fail(path, "'case' needs at least 2 caseBranches besides the defaultBranch.");
    step.defaultBranch = buildBranch(ctx, node.defaultBranch, 'Sonst', childCounter, `${path}.defaultBranch`);
    step.caseBranches = node.caseBranches.map((b, n) => buildBranch(ctx, b, `Fall ${n + 1}`, childCounter, `${path}.caseBranches[${n}]`));
  }
  return step;
}

// ============================================================
// Template filling
// ============================================================

function replaceRequired(html, pattern, replacement, what) {
  if (!pattern.test(html)) fail('template', `${what} not found — does reference/suc-template.nsd still match this script?`);
  return html.replace(pattern, replacement);
}

function resetHtml(content, html) {
  content.html = html;
  content.plain = undefined;
  content.markups = [];
}

function divs(contents) {
  return contents.map((c) => `<div>${c}</div>`).join('\n');
}

function descriptionHtml(ctx, intro, path) {
  const parts = [];
  for (const [i, spec] of (intro.description ?? []).entries()) {
    const content = resolveContent(ctx, spec, `${path}.description[${i}]`);
    if (content.tail.length > 0) fail(`${path}.description[${i}]`, 'List/table/image is not possible in the description — model it as a precondition item with `areas` or as a step.');
    parts.push(content.html);
  }
  if (intro.actors) {
    const actors = resolveHead(ctx, intro.actors, `${path}.actors`);
    parts.push(`${runsToHtml([{ text: 'Akteur(e):', b: true }])} ${actors}`);
  }
  return parts;
}

function fillIntro(ctx, ast, plan) {
  const intro = plan.intro ?? {};
  resetHtml(ast.intro.head, replaceRequired(
    ast.intro.head.html, /SUC-000\s+Template/, escapeText(`${plan.number} ${plan.title}`), 'Titel-Platzhalter "SUC-000 Template"',
  ));

  const tail = ast.intro.tail;
  const descIdx = tail.findIndex((a) => a.kind === 'text' && /Beschreibung/.test(a.content.html));
  if (descIdx === -1) fail('template', 'description text area not found.');
  const resultIdx = tail.findIndex((a) => a.kind === 'text' && /Resultat/.test(a.content.html));
  const listAfter = (idx) => tail.findIndex((a, i) => i > idx && a.kind === 'list');
  const preIdx = listAfter(descIdx);
  const postIdx = listAfter(resultIdx);
  if (resultIdx === -1 || preIdx === -1 || postIdx === -1) fail('template', 'precondition/postcondition list not found.');

  const descParts = descriptionHtml(ctx, intro, 'intro');
  if (descParts.length > 0) {
    const area = tail[descIdx].content;
    const m = /^([\s\S]*?<\/h2>)\s*<div[\s\S]*?<\/div>\s*(<h2[\s\S]*)$/.exec(area.html);
    if (!m) fail('template', 'structure of the description text area not recognised.');
    resetHtml(area, `${m[1]}\n${divs(descParts)}\n${m[2]}`);
  }

  const fillList = (index, items, name) => {
    if (!items || items.length === 0) return;
    tail[index].items = items.map((item, i) => {
      const c = itemContent(ctx, item, `intro.${name}[${i}]`);
      return { content: contentOf(ctx, c, []), change: undefined };
    });
  };
  fillList(preIdx, intro.preconditions, 'preconditions');
  fillList(postIdx, intro.postconditions, 'postconditions');
}

function fillOutro(ctx, ast, plan) {
  const outro = plan.outro ?? {};
  if (!ast.outro) fail('template', 'no outro block.');

  const fillSlots = (content, slotContents, what) => {
    const specs = slotContents.filter(([, list]) => list && list.length > 0);
    if (specs.length === 0) return;
    let seen = -1;
    const html = content.html.replace(/<div>\s*<\/div>/g, (whole) => {
      seen++;
      const found = specs.find(([slot]) => slot === seen);
      return found ? divs(found[1].map((spec, i) => {
        const c = resolveContent(ctx, spec, `outro.${what}[${i}]`);
        if (c.tail.length > 0) fail(`outro.${what}[${i}]`, 'List/table/image is not possible here — specify it as `sections[].areas`.');
        return c.html;
      })) : whole;
    });
    resetHtml(content, html);
  };

  fillSlots(ast.outro.head, [[1, outro.businessRules], [2, outro.nonFunctional]], 'businessRules/nonFunctional');

  const tail = ast.outro.tail;
  if (outro.openPoints && outro.openPoints.length > 0) {
    const table = tail.find((a) => a.kind === 'table' && a.rows[0]?.cells.length === 3);
    if (!table) fail('template', 'open-points table not found.');
    table.rows.splice(1, table.rows.length - 1, ...outro.openPoints.map((row, r) => {
      if (row.length !== 3) fail(`outro.openPoints[${r}]`, 'expected [issue, priority, status].');
      return { cells: row.map((cell, c) => ({ content: contentOf(ctx, itemContent(ctx, cell, `outro.openPoints[${r}][${c}]`), []) })) };
    }));
  }
  const notes = tail.find((a) => a.kind === 'text' && /Bemerkungen/.test(a.content.html));
  if (notes) fillSlots(notes.content, [[1, outro.remarks], [2, outro.designNotes]], 'remarks/designNotes');
  else if ((outro.remarks?.length ?? 0) + (outro.designNotes?.length ?? 0) > 0) fail('template', 'remarks text area not found.');

  (outro.sections ?? []).forEach((section, n) => {
    const here = `outro.sections[${n}]`;
    if (typeof section.heading !== 'string' || section.heading === '') fail(here, "needs 'heading'.");
    tail.push(buildArea({ kind: 'text', html: `<h2>${escapeText(section.heading)}</h2>` }));
    for (const spec of resolveAreas(ctx, section.areas, here)) tail.push(buildArea(spec));
  });
}

// ============================================================
// Coverage
// ============================================================

function expandIgnored(ctx, ignored, field = 'ignored') {
  const out = new Map();
  (ignored ?? []).forEach((entry, n) => {
    const here = `${field}[${n}]`;
    if (typeof entry.reason !== 'string' || entry.reason.trim() === '') fail(here, "needs a non-empty 'reason'.");
    const ids = [...(entry.ids ?? [])];
    if (entry.from !== undefined || entry.to !== undefined) {
      const num = (id) => Number(/^[pi](\d+)$/.exec(id ?? '')?.[1]);
      const prefix = String(entry.from)[0];
      const [from, to] = [num(entry.from), num(entry.to)];
      if (!(from <= to)) fail(here, "'from'/'to' must be ids of the same kind (p<N> or i<N>) with from <= to.");
      for (let k = from; k <= to; k++) ids.push(`${prefix}${k}`);
    }
    if (ids.length === 0) fail(here, "needs 'ids' or 'from'/'to'.");
    for (const id of ids) {
      const block = ctx.byId.get(id);
      if (!block) fail(here, `unknown extract id '${id}'.`);
      out.set(id, entry.reason);
      if (block.type === 'table') {
        for (const p of collectParagraphs(block)) {
          out.set(p.id, entry.reason);
          for (const imageId of p.images) out.set(imageId, entry.reason);
        }
      } else if (block.type === 'p') {
        for (const imageId of block.images) out.set(imageId, entry.reason);
      }
    }
  });
  return out;
}

function checkCoverage(ctx, ignoredMap) {
  const unreferenced = [];
  for (const p of allParagraphs(ctx.extract.blocks)) {
    if (p.text.trim() === '' && p.images.length === 0) continue;
    if (ctx.consumed.has(p.id) || ignoredMap.has(p.id)) continue;
    if (p.text.trim() === '') continue; // image-only paragraph: its images are checked below
    unreferenced.push({ id: p.id, text: p.text.slice(0, 120) });
  }
  for (const image of ctx.extract.images) {
    if (!ctx.consumedImages.has(image.id) && !ignoredMap.has(image.id)) unreferenced.push({ id: image.id, text: '(image)' });
  }
  return unreferenced;
}

/** Ids (paragraphs, images, table contents) a plan declares as deliberately left out. */
export function ignoredIds(extract, ignored) {
  try { return { ok: true, ids: new Set(expandIgnored(createContext(extract), ignored).keys()) }; } catch (e) {
    if (e instanceof PlanError) return { ok: false, error: e.message };
    throw e;
  }
}

function assertDisjoint(rewordedMap, ignoredMap) {
  for (const id of rewordedMap.keys()) {
    if (ignoredMap.has(id)) fail('reworded', `id '${id}' is also in 'ignored' — do not additionally ignore reworded content.`);
  }
}

/** Ids a plan declares as deliberately reworded (user-approved); must not overlap with `ignored`. */
export function rewordedIds(extract, reworded, ignored) {
  try {
    const ctx = createContext(extract);
    const map = expandIgnored(ctx, reworded, 'reworded');
    assertDisjoint(map, expandIgnored(ctx, ignored));
    return { ok: true, ids: new Set(map.keys()) };
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, error: e.message };
    throw e;
  }
}

/** Groups `{id -> reason}` by reason into `[{ reason, entries: [{ id, text }] }]`, skipping empty texts. */
function groupByReason(ctx, map) {
  const byReason = new Map();
  for (const [id, reason] of map) {
    const text = (ctx.byId.get(id).text ?? '').trim();
    if (text === '') continue;
    if (!byReason.has(reason)) byReason.set(reason, []);
    byReason.get(reason).push({ id, text: text.slice(0, 120) });
  }
  return [...byReason].map(([reason, entries]) => ({ reason, entries }));
}

// ============================================================
// Entry point
// ============================================================

export function buildFromPlan({ templateText, plan, extract }) {
  try {
    if (!plan || typeof plan !== 'object') fail('plan', 'is missing or not an object.');
    for (const key of ['number', 'title']) {
      if (typeof plan[key] !== 'string' || plan[key].trim() === '') fail('plan', `'${key}' is required.`);
    }
    if (!plan.main?.steps) fail('plan', "'main.steps' is required.");

    const ctx = createContext(extract);
    const ast = parseDiagram(templateText);
    const ignoredMap = expandIgnored(ctx, plan.ignored);
    const rewordedMap = expandIgnored(ctx, plan.reworded, 'reworded');
    assertDisjoint(rewordedMap, ignoredMap);

    fillIntro(ctx, ast, plan);

    const mainCounter = { prefix: '', n: 0 };
    const steps = buildSteps(ctx, plan.main.steps, mainCounter, 'main.steps');
    ast.mainSequence.steps = steps;
    ast.mainSequence.catchArea = buildCatchArea(ctx, plan.main.catches, steps, mainCounter, 'main');

    fillOutro(ctx, ast, plan);

    let historyRows = null;
    if (Array.isArray(plan.history)) historyRows = plan.history;
    else if ((plan.history === undefined || plan.history === 'extract') && extract.history) {
      historyRows = extract.history.rows;
      for (const id of extract.history.paragraphIds) ctx.consumed.set(id, 1);
    } else if (plan.history === 'extract') fail('plan.history', "'extract' was given, but the docx contains no recognisable history table.");

    const unreferenced = checkCoverage(ctx, new Map([...rewordedMap, ...ignoredMap]));
    if (unreferenced.length > 0) {
      return {
        ok: false,
        error: `${unreferenced.length} docx content item(s) do not appear in the plan (neither used nor justified in 'ignored') — no logic may be lost:\n` +
          unreferenced.map((u) => `  ${u.id}: ${u.text}`).join('\n'),
        unreferenced,
      };
    }

    // Grouped by reason and without empty paragraphs: the report must be readable, and every
    // ignored/reworded text still shows up so the user can see exactly what was left out or changed.
    const ignored = groupByReason(ctx, ignoredMap);
    const reworded = groupByReason(ctx, rewordedMap);
    return {
      ok: true,
      text: serializeDiagram(ast),
      historyRows,
      summary: {
        ...ctx.counts,
        ignoredTexts: ignored.reduce((n, g) => n + g.entries.length, 0),
        rewordedTexts: reworded.reduce((n, g) => n + g.entries.length, 0),
      },
      ignored,
      reworded,
      warnings: ctx.warnings,
    };
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, error: e.message };
    throw e;
  }
}
