// nsd-build.mjs — shared builders for freshly created steps: collision-free step numbers/IDs and the
// placeholder `simple` step that every grammatically mandatory body/branch/catch must contain
// (`step+`). Used by nsd-insert-step and nsd-catch; callers MUST replace each placeholder
// immediately via nsd-set-text, addressed by the IDs these builders hand back.

import { randomBytes } from 'node:crypto';
import { listSequences } from './nsd-paths.mjs';

export const PLACEHOLDER_STEP_HTML = 'TODO Schritt';
export const STEP_ID_RE = /^[0-9a-f]{8}$/;

export function collectStepIds(ast) {
  const ids = new Set();
  for (const { steps } of listSequences(ast)) for (const s of steps) ids.add(s.stepId);
  return ids;
}

export function collectStepNums(ast) {
  const nums = new Set();
  for (const { steps } of listSequences(ast)) for (const s of steps) nums.add(s.stepNum);
  return nums;
}

// Placeholder step numbers/IDs only need to (a) be lexically valid and (b) not collide with
// anything already in the file or with another one created in the same call — hence the
// caller-owned `used*` sets are mutated in place across every generated value.
export function freshStepNum(usedNums) {
  let candidate;
  do { candidate = String(9000 + Math.floor(Math.random() * 999)); } while (usedNums.has(candidate));
  usedNums.add(candidate);
  return candidate;
}

export function freshStepId(usedIds) {
  let id;
  do { id = randomBytes(4).toString('hex'); } while (usedIds.has(id));
  usedIds.add(id);
  return id;
}

/** Validates a caller-supplied step ID (format + diagram-wide uniqueness) and reserves it in `usedIds`. */
export function reserveStepId(id, usedIds) {
  if (!STEP_ID_RE.test(id)) {
    throw new Error(`nsd-build: --id must be exactly 8 hex characters (0-9, a-f, lowercase), got: '${id}'.`);
  }
  if (usedIds.has(id)) {
    throw new Error(`nsd-build: step id '${id}' is already in use — --id must be unique across the diagram.`);
  }
  usedIds.add(id);
  return id;
}

export function makePlaceholderStep(usedNums, usedIds, placeholderStepIds) {
  const stepId = freshStepId(usedIds);
  placeholderStepIds.push(stepId);
  return {
    kind: 'simple',
    stepNum: freshStepNum(usedNums),
    stepId,
    content: { head: { html: PLACEHOLDER_STEP_HTML, plain: undefined, markups: [] }, tail: [] },
    change: undefined,
    deco: undefined,
    shade: undefined,
  };
}
