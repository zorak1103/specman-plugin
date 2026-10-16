#!/usr/bin/env node
// migrate-inventory.mjs — read-only overview for `migrate --all`: lists every .docx in a folder with
// what a migration has to deal with (paragraphs, tables, images, tracked changes) and what the
// target .nsd next to it currently looks like.
//
// Target status: `none` (free), `v2` (a V2 .nsd exists — would be overwritten), `legacy` (an .nsd
// exists but is not V2, e.g. V001 JSON — also would be overwritten, flagged separately because it
// cannot be re-read by the other nsd-* scripts), `working-copy` (Specman currently has a .wrk
// open for it — must be closed first).
//
// Usage: node migrate-inventory.mjs --dir <ordner> --json

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { extractDocx } from './lib/docx-reader.mjs';

export function targetStatus(nsdPath) {
  if (existsSync(`${nsdPath}.wrk`)) return 'working-copy';
  if (!existsSync(nsdPath)) return 'none';
  const firstLine = readFileSync(nsdPath, 'utf8').split('\n', 1)[0];
  return firstLine.includes('specman.model.v002.DiagramModel_V002') ? 'v2' : 'legacy';
}

export function inventory(dir) {
  const folder = resolve(dir);
  let names;
  try { names = readdirSync(folder); } catch (e) {
    return { ok: false, error: `Ordner nicht lesbar: ${folder} (${e.message})` };
  }
  const files = names
    .filter((n) => n.toLowerCase().endsWith('.docx') && !n.startsWith('~$'))
    .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }))
    .map((name) => {
      const docx = join(folder, name);
      const nsd = docx.replace(/\.docx$/i, '.nsd');
      const entry = { docx, nsd, target: targetStatus(nsd) };
      try {
        const { stats, warnings, history } = extractDocx(readFileSync(docx));
        Object.assign(entry, { stats, warnings, hasHistory: history !== null });
      } catch (e) {
        entry.error = e.message;
      }
      return entry;
    });
  return { ok: true, folder, files };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  if (!args.dir) { report({ ok: false, error: '--dir ist Pflicht.' }, { json }); return; }
  report(inventory(args.dir), {
    json,
    plainText: (r) => r.files.map((f) => `${f.target.padEnd(12)} ${f.docx}${f.stats ? ` (${f.stats.paragraphs} Abs., ${f.stats.tables} Tab., ${f.stats.images} Bilder)` : ' (FEHLER)'}`).join('\n'),
  });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
