---
name: plan
description: "Interviews the user to design a new Specman SUC (or sub-SUC) specification, then creates the .nsd file from the template by editing its text directly and validates it with the Specman sanitizer jar. Use only when a genuinely new specification needs to be created from scratch. Not for editing an existing .nsd (use edit) or for implementing code from one (use implement)."
argument-hint: "[--dir <spec-folder>] [--parent <suc-number>]"
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - AskUserQuestion
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# plan

Two phases: an interview (with a private working outline, never presented for approval), then
creating and sanitizing the actual `.nsd` (the only output that needs approval). You write the `.nsd`
text yourself against `${CLAUDE_PLUGIN_ROOT}/reference/SpecmanModel_V002.g4`; copy the shape of any
construct from `${CLAUDE_PLUGIN_ROOT}/reference/specman-reference-v1.4-model-v2.nsd`. The `edit` skill's
Step 3 and hard rules apply here as well.

## Step 0 — Prerequisite check: sanitizer jar

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-jar.mjs" --json
```

* `ok: false`: **Stop.** Relay `error` verbatim and ask the user to set `SPECMAN_JAR` to the full path
  of `specman-*-jar-with-dependencies.jar` (Specman 1.4.0+) and restart the session. Do not
  continue and do not "sanitize later".
* `ok: true` with `warnings`: show them and ask via `AskUserQuestion` whether to continue.

## Step 1 — Target folder and number

Ask for the folder if not given via `--dir` (project default: `.claude/specman.local.md` → `specDir`).
Find the next number yourself: `Glob` the folder recursively for `SUC-*.nsd`; the next top-level
number is the highest top-level `SUC-<n>` + 1; for `--parent <p>` it is `<p>.<k>` with `k` = highest
existing child index + 1. **Propose it, do not adopt it silently** — the user knows the right topic
range.

## Step 2 — Separate sub-SUC or not?

For a larger multi-part flow, ask one question whether a partial flow gets its own sub-SUC (separate
file, hierarchical name such as `SUC-902.4 <title>.nsd`) or stays a subsequence in this file.
Cross-references between SUC files are plain running text ("See SUC-902.1.2 <title>"), never a link.

## Step 3 — Interview

One point per follow-up question until clear: purpose; trigger/preconditions; actors; main flow
(step by step); exceptions/abort cases; postconditions/results; business rules / non-functional
requirements (optional). Prefer `AskUserQuestion` with options; otherwise open questions.

## Step 4 — Private working outline

Keep the interview state as a Markdown outline in the scratchpad directory. It is a tool for you —
never present it for approval; delete it after a successful sanitize.

## Step 5 — Create the file

`Read` the template `${CLAUDE_PLUGIN_ROOT}/reference/suc-template.nsd` and `Write` it to
`<folder>/SUC-<number> <title>.nsd` (no Bash copy). The template is German; its headings
(`Beschreibung` = description, `Geschäftsregeln` = business rules, `Akzeptanzkriterien` = acceptance
criteria, `Ablaufspezifikation` = flow specification, `Offene Punkte` = open items) stay.

## Step 6 — Fill the structure

With `Edit`, replace the template content with the interview results:

- Title: the intro heading `SUC-000 Template` → `SUC-<number> <title>`.
- Description, trigger and result lists, business rules, acceptance criteria as far as gathered.
- Flow: one `simple` step (or subsequence for complex parts) per main step; map conditions,
  case distinctions and loops to real `if`/`ifElse`/`case`/`while`/`doWhile` steps, tables/lists as
  real areas — not as running text. Every exception/abort case from the interview is a `break`
  (with a `catch` when the user wants the handling shown).
- Every new step: fresh 8-hex ID, unique in the file; the step number is a
  unique placeholder (not used by any other step) — the sanitizer renumbers.

## Step 6a — Initial document-history row

The template's history table has the row `0.1 | Initiale Erstellung | (empty) | (empty) | (empty)`
(activity, author, date). Resolve the author:
`node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --get author --json`; empty → ask for the
name, `--abbreviate-name "<full name>"`, confirm, `--set author --value "<name>"`. Then fill the empty
cells: author, today's date, follow-up action `Review` (only `-` if the user explicitly wants that);
version `0.1` and the activity stay.

## Step 7 — Sanitize

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <file> --json
```

`ERROR`/`ok: false`: fix the cause and run again. `OK`/`SANITIZED` (`stable: true`): delete the
outline. Show any `warnings`.

## Step 8 — Summary for approval

Show a plain-text summary (file name, main steps, open items) — **never the raw `.nsd`**. This is the
first and only approval point.
