// nsd-paths.mjs — addressing helpers over a parsed diagram AST (see nsd-ast.mjs).
//
// Every step-sequence in a diagram (main sequence, a loop body, a branch body, a case branch, a
// catch handler body) gets a stable, human-readable key derived from its enclosing step's ID (or
// "main" for the top level). Every text-bearing sub-area of a step's content gets a similar key.
// Callers (nsd-locate, nsd-set-text, nsd-insert-step, ...) always pass these keys back verbatim —
// nothing ever reconstructs a key from scratch, which is what keeps addressing correct even as
// the grammar's content model grows more nested (head + tail areas + list items + table cells).

/**
 * Enumerates every step-sequence in the diagram as { key, steps, holder, canHaveCatch, parentKey }
 * entries. `steps` is the live array reference from the AST (mutate in place for insertion, then
 * re-serialize). `holder` is the AST node whose `catchArea` slot belongs to this sequence (null for
 * a catch body); `canHaveCatch` says whether the grammar allows a `catchArea` there at all (main,
 * while, subsequence, if/else branch — not doWhile, case/default branches or catch bodies).
 */
export function listSequences(ast) {
  const out = [];
  walkContainer({ key: 'main', steps: ast.mainSequence.steps, holder: ast.mainSequence, canHaveCatch: true, parentKey: null }, out);
  return out;
}

function walkContainer(entry, out) {
  out.push(entry);
  for (const step of entry.steps) walkStepChildren(step, entry.key, out);
  const catchArea = entry.holder?.catchArea;
  if (catchArea) {
    catchArea.catches.forEach((catchBlock, n) => {
      walkContainer({
        key: `${entry.key}.catch[${n}].body`, steps: catchBlock.body, holder: null, canHaveCatch: false, parentKey: entry.key,
      }, out);
    });
  }
}

function walkStepChildren(step, parentKey, out) {
  const prefix = `step:${step.stepId}`;
  const child = (suffix, steps, holder, canHaveCatch) => walkContainer({ key: `${prefix}${suffix}`, steps, holder, canHaveCatch, parentKey }, out);
  if (step.body) child('.body', step.body, step, step.kind !== 'doWhile');
  if (step.ifBranch) child('.if_branch', step.ifBranch.body, step.ifBranch, true);
  if (step.elseBranch) child('.else_branch', step.elseBranch.body, step.elseBranch, true);
  if (step.defaultBranch) child('.default_branch', step.defaultBranch.body, step.defaultBranch, false);
  if (step.caseBranches) {
    step.caseBranches.forEach((branch, n) => child(`.branch[${n}]`, branch.body, branch, false));
  }
}

/**
 * Wraps the `intro` or `outro` node as a step-like object (`{ content: { head, tail } }`) so
 * addressableAreas/listTailAreas/resolveArea/resolveTailContainer work on it unchanged.
 */
export function blockAsStep(ast, name) {
  if (name !== 'intro' && name !== 'outro') throw new Error(`nsd-paths: unknown block '${name}' (expected: intro|outro)`);
  const node = ast[name];
  if (!node) throw new Error(`nsd-paths: the specification has no ${name} block.`);
  return { content: node };
}

/**
 * Resolves a CLI selector: `intro`/`outro` → `{ step, block }`; a step ID (8 hex) or step number →
 * `{ step, parentKey, index }`. Returns `null` if no step matches.
 */
export function resolveTarget(ast, selector) {
  if (selector === 'intro' || selector === 'outro') return { step: blockAsStep(ast, selector), block: selector };
  return findStep(ast, /^[0-9a-f]{8}$/.test(selector) ? { stepId: selector } : { stepNum: selector });
}

/**
 * Lists every catch block (`catches`: owner sequence key, break step, body sequence key) and every
 * `break` step that no catch/coCatch covers yet (`uncaughtBreaks`).
 */
export function listCatches(ast) {
  const sequences = listSequences(ast);
  const breaks = [];
  for (const { key, steps } of sequences) {
    for (const s of steps) if (s.kind === 'break') breaks.push({ stepNum: s.stepNum, stepId: s.stepId, parentKey: key });
  }
  const idByNum = new Map(breaks.map((b) => [b.stepNum, b.stepId]));
  const catches = [];
  const covered = new Set();
  for (const { key, holder } of sequences) {
    (holder?.catchArea?.catches ?? []).forEach((c, index) => {
      covered.add(c.breakStepNum);
      c.coCatches.forEach((cc) => covered.add(cc.breakStepNum));
      catches.push({
        ownerKey: key, index, breakStepNum: c.breakStepNum, breakStepId: idByNum.get(c.breakStepNum),
        bodyKey: `${key}.catch[${index}].body`, stepCount: c.body.length,
      });
    });
  }
  return { catches, uncaughtBreaks: breaks.filter((b) => !covered.has(b.stepNum)) };
}

/**
 * Finds the sequence that should hold the catch for the break step `breakStepId`: `parentKey` if
 * given (must be the break's own sequence or an ancestor that may hold a catchArea), otherwise the
 * nearest such sequence. Throws a descriptive error otherwise. Returns the `listSequences` entry.
 */
export function catchTargetFor(ast, breakStepId, parentKey) {
  const found = findStep(ast, { stepId: breakStepId });
  if (!found || found.step.kind !== 'break') {
    throw new Error(`nsd-paths: '${breakStepId}' is not a break step.`);
  }
  const byKey = new Map(listSequences(ast).map((s) => [s.key, s]));
  const chain = [];
  for (let k = found.parentKey; k; k = byKey.get(k).parentKey) chain.push(byKey.get(k));
  const allowed = chain.filter((s) => s.canHaveCatch);
  if (parentKey === undefined) {
    if (allowed.length === 0) throw new Error(`nsd-paths: no ancestor of break step '${breakStepId}' may carry a catch block.`);
    return allowed[0];
  }
  const target = allowed.find((s) => s.key === parentKey);
  if (!target) {
    throw new Error(`nsd-paths: '${parentKey}' is not an ancestor of break step '${breakStepId}' that may carry a catch block (possible: ${allowed.map((s) => s.key).join(', ') || 'none'}).`);
  }
  return target;
}

/**
 * Finds a step by step number or step ID. `selector` is `{ stepNum }` or `{ stepId }` (exactly
 * one). Returns `{ step, parentKey, index }` or `null` if nothing matches. Throws if neither
 * selector field is given.
 */
export function findStep(ast, selector) {
  const { stepNum, stepId } = selector || {};
  if (stepNum === undefined && stepId === undefined) {
    throw new Error('nsd-paths: findStep requires a selector with stepNum or stepId');
  }
  for (const { key, steps } of listSequences(ast)) {
    const index = steps.findIndex((s) => (
      (stepNum !== undefined && s.stepNum === stepNum) ||
      (stepId !== undefined && s.stepId === stepId)
    ));
    if (index !== -1) return { step: steps[index], parentKey: key, index };
  }
  return null;
}

/**
 * Lists every addressable text-bearing area under a step's content: the head, each tail area
 * (a plain `text(...)` area, each list item, each table cell), and — for structured steps — each
 * branch heading (`if_branch`/`else_branch`/`default_branch`/`case_branch`). Image areas are
 * intentionally excluded — this plugin never edits image content, only passes it through.
 */
export function addressableAreas(step) {
  const out = [];
  out.push({ key: 'head', plain: step.content.head.plain, html: step.content.head.html });
  step.content.tail.forEach((area, i) => {
    if (area.kind === 'text') {
      out.push({ key: `tail[${i}]`, plain: area.content.plain, html: area.content.html });
    } else if (area.kind === 'list') {
      area.items.forEach((item, j) => {
        out.push({ key: `tail[${i}].items[${j}]`, plain: item.content.head.plain, html: item.content.head.html });
      });
    } else if (area.kind === 'table') {
      area.rows.forEach((row, r) => {
        row.cells.forEach((cell, c) => {
          out.push({
            key: `tail[${i}].rows[${r}].cells[${c}]`,
            plain: cell.content.head.plain,
            html: cell.content.head.html,
          });
        });
      });
    }
    // image areas: no addressable text, pass-through only.
  });
  if (step.ifBranch) {
    out.push({ key: 'ifBranch.head', plain: step.ifBranch.content.head.plain, html: step.ifBranch.content.head.html });
  }
  if (step.elseBranch) {
    out.push({ key: 'elseBranch.head', plain: step.elseBranch.content.head.plain, html: step.elseBranch.content.head.html });
  }
  if (step.defaultBranch) {
    out.push({
      key: 'defaultBranch.head',
      plain: step.defaultBranch.content.head.plain,
      html: step.defaultBranch.content.head.html,
    });
  }
  if (step.caseBranches) {
    step.caseBranches.forEach((branch, n) => {
      out.push({ key: `caseBranch[${n}].head`, plain: branch.content.head.plain, html: branch.content.head.html });
    });
  }
  return out;
}

/**
 * Lists every top-level tail area of a step's content as `{ key, kind, ... }`, for callers that
 * need to insert/append/remove whole areas (table/list/text blocks) rather than replace text
 * inside one that already exists (that's `addressableAreas`/`resolveArea`). Kind-specific extras:
 * `list` → `ordered`, `itemCount`; `table` → `rowCount`, `colCount`. `image` areas are reported
 * (so callers can see they exist and skip them) but carry no further detail — this plugin never
 * edits image content.
 */
export function listTailAreas(step) {
  return step.content.tail.map((area, i) => {
    const key = `tail[${i}]`;
    if (area.kind === 'text') return { key, kind: 'text' };
    if (area.kind === 'list') return { key, kind: 'list', ordered: area.ordered, itemCount: area.items.length };
    if (area.kind === 'table') {
      const colCount = area.rows[0]?.cells.length ?? 0;
      return { key, kind: 'table', rowCount: area.rows.length, colCount };
    }
    if (area.kind === 'image') return { key, kind: 'image' };
    throw new Error(`nsd-paths: unknown area kind '${area.kind}'`);
  });
}

/**
 * Resolves a tail-area key to its structural container, for mutation (insert/append/remove a
 * whole area, table row, or list item) rather than text replacement inside one. Accepts:
 * `tail[i]` → `{ area, index }`; `tail[i].rows[r]` → `{ area, row, index }` (area must be a
 * table); `tail[i].items[j]` → `{ area, item, index }` (area must be a list).
 */
export function resolveTailContainer(step, key) {
  const tailMatch = key.match(/^tail\[(\d+)\]$/);
  if (tailMatch) {
    const index = Number(tailMatch[1]);
    const area = step.content.tail[index];
    if (!area) throw new Error(`nsd-paths: no tail area at key '${key}'`);
    return { area, index };
  }
  const rowMatch = key.match(/^tail\[(\d+)\]\.rows\[(\d+)\]$/);
  if (rowMatch) {
    const area = step.content.tail[Number(rowMatch[1])];
    if (!area) throw new Error(`nsd-paths: no tail area at key '${key}'`);
    if (area.kind !== 'table') throw new Error(`nsd-paths: area key '${key.replace(/\.rows\[\d+\]$/, '')}' is not a table`);
    const index = Number(rowMatch[2]);
    const row = area.rows[index];
    if (!row) throw new Error(`nsd-paths: no table row at key '${key}'`);
    return { area, row, index };
  }
  const itemMatch = key.match(/^tail\[(\d+)\]\.items\[(\d+)\]$/);
  if (itemMatch) {
    const area = step.content.tail[Number(itemMatch[1])];
    if (!area) throw new Error(`nsd-paths: no tail area at key '${key}'`);
    if (area.kind !== 'list') throw new Error(`nsd-paths: area key '${key.replace(/\.items\[\d+\]$/, '')}' is not a list`);
    const index = Number(itemMatch[2]);
    const item = area.items[index];
    if (!item) throw new Error(`nsd-paths: no list item at key '${key}'`);
    return { area, item, index };
  }
  throw new Error(`nsd-paths: unrecognized tail container key '${key}'`);
}

/**
 * Resolves an area key (as returned by addressableAreas) to the actual HtmlContent object inside
 * a step's content tree, so callers can read or replace it in place.
 */
export function resolveArea(step, key) {
  if (key === 'head') return step.content.head;
  const tailMatch = key.match(/^tail\[(\d+)\]$/);
  if (tailMatch) {
    const area = step.content.tail[Number(tailMatch[1])];
    if (!area || area.kind !== 'text') throw new Error(`nsd-paths: area key '${key}' is not a text area`);
    return area.content;
  }
  const itemMatch = key.match(/^tail\[(\d+)\]\.items\[(\d+)\]$/);
  if (itemMatch) {
    const area = step.content.tail[Number(itemMatch[1])];
    if (!area || area.kind !== 'list') throw new Error(`nsd-paths: area key '${key}' is not a list area`);
    const item = area.items[Number(itemMatch[2])];
    if (!item) throw new Error(`nsd-paths: no list item at key '${key}'`);
    return item.content.head;
  }
  const cellMatch = key.match(/^tail\[(\d+)\]\.rows\[(\d+)\]\.cells\[(\d+)\]$/);
  if (cellMatch) {
    const area = step.content.tail[Number(cellMatch[1])];
    if (!area || area.kind !== 'table') throw new Error(`nsd-paths: area key '${key}' is not a table area`);
    const row = area.rows[Number(cellMatch[2])];
    if (!row) throw new Error(`nsd-paths: no table row at key '${key}'`);
    const cell = row.cells[Number(cellMatch[3])];
    if (!cell) throw new Error(`nsd-paths: no table cell at key '${key}'`);
    return cell.content.head;
  }
  if (key === 'ifBranch.head') {
    if (!step.ifBranch) throw new Error(`nsd-paths: step has no ifBranch (key '${key}')`);
    return step.ifBranch.content.head;
  }
  if (key === 'elseBranch.head') {
    if (!step.elseBranch) throw new Error(`nsd-paths: step has no elseBranch (key '${key}')`);
    return step.elseBranch.content.head;
  }
  if (key === 'defaultBranch.head') {
    if (!step.defaultBranch) throw new Error(`nsd-paths: step has no defaultBranch (key '${key}')`);
    return step.defaultBranch.content.head;
  }
  const caseBranchMatch = key.match(/^caseBranch\[(\d+)\]\.head$/);
  if (caseBranchMatch) {
    const branch = step.caseBranches && step.caseBranches[Number(caseBranchMatch[1])];
    if (!branch) throw new Error(`nsd-paths: no case branch at key '${key}'`);
    return branch.content.head;
  }
  throw new Error(`nsd-paths: unrecognized area key '${key}'`);
}
