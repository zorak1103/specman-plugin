#!/usr/bin/env node
// nsd-build-from-plan.mjs — builds a complete SUC .nsd from the plugin template, a migration plan
// and the docx extract (see lib/nsd-plan.mjs for the plan shape and the no-logic-lost guarantee).
// The output is NOT sanitized here — run sanitize.mjs next (the `migrate` skill does).
//
// Refuses to overwrite an existing --out unless --force is given (the skill asks the user first).
//
// With --migration-version/--migration-author/--migration-followup the migration row is appended to the
// history right after the import, so a rebuild (--force) does not lose it.
//
// Usage: node nsd-build-from-plan.mjs --plan <plan.json> --extract <extract.json> --out <ziel.nsd> [--template <vorlage.nsd>] [--force]
//          [--migration-version <v> --migration-author <name> --migration-followup <-|Review>] --json

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { buildFromPlan } from './lib/nsd-plan.mjs';
import { importRows, appendRow, todayDate } from './nsd-history.mjs';

const DEFAULT_TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'reference', 'suc-template.nsd');

function readJson(path, what) {
  try { return { value: JSON.parse(readFileSync(path, 'utf8')) }; } catch (e) {
    return { error: `${what} nicht lesbar/parsebar: ${path} (${e.message})` };
  }
}

export const MIGRATION_ACTIVITY = 'Migration von Word nach Specman';

export function buildFile({ planPath, extractPath, outPath, templatePath = DEFAULT_TEMPLATE, force = false, migration }) {
  if (existsSync(outPath) && !force) {
    return { ok: false, error: `Zieldatei existiert bereits: ${outPath} (nur mit --force überschreiben, vorher den Nutzer fragen).` };
  }
  const plan = readJson(planPath, 'Plan');
  if (plan.error) return { ok: false, error: plan.error };
  const extract = readJson(extractPath, 'Extract');
  if (extract.error) return { ok: false, error: extract.error };
  let templateText;
  try { templateText = readFileSync(templatePath, 'utf8'); } catch (e) {
    return { ok: false, error: `Vorlage nicht lesbar: ${templatePath} (${e.message})` };
  }

  const built = buildFromPlan({ templateText, plan: plan.value, extract: extract.value });
  if (!built.ok) return built;

  let text = built.text;
  if (built.historyRows) {
    const imported = importRows(text, { rows: built.historyRows });
    if (!imported.ok) return { ok: false, error: `Historie: ${imported.error}` };
    text = imported.text;
  }
  if (migration) {
    const appended = appendRow(text, {
      version: migration.version, activity: MIGRATION_ACTIVITY, author: migration.author,
      date: migration.date ?? todayDate(), followup: migration.followup,
    });
    if (!appended.ok) return { ok: false, error: `Migrationszeile: ${appended.error}` };
    text = appended.text;
  }
  writeFileSync(outPath, text);
  return {
    ok: true,
    out: outPath,
    summary: built.summary,
    historyRows: built.historyRows ? built.historyRows.length : 0,
    migrationRow: !!migration,
    ignored: built.ignored,
    reworded: built.reworded,
    warnings: built.warnings,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  for (const required of ['plan', 'extract', 'out']) {
    if (args[required] === undefined) { report({ ok: false, error: `--${required} ist Pflicht.` }, { json }); return; }
  }
  const flags = ['version', 'author', 'followup'].map((k) => args[`migration-${k}`]);
  if (flags.some((v) => v !== undefined) && flags.some((v) => v === undefined)) {
    report({ ok: false, error: '--migration-version, --migration-author und --migration-followup nur gemeinsam angeben.' }, { json });
    return;
  }
  const migration = flags[0] === undefined ? undefined : { version: flags[0], author: flags[1], followup: flags[2] };
  const result = buildFile({
    planPath: args.plan, extractPath: args.extract, outPath: args.out,
    templatePath: args.template, force: !!args.force, migration,
  });
  report(result, {
    json,
    plainText: (r) => `gebaut: ${r.out} (${r.summary.steps} Schritte, ${r.summary.images} Bilder, ${r.ignored.length} begründet ignoriert, ${r.summary.rewordedTexts} umformuliert)`,
  });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
