---
name: edit
description: "Applies a targeted edit (text change, new or removed step, list/table/text area change, PlantUML diagram source change, catch block, or an added/removed change mark) to an existing Specman .nsd specification by editing the .nsd text directly against the Specman grammar, then validates it with the Specman sanitizer jar. Use only when a specific existing .nsd file needs a scoped change. Not for creating a new specification (use plan) or for implementing code from one (use implement)."
argument-hint: "<file> <what to change>"
allowed-tools:
  - Read
  - Edit
  - Write
  - Grep
  - Glob
  - AskUserQuestion
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# edit

You edit the `.nsd` text yourself — there are no editing scripts. The grammar is
`${CLAUDE_PLUGIN_ROOT}/reference/SpecmanModel_V002.g4`; a complete worked example of every construct
is `${CLAUDE_PLUGIN_ROOT}/reference/specman-reference-v1.4-model-v2.nsd`. Before writing a construct
you have not used in this file, find it in the reference and copy its shape. The Specman jar
(`sanitize.mjs`) is the safety net — but it does **not** catch everything (see Hard rules).

## Step 0 — Prerequisite check: sanitizer jar

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-jar.mjs" --json
```

* `ok: false`: **Stop.** Relay `error` verbatim and ask the user to set `SPECMAN_JAR` to the full path
  of `specman-*-jar-with-dependencies.jar` (Specman 1.4.0+) and restart the session. Do not edit
  anything, and never "sanitize later".
* `ok: true` with `warnings`: show them and ask via `AskUserQuestion` whether to continue.

## Step 1 — Pick the file

If `<file>.nsd.wrk` exists, the spec is open in Specman: read and edit the **`.wrk`** (saving in
Specman would otherwise overwrite your change with stale content), and sanitize the `.wrk`. Without a
`.wrk`, use the `.nsd`. Read the whole file first. If the header comment names an old `modelType`
(V001), stop: the user must open and save it once in Specman 1.3.0+.

## Step 2 — Check change tracking

Look at `changeModeEnabled` in the `settings { }` block. If `true`, every content change must be
tracked (Step 4); if you cannot track a requested change with the allowed marks, **say so and stop** —
do not edit it untracked. If `false`/missing, edit plainly.

## Step 3 — Edit

Use `Edit` on the `.nsd` text, one construct at a time.

- Text fields are backtick-quoted HTML (`` `...` ``); keep the surrounding markup of the node you
  change, replace only the visible text. A literal backtick inside text must be escaped as the
  reference shows.
- Step lines are `kind(stepNum, stepId, `html`, plain=`...`, ...)`. A **new step** needs a fresh ID: 8
  lower-case hex characters, unique in the diagram (check with `Grep`). The step number is a
  **unique placeholder** (a number no other step uses — catch blocks and steplinks refer to step
  numbers); the sanitizer renumbers (re-read the file after sanitize before quoting numbers).
- Structured steps (`while`, `doWhile`, `if`, `ifElse`, `case`, `subsequence`) have mandatory
  branches/bodies — copy the full shape from the reference, including every branch.
- Tables, lists and text areas live in a step's tail (`{ ... }` after the step line); copy
  `table(...) { row { cell(..) | cell(..) } }`, `list(...) { item(..) }` and `text(..)` from the
  reference.
- A `catch` block belongs to a `break`; add one only on request (a `break` without catch is valid).
- PlantUML: the diagram is an `image(..., type=plantuml) { `source` }` area — change only the source
  text; never touch `backup=`.
- Intro/outro are normal steps (`intro(...)`, `outro(...)`): the title is the first heading of the
  intro.

## Step 4 — Change marks (only when `changeModeEnabled=true`)

Allowed: whole-element `change=` marks only, never `markups=` (offsets are unvalidated and easy to get
wrong) —
- added step/item/area/cell: `change=(added, <changeSetName>)`; `changeSetName` is in `settings`.
  Mark **every nested element** of an added construct as well: the branches and inner steps of an added
  `ifElse`/`if`/`case`, every cell of an added table, every item of an added list (reference steps 26,
  38 and 39 show the shape).
- removed step/item/area: keep the element, add `change=(removed, <changeSetName>)` (reference step 8).

**Refuse** (say so, stop): `source`/`target` move marks, any other `markups=` offsets, text-run
changes inside an existing element, and anything touching `backup=`. Tell the user to make that
change in Specman itself.

## Step 5 — Hard rules (what the jar does not catch)

- Never hand-write a *different* `plain=` than the visible text; the sanitizer regenerates it, so a
  wrong one is silently rewritten — but never rely on it for anything else.
- Never create or move `source`/`target` marks, never edit `sourceStep=`; the jar accepts broken links
  and Specman then fails on load.
- Do not edit text that carries `Steplink` markups (offsets would move silently) — ask first. Never
  create steplinks by hand.
- Step IDs: 8 lower-case hex, never reused, keep existing IDs when editing a step.

## Step 6 — Sanitize

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <the file you edited> --json
```

It rewrites the file **in place**. `OK`/`SANITIZED` with `stable: true` is done (report
`stepNumberChanges` briefly; `plainTextFieldsRefreshed > 0` is normal). `ERROR` or `ok: false`: read
`message`, fix the cause and run again; if you cannot fix it, revert your edit and tell the user.
Never leave a failing file. Show any `warnings`. Re-read the file before you quote step numbers.

## Step 7 — History entry

After a successful sanitize, add **one** row for the whole pass to the document-history table in
`intro` (columns Activity/Author/Date, German template: Aktivität/Autor/Datum; row shape in
`reference/suc-template.nsd`).

1. Author: `node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --get author --json`. Empty → ask,
   `--abbreviate-name "<full name>"`, confirm, then `--set author --value "<name>"`.
2. Version: highest `<int>.<int>` in the table. Suggest `x.(y+1)` for wording-only changes,
   `(x+1).1` for new/removed steps or a changed flow; confirm via `AskUserQuestion`.
3. Activity: one short noun phrase for the whole pass, no step numbers.
4. Follow-up action: ask (`-` or `Review`).
5. Append the row (copy an existing row's markup), then sanitize again.

Never write a review row yourself.
