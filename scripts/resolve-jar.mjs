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
    `Die Spezifikation wurde mit Specman ${specVersion} gespeichert, die Jar unter SPECMAN_JAR ist ` +
    `aber nur ${jarVersion}. Der Sanitizer kann neuere Konstrukte ablehnen — SPECMAN_JAR auf ` +
    `specman-${specVersion}-jar-with-dependencies.jar (oder neuer) setzen.`
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
        'SPECMAN_JAR ist nicht gesetzt. Setze die Umgebungsvariable SPECMAN_JAR auf den vollen ' +
        'Pfad zur specman-*-jar-with-dependencies.jar (siehe README.adoc dieses Plugins).',
    };
  }

  const warnings = [];
  let jarPath = raw;
  const quoted = raw.match(/^(["'])(.*)\1$/);
  if (quoted) {
    jarPath = quoted[2];
    warnings.push(
      'SPECMAN_JAR enthält Anführungszeichen um den Pfad — sie wurden ignoriert. Variable ohne ' +
        'Anführungszeichen setzen.',
    );
  }

  if (!existsSync(jarPath)) {
    return { ok: false, error: `Sanitizer-Jar nicht gefunden: ${jarPath} (SPECMAN_JAR zeigt hierhin)` };
  }
  if (statSync(jarPath).isDirectory()) {
    return {
      ok: false,
      error: `SPECMAN_JAR zeigt auf ein Verzeichnis (${jarPath}), nicht auf die Jar-Datei selbst ` +
        '(specman-*-jar-with-dependencies.jar).',
    };
  }
  if (!/\.jar$/i.test(jarPath)) {
    return {
      ok: false,
      error: `SPECMAN_JAR zeigt nicht auf eine .jar-Datei: ${jarPath} ` +
        '(erwartet: specman-*-jar-with-dependencies.jar).',
    };
  }
  if (!hasZipMagic(jarPath)) {
    return {
      ok: false,
      error: `SPECMAN_JAR zeigt auf kein gültiges Jar (kein ZIP-Archiv): ${jarPath} — Datei beschädigt ` +
        'oder unvollständig heruntergeladen?',
    };
  }

  const version = parseJarVersion(jarPath);
  if (version === null) {
    warnings.push(
      'Die Specman-Version der Jar ist am Dateinamen nicht erkennbar (erwartet: ' +
        `specman-<version>-jar-with-dependencies.jar). Das Plugin braucht Specman ${MIN_SUPPORTED_VERSION}+.`,
    );
  } else if (compareVersions(version, MIN_SUPPORTED_VERSION) < 0) {
    warnings.push(
      `Die Jar unter SPECMAN_JAR ist Specman ${version}; dieses Plugin ist auf Specman ` +
        `${MIN_SUPPORTED_VERSION}+ ausgelegt. Neuere Spezifikationen (z. B. mit Meta-Tags) lassen ` +
        'sich mit der älteren Jar nicht sanitizen — SPECMAN_JAR auf die neuere Jar umstellen.',
    );
  }

  return { ok: true, path: jarPath, version, warnings };
}

function main() {
  const result = resolveJarPath(process.env);
  report(result, {
    json: process.argv.includes('--json'),
    plainText: (r) => [r.path, ...r.warnings.map((w) => `WARNUNG: ${w}`)].join('\n'),
  });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
