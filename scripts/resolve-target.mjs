#!/usr/bin/env node
// resolve-target.mjs — decides whether an edit should go to `<file>.nsd` or `<file>.nsd.wrk`.
//
// Specman's autoload feature (see AutoSaveOp.java/AutoLoadOp.java, verified against the actual
// Specman source) creates `<file>.nsd.wrk` the moment the file is opened, and only ever reads
// that working copy on its autoload timer — never the `.nsd` itself while it's open. So: if a
// `.wrk` exists, the file is currently open in Specman and edits MUST go to the `.wrk` (an
// explicit save in Specman would otherwise overwrite a `.wrk`-only edit with stale content).
// Without a `.wrk`, the file isn't open and the `.nsd` is edited directly. `--sanitize` itself
// has no awareness of this convention, so this decision always happens before invoking it.
//
// Usage: node resolve-target.mjs --file <path-to.nsd> --json

import { existsSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';

export function resolveTarget(nsdPath) {
  if (!existsSync(nsdPath)) {
    return { ok: false, error: `Datei nicht gefunden: ${nsdPath}` };
  }
  const wrkPath = `${nsdPath}.wrk`;
  if (existsSync(wrkPath)) {
    return { ok: true, path: wrkPath, usingWorkingCopy: true };
  }
  return { ok: true, path: nsdPath, usingWorkingCopy: false };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    report({ ok: false, error: '--file ist Pflicht.' }, { json: !!args.json });
    return;
  }
  const result = resolveTarget(args.file);
  report(result, {
    json: !!args.json,
    plainText: (r) => `${r.path}${r.usingWorkingCopy ? ' (Arbeitskopie, Datei ist in Specman geöffnet)' : ''}`,
  });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
