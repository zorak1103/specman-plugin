#!/usr/bin/env node
// resolve-jar.mjs — resolves and validates the path to the Specman sanitizer jar from the
// SPECMAN_JAR environment variable. The jar itself (~50-70 MB) is never vendored into this repo —
// see VENDORING.md — so every skill that needs to invoke the sanitizer goes through this script
// first rather than assuming a fixed install location.
//
// Hard errors (ok: false): variable unset/blank, path missing, a directory, not a *.jar, not a ZIP.
// Soft findings (ok: true, `warnings`): surrounding quotes stripped, jar older than
// MIN_SUPPORTED_VERSION, or the version not readable from the file name. Callers must show warnings
// to the user. The version is taken from the standard file name
// (specman-<version>-jar-with-dependencies.jar) because launching `java -jar` without a task flag
// starts the GUI, so there is no cheap way to ask the jar itself.
//
// Usage: node resolve-jar.mjs --json

import { existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { isMainModule, report } from './lib/cli.mjs';
import { compareVersions } from './lib/versions.mjs';

export { compareVersions };

// Oldest Specman whose model format (grammar) this plugin fully understands. Raise it together with
// the vendored grammar under reference/ (see VENDORING.md).
export const MIN_SUPPORTED_VERSION = '1.4.0';

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

export function parseJarVersion(jarPath) {
  const base = jarPath.split(/[\\/]/).pop();
  const m = base.match(/^specman-(\d+(?:\.\d+)*)(?:-[A-Za-z][\w.]*)?-jar-with-dependencies\.jar$/i);
  return m ? m[1] : null;
}

/**
 * Warning text when a spec was last saved by a newer Specman than the jar that would sanitize it,
 * else null. Either version may be missing (unknown) — then there is nothing to compare.
 */
export function specVersionWarning(jarVersion, specVersion) {
  if (!jarVersion || !specVersion) return null;
  if (compareVersions(specVersion, jarVersion) <= 0) return null;
  return (
    `The specification was saved with Specman ${specVersion}, but the jar under SPECMAN_JAR is only ` +
    `${jarVersion}. The sanitizer may reject newer constructs — point SPECMAN_JAR to ` +
    `specman-${specVersion}-jar-with-dependencies.jar (or newer).`
  );
}

function hasZipMagic(file) {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(ZIP_MAGIC.length);
    const n = readSync(fd, buf, 0, buf.length, 0);
    return n === ZIP_MAGIC.length && ZIP_MAGIC.every((b, i) => buf[i] === b);
  } finally {
    closeSync(fd);
  }
}

export function resolveJarPath(env) {
  const raw = (env.SPECMAN_JAR ?? '').trim();
  if (!raw) {
    return {
      ok: false,
      error:
        'SPECMAN_JAR is not set. Set the SPECMAN_JAR environment variable to the full path of ' +
        'specman-*-jar-with-dependencies.jar (see this plugin\'s README.adoc).',
    };
  }

  const warnings = [];
  let jarPath = raw;
  const quoted = raw.match(/^(["'])(.*)\1$/);
  if (quoted) {
    jarPath = quoted[2];
    warnings.push(
      'SPECMAN_JAR contains quotes around the path — they were ignored. Set the variable without ' +
        'quotes.',
    );
  }

  if (!existsSync(jarPath)) {
    return { ok: false, error: `Sanitizer jar not found: ${jarPath} (SPECMAN_JAR points here)` };
  }
  if (statSync(jarPath).isDirectory()) {
    return {
      ok: false,
      error: `SPECMAN_JAR points to a directory (${jarPath}), not to the jar file itself ` +
        '(specman-*-jar-with-dependencies.jar).',
    };
  }
  if (!/\.jar$/i.test(jarPath)) {
    return {
      ok: false,
      error: `SPECMAN_JAR does not point to a .jar file: ${jarPath} ` +
        '(expected: specman-*-jar-with-dependencies.jar).',
    };
  }
  if (!hasZipMagic(jarPath)) {
    return {
      ok: false,
      error: `SPECMAN_JAR does not point to a valid jar (not a ZIP archive): ${jarPath} — corrupted ` +
        'or incompletely downloaded?',
    };
  }

  const version = parseJarVersion(jarPath);
  if (version === null) {
    warnings.push(
      'The Specman version of the jar cannot be determined from the file name (expected: ' +
        `specman-<version>-jar-with-dependencies.jar). The plugin needs Specman ${MIN_SUPPORTED_VERSION}+.`,
    );
  } else if (compareVersions(version, MIN_SUPPORTED_VERSION) < 0) {
    warnings.push(
      `The jar under SPECMAN_JAR is Specman ${version}; this plugin targets Specman ` +
        `${MIN_SUPPORTED_VERSION}+. Newer specifications (e.g. with meta tags) cannot be sanitized ` +
        'with the older jar — point SPECMAN_JAR to the newer jar.',
    );
  }

  return { ok: true, path: jarPath, version, warnings };
}

function main() {
  const result = resolveJarPath(process.env);
  report(result, {
    json: process.argv.includes('--json'),
    plainText: (r) => [r.path, ...r.warnings.map((w) => `WARNING: ${w}`)].join('\n'),
  });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
