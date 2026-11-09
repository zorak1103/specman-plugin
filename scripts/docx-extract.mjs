#!/usr/bin/env node
// docx-extract.mjs — reads a Word specification (.docx) and writes everything the migration needs
// into a caller-chosen, empty-or-new output directory:
//   extract.json   id-addressed block tree (paragraphs p<N>, tables t<N>, images i<N>) with run
//                  formatting, list info, table structure and the detected history table
//   outline.txt    the same tree as readable text — this is what a migration plan is written from
//   i<N>.<ext>     one file per embedded image (names are generated, never taken from the archive)
// The .docx itself is only ever read. Tracked changes are extracted in their final state, comments
// are ignored (see lib/docx-reader.mjs).
//
// Usage: node docx-extract.mjs --file <datei.docx> --out-dir <ordner> --json

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';
import { extractDocx, renderOutline } from './lib/docx-reader.mjs';

export function extractToDir(docxPath, outDir) {
  let buffer;
  try { buffer = readFileSync(docxPath); } catch (e) {
    return { ok: false, error: `File not readable: ${docxPath} (${e.message})` };
  }
  const absoluteOut = resolve(outDir);
  mkdirSync(absoluteOut, { recursive: true });

  let extract;
  try {
    extract = extractDocx(buffer, {
      imageSink: (name, bytes) => {
        const path = join(absoluteOut, name);
        writeFileSync(path, bytes);
        return path;
      },
    });
  } catch (e) {
    return { ok: false, error: `docx not readable: ${e.message}` };
  }

  const extractPath = join(absoluteOut, 'extract.json');
  const outlinePath = join(absoluteOut, 'outline.txt');
  writeFileSync(extractPath, JSON.stringify({ source: resolve(docxPath), ...extract }, null, 1));
  writeFileSync(outlinePath, `${renderOutline(extract.blocks).join('\n')}\n`);

  return {
    ok: true,
    extractPath,
    outlinePath,
    stats: extract.stats,
    imageFiles: extract.images.map((i) => ({ id: i.id, file: i.file, ext: i.ext })),
    history: extract.history ? { tableId: extract.history.tableId, rowCount: extract.history.rows.length } : null,
    warnings: extract.warnings,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  for (const required of ['file', 'out-dir']) {
    if (args[required] === undefined) { report({ ok: false, error: `--${required} is required.` }, { json }); return; }
  }
  const result = extractToDir(args.file, args['out-dir']);
  report(result, {
    json,
    plainText: (r) => `extracted: ${r.stats.paragraphs} paragraphs, ${r.stats.tables} tables, ${r.stats.images} images → ${r.outlinePath}`,
  });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
