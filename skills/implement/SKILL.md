---
name: implement
description: "Reads a Specman SUC .nsd specification and either implements the corresponding code directly (small SUCs) or proposes a phased implementation plan for it (large SUCs), with SUC-XXX Step N (ID: xxx) references in the generated Javadoc/JSDoc comments. Use only when code needs to be written or changed to match an existing spec. Not for editing the spec itself (use edit) or creating a new one (use plan)."
argument-hint: "<suc-file>"
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - AskUserQuestion
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# implement

## Step 1 — Read the specification

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-locate.mjs" --file <suc-file> --json
```

If the call fails with a hint about V001/`modelType`: stop, ask the user to open and save the file
once in Specman 1.3.0+. `sequences` gives an overview of the structure (number of main steps per
sequence); for the full flow text, query each main step specifically with `--step` (see the
`edit` skill for addressing).

## Step 2 — Assess the scope

Rough guideline: more than ~15-20 steps in total, several actors, or several independent
exception paths suggest "large". When in doubt, ask rather than guess.

**For a large scope:**

> "The SUC to be implemented is very large. Instead of implementing it directly, I would create a
> phased implementation plan."

`AskUserQuestion` (`header: "Scope"`) — agreement? If yes: create a phase plan as a Markdown file
(location by follow-up question; without a preference, next to the `.nsd` file). Per phase: step
range (step IDs from `nsd-locate`), affected components/files, dependencies on other phases, and
an acceptance criterion. Then state explicitly: **the phases are implemented in separate
sessions** — do not continue with the implementation in this session, not even partially.

**For a small scope:** continue with Step 3.

## Step 3 — Implement directly

Normal implementation work — follow existing patterns in the target project, tests as is usual
in the project. In addition, where a method/class implements a step of the specification, add a
reference in the Javadoc or JSDoc comment:

```
SUC-<number> Step <current-number> (ID: <id>)
```

**Always take the current number and ID fresh from `nsd-locate`**, never copy them from memory or
from an old reference in the code — step numbers shift with every sanitize round.

If you come across an existing reference whose number no longer matches the current state of the
`.nsd` file: the ID is the stable anchor, correct the number (see also the standalone `sync-refs`
skill for a whole file/project run). Older comments may use the legacy German keyword `Schritt`
instead of `Step` (`SUC-<number> Schritt <n> (ID: <id>)`); when correcting those, change only the
number and keep the keyword the comment already uses.

## Step 4 — Keep references in sync

After the implementation, or when only existing references should be refreshed without changing
anything else:

```
/specman:sync-refs
```
