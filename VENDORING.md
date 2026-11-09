# Vendoring — Origin and Update Procedure of the Reference Files

This document is **not part of the plugin's behavior** — no skill, agent or script reads this file
at runtime. It serves exclusively for maintaining the plugin itself: where the files under
`reference/` come from and how to re-fetch them when Specman is updated.

## Source

Upstream repository: `https://github.com/j-specman/specman`
License: BSD-3-Clause-like (`license.txt` in the upstream repo) — redistribution with copyright
notice and disclaimer is permitted. When re-vendoring, check the license text again in case the
upstream project has been relicensed.

## Vendored files

| File here | Upstream path | Retrieved on |
|---|---|---|
| `reference/SpecmanModel_V002.g4` | `src/main/antlr4/specman/model/v002/SpecmanModel_V002.g4` | 2026-11-09 (Specman 1.4.0) |
| `reference/specman-reference-v1.4-model-v2.nsd` | `specman-reference-v1.4-model-v2.nsd` (repo root, tag `v1.4.0`) | 2026-11-09 |
| `reference/specman-reference-v1.3-model-v2.nsd` | `specman-reference-v1.3-model-v2.nsd` (repo root) | 2026-09-16 |

The 1.3 reference is kept as a regression fixture: files that were still saved with Specman 1.3 must
continue to parse. At the next update, **add** the new reference, do not replace the old one.

`reference/suc-template.nsd` is **not an upstream file** — it is project-owned (the SUC template,
in German; derived from `suc-template.nsd`, originally in the old V001 JSON format, opened and
saved once by hand in Specman 1.3.0 to lift it to the V2 text format). To update this file: open it
in Specman, check it, save it, then copy it here — no download from GitHub needed.

## What is deliberately NOT vendored

- The sanitizer jar (`specman-*-jar-with-dependencies.jar`, ~50–70 MB) — too large for the Git repo.
  Users provide the path via the environment variable `SPECMAN_JAR` (see `README.adoc`).
- `gutenmorgen.nsd` — personal scratch file from the local Specman installation, not part of the
  distribution.
- `specman.bat` — the launcher currently has a bug (`%1` instead of `%*`, swallows arguments such as
  `--sanitize <file>`); the plugin calls `java -jar` directly anyway and bypasses the `.bat`
  entirely.

## What an update looks like

1. Obtain the new version of the grammar/reference/jar from `github.com/j-specman/specman`
   (locally e.g. under `C:\Users\<user>\Desktop\specman-installation\` or via
   `git clone`/`git pull` on `github.com/j-specman/specman`).
2. Replace `reference/SpecmanModel_V002.g4` with the new version and put the new
   `specman-reference-vX.Y-model-v2.nsd` next to the existing references.
3. Run `diff` against the previous version — every new grammar production and every new optional
   attribute may affect `scripts/lib/nsd-ast.mjs` (parser **and** serializer; see their comments on
   production coverage). In particular check:
   - New step types or new optional parameters per step type.
   - Changed lexer precedence (e.g. `STEP_ID` vs. `INT` vs. `STEP_NUM`).
   - Changed semantics of `change=`/`markups=` (change kinds, allowed constructs).
4. Run `node --test "test/**/*.test.mjs"` — in particular the round-trip tests against the new
   reference file (parse → serialize → parse again).
5. Adapt affected scripts/skills, bump the `plugin.json` version according to SemVer, commit.

## Known quirks of the format (as of 2026-09-16, see script comments for details)

- `change=(added|removed|source|target, changeset[, sourceStep=<id>])` — no "modified"; that was
  explicitly removed in the Specman code in 2021 (`Aenderungsart.Bearbeitet` deleted).
- The `source`/`target` link (step move with tracking) is not validated by Specman itself — a wrong
  `sourceStep=` crashes the GUI on load. This plugin deliberately does not produce such pairs itself
  (see the plan document of the original implementation).
- Real-world existing specifications are often still in the old V001 JSON format — this plugin's V2
  tools reject such files with a clear message instead of misinterpreting them.
