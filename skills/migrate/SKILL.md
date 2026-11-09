---
name: migrate
description: "Migrates an existing Word (.docx) SUC specification to a Specman .nsd file next to it -- branches, loops and exceptions become structured steps, images become wireframes, the document history is carried over -- without losing any logic. Use only when an existing .docx specification should become a .nsd. Not for creating a new specification (use plan), editing an existing .nsd (use edit) or implementing code from one (use implement)."
argument-hint: "--file <docx> | --all [--dir <spec-folder>]"
allowed-tools:
  - Read
  - Write
  - AskUserQuestion
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# migrate

Migrates a Word specification (`.docx`) to Specman (`.nsd`). The `.nsd` is created **next to the
docx** under the same name (`SUC-220 Titel.docx` → `SUC-220 Titel.nsd`); the docx is never
modified.

The Word documents being migrated follow the German SUC template and are in German. Quoted German
phrases below (headings, trigger words, example sentences) are the patterns to look for in those
documents; an English gloss follows on first mention.

## No logic may be lost

This is the top rule of this skill — more important than a tidy structure:

* **Omit nothing, reword nothing, summarize nothing.** Every condition, rule, field description,
  error handling, number, table and design note of the docx is in the `.nsd` afterwards. Text comes
  from the extract via `ref`, not from memory. **Only exception:** branches are reworded into
  question + action in the branch (Step 4b) — only with the user's prior approval and only via the
  plan field `reworded`, never via `ignored`.
* **Invent nothing.** Own text is only allowed for headings that do not exist in the docx (e.g.
  branch labels `Ja`/`Nein`, the German "Yes"/"No") and for the approved rewordings from Step 4b.
  Anything new in substance, smoothed or "tidied up" does not go in.
* **Structure must not change logic.** Order, conditions and assignment (who does what, what
  happens when/otherwise) stay exactly as they are. If a branch is not clearly recognizable, the
  text stays as a simple step — better flat and complete than structured and wrong.
* **Technically enforced:** `nsd-build-from-plan.mjs` aborts as long as a paragraph or image of the
  docx is neither used nor listed in `ignored` with a reason; `migrate-verify.mjs` checks after the
  build that every paragraph appears in the result or is approved as `reworded`.
  **Never bypass these checks** (no domain content in `ignored`, no dropping of warnings).
* **Let nothing disappear silently:** Everything the target model cannot represent (merged table
  cells, nested lists, footnotes, text boxes, non-PNG images) goes into the report (Step 9) and is
  communicated to the user.

In addition, as everywhere in the plugin: **never write `.nsd` syntax by hand** — every mutation
goes through the scripts under `${CLAUDE_PLUGIN_ROOT}/scripts/`. If a capability is missing: stop
and tell the user, do not improvise.

Fixed decisions: tracked changes → **final state** (insertions stay, deletions are dropped);
**comments are ignored**; control flow is mapped **automatically** to
if/ifElse/case/while/`break`+catch; images are carried over as **wireframe images**; the docx
history is carried over and extended by one migration row.

## Step 0 — Prerequisite check: sanitizer jar

Before touching anything, check that the environment variable `SPECMAN_JAR` is correct — otherwise
the sanitizer step at the end only fails after the work is done:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-jar.mjs" --json
```

* `ok: false`: **Stop.** Pass `error` on to the user verbatim (variable missing, path does not
  exist, points to a directory or to something that is not a valid `.jar`) and ask them to set
  `SPECMAN_JAR` to the full path of `specman-*-jar-with-dependencies.jar` (Specman 1.4.0+) and to
  restart the Claude Code session. Do not continue, do not "sanitize later".
* `ok: true` with a non-empty `warnings`: show each warning to the user (e.g. jar older than
  Specman 1.4.0 or version not detectable) and ask via `AskUserQuestion` whether to continue
  anyway.
* `ok: true` without warnings: continue silently to Step 1.

## Step 1 — Target and scope

* `--file <docx>`: exactly this file.
* `--all` (optionally `--dir`, otherwise ask for the folder or use `specDir` from
  `.claude/specman.local.md`):

  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-inventory.mjs" --dir <ordner> --json
  ```

  Show an overview (files, paragraphs/tables/images, target status) and use `AskUserQuestion` to
  clarify which files to migrate. Process **files one after another** (Steps 2–10 per file); for a
  large scope, offer to continue the rest in a new session.

## Step 2 — Check the target file

Target = docx path with `.nsd`. Target status (`migrate-inventory.mjs`, or for `--file`
`resolve-target.mjs --file <target> --json`):

* `none`: continue.
* `v2` / `legacy`: a `.nsd` already exists → `AskUserQuestion` whether to overwrite it (for
  `legacy`, point out that it is not the V2 format). If "no", skip this file.
* `working-copy` (`.wrk` exists, the file is open in Specman): stop and ask the user to close it in
  Specman.

Overwriting happens later only with `--force`, and only after this confirmation.

**The `.wrk` can also appear after the first build** (the user opens the file in Specman and wants
to look at further changes there). Before **every** later rebuild, check Step 2 again. If there is
now a `.wrk`, the `.wrk` is the working version: there is no script that moves or deletes steps, so
proceed as follows:

1. Create a backup of the `.wrk` (e.g. `<name>.wrk.bak`).
2. Build the newly built `.nsd` at an intermediate location (not over the target file) and check it
   with `sanitize.mjs`.
3. Overwrite the `.wrk` with the result and sanitize again.
4. Explicitly ask the user to **reload** the file in Specman (or close and reopen it) — changes
   they made in Specman since the backup exist only in the backup.

Only do this after confirmation by the user; never overwrite a `.wrk` without a backup.

## Step 3 — Extract

Working folder: `C:/Users/<user>/.claude/tmp/scratch/migrate-<slug>/` (convention for transient
intermediate files from the user's global CLAUDE.md).

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/docx-extract.mjs" --file <docx> --out-dir <arbeitsordner> --json
```

Produces `extract.json`, `outline.txt` and `i<N>.<ext>` per image. Note the `warnings` of the
response (footnotes, text boxes, non-PNG images, OLE objects, …) — they go into the report.
`stats.comments` is ignored (comments are not part of the migration by design).

## Step 4 — Read the outline and derive the structure

Read `outline.txt` completely (`Read`). Each line carries the id (`p12`, `t3`, `i2`) the plan works
with. The docx follows the SUC layout: document history (`Dokumentenhistorie`) → header table
(title, description, actor(s), trigger/precondition, result/postcondition) → flow table
(`Nr. | Beteiligte | Text`, i.e. No. | Participants | Text; normal flow, then alternative
flow/exception handling) → business rules, non-functional requirements, open points, remarks, test
cases, design notes → sections "Wireframes"/"Fachklassenmodell" (domain class model) with images.

Mapping (details and schema: `${CLAUDE_PLUGIN_ROOT}/skills/migrate/plan-format.md` — **read it
before writing the plan**):

| docx | `.nsd` |
|---|---|
| Title/number | `number`/`title` |
| Description, actors, preconditions, postconditions | `intro.*` |
| Paragraph in style `Essential` (main step heading) | `subsequence`, with the steps below it |
| Flow row `USER`/`SYSTEM`/… | `simple` — just the sentence, **without** the `System:`/`User:` prefix (see below) |
| "Ist …, so …" (if …, then …) / "Andernfalls" (otherwise) / "Wenn … sonst …" (if … else …) | `if` / `ifElse` — head = question, action in the branch (Step 4b) |
| "Je nach …" (depending on …), case distinction with bullet list | `case` (default + ≥ 2 cases) |
| "Solange …" (as long as …), "für jeden …" (for each …), "wiederhole …" (repeat …) | `while` (or `doWhile` for "at least once") |
| "Exception …" / exception handling / abort | `break` in the flow + `catches` with the exception flow |
| Lists, field/condition tables in the step | `ref` to the paragraphs/table → areas of the step |
| Business rules, non-functional requirements, remarks, design notes | `outro.*` |
| Open points (table, `Offene Punkte`) | `outro.openPoints` |
| Images (inline in the step or under "Wireframes"/"Fachklassenmodell") | image area on the step or `outro.sections` |

Rules:

* **Formulations without the `System:` / `User:` prefix.** Step texts do not start with the
  participant (neither `System:`, `User:`, nor bold or in capital letters); the sentence stands on
  its own ("The system shows …", "If the user wants …"). The participants cell of the flow table is
  therefore **not** put in front of the text but listed in `ignored` (reason: "Participant is
  stated in the sentence"). The plan field `label` is not used for participants — the builder
  rejects `System`/`User` as `label`. If a sentence does not name its actor (no "System"/"User" or
  similar in the sentence), that is no reason for a prefix: leave the sentence unchanged and name
  the place in the report so the user can decide.
* **Branches are question + action.** The head of `if`/`ifElse` is a question ("Are there already
  selections for the balance sheet?"); each branch (`Ja`/`Nein`, i.e. Yes/No) contains the action
  that is then performed. If condition and consequence are in one paragraph, it is **not** used as
  a whole as the head but split into question and branch action — that is a rewording and goes
  through Step 4b.
* **Keep it flat conservatively** where there is no real branch: "Möchte der User …" (the user
  wants to … — trigger of an action), inline "bzw." (or) and "Wenn … dann" (if … then) in notes.
  Real branches are e.g. "Sofern … / Andernfalls …" (provided that … / otherwise …) or "Liegen … vor?
  … sonst …" (are … present? … otherwise …).
* **No bullet points for single steps.** A bullet point of the docx that is migrated as its own step
  (e.g. a branch of a branching) is normal step text, not a single-item list with an empty head: set
  `"flatLists": true` on the `ref`. The build warns about a step with empty step text. Several
  related bullet points may remain a list.
* **Notes** ("Anmerkung: …") stay attached to the step: via `areas` with `kind: "text"` and `ref`
  if the head of the step is its own text.
* **References to numbered alternatives** ("Für 1, 2 und 3 gilt …", "Für 4 gilt …" — i.e. "For 1, 2
  and 3 the following applies …") refer to a list in the previous step. Such references are
  reworded into a question (Step 4b) and appear in the report under the rewordings — never adopt
  them unchanged as a branch head if the reference is no longer unambiguous in the result.
* An exception that the flow refers to becomes a `break` step (assign an `id`); the exception flow
  of the docx moves into the corresponding `catches` entry of the enclosing container.
* Images: position in the docx decides — image in/next to a flow step → area of that step, image
  under a section heading → `outro.sections` with the same heading. Only specify scaling if the
  default (width relative to the diagram) obviously does not fit. If an image is not a PNG, ask the
  user for a PNG conversion (`pngFile`).
* Doubtful cases (is this really a branch? does the image belong here?) are clarified **in a
  batch** via `AskUserQuestion` before the plan is written — or conservatively left flat and named
  in the report.

## Step 4b — Review wordings and get them approved

In **every** migration (not only for branches), go through the wordings of the step texts: unclear
sentences, missing actor, branches without a question. Nothing is changed without asking.

* For each branch that is to be rebuilt into question + action, **propose concrete wordings**:
  original paragraph → question (head) → action per branch. Present all proposals **in a batch**
  via `AskUserQuestion` (accept / word differently / leave flat) — **before** the plan is written.
* Approved rewordings: question and branch action go into the plan as own text (`"Text"`), the
  replaced original paragraphs go into **`reworded`** (`reason`: "Deliberately reworded into
  question/action (user approval)") — not into `ignored`.
* **Check for duplicates before the plan is created:**
  * Identical conditions in consecutive steps ("Für 1, 2 und 3 gilt …" / "Für 4 gilt …" in two
    steps) are **one** branch, not two. Never adopt them twice 1:1.
  * Compare similar blocks (e.g. data lists) **paragraph by paragraph**. Present differences (such
    as a deviating industry code) **in a batch** via `AskUserQuestion`. Only verbatim duplicates or
    ones approved by the user are merged; the replaced paragraphs then go into `reworded` (with a
    reference to the retained paragraph in the `reason`), never into `ignored`.
* Not approved: adopt the paragraph unchanged via `ref` (flat, complete).
* Other oddities without a rewording belong in the report (Step 9), not in the plan.

## Step 5 — Write the plan

Write the plan as `plan.json` into the working folder (`Write`). Content only via `ref`/keywords of
the plan format; **every** id from `outline.txt` is either used or listed in `ignored` with a
reason (`reason`) — and `ignored` is only for labels, empty cells and structural elements that the
template itself brings along, never for domain content. Rewordings approved by the user (Step 4b)
go into `reworded`.

## Step 6 — Build

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-build-from-plan.mjs" --plan <plan.json> --extract <extract.json> --out <ziel.nsd> [--force] --json
```

* `unreferenced` in the error: this content is missing from the plan. **Fix the plan** (use it), do
  not argue it away — unless it really is pure structure. If own text stands in place of a
  paragraph, that paragraph belongs in `reworded` only if the user agreed in Step 4b.
* Other errors (empty body, `case` with < 2 cases, unknown id, …): adjust the plan, build again.
* Note the `warnings` (resolved merged cells, flattened lists, steps with empty step text) and
  `summary.defaultedBranchHeads` for the report; add missing branch labels if the docx provides
  some.
* **Every rebuild with `--force` rewrites the history from the extract.** As soon as version, author
  and follow-up action from Step 8 are settled, pass `--migration-version <v> --migration-author
  "<Name>" --migration-followup <-|Review>` when building (all three together): the migration row
  is then written right away and is not lost on rebuilds.

## Step 7 — Sanitize and verify

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <ziel.nsd> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-verify.mjs" --extract <extract.json> --nsd <ziel.nsd> --plan <plan.json> --json
```

* `ERROR` from the sanitizer: fix the cause in the plan, rebuild (`--force`), try again. Never leave
  a faulty file in place. If `SPECMAN_JAR` is not set, the sanitizer aborts:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-jar.mjs" --json` confirms that (it only reads the
  environment variable and does not search itself). Then ask the user whether to search for the JAR,
  and let them name or confirm the path (see README) — sanitizing is not skipped.
* `warnings` in the sanitizer response (with any status): show each warning to the user (jar too
  old, specification from a newer Specman than the jar).
* `stepNumberChanges` in the sanitizer response: the sanitizer has shifted step numbers. Harmless
  for a fresh migration. If an already migrated `.nsd` is rebuilt and code comments refer to its
  step numbers, suggest `sync-refs` afterwards.
* `migrate-verify` with `ok:false`: `missing` (paragraphs that are missing in the `.nsd`), deviating
  image or step count. Fix the plan and repeat from Step 6. At most three passes; after that,
  present the state and the open gaps to the user instead of guessing on. `reworded` in the
  response lists the approved rewordings — they go into the report separately.
* Working directory and shell state are reset after every Bash call: use **absolute paths**.

## Step 8 — Migration row in the history

The history of the docx is already in the file 1:1. Add **one** additional row for the migration:

1. Author: `node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --get author --json`. Empty →
   **ask for the name as free text** (a single option is not enough for `AskUserQuestion`), have it
   abbreviated (`--abbreviate-name`), confirm, remember with `--set author` (as in the `plan`
   skill). Never assume a name without asking.
2. `node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-history.mjs" --file <ziel.nsd> --mode read --json` →
   determine the highest version that parses as `<int>.<int>` (ignore `-` rows).
3. `AskUserQuestion` with **version** and **follow-up action** (`-` or `Review`). **Derive the
   version-counting pattern from the last rows**, do not blindly suggest `x.(y+1)`: does the history
   count in major versions (`5.1`, `6.1` → suggest `7.1`) or in minor versions (`2.1`, `2.2` →
   `2.3`)? Offer the derived pattern as the first option and the alternative as the second; without
   a parsable previous version, ask openly.
4. Write the row and sanitize again — **only** if the file was built without the `--migration-*`
   flags; otherwise the row is already there (Step 6), and only sanitizing remains:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-history.mjs" --file <ziel.nsd> --mode append --version <v> --activity "Migration von Word nach Specman" --author "<Name>" --followup <-|Review> --json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <ziel.nsd> --json
   ```

   (The history table columns are `Aktivität`/`Autor`/`Datum` — activity/author/date; the scripts
   also accept the English headers Activity/Author/Date. The activity text is written verbatim and
   stays German like the rest of the history; `Review` is the German-template follow-up value.)

**Never write a review row** — a review is a manual process.

For rebuilds (Step 6, e.g. after corrections from the report), pass the same `--migration-*` values
again — version and follow-up action are not asked for again.

## Step 9 — Report for approval

Plain-text summary per file — **never show the raw `.nsd`**:

* Target file, number of steps (leaf/structure) and which branches/loops/exceptions were detected
  (briefly, with step heading)
* Images (count, where to)
* History (carried-over rows + migration row)
* **Result of the fidelity check** (`checkedParagraphs`, `missing` empty?)
* **Approved rewordings** (`reworded` from build/verify) as a separate section: per entry original
  paragraph → new wording. Do not mix with the ignored texts.
* **Everything not representable and all warnings** (merged cells, flattened lists, footnotes, text
  boxes, non-PNG images, defaulted branch labels)
* **List of ignored texts**, grouped by reason (`ignored` from the build response), so the user sees
  what was deliberately not carried over as its own content
* open doubtful cases

This is the first and only approval point per file. The working folder under `.claude/tmp/scratch/`
stays in place for follow-up questions (images and `extract.json`); name the path.
