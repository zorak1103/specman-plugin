#!/usr/bin/env node
// resolve-suc-number.mjs — proposes the next free SUC number for a new (sub-)specification, by
// scanning a target folder's existing `SUC-<n>(.<m>)* <Titel>.nsd` filenames (the project
// convention; a discarded per-flow-Markdown convention observed
// elsewhere is NOT this one). Numbering only, never touches file content or creates anything —
// the caller (the `plan` skill) does the actual file creation once the user confirms the number.
//
// Usage: node resolve-suc-number.mjs --dir <path> [--parent <suc-number>] [--base <int>] --json

import { existsSync, readdirSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';

const FILENAME_RE = /^SUC-(\d+(?:\.\d+)*)\b/;

export function proposeSucNumber(dir, { parent, base }) {
  if (!existsSync(dir)) return { ok: false, error: `Folder not found: ${dir}` };

  const existingNumbers = readdirSync(dir)
    .map((name) => name.match(FILENAME_RE))
    .filter(Boolean)
    .map((m) => m[1]);

  const prefix = parent ? `${parent}.` : '';
  const depth = parent ? parent.split('.').length + 1 : 1;

  const usedAtThisLevel = new Set();
  for (const num of existingNumbers) {
    if (parent) {
      if (!num.startsWith(prefix)) continue;
      const rest = num.slice(prefix.length);
      const firstSegment = rest.split('.')[0]; // a deeper descendant still marks this level used
      const n = Number(firstSegment);
      if (Number.isInteger(n)) usedAtThisLevel.add(n);
    } else {
      const first = Number(num.split('.')[0]);
      if (Number.isInteger(first)) usedAtThisLevel.add(first);
    }
  }

  const baseline = usedAtThisLevel.size > 0
    ? Math.max(...usedAtThisLevel)
    : (parent ? 0 : (base ? Number(base) : 0));
  const candidate = baseline + 1;

  return { ok: true, number: `${prefix}${candidate}`, depth };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dir) {
    report({ ok: false, error: '--dir is required.' }, { json: !!args.json });
    return;
  }
  const result = proposeSucNumber(args.dir, { parent: args.parent, base: args.base ? Number(args.base) : undefined });
  report(result, { json: !!args.json, plainText: (r) => r.number });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
