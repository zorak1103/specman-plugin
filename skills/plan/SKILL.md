---
name: plan
description: "Interviews the user to design a new Specman SUC (or sub-SUC) specification, then generates the .nsd file from the template and sanitizes it. Use only when a genuinely new specification needs to be created from scratch. Not for editing an existing .nsd (use edit) or for implementing code from one (use implement)."
argument-hint: "[--dir <spec-folder>] [--parent <suc-number>]"
allowed-tools:
  - Read
  - Write
  - AskUserQuestion
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# plan

Builds a new specification in two phases: first an interview with a private working outline
(never presented for approval), then generation and sanitizing of the actual `.nsd` file (the
only output that needs approval).

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

## Step 1 — Target folder and number

Ask the user for the folder if it was not given via `--dir` (the project-specific spec folder,
see `.claude/specman.local.md` → `specDir`, if present).

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-suc-number.mjs" --dir <folder> [--parent <suc-number>] --json
```

Propose the result (`number`) to the user, do not adopt it silently — they know the right topic
range (e.g. `9xx`) and may want a different number.

## Step 2 — Separate sub-SUC or not?

If the user describes a larger, multi-part flow: **ask one question** whether a partial flow
deserves its own sub-SUC (separate `.nsd` file, named hierarchically,
e.g. `SUC-902.4 <title>.nsd`) or stays as a subsequence within this one file. This is a judgment
call — there is no automatic splitting logic. Cross-references between SUC files are always plain
running text in the style "See SUC-902.1.2 <title>", never a structural link.

## Step 3 — Interview

One point per follow-up question, until the following is clear:

1. Purpose / short description
2. Trigger / preconditions
3. Actors
4. Main flow (step by step)
5. Exceptions / abort cases
6. Postconditions / result(s)
7. Business rules / non-functional requirements (optional)

Prefer `AskUserQuestion` with clear options where sensible; otherwise open questions.

## Step 4 — Private working outline

Record the interview state as Markdown under
`C:/Users/<user>/.claude/tmp/scratch/<slug>-outline.md` (convention for ephemeral intermediate
files from the user's global CLAUDE.md). This file is purely a working tool for yourself —
**never present it to the user for approval**, never refer to it as if it were the result.
Delete it after successful sanitizing in Step 7.

## Step 5 — Create the file

Copy the template `${CLAUDE_PLUGIN_ROOT}/reference/suc-template.nsd` to
`<folder>/SUC-<number> <title>.nsd` (`Read` + `Write`, no Bash copy — consistent with the rest of
the plugin). The vendored template is German, so the new spec starts with German section headings
and placeholders; replace their content with the interview results.

## Step 6 — Fill the structure

Build the flow specification from the outline of Step 4 — one subsequence or one simple step per
main step, depending on complexity. Map branches (conditions, case distinctions, loops) directly
as such, not as a running-text substitute:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-locate.mjs" --file <file> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-insert-step.mjs" --file <file> --parent <sequence-key> --position end --kind simple|break|while|doWhile|subsequence|if|ifElse|case [--branches <n>] --html <html> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <file> --step <id> --area <key> --html <html> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <file> --step <id> --op insert --kind text|list|table --position start|end|after:tail[i] [...] --json
```

Never write DSL text by hand, not even for the title and intro/outro (details in the
`edit` skill, Step 2 and 4). The section headings below (`Beschreibung` = description,
`Geschäftsregeln` = business rules, `Akzeptanzkriterien` = acceptance criteria) are the German
headings of the vendored template:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-locate.mjs" --file <file> --step intro --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <file> --step intro --title "SUC-<number> <title>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <file> --step intro --area <tail key from sections> --section Beschreibung --text "<plain text>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <file> --step intro --area <list>.items[0] --html <html> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <file> --step intro --op add-item --area <list> --position end --html <html> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <file> --step outro --area head --section Geschäftsregeln --text "<plain text>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <file> --step outro --op insert --kind text --position after:<tail-key> --heading Akzeptanzkriterien --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <file> --step outro --op insert --kind table --position after:<tail-key> --rows '[["Nr","Kriterium"],["1","..."]]' --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-catch.mjs" --file <file> --op add --break <break-stepId> --head "<plain text>" --json
```

Required after filling: title set (no longer `SUC-000 Template`), description as well as trigger
and result lists from the interview, business rules/acceptance criteria as far as gathered, and
for every exception/abort case a `break` with a `catch` (interview point 5) — at the end,
`nsd-locate` without `--step` must not report any `uncaughtBreaks`. If a step from another spec
should keep its ID: `nsd-insert-step ... --id <8 hex>`.

Further rules: create tables and lists as real areas via `nsd-area.mjs`
(see `edit` skill Step 4 for all operations and options), do not imitate them as running text.
For a structured child (`while`/`doWhile`/
`subsequence`/`if`/`ifElse`/`case`), `nsd-insert-step.mjs` first fills every mandatory branch/body
with a placeholder — immediately fill `insertedStepId`/`placeholderStepIds` from the response with
`nsd-set-text.mjs` (branch headings via the areas `ifBranch.head`/`elseBranch.head`/
`defaultBranch.head`/`caseBranch[n].head`, see `edit` skill Step 4 for details). Keep the
description (`Beschreibung`), flow specification (`Ablaufspezifikation`) and open items
(`Offene Punkte`) from the template (see `reference/suc-template.nsd`), and insert the content from
the interview.

## Step 6a — Fill in the document history

The template already comes with a row `0.1 | Initiale Erstellung | (leer) | (leer) | (leer)`
(`Initiale Erstellung` = initial creation, `(leer)` = empty). The history columns are `Aktivität`
(activity), `Autor` (author) and `Datum` (date); English headers (Activity/Author/Date) are also
accepted. Resolve the author and fill the three empty cells:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --get author --json
```

Empty (first use) → ask for the name, have it abbreviated, confirm, remember:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --abbreviate-name "<full name>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --set author --value "<confirmed, abbreviated name>" --json
```

Then write the row (version `0.1` and activity `Initiale Erstellung` stay untouched, the date is
today's):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-history.mjs" --file <file> --mode fill-initial --author "<name>" [--followup <-|Review>] --json
```

The follow-up action defaults to `Review` (a freshly planned spec awaits its review);
`--followup -` only if the user explicitly wants that.

## Step 7 — Sanitize

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <file> --json
```

On `ERROR`: fix the cause, try again. On `OK`/`SANITIZED`: delete the outline file from Step 4.
If the response contains a `warnings` array (e.g. jar older than Specman 1.4.0), show each
warning to the user.

## Step 8 — Summary for approval

Show a plain-text summary of the result (file name, main steps, open items) — **never show the
raw `.nsd` as the approval artifact**. This is the first and only approval point in this skill.
