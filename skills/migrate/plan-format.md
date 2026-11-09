# Plan format for `migrate`

The plan is a JSON file that `nsd-build-from-plan.mjs` processes, together with the extract
(`extract.json`) and the template `reference/suc-template.nsd`, into the `.nsd`. It defines
structure and mapping; text and formatting come **by reference** from the extract.

The Word documents being migrated and the SUC template are German, so some labels below (e.g.
`Ja`/`Nein`, `Aktivität`) are German strings that the scripts write or match; they stay verbatim.

## Content specifications (`content`)

Wherever text appears, one of the following forms is allowed:

| Form | Meaning |
|---|---|
| `"Text"` or `{ "text": "Text" }` | Own plain text — escaped by the script. Only for headings/branch labels that do not exist in the docx (e.g. `Ja`, `Nein`, i.e. Yes, No). |
| `{ "html": "<b>..</b>" }` | Ready-made HTML (no backtick, umlauts as `&#NNN;`) — only in exceptional cases. |
| `{ "ref": "p12" }` | Paragraph `p12` from `outline.txt`, including run formatting (bold, italic, …). |
| `{ "ref": ["p12", "p13", "t3", "i2"] }` | Several blocks in document order: the first text block becomes the head, subsequent lists/tables/images/texts become areas (`areas`) of the step. |
| `{ "ref": "p12", "label": "Hinweis" }` | `label` puts `**Hinweis:**` (note) before the first paragraph. **Never for participants**: the builder rejects `System`/`User`/`Benutzer` as `label` — step texts stand without the `System:` / `User:` prefix. |
| `{ "ref": "p12", "flatLists": true }` | List paragraphs of the `ref` become normal text instead of a `list` area — for a bullet point that is its own step. |

With several blocks, list paragraphs (style with `bullet`/`nr` in the outline) become a `list`
area; nested levels are flattened with indentation (Specman has no nested lists; the script
reports a warning). In head/list-item/cell contexts, list paragraphs are normal text; in steps you
get that with `flatLists: true` on the `ref`. If the head of a `simple`/`break` step stays empty
because its content consists only of a list, the build warns.

## Plan skeleton

```json
{
  "number": "SUC-220",
  "title": "Konsolidierungseinheit erstellen",
  "history": "extract",
  "intro": {
    "description": [{ "ref": "p48" }],
    "actors": "User, System",
    "preconditions": [{ "ref": "p55" }, { "ref": "p56" }],
    "postconditions": [{ "ref": "p60" }]
  },
  "main": { "steps": [], "catches": [] },
  "outro": {
    "businessRules": [], "nonFunctional": [], "openPoints": [["Frage", "2", "offen"]],
    "remarks": [], "designNotes": [],
    "sections": [{ "heading": "Wireframes", "areas": [{ "kind": "image", "ref": "i1" }] }]
  },
  "ignored": [{ "ids": ["p1"], "reason": "…" }, { "from": "p19", "to": "p24", "reason": "…" }],
  "reworded": [{ "ids": ["p31"], "reason": "Deliberately reworded into question/action (user approval)" }]
}
```

* `history`: `"extract"` (default if the docx has a history table) takes over its rows 1:1 — empty
  cells stay empty. Alternatively an array `[[Version, Aktivität, Autor, Datum, Folgeaktion], …]`
  (columns: version, activity, author, date, follow-up action; the history headers are also
  accepted in English as Activity/Author/Date).
* `intro.actors`: string or content specification; appended to the description as
  `**Akteur(e):** …` (actor(s)).
* `intro.description[]`: content specifications (text only — no list/table/image).
* `preconditions[]`/`postconditions[]`: list entries; entry = content specification or
  `{ "content": …, "areas": […] }`. Omitted = the template placeholder stays.
* `outro.openPoints`: rows of the open-points table (`Offene Punkte`), one array per row.
* `outro.sections[]`: additional sections after the template (`Wireframes`, `Fachklassenmodell`
  i.e. domain class model, …).

## Steps (`main.steps`, branch/body arrays)

Every node has `kind` and `content` (head text):

| `kind` | further fields |
|---|---|
| `simple` | `areas?` |
| `break` | `id` (freely chosen, referenced by `catches`), `areas?` |
| `subsequence` | `body` (≥ 1 step), `flat?`, `catches?`, `areas?` |
| `while` / `doWhile` | `body` (≥ 1 step), `catches?` |
| `if` | `ifBranch: { head?, body, catches?, areas? }`, `areas?` |
| `ifElse` | `ifBranch`, `elseBranch` (each `{ head?, body, areas?, … }`), `areas?` |
| `case` | `defaultBranch` and `caseBranches` (**at least 2**), `areas?` |

`areas` exist on **every** node (also on `if`/`ifElse`/`case`, then below the head of the branching)
and on **every branch** (then below the branch head). The head (`content` or `head`) may be own text
and still carry `areas` — e.g. a question as head and the associated data list as an area. The
areas belong to the node or branch, not to the body.

If a branch `head` is missing, the script sets `Ja`/`Nein`/`Sonst`/`Fall n` (Yes/No/Otherwise/Case n)
and counts that in `summary.defaultedBranchHeads` — deliberately improve it there if the docx
provides a label.

### Exceptions (`break` + `catches`)

A `catches` entry belongs to the **enclosing** container (`main`, `subsequence`, `while`,
`doWhile` or branch) of the `break` step(s):

```json
"catches": [
  { "breakIds": ["ungueltig", "gesperrt"], "content": { "ref": "p120" }, "body": [ { "kind": "simple", "content": { "ref": "p121" } } ] }
]
```

`breakId` (single) or `breakIds` (several aborts share one handler, Specman `coCatch`). Every id
must occur in this container as a `break` with `id`.

## Areas (`areas[]`)

| `kind` | Fields |
|---|---|
| `text` | `content` |
| `list` | `ordered?`, `items: [content \| {content, areas}]` |
| `table` | `cols?: [%]`, `widthPercent?`, `rows: [[content \| {content, areas}]]` (all rows of equal length) |
| `image` | `ref: "i3"`, `scale?: 1–100` (default from the image width relative to 731 px), `pngFile?` (converted PNG if the original is not a PNG) |
| `refs` | `ref: [ids]` — like `content`, but entirely as areas (for images/tables in `sections[]`, likewise for lists such as default data that should hang on a step or branch) |

Whole docx tables are most easily adopted via `{ "ref": "t3" }`. Merged cells are resolved by the
script (content in the first cell) and reported as a warning.

## `ignored` — only for pure structure

Every paragraph and every image of the extract must be **either used or listed here with a
reason**, otherwise the build aborts (`unreferenced`). Only content without specification logic is
allowed:

* Headings/labels that the template itself brings along ("Beschreibung" (description), "Auslöser,
  Vorbedingung" (trigger, precondition), "Nr." (No.), "Beteiligte" (participants), "Normaler
  Ablauf:" (normal flow:), header row of the open-points table, …)
* Participant/number cells (the actor is already in the sentence; Specman assigns step numbers)
* empty paragraphs/cells, title/number that went into `number`/`title`

Entry: `{ "ids": [...] }` or `{ "from": "p19", "to": "p24" }` (same kind `p`/`i`), plus
**`reason`** (mandatory, non-empty). A table id (`t3`) includes all paragraphs in it.
Everything domain-related (conditions, rules, field lists, design notes, error texts) **never**
belongs here.

## `reworded` — rewordings approved by the user

For paragraphs whose wording is deliberately changed (typically: condition + consequence →
question in the head, action in the branch). The new text appears as own text (`"Text"`) in the
plan; the original paragraph is thereby not consumed and belongs here with a reason. Structure as
for `ignored` (`ids` or `from`/`to`, `reason` mandatory); ranges such as
`{ "from": "p31", "to": "p36", "reason": "…" }` are also possible.

* Counts as covered for the build check, `migrate-verify` excuses the paragraph — but both report
  it **separately from `ignored`** (`reworded` in the response, `summary.rewordedTexts`).
* Only after explicit approval by the user (Step 4b of the skill). The same id must not appear in
  `ignored` at the same time (build error).
