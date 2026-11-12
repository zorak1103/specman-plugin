// Guards against a regression class: a
// stray `disable-model-invocation` re-appearing, a description losing its exclusion clause and
// quietly widening its trigger surface, or a skill pointing at a script that no longer exists.
// Dependency-free by convention (no YAML parser in this plugin) -- reads each SKILL.md as text and
// regexes the frontmatter block.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = ['plan', 'edit', 'implement', 'sync-refs'];

function readSkill(skill) {
  return fs.readFileSync(path.join(PLUGIN_ROOT, 'skills', skill, 'SKILL.md'), 'utf8');
}

function readFrontmatter(skill) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readSkill(skill));
  assert.ok(match, `${skill}/SKILL.md has no frontmatter block`);
  return match[1];
}

function readDescription(frontmatter) {
  const match = /description:\s*"([\s\S]*?)"\r?\n\S/.exec(`${frontmatter}\n---`);
  assert.ok(match, 'description field not found or not double-quoted');
  return match[1];
}

test('skills: exactly plan, edit, implement and sync-refs exist', () => {
  const dirs = fs.readdirSync(path.join(PLUGIN_ROOT, 'skills')).sort();
  assert.deepEqual(dirs, [...SKILLS].sort());
});

test('skills frontmatter: no skill carries disable-model-invocation', () => {
  for (const skill of SKILLS) {
    assert.doesNotMatch(readFrontmatter(skill), /disable-model-invocation/, `${skill} has the flag`);
  }
});

test('skills frontmatter: every description names .nsd and carries an exclusion clause', () => {
  for (const skill of SKILLS) {
    const description = readDescription(readFrontmatter(skill));
    assert.match(description, /\.nsd/, `${skill}'s description no longer mentions .nsd`);
    assert.match(description, /Use only|Use whenever|Not for /, `${skill}'s description lost its exclusion clause`);
  }
});

test('skills frontmatter: plan, edit and implement grant AskUserQuestion (sync-refs is fully automated by design)', () => {
  for (const skill of ['plan', 'edit', 'implement']) {
    assert.match(readFrontmatter(skill), /^\s*-\s*AskUserQuestion\s*$/m, `${skill} lost the AskUserQuestion grant`);
  }
  assert.doesNotMatch(readFrontmatter('sync-refs'), /AskUserQuestion/, 'sync-refs unexpectedly grants AskUserQuestion');
});

test('skills frontmatter: edit and plan edit .nsd text directly (grant Edit and Write), no subagent', () => {
  for (const skill of ['edit', 'plan']) {
    const frontmatter = readFrontmatter(skill);
    assert.match(frontmatter, /^\s*-\s*Edit\s*$/m, `${skill} lost the Edit grant`);
    assert.match(frontmatter, /^\s*-\s*Write\s*$/m, `${skill} lost the Write grant`);
    assert.doesNotMatch(frontmatter, /Agent\(/, `${skill} unexpectedly grants a subagent`);
  }
});

test('skills content: implement never edits the .nsd itself', () => {
  assert.match(readSkill('implement'), /Never modify the `\.nsd` itself/);
});

test('skills content: no skill references a removed script, agent or the migrate pipeline', () => {
  const removed = /nsd-(area|catch|set-text|locate|insert|history|mark|diff|plantuml|edit-settings|build)|docx|migrate-|resolve-target|resolve-suc-number|specman-nsd-editor/;
  for (const skill of SKILLS) {
    assert.doesNotMatch(readSkill(skill), removed, `${skill}/SKILL.md references a removed component`);
  }
});

// Skills that write a .nsd must verify SPECMAN_JAR up front, before any file is touched —
// otherwise the user only learns about a missing/wrong jar after all the edits are done.
for (const skill of ['plan', 'edit']) {
  test(`skills content: ${skill} checks SPECMAN_JAR up front, before Step 1`, () => {
    const text = readSkill(skill);
    const step0 = text.indexOf('## Step 0');
    const step1 = text.indexOf('## Step 1');
    assert.ok(step0 !== -1, `${skill}/SKILL.md has no "## Step 0" preflight section`);
    const preflight = text.slice(step0, step1 === -1 ? undefined : step1);
    assert.ok(step1 === -1 || step0 < step1, `${skill}: Step 0 must come before Step 1`);
    assert.match(preflight, /resolve-jar\.mjs/);
    assert.match(preflight, /SPECMAN_JAR/);
    assert.match(preflight, /warnings/, `${skill}: preflight must say what to do with warnings`);
  });
}

// sanitize.mjs may return a `warnings` array (jar older than 1.4, spec newer than the jar). The
// skills only surface it if their sanitize step says so.
for (const [skill, heading] of [['plan', '## Step 7'], ['edit', '## Step 6']]) {
  test(`skills content: ${skill} tells the agent to run sanitize and show its warnings`, () => {
    const text = readSkill(skill);
    const start = text.indexOf(heading);
    assert.ok(start !== -1, `${skill}: ${heading} not found`);
    const next = text.indexOf('\n## ', start + 1);
    const section = text.slice(start, next === -1 ? undefined : next);
    assert.match(section, /sanitize\.mjs/);
    assert.match(section, /`warnings`/, `${skill}: sanitize step must mention the warnings field`);
  });
}

test('skills content: edit states the .wrk rule and the change-mark refusals', () => {
  const text = readSkill('edit');
  assert.match(text, /\.nsd\.wrk/);
  assert.match(text, /\*\*Refuse\*\*/);
  assert.match(text, /`source`\/`target` move marks/);
});

test('skills content: edit marks added elements with change= only (no hand-computed markups) and covers nested children', () => {
  const text = readSkill('edit');
  assert.doesNotMatch(text, /markups=\[\(0,/, 'edit must not tell Claude to write markups offsets');
  assert.match(text, /every nested element/i, 'edit must say that children of an added element get their own mark');
});

test('skills content: edit and plan say a new step number is a unique placeholder', () => {
  for (const skill of ['edit', 'plan']) {
    assert.match(readSkill(skill), /unique placeholder/, `${skill} must call new step numbers a unique placeholder`);
  }
});
