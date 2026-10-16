#!/usr/bin/env node
// resolve-jar.mjs — resolves the path to the Specman sanitizer jar from the SPECMAN_JAR
// environment variable. The jar itself (~48-50 MB) is never vendored into this repo — see
// VENDORING.md — so every skill that needs to invoke the sanitizer goes through this script
// first rather than assuming a fixed install location.
//
// Usage: node resolve-jar.mjs --json

import { existsSync } from 'node:fs';
import { isMainModule, report } from './lib/cli.mjs';

export function resolveJarPath(env) {
  const jarPath = env.SPECMAN_JAR;
  if (!jarPath) {
    return {
      ok: false,
      error:
        'SPECMAN_JAR ist nicht gesetzt. Setze die Umgebungsvariable SPECMAN_JAR auf den vollen ' +
        'Pfad zur specman-*-jar-with-dependencies.jar (siehe README.adoc dieses Plugins).',
    };
  }
  if (!existsSync(jarPath)) {
    return { ok: false, error: `Sanitizer-Jar nicht gefunden: ${jarPath} (SPECMAN_JAR zeigt hierhin)` };
  }
  return { ok: true, path: jarPath };
}

function main() {
  const result = resolveJarPath(process.env);
  report(result, { json: process.argv.includes('--json'), plainText: (r) => r.path });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
