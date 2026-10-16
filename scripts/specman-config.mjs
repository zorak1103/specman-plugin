#!/usr/bin/env node
// specman-config.mjs — reads/writes flat `key: value` entries in this plugin's local config file
// `.claude/specman.local.md` (same file/shape already documented for `specDir`/
// `defaultChangeset`). No YAML parser (see test/skills-frontmatter.test.mjs):
// a regex-based frontmatter reader/writer is enough for this file's shape, scalar lines only.
//
// The `edit` skill is deliberately never granted `Write`/`Edit` (test/skills-frontmatter.test.mjs
// enforces this) — persisting the author name still has to go through a script, so it rides the
// same `Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)` grant every other mutation already uses.
//
// Usage:
//   node specman-config.mjs --get <key> [--config <path>] --json
//   node specman-config.mjs --set <key> --value <value> [--config <path>] --json
//   node specman-config.mjs --abbreviate-name "<voller Name>" --json

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { isMainModule, report, parseArgs } from './lib/cli.mjs';

const DEFAULT_CONFIG_PATH = '.claude/specman.local.md';

function readFrontmatter(path) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) values[kv[1]] = kv[2].trim();
  }
  return values;
}

export function getConfigValue(path, key) {
  return readFrontmatter(path)[key];
}

export function setConfigValue(path, key, value) {
  const values = readFrontmatter(path);
  values[key] = value;
  const frontmatterLines = Object.entries(values).map(([k, v]) => `${k}: ${v}`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `---\n${frontmatterLines.join('\n')}\n---\n`);
}

// Last whitespace-separated token is the surname; every earlier token is abbreviated to its
// initial. A pure suggestion, confirmed by the caller before use — multi-word surnames ("von
// Neumann") are exactly the case where a human confirmation catches what this heuristic can't.
export function abbreviateName(fullName) {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  const surname = parts[parts.length - 1];
  const initials = parts.slice(0, -1).map((p) => `${Array.from(p)[0].toUpperCase()}.`).join(' ');
  return `${initials} ${surname}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = !!args.json;
  const configPath = args.config || DEFAULT_CONFIG_PATH;

  if (args['abbreviate-name'] !== undefined) {
    const abbreviated = abbreviateName(args['abbreviate-name']);
    report({ ok: true, abbreviated }, { json, plainText: (r) => r.abbreviated });
    return;
  }

  if (args.get !== undefined) {
    const value = getConfigValue(configPath, args.get);
    report({ ok: true, value: value ?? null }, { json, plainText: (r) => r.value ?? '' });
    return;
  }

  if (args.set !== undefined) {
    if (args.value === undefined) {
      report({ ok: false, error: '--set <key> braucht zusätzlich --value <wert>.' }, { json });
      return;
    }
    setConfigValue(configPath, args.set, args.value);
    report({ ok: true }, { json, plainText: () => 'gespeichert.' });
    return;
  }

  report({ ok: false, error: 'Erwarte --get <key>, --set <key> --value <wert>, oder --abbreviate-name "<Name>".' }, { json });
}

if (isMainModule(import.meta.url, process.argv[1])) main();
