// Guards against a regression class: a
// stray `disable-model-invocation` re-appearing, or a description losing its exclusion clause and
// quietly widening its trigger surface. Dependency-free by convention (no YAML parser in this
// plugin) -- reads each SKILL.md as text and regexes the frontmatter block.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['plan', 'edit', 'implement', 'sync-refs', 'migrate'];

function readFrontmatter(skill) {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  assert.ok(match, `${skill}/SKILL.md has no frontmatter block`);
  return match[1];
}

function readDescription(frontmatter) {
  const match = /description:\s*"([\s\S]*?)"\r?\n\S/.exec(`${frontmatter}\n---`);
  assert.ok(match, 'description field not found or not double-quoted');
  return match[1];
}

test('skills frontmatter: no skill carries disable-model-invocation', () => {
  for (const skill of SKILLS) {
    const frontmatter = readFrontmatter(skill);
    assert.doesNotMatch(frontmatter, /disable-model-invocation/, `${skill} has the flag`);
  }
});

test('skills frontmatter: every description names .nsd and carries an exclusion clause', () => {
  for (const skill of SKILLS) {
    const description = readDescription(readFrontmatter(skill));
    assert.match(description, /\.nsd/, `${skill}'s description no longer mentions .nsd`);
    assert.match(description, /Use only|Use whenever|Not for /, `${skill}'s description lost its exclusion clause`);
  }
});

test('skills frontmatter: plan, edit, implement, and migrate grant AskUserQuestion (sync-refs is fully automated by design)', () => {
  for (const skill of ['plan', 'edit', 'implement', 'migrate']) {
    const frontmatter = readFrontmatter(skill);
    assert.match(frontmatter, /^\s*-\s*AskUserQuestion\s*$/m, `${skill} lost the AskUserQuestion grant`);
  }
  assert.doesNotMatch(readFrontmatter('sync-refs'), /AskUserQuestion/, 'sync-refs unexpectedly grants AskUserQuestion');
});

test('skills frontmatter: edit never grants Write or Edit directly (mutation only via nsd-* scripts/subagent)', () => {
  const frontmatter = readFrontmatter('edit');
  assert.doesNotMatch(frontmatter, /^\s*-\s*Write\s*$/m, 'edit unexpectedly grants Write');
  assert.doesNotMatch(frontmatter, /^\s*-\s*Edit\s*$/m, 'edit unexpectedly grants Edit');
});

test('skills frontmatter: migrate never grants Edit (the .nsd is only produced by scripts; Write is for the plan file only)', () => {
  const frontmatter = readFrontmatter('migrate');
  assert.doesNotMatch(frontmatter, /^\s*-\s*Edit\s*$/m, 'migrate unexpectedly grants Edit');
});

test('skills content: migrate states the no-logic-lost rule', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'migrate', 'SKILL.md'), 'utf8');
  assert.match(text, /Keine Logik darf verloren gehen/);
});

test('skills content: migrate forbids the System:/User: step prefix', () => {
  const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', 'migrate', 'SKILL.md'), 'utf8');
  assert.match(text, /Formulierungen ohne Präfix `System:` \/ `User:`/);
});

// Skills that run the sanitizer must verify SPECMAN_JAR up front, before any file is touched —
// otherwise the user only learns about a missing/wrong jar after all the edits are done.
for (const skill of ['plan', 'edit', 'migrate']) {
  test(`skills content: ${skill} checks SPECMAN_JAR up front, before Schritt 1`, () => {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    const step0 = text.indexOf('## Schritt 0');
    const step1 = text.indexOf('## Schritt 1');
    assert.ok(step0 !== -1, `${skill}/SKILL.md has no "## Schritt 0" preflight section`);
    const preflight = text.slice(step0, step1 === -1 ? undefined : step1);
    assert.ok(step1 === -1 || step0 < step1, `${skill}: Schritt 0 must come before Schritt 1`);
    assert.match(preflight, /resolve-jar\.mjs/);
    assert.match(preflight, /warnings/, `${skill}: preflight must say what to do with warnings`);
  });
}

// sanitize.mjs may return a `warnings` array (jar older than 1.4, spec newer than the jar). The
// skills only surface it if their sanitize step says so.
for (const [skill, heading] of [['plan', '## Schritt 7'], ['edit', '## Schritt 6'], ['migrate', '## Schritt 7']]) {
  test(`skills content: ${skill} tells the agent to show sanitize warnings`, () => {
    const text = fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
    const start = text.indexOf(heading);
    assert.ok(start !== -1, `${skill}: ${heading} not found`);
    const next = text.indexOf('\n## ', start + 1);
    const section = text.slice(start, next === -1 ? undefined : next);
    assert.match(section, /sanitize\.mjs/);
    assert.match(section, /`warnings`/, `${skill}: sanitize step must mention the warnings field`);
  });
}
