// cli.mjs — tiny shared helpers for this plugin's scripts/*.mjs entry points. Conventions: every script
// supports --json, prints a plain message otherwise, exits 1 on a usage/IO failure and 2 on a
// deliberate domain refusal (e.g. "this operation isn't supported for this node kind").

import { pathToFileURL } from 'node:url';

// `import.meta.url` is always bound to the module it lexically appears in — it can't be read
// generically from inside this shared helper. Callers pass their own `import.meta.url` in.
export function isMainModule(moduleUrl, argv1) {
  return moduleUrl === pathToFileURL(argv1).href;
}

/** Prints `result` (either as JSON or via `plainText(result)`) and exits with `exitCode`. */
export function report(result, { json, plainText, exitCode = result.ok ? 0 : 1 }) {
  if (json) {
    console.log(JSON.stringify(result));
  } else if (result.ok) {
    console.log(plainText ? plainText(result) : JSON.stringify(result, null, 2));
  } else {
    console.error(result.error);
  }
  process.exit(exitCode);
}

/** Minimal `--flag value` / `--flag` argv parser shared by every script in this plugin. */
export function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { args[key] = next; i++; }
      else { args[key] = true; }
    } else {
      args._.push(arg);
    }
  }
  return args;
}
