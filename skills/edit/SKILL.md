---
name: edit
description: "Applies a targeted edit (text change, intro/outro title, section or list/table content, new leaf or structured step, catch block for a break, table/list/text area insert or row/item append/remove, PlantUML diagram read/change/create, or added/removed change mark) to an existing Specman .nsd specification, using this plugin's AST scripts, then sanitizes the result. Use only when a specific existing .nsd file needs a scoped change. Not for creating a new specification (use plan) or for implementing code from one (use implement)."
argument-hint: "<file> <what to change>"
allowed-tools:
  - Read
  - AskUserQuestion
  - Agent(specman:specman-nsd-editor)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# edit

Core principle of this plugin: scripts handle the DSL mechanics (backtick escaping, bracket
nesting, character offsets); the model only decides on content and addressing. Never construct
`.nsd` syntax by hand — every change goes through the `nsd-*` scripts under
`${CLAUDE_PLUGIN_ROOT}/scripts/`.

## Step 0 — Prerequisite check: sanitizer jar

Before touching anything, check that the `SPECMAN_JAR` environment variable is valid — otherwise
the sanitizer step at the end only fails after the work is done:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-jar.mjs" --json
```

* `ok: false`: **Stop.** Relay `error` to the user verbatim (variable missing, path does not
  exist, points to a directory or to an invalid `.jar`) and ask them to set `SPECMAN_JAR` to the
  full path of the `specman-*-jar-with-dependencies.jar` (Specman 1.4.0+) and restart the
  Claude Code session. Do not continue, and do not "sanitize later".
* `ok: true` with a non-empty `warnings`: show each warning to the user (e.g. jar older than
  Specman 1.4.0 or version not detectable) and ask via `AskUserQuestion` whether to continue
  anyway.
* `ok: true` without warnings: continue silently to Step 1.

## Step 1 — Resolve the target file

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-target.mjs" --file <path-to-nsd> --json
```

A result of `usingWorkingCopy: true` means the file is currently open in Specman (autoload
active). **From here on always use the returned `path`** (the `.wrk`), never the original `.nsd`
— otherwise saving in Specman would overwrite a `.wrk`-only change with the old state.

## Step 2 — Inspect the current state

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-locate.mjs" --file <target> --json
```

- If the call fails with a hint about `modelType`/V001: the file is in the old format. Stop — tell
  the user the file must be opened and saved once in Specman 1.3.0+ before it can be edited here.
- Otherwise check `settings.changeModeEnabled`. `false` or missing → `AskUserQuestion`
  (`header: "Tracking"`) asking whether change tracking should be enabled for this edit. No
  script currently sets this setting itself — it is a Specman UI setting. If the user agrees,
  note that in the conversation and still make the change without `change=`/`markups=`, telling
  them they should set `changeModeEnabled=true` once in Specman itself; if they decline, proceed
  without tracking.
- Remember `settings.changeSetName` as the default changeset in case none is named explicitly.

Then search specifically for the affected step(s):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-locate.mjs" --file <target> --step <number-or-id> --json
```

This returns `areas` (addressable text areas: `head`, `tail[n]`, `tail[n].items[i]`,
`tail[n].rows[r].cells[c]`, and for structured steps additionally `ifBranch.head`/`elseBranch.head`/
`defaultBranch.head`/`caseBranch[n].head`), `tailAreas` (the tail areas themselves as whole
building blocks — `tail[n]` with `kind: text|list|table|image`, for `list` additionally `ordered`/
`itemCount`, for `table` additionally `rowCount`/`colCount`, for `image` additionally `imageType`
(`png|plantuml|svg`, so PlantUML diagrams can be found) — the basis for insert/append/remove
in Step 4) and `sequences` (valid insertion targets for new steps).

Instead of a step, `--step` also accepts `intro` or `outro` (alias `--block`): title,
description, trigger/result lists (intro) as well as business rules, acceptance criteria,
open-items table, remarks (outro) live there. The response then contains `block` instead of
`step`, the same `areas`/`tailAreas`, and additionally `sections` (per text block an `areaKey` +
the `heading`s it contains). Without `--step`, `nsd-locate` also returns `blocks`,
`catches` (per catch: `ownerKey`, `breakStepId`, `bodyKey`) and `uncaughtBreaks` (break steps
without a catch).

**Take every `key` verbatim from this output** — never construct a path yourself. After every
structural change to a tail (area inserted/removed, row/item inserted/removed), subsequent
`tail[n]` indices shift — call `nsd-locate.mjs --step <id>` again before the next addressing,
never keep using an old key.

Note: the vendored SUC template (`reference/suc-template.nsd`) is German, so freshly planned
specs carry German section headings (e.g. `Beschreibung` = description, `Geschäftsregeln` =
business rules, `Akzeptanzkriterien` = acceptance criteria). Use the headings exactly as
`sections` reports them.

## Step 3 — Main thread or subagent?

- **Up to 2 related addresses in the same task:** continue directly here (Step 4).
- **From 3 addresses on, or when this edit comes up in the middle of an unrelated conversation**
  (the main context already carries a lot of unrelated history): `Agent
  (specman:specman-nsd-editor)` with a concise, fully worded task — file, the exact `key` values
  from Step 2, and the desired new content (for a PlantUML diagram: the complete final source,
written by you beforehand). The subagent makes no design decisions, only
  executes.

## Step 4 — Apply the change

**Replace text:**
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <target> --step <id|intro|outro> --area <key> --html <newHtml> --json
```
`head` and the text blocks of `intro`/`outro` bundle headings and paragraphs in one HTML block —
`--html` replaces it completely. To change only part of it, use instead:
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <target> --step intro --title "<title>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <target> --step <intro|outro> --area <head|tail[n]> --section "<heading from sections>" --text "<plain text, \n = new paragraph>" --json
```
`--title` replaces only the h1 (spec title, intro only); `--section`/`--text` replaces only the
paragraph under a heading. Both expect plain text and escape it themselves. A freshly planned
template carries the title `SUC-000 Template` — it must be set via `--title`.
Never writes `plain=` (the sanitizer regenerates it) and automatically deletes old `markups=` on
the changed area, since their offsets referred to the old text.

**Insert a new step** (leaf: `simple`/`break`; structured: `while`/`doWhile`/`subsequence`/
`if`/`ifElse`/`case`):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-insert-step.mjs" --file <target> --parent <sequence-key> --position start|end|after:<stepId> --kind <kind> [--branches <n>] --html <html> --json
```
With `--id <8 hex>` the step keeps a given ID (needed when it moves over from another spec and
code references `SUC-xxx Step N (ID: ...)` should stay stable); the ID must be unique across the
whole diagram, otherwise the script aborts. Without `--id` a new one is always assigned.

The assigned number is a placeholder number — the sanitizer in the next step renumbers everything.
**Never overwrite the number of an already existing, referenced step by hand** — that breaks
existing steplink resolution. New steps always get a new number, never a reused one.

For a structured child, the script automatically fills every branch/body that the grammar
requires with a placeholder (`case` additionally needs `--branches`, default 2, at least 2 case
branches besides the default branch) — the response returns `insertedStepId` and
`placeholderStepIds`. **Fill these placeholders immediately**, before the edit counts as
complete:
- Branch headings via `nsd-set-text.mjs --step <insertedStepId> --area ifBranch.head|elseBranch.head|defaultBranch.head|caseBranch[n].head`
  (keys come from `nsd-locate.mjs --step <insertedStepId>`; as with every other area key, never
  construct them yourself).
- Every placeholder leaf step from `placeholderStepIds` via `nsd-set-text.mjs --step <id> --area head`.

**Insert, append, remove a table/list/text block** (for steps and for `--step intro|outro`; tail
areas themselves, not text inside an already existing area — that is what `nsd-set-text.mjs` is
for):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <target> --step <id> --op insert --kind text  --position start|end|after:tail[i] --html <html> [--changeset <cs>] --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <target> --step <id> --op insert --kind list  --position <pos> --ordered true|false --items '["h1","h2"]' [--changeset <cs>] --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <target> --step <id> --op insert --kind table --position <pos> --rows '[["h1","h2"],["a","b"]]' [--cols '["30%","70%"]'] [--width <percent>] [--changeset <cs>] --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <target> --step <id> --op add-row  --area <tail-key> --position start|end|after:<rowIndex>  --cells '["a","b"]' --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <target> --step <id> --op add-item --area <tail-key> --position start|end|after:<itemIndex> --html <html> [--changeset <cs>] --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <target> --step <id> --op remove      --area <tail-key>              [--changeset <cs>] --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <target> --step <id> --op remove-item --area <tail-key>.items[j]     [--changeset <cs>] --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <target> --step <id> --op remove-row  --area <tail-key>.rows[r]      --json
```
New sections with a heading (e.g. "acceptance criteria" in the outro) are created with
`--op insert --kind text --heading "<heading>" [--text "<paragraphs>"]` instead of `--html`;
multiple tail areas (table, text, table) via `--position after:tail[i]`.

`--rows`/`--items`/`--cols`/`--cells` are JSON arrays passed as a string. `insert` returns
`areaKey` (the new `tail[n]`), for `list` additionally `itemAreaKeys`, for `table` additionally
`cellAreaKeys` — refine these immediately via `nsd-set-text.mjs` if the cell/item contents still
need formatted HTML instead of plain text. `--rows` must be rectangular (every row with the same
number of cells); `--cols`/`--width` are percentage values like `30%`.

Tracking asymmetry from the grammar (not this plugin's decision): `text` and `table` areas can
be marked as `added`/`removed` as a whole area with `--changeset`, but a `list` area itself
cannot — there each `item` carries its own `change`, never the list as a whole (`insert --kind
list --changeset` therefore marks each initial item individually). Table rows (`tableRow`) have
no `change` slot at all: `add-row` always inserts untracked (the response carries
`untracked: true`), `remove-row --changeset` is refused — row tracking remains a manual Specman
action. `remove`/`remove-item` delete immediately without `--changeset`; with `--changeset`,
`change=(removed, cs)` is set instead (not possible for `list`, see above — there, mark
individual items via `remove-item`).

**Read, change, create a PlantUML diagram** (an `image` tail area with `imageType: plantuml`, for
steps and for `--step intro|outro`; Specman 1.4.0+ specs only):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-plantuml.mjs" --file <target> --step <id|intro|outro> --op get    --area <tail-key> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-plantuml.mjs" --file <target> --step <id|intro|outro> --op set    --area <tail-key> --source-file - [--changeset <cs>] --json <<'EOF'
@startuml
...
@enduml
EOF
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-plantuml.mjs" --file <target> --step <id|intro|outro> --op insert --position start|end|after:tail[i] --source-file - [--scale <1-100>] [--changeset <cs>] --json <<'EOF'
@startuml
...
@enduml
EOF
```
`--source-file` takes a file path or `-` for stdin (a quoted heredoc `<<'EOF'` keeps the source
verbatim). `--block` is accepted as an alias of `--step`.

* `get` never writes. It returns `source` (LF newlines, without the surrounding backticks),
  `scalePercent`, and — if present — `change` and `backup` (`{ changeset, source }`). Find the
  `tail[n]` key via `tailAreas` (`kind: image`, `imageType: plantuml`) from Step 2; never guess it.
* To change a diagram, read the current source with `get`, rewrite it from the user's description
  and pass the **complete** new source to `set` — there is no partial edit. `set` returns `areaKey`
  and `backupWritten`. Never invent diagram content beyond what the user asked for.
* The source must start with `@start…` and end with `@end…` (e.g. `@startuml` … `@enduml`) and
  must not contain a backtick — the `.nsd` format has no escape for it, so the script refuses it.
* `set --changeset <cs>` keeps the old source as `backup=(<cs>, old source)` so that Specman can
  accept or reject the change; it does **not** write a `change=` mark (the grammar has no
  "changed" change type for areas). An untracked `set` (no `--changeset`) overwrites the source
  and leaves any existing `change=`/`backup=` as it is. A tracked `set` is refused for a diagram
  marked `removed` and for one that already carries a backup for a different changeset; a repeat
  `set` for the same changeset keeps the existing backup, and so does a diagram that is
  `added` in this very changeset (nothing to restore).
* `insert` adds a new diagram (default `--position end`, `--scale 100`; scale is a percentage in
  (0, 100]) and returns the new `areaKey`. With `--changeset <cs>` it is marked
  `change=(added, <cs>)`. Use the changeset from Step 2 (`settings.changeSetName`) when tracking
  is active.
* `insert` shifts the `tail[n]` keys of every later area — re-run `nsd-locate.mjs --step <id>`
  before addressing the tail again.
* Specs saved by a Specman older than 1.4.0 are refused: tell the user to open and save the spec
  once in Specman 1.4.0+.
* Run the sanitizer (Step 6) after `set`/`insert`, as for every edit.
* SVG and PNG image blocks are not edited this way (`nsd-area.mjs --op remove` also refuses image
  areas). Rendering the diagram and checking the PlantUML syntax remain Specman's job — the script
  only validates the `@start…`/`@end…` frame.

**Create, change, remove a `catch` for a `break`:**
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-catch.mjs" --file <target> --op add --break <stepId> --head "<plain text>" [--parent <sequence-key>] --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-catch.mjs" --file <target> --op set-head --break <stepId> --head "<plain text>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-catch.mjs" --file <target> --op remove --break <stepId> --json
```
`--head-html` instead of `--head` passes ready-made HTML through. `add` creates the catch in the
`catchArea` of the break's sequence (or the nearest enclosing one allowed to carry one; `--parent`
from `sequences` selects a higher one) and returns `bodyKey` + `placeholderStepIds`: fill the
placeholder immediately via `nsd-set-text`, add further handler steps via
`nsd-insert-step --parent <bodyKey>`. There is no `coCatch`. After creating a `break`, check that
`nsd-locate` no longer lists it under `uncaughtBreaks` — the consequences of a break belong in a
catch, not in a table on the break step.

**Mark a change** (only when change tracking is active, see Step 2):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-mark-change.mjs" --file <target> --step <id> --kind added|removed --changeset <name> --json
```
`kind: source` or `target` is refused — Specman does not validate this linkage anywhere and
crashes on load if it is wrong; moving a step with tracking remains a manual Specman action.

**Change diagram settings** (`settings`/`pdfOptions` — e.g. zoom, changeset name, PDF page size):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-edit-settings.mjs" --file <target> --mode read --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-edit-settings.mjs" --file <target> --mode set --key <key> --value <value> --json
```
`<key>` is one of `width`/`zoom`/`changeModeEnabled`/`changeSetName` or
`pdfOptions.filename`/`pdfOptions.modelFilename`/`pdfOptions.pageSize`/`pdfOptions.portrait`/`pdfOptions.paging`.


## Step 5 — Track a text change (only with active change tracking, only for `nsd-set-text`)

Two-stage, since `plain=` is only recomputed correctly by the sanitizer:

1. **Before** the `nsd-set-text` call from Step 4: note the `plain` of the affected area from the
   `nsd-locate` output of Step 2 (that is the old state).
2. Run `nsd-set-text` (Step 4).
3. Sanitize (Step 6) so that `plain=` reflects the new text correctly.
4. Compute and write the markups:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-diff-markups.mjs" --file <target> --step <id> --area <key> --old-plain <old-plain-text> --changeset <name> --json
   ```
   Produces exactly one `Changed` span over the changed region (no attempt to split more finely
   at HTML tag boundaries — that would need Specman's own renderer). For a pure deletion with no
   new text in the result, no markup is deliberately written — this is not an error.
5. Sanitize again (Step 6) to confirm the result.

## Step 6 — Sanitize

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <target> --json
```

- `OK` or `SANITIZED`: done. `stable: true` means a second run leaves the file unchanged.
  `plainTextFieldsRefreshed` is not an error counter and stays permanently > 0 for specs with an
  empty `<div>` at the start of intro/outro text blocks (a sanitizer quirk); only `stable: false`
  or `ERROR` requires follow-up. On `SANITIZED`, briefly report the summary (`stepNumberChanges`,
  `steplinkUpdates`, `plainTextFieldsRefreshed`).
- `ERROR`: read `message`, fix the cause (usually a mistake in the previous steps), try again.
  Never leave a faulty file in place.
- `warnings` in the response (with any status): show each warning to the user — e.g. that the
  specification was saved with a newer Specman than the jar under `SPECMAN_JAR`.

## Step 7 — History entry

After a successful sanitize (Step 6), add **one** row for the whole editing pass to the document
history table of the `intro` block — not one row per individual change from Step 4.

The history table's columns are `Aktivität` (activity), `Autor` (author) and `Datum` (date) in the
vendored German template; English headers (Activity/Author/Date) are also accepted.

1. **Resolve the author:**
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --get author --json
   ```
   Empty (first use) → ask for the name, have it abbreviated, confirm, remember:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --abbreviate-name "<full name>" --json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --set author --value "<confirmed, abbreviated name>" --json
   ```

2. **Read the current state** (basis for the version suggestion):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-history.mjs" --file <target> --mode read --json
   ```
   Determine the highest version in `rows` that parses as `<int>.<int>` (ignore `-` rows).

3. **Phrase one** activity row for the whole pass — a short noun phrase in the style of existing
   specs ("Behavior on change of tenant, country and structure scheme adjusted", "Added
   permissions as a precondition"), no enumeration of individual steps, no step numbers.

4. **Suggest a version and have it confirmed** (`AskUserQuestion`, suggestion as the first
   option, plus free input): a pure wording/clarification change to existing steps →
   `x.(y+1)`; new/removed steps or a changed flow → `(x+1).1`. Without a parsable previous
   version, ask openly, without a suggestion.

5. **Ask for the follow-up action** (`AskUserQuestion`, options `-` and `Review`).

6. **Write the row and sanitize again:**
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-history.mjs" --file <target> --mode append --version <v> --activity "<summary>" --author "<name>" --followup <-|Review> --json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <target> --json
   ```

**Never write a review row yourself** — a review is a manual process outside this skill; the
review row carries the reviewed version, not `-`. The follow-up action `Review` in the row of
your own edit, on the other hand, is only a reminder ("awaiting review") and is allowed.
