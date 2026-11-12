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

Never modify the `.nsd` itself with this skill — that is the `edit` skill's job.

## Step 1 — Read the specification

`Read` the `.nsd` — or its `<file>.nsd.wrk` working copy if one exists (the spec is open in Specman
and the `.wrk` is the current state). Step lines look like `kind(stepNum, stepId, `html`, plain=`...`)`;
the `plain=` text is the readable step text, nesting (`{ }`) is the flow structure. If the header
comment names an old `modelType` (V001), stop: the user must open and save it once in Specman 1.3.0+.

## Step 2 — Assess the scope

Rough guideline: more than ~15–20 steps, several actors, or several independent exception paths
suggest "large". When in doubt, ask.

**Large:** tell the user "The SUC to be implemented is very large. Instead of implementing it directly,
I would create a phased implementation plan." and confirm via `AskUserQuestion` (`header: "Scope"`).
If yes, write a phase plan as a Markdown file (location: ask; default next to the `.nsd`). Per phase:
step range (step IDs), affected components/files, dependencies on other phases, acceptance criterion.
Then state explicitly: **the phases are implemented in separate sessions** — do not continue
implementing in this session, not even partially.

**Small:** continue with Step 3.

## Step 3 — Implement directly

Normal implementation work: follow the target project's patterns and testing habits. Where a
method/class implements a step, add to its Javadoc/JSDoc comment:

```
SUC-<number> Step <current-number> (ID: <id>)
```

Take the current number and ID **fresh from the `.nsd` file you just read**, never from memory or an old
code comment — numbers shift whenever the spec is sanitized. For an existing reference whose number
is stale, the ID is the stable anchor: correct the number. Legacy comments may use the German keyword
`Schritt`; change only the number and keep the keyword.

## Step 4 — Keep references in sync

For a whole file or project run, or to refresh references without other changes: `/specman:sync-refs`.
