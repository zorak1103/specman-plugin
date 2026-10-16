# Plan-Format für `migrate`

Der Plan ist eine JSON-Datei, die `nsd-build-from-plan.mjs` zusammen mit dem Extrakt
(`extract.json`) und der Vorlage `reference/suc-template.nsd` zur `.nsd` verarbeitet. Er legt
Struktur und Zuordnung fest; Text und Formatierung kommen **per Referenz** aus dem Extrakt.

## Inhalt-Angaben (`content`)

Überall, wo Text steht, ist eine der folgenden Formen erlaubt:

| Form | Bedeutung |
|---|---|
| `"Text"` oder `{ "text": "Text" }` | Eigener Klartext — wird vom Skript escaped. Nur für Überschriften/Zweigbezeichnungen, die es im docx nicht gibt (z. B. `Ja`, `Nein`). |
| `{ "html": "<b>..</b>" }` | Fertiges HTML (kein Backtick, Umlaute als `&#NNN;`) — nur im Ausnahmefall. |
| `{ "ref": "p12" }` | Absatz `p12` aus `outline.txt`, inklusive Run-Formatierung (fett, kursiv, …). |
| `{ "ref": ["p12", "p13", "t3", "i2"] }` | Mehrere Blöcke in Dokumentreihenfolge: erster Textblock wird der Kopf, danach folgende Listen/Tabellen/Bilder/Texte werden Bereiche (`areas`) des Schritts. |
| `{ "ref": "p12", "label": "Hinweis" }` | `label` setzt `**Hinweis:**` vor den ersten Absatz. **Nie für Beteiligte**: `System`/`User`/`Benutzer` als `label` verweigert der Builder — Schritttexte stehen ohne Präfix `System:`/`User:`. |
| `{ "ref": "p12", "flatLists": true }` | Listenabsätze der `ref` werden normaler Text statt `list`-Area — für einen Aufzählungspunkt, der ein eigener Schritt ist. |

Listenabsätze (Style mit `bullet`/`nr` in der Outline) werden bei mehreren Blöcken zu einer
`list`-Area; verschachtelte Ebenen werden eingerückt abgeflacht (Specman kennt keine
verschachtelten Listen; das Skript meldet eine Warnung). In Kopf-/Listeneintrag-/Zellen-Kontexten
sind Listenabsätze normaler Text; in Schritten erreicht man das mit `flatLists: true` am `ref`.
Bleibt der Kopf eines `simple`/`break`-Schritts leer, weil sein Inhalt nur aus einer Liste besteht,
warnt der Build.

## Plan-Gerüst

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
  "reworded": [{ "ids": ["p31"], "reason": "Bewusst zu Frage/Aktion umformuliert (Freigabe des Nutzers)" }]
}
```

* `history`: `"extract"` (Default, wenn das docx eine Historientabelle hat) übernimmt deren Zeilen
  1:1 — leere Zellen bleiben leer. Alternativ ein Array `[[Version, Aktivität, Autor, Datum, Folgeaktion], …]`.
* `intro.actors`: String oder Inhalt-Angabe; wird als `**Akteur(e):** …` an die Beschreibung gehängt.
* `intro.description[]`: Inhalt-Angaben (nur Text — keine Liste/Tabelle/Bild).
* `preconditions[]`/`postconditions[]`: Listeneinträge; Eintrag = Inhalt-Angabe oder
  `{ "content": …, "areas": […] }`. Weglassen = Vorlagen-Platzhalter bleibt.
* `outro.sections[]`: zusätzliche Abschnitte hinter der Vorlage (`Wireframes`, `Fachklassenmodell`, …).

## Schritte (`main.steps`, Zweig-/Body-Arrays)

Jeder Knoten hat `kind` und `content` (Kopftext):

| `kind` | weitere Felder |
|---|---|
| `simple` | `areas?` |
| `break` | `id` (frei wählbar, wird von `catches` referenziert), `areas?` |
| `subsequence` | `body` (≥ 1 Schritt), `flat?`, `catches?`, `areas?` |
| `while` / `doWhile` | `body` (≥ 1 Schritt), `catches?` |
| `if` | `ifBranch: { head?, body, catches?, areas? }`, `areas?` |
| `ifElse` | `ifBranch`, `elseBranch` (je `{ head?, body, areas?, … }`), `areas?` |
| `case` | `defaultBranch` und `caseBranches` (**mindestens 2**), `areas?` |

`areas` gibt es an **jedem** Knoten (auch an `if`/`ifElse`/`case`, dann unter dem Kopf der
Verzweigung) und an **jedem Zweig** (dann unter dem Zweigkopf). Der Kopf (`content` bzw. `head`) darf
dabei eigener Text sein und trotzdem `areas` tragen — z. B. eine Frage als Kopf und die zugehörige
Datenliste als Area. Die Areas stehen am Knoten bzw. Zweig, nicht im Body.

Fehlt ein Zweig-`head`, setzt das Skript `Ja`/`Nein`/`Sonst`/`Fall n` und zählt das in
`summary.defaultedBranchHeads` — dort bewusst nachbessern, wenn das docx eine Bezeichnung hergibt.

### Exceptions (`break` + `catches`)

Ein `catches`-Eintrag steht am **umschließenden** Container (`main`, `subsequence`, `while`,
`doWhile` oder Zweig) des/der `break`-Schritte:

```json
"catches": [
  { "breakIds": ["ungueltig", "gesperrt"], "content": { "ref": "p120" }, "body": [ { "kind": "simple", "content": { "ref": "p121" } } ] }
]
```

`breakId` (einzeln) oder `breakIds` (mehrere Abbrüche teilen sich einen Handler, Specman
`coCatch`). Jede Id muss in diesem Container als `break` mit `id` vorkommen.

## Areas (`areas[]`)

| `kind` | Felder |
|---|---|
| `text` | `content` |
| `list` | `ordered?`, `items: [Inhalt \| {content, areas}]` |
| `table` | `cols?: [%]`, `widthPercent?`, `rows: [[Inhalt \| {content, areas}]]` (alle Zeilen gleich lang) |
| `image` | `ref: "i3"`, `scale?: 1–100` (Default aus der Bildbreite relativ zu 731 px), `pngFile?` (konvertiertes PNG, wenn das Original kein PNG ist) |
| `refs` | `ref: [ids]` — wie bei `content`, aber komplett als Areas (für Bilder/Tabellen in `sections[]`, ebenso für Listen wie Defaultdaten, die an einem Schritt oder Zweig hängen sollen) |

Ganze docx-Tabellen werden am einfachsten per `{ "ref": "t3" }` übernommen. Verbundene Zellen
löst das Skript auf (Inhalt in der ersten Zelle) und meldet das als Warnung.

## `ignored` — nur für reine Struktur

Jeder Absatz und jedes Bild des Extrakts muss **entweder verwendet oder hier mit Begründung**
aufgeführt sein, sonst bricht der Build ab (`unreferenced`). Erlaubt sind ausschließlich Inhalte
ohne Spezifikationslogik:

* Überschriften/Beschriftungen, die die Vorlage selbst mitbringt („Beschreibung“, „Auslöser,
  Vorbedingung“, „Nr.“, „Beteiligte“, „Normaler Ablauf:“, Kopfzeile der Offene-Punkte-Tabelle, …)
* Beteiligten-/Nummernzellen (der Handelnde steht bereits im Satz; Schrittnummern vergibt Specman)
* leere Absätze/Zellen, Titel/Nummer, die in `number`/`title` eingegangen sind

Eintrag: `{ "ids": [...] }` oder `{ "from": "p19", "to": "p24" }` (gleiche Art `p`/`i`), plus
**`reason`** (Pflicht, nicht leer). Eine Tabellen-Id (`t3`) schließt alle Absätze darin ein.
Alles Fachliche (Bedingungen, Regeln, Feldlisten, Designanmerkungen, Fehlertexte) gehört **nie**
hierher.

## `reworded` — vom Nutzer freigegebene Umformulierungen

Für Absätze, deren Wortlaut bewusst geändert wird (typisch: Bedingung + Folge → Frage im Kopf,
Aktion im Zweig). Der neue Text steht als eigener Text (`"Text"`) im Plan; der Originalabsatz wird
dadurch nicht verbraucht und gehört mit Begründung hierher. Aufbau wie `ignored`
(`ids` oder `from`/`to`, `reason` Pflicht); auch Bereiche wie
`{ "from": "p31", "to": "p36", "reason": "…" }` sind möglich.

* Gilt für den Build-Check als abgedeckt, `migrate-verify` entschuldigt den Absatz — beide weisen
  ihn aber **getrennt von `ignored`** aus (`reworded` in der Antwort, `summary.rewordedTexts`).
* Nur nach ausdrücklicher Freigabe des Nutzers (Schritt 4b des Skills). Dieselbe Id darf nicht
  zugleich in `ignored` stehen (Build-Fehler).
