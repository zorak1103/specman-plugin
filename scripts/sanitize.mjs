#!/usr/bin/env node
// sanitize.mjs — wraps `java -jar <jar> --sanitize <file>` and turns its stdout into structured
// JSON. The CLI contract (verified against the actual jar's SanitizeCLO class and by running it
// against real test files): first stdout line is exactly OK / SANITIZED / ERROR.
//   OK          — nothing changed.
//   SANITIZED   — followed by "Step numbers changed (n):", "Steplink references updated (n):",
//                 "Plain text fields refreshed: n" sections (any may be absent).
//   ERROR       — followed by a detail message (duplicate IDs, unresolvable steplinks, a parse
//                 error, or "headless sanitize requires V2 format" for a legacy V001 file).
// Exit code is 0 for OK/SANITIZED, 1 for ERROR.
//
// A SANITIZED result is re-run once; `stable: true` means the second run left the file unchanged.
//
// Usage: node sanitize.mjs --file <path> --json

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { resolveJarPath, specVersionWarning } from './resolve-jar.mjs';

export function parseSanitizeOutput(rawStdout, exitCode) {
  // The real jar prints CRLF line endings on Windows (verified against actual output) — normalize
  // once so every regex below can assume bare \n regardless of host line-ending convention.
  const stdout = rawStdout.replace(/\r\n/g, '\n');
  const lines = stdout.split('\n');
  const status = lines[0].trim();

  if (status === 'OK') {
    return { ok: true, status: 'OK' };
  }

  if (status === 'ERROR') {
    const message = lines.slice(1).join('\n').trim();
    return { ok: false, status: 'ERROR', message };
  }

  if (status === 'SANITIZED') {
    const body = lines.slice(1).join('\n');
    const stepNumberChanges = [];
    const stepChangeSection = body.match(/Step numbers changed \(\d+\):\n([\s\S]*?)(\n\n|$)/);
    if (stepChangeSection) {
      const lineRe = /^\s*(\S+) -> (\S+) \((\w+)\)(?: "(.*)")?\s*$/;
      for (const l of stepChangeSection[1].split('\n')) {
        const m = l.match(lineRe);
        if (m) stepNumberChanges.push({ from: m[1], to: m[2], type: m[3], text: m[4] });
      }
    }
    const steplinkUpdates = [];
    const steplinkSection = body.match(/Steplink references updated \(\d+\):\n([\s\S]*?)(\n\n|$)/);
    if (steplinkSection) {
      for (const l of steplinkSection[1].split('\n')) {
        const trimmed = l.trim();
        if (trimmed) steplinkUpdates.push(trimmed);
      }
    }
    let plainTextFieldsRefreshed;
    const refreshedMatch = body.match(/Plain text fields refreshed: (\d+)/);
    if (refreshedMatch) plainTextFieldsRefreshed = Number(refreshedMatch[1]);
    return { ok: true, status: 'SANITIZED', stepNumberChanges, steplinkUpdates, plainTextFieldsRefreshed };
  }

  return {
    ok: false,
    error: `unerwartete Sanitizer-Ausgabe (weder OK/SANITIZED/ERROR): ${JSON.stringify(status)}`,
    exitCode,
  };
}

// Some error paths print to stderr instead of stdout — verified empirically against the real
// jar: a malformed line-1 JSON envelope and an ANTLR grammar parse error both land on stderr,
// while SanitizeCLO's own controlled OK/SANITIZED/duplicate-ID/unresolvable-steplink paths print
// to stdout. Prefer stdout when it already has a recognized status line; otherwise fall back to
// stderr (or back to stdout if stderr is empty too, so a genuinely unrecognized failure still
// surfaces via the normal "unerwartete Sanitizer-Ausgabe" path instead of silently vanishing).
export function pickOutputStream(stdout, stderr) {
  if (/^(OK|SANITIZED|ERROR)\b/.test(stdout.trim())) return stdout;
  return stderr || stdout;
}

export function runSanitize(jarPath, filePath) {
  const proc = spawnSync('java', ['-jar', jarPath, '--sanitize', filePath], { encoding: 'utf8' });
  if (proc.error) {
    return { ok: false, error: `java konnte nicht gestartet werden: ${proc.error.message}` };
  }
  const output = pickOutputStream(proc.stdout ?? '', proc.stderr ?? '');
  return parseSanitizeOutput(output, proc.status ?? 1);
}

// The jar keeps reporting "Plain text fields refreshed: n" on every run for fields whose regenerated
// plain text it trims when writing (verified: a leading empty <div> in the template's outro areas
// makes the regenerated plain= start with a newline that the written plain= never has), so that
// counter never reaches 0 even though the file has settled. "Idempotent" therefore means: a second
// run leaves the file byte-identical — which is what `stable` reports. Only SANITIZED needs the
// second run; OK already proves stability.
export function sanitizeUntilStable(run, readFile) {
  const first = run();
  if (!first.ok) return first;
  if (first.status === 'OK') return { ...first, stable: true };
  const afterFirst = readFile();
  const second = run();
  if (!second.ok) return second;
  return { ...first, stable: readFile() === afterFirst };
}

/** Reads specmanVersion from the line-1 `// {...}` envelope; null when absent or unparseable. */
export function readSpecVersion(text) {
  const m = text.match(/^\/\/ (\{.*\})\s*$/m);
  if (!m) return null;
  try {
    return JSON.parse(m[1]).specmanVersion ?? null;
  } catch {
    return null;
  }
}

/** Adds a `warnings` array to a result — only when there is something to report. */
export function attachWarnings(result, warnings) {
  return warnings.length ? { ...result, warnings } : result;
}

function plainSummary(r) {
  if (r.status === 'OK') return 'OK — keine Änderungen.';
  const parts = [`SANITIZED — ${r.stepNumberChanges.length} Schrittnummer(n) geändert`];
  if (r.steplinkUpdates.length) parts.push(`${r.steplinkUpdates.length} Steplink(s) aktualisiert`);
  if (r.plainTextFieldsRefreshed) parts.push(`${r.plainTextFieldsRefreshed} plain=-Feld(er) aufgefrischt`);
  if (r.stable === false) parts.push('NICHT stabil (zweiter Lauf ändert die Datei erneut)');
  return parts.join(', ');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    report({ ok: false, error: '--file ist Pflicht.' }, { json: !!args.json });
    return;
  }
  const jar = resolveJarPath(process.env);
  if (!jar.ok) {
    report(jar, { json: !!args.json });
    return;
  }
  const warnings = [...jar.warnings];
  try {
    const specWarning = specVersionWarning(jar.version, readSpecVersion(readFileSync(args.file, 'utf8')));
    if (specWarning) warnings.push(specWarning);
  } catch {
    // unreadable file: the sanitizer run below reports that error itself
  }
  const result = attachWarnings(
    sanitizeUntilStable(
      () => runSanitize(jar.path, args.file),
      () => readFileSync(args.file, 'utf8'),
    ),
    warnings,
  );
  report(result, {
    json: !!args.json,
    plainText: (r) => [plainSummary(r), ...(r.warnings ?? []).map((w) => `WARNUNG: ${w}`)].join('\n'),
  });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
