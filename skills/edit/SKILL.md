---
name: edit
description: "Applies a targeted edit (text change, intro/outro title, section or list/table content, new leaf or structured step, catch block for a break, table/list/text area insert or row/item append/remove, or added/removed change mark) to an existing Specman .nsd specification, using this plugin's AST scripts, then sanitizes the result. Use only when a specific existing .nsd file needs a scoped change. Not for creating a new specification (use plan) or for implementing code from one (use implement)."
argument-hint: "<datei> <was geändert werden soll>"
allowed-tools:
  - Read
  - AskUserQuestion
  - Agent(specman:specman-nsd-editor)
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# edit

Kernprinzip dieses Plugins: Skripte übernehmen die DSL-Mechanik (Backtick-Escaping,
Klammer-Verschachtelung, Zeichen-Offsets), das Modell entscheidet nur über Inhalt und
Adressierung. Konstruiere niemals selbst `.nsd`-Syntax von Hand — jede Änderung läuft über die
`nsd-*`-Skripte unter `${CLAUDE_PLUGIN_ROOT}/scripts/`.

## Schritt 1 — Zieldatei auflösen

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-target.mjs" --file <pfad-zur-nsd> --json
```

Ergebnis `usingWorkingCopy: true` bedeutet: die Datei ist gerade in Specman geöffnet (Autoload
aktiv). **Ab hier immer den zurückgegebenen `path` verwenden** (die `.wrk`), niemals die
ursprüngliche `.nsd` — ein Speichern in Specman würde eine reine `.wrk`-Änderung sonst mit dem
alten Stand überschreiben.

## Schritt 2 — Bestand prüfen

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-locate.mjs" --file <target> --json
```

- Schlägt der Aufruf mit einem Hinweis auf `modelType`/V001 fehl: die Datei liegt im alten Format
  vor. Stopp — sag dem Nutzer, dass die Datei einmal in Specman 1.3.0+ geöffnet und gespeichert
  werden muss, bevor sie hier bearbeitbar ist.
- Sonst: `settings.changeModeEnabled` prüfen. `false` oder fehlend → `AskUserQuestion`
  (`header: "Änderungsverfolgung"`), ob sie für diese Bearbeitung aktiviert werden soll. Diese
  Einstellung selbst setzt aktuell kein Skript — das ist eine Specman-UI-Einstellung; wenn der
  Nutzer zustimmt, das im Gespräch festhalten und die Änderung trotzdem ohne `change=`/`markups=`
  vornehmen, mit dem Hinweis, dass er `changeModeEnabled=true` einmal in Specman selbst setzen
  sollte, oder ohne Tracking fortfahren, wenn er ablehnt.
- Merke dir `settings.changeSetName` als Default-Changeset, falls keins explizit genannt wurde.

Dann gezielt nach dem/den betroffenen Schritt(en) suchen:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-locate.mjs" --file <target> --step <nummer-oder-id> --json
```

Liefert `areas` (adressierbare Text-Bereiche: `head`, `tail[n]`, `tail[n].items[i]`,
`tail[n].rows[r].cells[c]`, bei Strukturschritten zusätzlich `ifBranch.head`/`elseBranch.head`/
`defaultBranch.head`/`caseBranch[n].head`), `tailAreas` (die Tail-Areas selbst als ganze
Bausteine — `tail[n]` mit `kind: text|list|table|image`, bei `list` zusätzlich `ordered`/
`itemCount`, bei `table` zusätzlich `rowCount`/`colCount` — Grundlage für Einfügen/Ergänzen/
Entfernen in Schritt 4) und `sequences` (gültige Einfüge-Ziele für neue Schritte).

Statt eines Schritts akzeptiert `--step` auch `intro` oder `outro` (Alias `--block`): Titel,
Beschreibung, Auslöser-/Resultat-Listen (intro) sowie Geschäftsregeln, Akzeptanzkriterien,
Offene-Punkte-Tabelle, Bemerkungen (outro) liegen dort. Die Antwort enthält dann `block` statt
`step`, dieselben `areas`/`tailAreas` und zusätzlich `sections` (je Textblock `areaKey` +
`heading` der enthaltenen Überschriften). Ohne `--step` liefert `nsd-locate` außerdem `blocks`,
`catches` (je catch: `ownerKey`, `breakStepId`, `bodyKey`) und `uncaughtBreaks` (break-Schritte
ohne catch).

**Übernimm
jeden `key` wörtlich aus dieser Ausgabe** — nie selbst einen Pfad konstruieren. Nach jeder
strukturellen Änderung an einem Tail (Area eingefügt/entfernt, Zeile/Item eingefügt/entfernt)
verschieben sich nachfolgende `tail[n]`-Indizes — vor der nächsten Adressierung erneut
`nsd-locate.mjs --step <id>` aufrufen, nie einen alten Key weiterverwenden.

## Schritt 3 — Hauptthread oder Subagent?

- **Bis zu 2 zusammenhängende Adressen im selben Auftrag:** direkt hier weitermachen (Schritt 4).
- **Ab 3 Adressen, oder wenn diese Bearbeitung mitten in einem fachfremden Gespräch auftaucht**
  (der Hauptkontext trägt bereits viel unrelated Historie mit sich): `Agent
  (specman:specman-nsd-editor)` mit einem knappen, fertig formulierten Auftrag — Datei,
  die exakten `key`-Werte aus Schritt 2, und der gewünschte neue Inhalt. Der Subagent trifft keine
  Design-Entscheidungen, nur Ausführung.

## Schritt 4 — Änderung anwenden

**Text ersetzen:**
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <target> --step <id|intro|outro> --area <key> --html <neuesHtml> --json
```
`head` und Textblöcke von `intro`/`outro` bündeln Überschriften und Absätze in einem HTML-Block —
`--html` ersetzt ihn komplett. Zum gezielten Ändern stattdessen:
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <target> --step intro --title "<Titel>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <target> --step <intro|outro> --area <head|tail[n]> --section "<Überschrift aus sections>" --text "<Klartext, \n = neuer Absatz>" --json
```
`--title` ersetzt nur die h1 (Spec-Titel, nur intro); `--section`/`--text` ersetzt nur den Absatz
unter einer Überschrift. Beide erwarten Klartext und escapen selbst. Ein frisch geplantes Template
trägt den Titel `SUC-000 Template` — der muss per `--title` gesetzt werden.
Schreibt nie `plain=` (der Sanitizer regeneriert es) und löscht automatisch alte `markups=` auf
dem geänderten Bereich, da deren Offsets sich auf den alten Text bezogen.

**Neuen Schritt einfügen** (leaf: `simple`/`break`; strukturiert: `while`/`doWhile`/`subsequence`/
`if`/`ifElse`/`case`):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-insert-step.mjs" --file <target> --parent <sequence-key> --position start|end|after:<stepId> --kind <kind> [--branches <n>] --html <html> --json
```
Mit `--id <8 Hex>` behält der Schritt eine vorgegebene ID (nötig, wenn er aus einer anderen Spec
umzieht und Code-Verweise `SUC-xxx Schritt N (ID: ...)` stabil bleiben sollen); die ID muss
diagrammweit eindeutig sein, sonst bricht das Skript ab. Ohne `--id` wird immer eine neue vergeben.

Die zugewiesene Nummer ist eine Fantasienummer — der Sanitizer im nächsten Schritt nummeriert
durch. **Niemals die Nummer eines bereits bestehenden, referenzierten Schritts von Hand
überschreiben** — das bricht bestehende Steplink-Auflösung. Neue Schritte bekommen immer eine
neue Nummer, nie eine wiederverwendete.

Bei einem strukturierten Kind füllt das Skript jeden laut Grammatik zwingenden Zweig/Body
automatisch mit einem Platzhalter (`case` braucht zusätzlich `--branches`, Default 2, mindestens
2 Case-Branches neben dem Default-Branch) — die Antwort liefert `insertedStepId` und
`placeholderStepIds`. **Diese Platzhalter sofort befüllen**, bevor die Bearbeitung als
abgeschlossen gilt:
- Zweig-Überschriften über `nsd-set-text.mjs --step <insertedStepId> --area ifBranch.head|elseBranch.head|defaultBranch.head|caseBranch[n].head`
  (Schlüssel kommen aus `nsd-locate.mjs --step <insertedStepId>`, wie jeder andere Area-Key nie
  selbst konstruieren).
- Jeder Platzhalter-Leaf-Schritt aus `placeholderStepIds` über `nsd-set-text.mjs --step <id> --area head`.

**Tabelle/Liste/Textblock einfügen, ergänzen, entfernen** (bei Schritten und bei `--step intro|outro`; Tail-Areas selbst, nicht Text
innerhalb einer bereits bestehenden Area — dafür ist `nsd-set-text.mjs` da):
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
Neue Abschnitte mit Überschrift (z. B. „Akzeptanzkriterien" im outro) entstehen mit
`--op insert --kind text --heading "<Überschrift>" [--text "<Absätze>"]` statt `--html`; mehrere
Tail-Areas (Tabelle, Text, Tabelle) per `--position after:tail[i]`.

`--rows`/`--items`/`--cols`/`--cells` sind JSON-Arrays als String. `insert` liefert `areaKey`
(neuer `tail[n]`), bei `list` zusätzlich `itemAreaKeys`, bei `table` zusätzlich `cellAreaKeys` —
diese sofort per `nsd-set-text.mjs` weiter verfeinern, falls die Zell-/Item-Inhalte noch
formatiertes HTML statt reinen Text brauchen. `--rows` muss rechteckig sein (jede Zeile gleich
viele Zellen); `--cols`/`--width` sind Prozentwerte wie `30%`.

Tracking-Asymmetrie aus der Grammatik (nicht dieses Plugins Entscheidung): `text`- und
`table`-Areas können als ganze Area mit `--changeset` als `added`/`removed` markiert werden, eine
`list`-Area selbst dagegen nicht — dort trägt jedes `item` sein eigenes `change`, nie die Liste
als Ganzes (`insert --kind list --changeset` markiert deshalb jedes Anfangs-Item einzeln).
Tabellenzeilen (`tableRow`) haben überhaupt keinen `change`-Slot: `add-row` fügt immer ungetrackt
ein (Antwort trägt `untracked: true`), `remove-row --changeset` wird verweigert — Zeilen-Tracking
bleibt eine manuelle Specman-Aktion. `remove`/`remove-item` löschen ohne `--changeset` sofort,
mit `--changeset` wird stattdessen `change=(removed, cs)` gesetzt (bei `list` nicht möglich,
siehe oben — dort einzelne Items per `remove-item` markieren).

**`catch` zu einem `break` anlegen, ändern, entfernen:**
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-catch.mjs" --file <target> --op add --break <stepId> --head "<Klartext>" [--parent <sequence-key>] --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-catch.mjs" --file <target> --op set-head --break <stepId> --head "<Klartext>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-catch.mjs" --file <target> --op remove --break <stepId> --json
```
`--head-html` statt `--head` reicht fertiges HTML durch. `add` legt den catch im `catchArea` der
Sequenz des break an (bzw. der nächsthöheren, die eines tragen darf; `--parent` aus `sequences`
wählt eine höhere) und liefert `bodyKey` + `placeholderStepIds`: den Platzhalter sofort per
`nsd-set-text` befüllen, weitere Handler-Schritte per `nsd-insert-step --parent <bodyKey>`.
`coCatch` gibt es nicht. Nach dem Anlegen eines `break` prüfen, dass `nsd-locate` ihn nicht mehr
unter `uncaughtBreaks` führt — die Folgen eines break gehören in einen catch, nicht in eine Tabelle
am break-Schritt.

**Änderung markieren** (nur wenn Änderungsverfolgung aktiv, siehe Schritt 2):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-mark-change.mjs" --file <target> --step <id> --kind added|removed --changeset <name> --json
```
`kind: source` oder `target` wird verweigert — Specman validiert diese Verknüpfung nirgends und
crasht bei einem Fehler beim Laden; Schritt-Verschiebung mit Tracking bleibt eine manuelle
Specman-Aktion.

**Diagramm-Einstellungen ändern** (`settings`/`pdfOptions` — z. B. Zoom, Changeset-Name, PDF-Seitengröße):
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-edit-settings.mjs" --file <target> --mode read --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-edit-settings.mjs" --file <target> --mode set --key <key> --value <wert> --json
```
`<key>` ist einer von `width`/`zoom`/`changeModeEnabled`/`changeSetName` oder
`pdfOptions.filename`/`pdfOptions.modelFilename`/`pdfOptions.pageSize`/`pdfOptions.portrait`/`pdfOptions.paging`.


## Schritt 5 — Textänderung nachverfolgen (nur bei aktiver Änderungsverfolgung, nur bei `nsd-set-text`)

Zweistufig, da `plain=` nur vom Sanitizer korrekt neu berechnet wird:

1. **Vor** dem `nsd-set-text`-Aufruf aus Schritt 4: `plain` des betroffenen Bereichs aus der
   `nsd-locate`-Ausgabe von Schritt 2 merken (das ist der Alt-Stand).
2. `nsd-set-text` ausführen (Schritt 4).
3. Sanitizen (Schritt 6), damit `plain=` den neuen Text korrekt widerspiegelt.
4. Markups berechnen und schreiben:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-diff-markups.mjs" --file <target> --step <id> --area <key> --old-plain <alter-plain-text> --changeset <name> --json
   ```
   Erzeugt genau einen `Changed`-Span über den geänderten Bereich (kein Versuch, an
   HTML-Tag-Grenzen feiner aufzuteilen — das bräuchte Specmans eigenen Renderer). Bei einer reinen
   Löschung ohne neuen Text im Ergebnis wird bewusst kein Markup geschrieben — das ist kein Fehler.
5. Erneut sanitizen (Schritt 6), um das Ergebnis zu bestätigen.

## Schritt 6 — Sanitizen

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <target> --json
```

- `OK` oder `SANITIZED`: fertig. `stable: true` heißt: ein zweiter Lauf lässt die Datei unverändert.
  `plainTextFieldsRefreshed` ist kein Fehlerzähler und bleibt bei Specs mit einem leeren `<div>` am
  Anfang von intro/outro-Textblöcken dauerhaft > 0 (Sanitizer-Eigenheit); nur `stable: false` oder
  `ERROR` verlangt Nacharbeit. Bei `SANITIZED` die Zusammenfassung (`stepNumberChanges`,
  `steplinkUpdates`, `plainTextFieldsRefreshed`) kurz berichten.
- `ERROR`: `message` lesen, Ursache beheben (meist ein Fehler in den vorherigen Schritten), erneut
  versuchen. Nie eine fehlerhafte Datei so stehen lassen.

## Schritt 7 — Historieneintrag

Nach erfolgreichem Sanitizen (Schritt 6) **eine** Zeile für den ganzen Bearbeitungsdurchlauf in die
Dokumentenhistorie-Tabelle des `intro`-Blocks eintragen — nicht eine Zeile pro Einzeländerung aus
Schritt 4.

1. **Autor auflösen:**
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --get author --json
   ```
   Leer (erste Nutzung) → Namen erfragen, abkürzen lassen, bestätigen, merken:
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --abbreviate-name "<voller Name>" --json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --set author --value "<bestätigter, abgekürzter Name>" --json
   ```

2. **Bestand lesen** (Grundlage für den Versions-Vorschlag):
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-history.mjs" --file <target> --mode read --json
   ```
   Höchste als `<int>.<int>` parsbare Version in `rows` bestimmen (`-`-Zeilen ignorieren).

3. **Eine** Aktivitätszeile für den gesamten Durchlauf formulieren — kurze Nominalphrase im Stil
   bestehender Specs („Verhalten bei Änderung von Mandanten, Land und Gliederungsschema
   angepasst", „Hinzufügung von Rechten als Vorbedingung"), keine Aufzählung einzelner Schritte,
   keine Schrittnummern.

4. **Version vorschlagen und bestätigen lassen** (`AskUserQuestion`, Vorschlag als erste Option,
   dazu freie Eingabe): reine Wortlaut-/Präzisierungsänderung an bestehenden Schritten →
   `x.(y+1)`; neue/entfernte Schritte oder geänderter Ablauf → `(x+1).1`. Ohne parsbare
   Vorversion offen fragen, ohne Vorschlag.

5. **Folgeaktion erfragen** (`AskUserQuestion`, Optionen `-` und `Review`).

6. **Zeile schreiben und erneut sanitizen:**
   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-history.mjs" --file <target> --mode append --version <v> --activity "<Zusammenfassung>" --author "<Name>" --followup <-|Review> --json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <target> --json
   ```

**Nie selbst eine Review-Zeile schreiben** — ein Review ist ein manueller Vorgang außerhalb dieses
Skills; die Review-Zeile trägt die reviewte Version, nicht `-`. Die Folgeaktion `Review` in der Zeile einer
eigenen Bearbeitung ist dagegen nur eine Vormerkung („wartet auf Review") und erlaubt.
