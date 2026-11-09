---
name: sync-refs
description: "Scans Java Javadoc and TypeScript/Angular JSDoc comments for SUC-XXX Step N (ID: xxx) references (the legacy German keyword Schritt is also recognised) and corrects the step number wherever it has drifted from the step's current number in the actual .nsd file, resolved via the stable ID. Use whenever spec step numbers may have shifted (after editing a spec, or as a standalone check) and code comments need to stay accurate. Not for editing the spec itself."
argument-hint: "[<file-or-folder>] [--spec-dir <folder>]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# sync-refs

## Step 1 — Determine target and spec folder

Without an argument: assume the current diff or the project's most recently edited files
(`Grep` for `SUC-\d+.*(Step|Schritt).*\(ID:` across the project, if nothing else was named). The
spec folder comes from `--spec-dir`, or from `.claude/specman.local.md` (`specDir`), or is asked
for once.

## Step 2 — Update per file

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sync-refs.mjs" --file <file> --spec-dir <folder> --json
```

Call it individually for each affected file (Java and TypeScript/Angular files alike — the script
recognises both comment styles via the same pattern). It recognises both `Step` and the legacy
German `Schritt` as the keyword; it rewrites only the number and keeps whichever keyword the
comment already uses.

## Step 3 — Report the result

- `changedCount`: number of corrected references — briefly list which file/reference was
  affected.
- `unresolved`: references that could not be resolved (spec file not found, or the ID no longer
  exists in the spec). Report both to the user, do not ignore them silently — an ID that no
  longer exists points to a deleted step that the code comment still references.
