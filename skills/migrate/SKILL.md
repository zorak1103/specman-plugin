---
name: migrate
description: "Migrates an existing Word (.docx) SUC specification to a Specman .nsd file next to it -- branches, loops and exceptions become structured steps, images become wireframes, the document history is carried over -- without losing any logic. Use only when an existing .docx specification should become a .nsd. Not for creating a new specification (use plan), editing an existing .nsd (use edit) or implementing code from one (use implement)."
argument-hint: "--file <docx> | --all [--dir <spec-ordner>]"
allowed-tools:
  - Read
  - Write
  - AskUserQuestion
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# migrate

Migriert eine Word-Spezifikation (`.docx`) nach Specman (`.nsd`). Die `.nsd` entsteht **neben der
docx** unter dem gleichen Namen (`SUC-220 Titel.docx` → `SUC-220 Titel.nsd`); die docx wird nie
verändert.

## Keine Logik darf verloren gehen

Das ist die oberste Regel dieses Skills — wichtiger als eine schöne Struktur:

* **Nichts weglassen, nichts umformulieren, nichts zusammenfassen.** Jede Bedingung, Regel,
  Feldbeschreibung, Fehlerbehandlung, Zahl, Tabelle und Designanmerkung der docx steht danach in
  der `.nsd`. Text kommt per `ref` aus dem Extrakt, nicht aus dem Gedächtnis. **Einzige Ausnahme:**
  Verzweigungen werden zu Frage + Aktion im Zweig umformuliert (Schritt 4b) — nur mit vorheriger
  Freigabe des Nutzers und nur über das Plan-Feld `reworded`, nie über `ignored`.
* **Nichts erfinden.** Eigener Text ist nur für Überschriften erlaubt, die es im docx nicht gibt
  (z. B. Zweigbezeichnungen `Ja`/`Nein`) und für die freigegebenen Umformulierungen aus Schritt 4b.
  Fachlich Neues, Geglättetes oder „Aufgeräumtes“ kommt nicht hinein.
* **Struktur darf Logik nicht verändern.** Reihenfolge, Bedingungen und Zuordnung (wer macht was,
  was passiert wann/sonst) bleiben exakt. Ist eine Verzweigung nicht eindeutig erkennbar,
  bleibt der Text als einfacher Schritt stehen — lieber flach und vollständig als strukturiert und
  falsch.
* **Technisch abgesichert:** `nsd-build-from-plan.mjs` bricht ab, solange ein Absatz oder Bild
  des docx weder verwendet noch mit Begründung in `ignored` aufgeführt ist; `migrate-verify.mjs`
  prüft nach dem Bauen, dass jeder Absatz im Ergebnis vorkommt oder als `reworded` freigegeben ist.
  **Diese Prüfungen nie umgehen** (kein Fachinhalt in `ignored`, kein Weglassen von Warnungen).
* **Nichts still verschwinden lassen:** Alles, was das Zielmodell nicht abbilden kann
  (verbundene Tabellenzellen, verschachtelte Listen, Fußnoten, Textfelder, Nicht-PNG-Bilder),
  steht im Bericht (Schritt 9) und wird dem Nutzer genannt.

Daneben gilt wie im ganzen Plugin: **nie `.nsd`-Syntax von Hand schreiben** — jede Mutation läuft
über die Skripte unter `${CLAUDE_PLUGIN_ROOT}/scripts/`. Fehlt eine Fähigkeit: stoppen und dem
Nutzer sagen, nicht improvisieren.

Festgelegte Entscheidungen: Tracked Changes → **Endstand** (Einfügungen bleiben, Löschungen
entfallen); **Kommentare werden ignoriert**; Kontrollfluss wird **automatisch** als
if/ifElse/case/while/`break`+Catch abgebildet; Bilder werden als **Wireframe-Bilder** übernommen;
die Historie der docx wird übernommen und um eine Migrationszeile ergänzt.

## Schritt 0 — Voraussetzung prüfen: Sanitizer-Jar

Bevor irgendetwas angefasst wird, prüfen, ob die Umgebungsvariable `SPECMAN_JAR` stimmt — der
Sanitizer-Schritt am Ende scheitert sonst erst nach getaner Arbeit:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-jar.mjs" --json
```

* `ok: false`: **Stopp.** `error` wörtlich an den Nutzer weitergeben (Variable fehlt, Pfad
  existiert nicht, zeigt auf ein Verzeichnis oder keine gültige `.jar`) und bitten, `SPECMAN_JAR`
  auf den vollen Pfad der `specman-*-jar-with-dependencies.jar` (Specman 1.4.0+) zu setzen und die
  Claude-Code-Session neu zu starten. Nicht weiterarbeiten, nicht „später sanitizen".
* `ok: true` mit nicht-leerem `warnings`: jede Warnung dem Nutzer zeigen (z. B. Jar älter als
  Specman 1.4.0 oder Version nicht erkennbar) und per `AskUserQuestion` fragen, ob trotzdem
  weitergemacht werden soll.
* `ok: true` ohne Warnungen: still weiter zu Schritt 1.

## Schritt 1 — Ziel und Umfang

* `--file <docx>`: genau diese Datei.
* `--all` (optional `--dir`, sonst Ordner erfragen bzw. `specDir` aus `.claude/specman.local.md`):

  ```
  node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-inventory.mjs" --dir <ordner> --json
  ```

  Übersicht zeigen (Dateien, Absätze/Tabellen/Bilder, Zielstatus) und per `AskUserQuestion`
  klären, welche Dateien migriert werden. **Dateien nacheinander** abarbeiten (Schritte 2–10 je
  Datei); bei großem Umfang anbieten, den Rest in einer neuen Sitzung fortzusetzen.

## Schritt 2 — Zieldatei prüfen

Ziel = docx-Pfad mit `.nsd`. Zielstatus (`migrate-inventory.mjs`, bzw. für `--file`
`resolve-target.mjs --file <ziel> --json`):

* `none`: weiter.
* `v2` / `legacy`: es existiert bereits eine `.nsd` → `AskUserQuestion`, ob sie überschrieben werden
  soll (bei `legacy` darauf hinweisen, dass es nicht das V2-Format ist). Bei „nein“ diese Datei
  überspringen.
* `working-copy` (`.wrk` vorhanden, Datei ist in Specman geöffnet): stoppen und den Nutzer bitten,
  sie in Specman zu schließen.

Überschrieben wird später nur mit `--force`, und nur nach dieser Bestätigung.

**Die `.wrk` kann auch nach dem ersten Build entstehen** (der Nutzer öffnet die Datei in Specman und
will weitere Änderungen dort ansehen). Vor **jedem** späteren Neubau Schritt 2 erneut prüfen. Gibt
es jetzt eine `.wrk`, gilt die `.wrk` als die Arbeitsfassung: Es gibt kein Skript, das Schritte
verschiebt oder löscht, daher so vorgehen:

1. Backup der `.wrk` (z. B. `<name>.wrk.bak`) anlegen.
2. Die neu gebaute `.nsd` an einen Zwischenort bauen (nicht über die Zieldatei) und mit
   `sanitize.mjs` prüfen.
3. Die `.wrk` mit dem Ergebnis überschreiben und erneut sanitizen.
4. Den Nutzer ausdrücklich bitten, die Datei in Specman **neu zu laden** (bzw. zu schließen und
   wieder zu öffnen) — Änderungen, die er in Specman seit dem Backup gemacht hat, stehen nur im
   Backup.

Das nur nach Bestätigung durch den Nutzer; nie eine `.wrk` ohne Backup überschreiben.

## Schritt 3 — Extrahieren

Arbeitsordner: `C:/Users/<user>/.claude/tmp/scratch/migrate-<slug>/` (Konvention für flüchtige
Zwischendateien aus dem globalen CLAUDE.md des Nutzers).

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/docx-extract.mjs" --file <docx> --out-dir <arbeitsordner> --json
```

Liefert `extract.json`, `outline.txt` und `i<N>.<ext>` je Bild. Die `warnings` der Antwort
(Fußnoten, Textfelder, Nicht-PNG-Bilder, OLE-Objekte, …) merken — sie kommen in den Bericht.
`stats.comments` wird ignoriert (Kommentare sind laut Vorgabe nicht Teil der Migration).

## Schritt 4 — Outline lesen und Struktur ableiten

`outline.txt` vollständig lesen (`Read`). Jede Zeile trägt die Id (`p12`, `t3`, `i2`), mit der der
Plan arbeitet. Das docx folgt dem SUC-Aufbau: Dokumentenhistorie → Kopftabelle (Titel,
Beschreibung, Akteur(e), Auslöser/Vorbedingung, Resultat/Nachbedingung) → Ablauftabelle
(`Nr. | Beteiligte | Text`, normaler Ablauf, dann Alternativer Ablauf/Ausnahmebehandlung) →
Geschäftsregeln, nicht funktionale Anforderungen, Offene Punkte, Bemerkungen, Testfälle,
Designanmerkungen → Abschnitte „Wireframes“/„Fachklassenmodell“ mit Bildern.

Zuordnung (Details und Schema: `${CLAUDE_PLUGIN_ROOT}/skills/migrate/plan-format.md` — **vor dem
Schreiben des Plans lesen**):

| docx | `.nsd` |
|---|---|
| Titel/Nummer | `number`/`title` |
| Beschreibung, Akteure, Vorbedingungen, Nachbedingungen | `intro.*` |
| Absatz im Style `Essential` (Hauptschritt-Überschrift) | `subsequence`, darunter die Schritte |
| Ablaufzeile `USER`/`SYSTEM`/… | `simple` — nur der Satz, **ohne** Präfix `System:`/`User:` (siehe unten) |
| „Ist …, so …“ / „Andernfalls“ / „Wenn … sonst …“ | `if` / `ifElse` — Kopf = Frage, Aktion im Zweig (Schritt 4b) |
| „Je nach …“, Fallunterscheidung mit Aufzählung | `case` (Default + ≥ 2 Fälle) |
| „Solange …“, „für jeden …“, „wiederhole …“ | `while` (bzw. `doWhile` bei „mindestens einmal“) |
| „Exception …“ / Ausnahmebehandlung / Abbruch | `break` im Ablauf + `catches` mit dem Ausnahme-Ablauf |
| Listen, Feld-/Bedingungstabellen im Schritt | `ref` auf die Absätze/Tabelle → Areas des Schritts |
| Geschäftsregeln, nicht funktionale Anforderungen, Bemerkungen, Design-Anmerkungen | `outro.*` |
| Offene Punkte (Tabelle) | `outro.openPoints` |
| Bilder (inline im Schritt oder unter „Wireframes“/„Fachklassenmodell“) | Image-Area am Schritt bzw. `outro.sections` |

Regeln dabei:

* **Formulierungen ohne Präfix `System:` / `User:`.** Schritttexte beginnen nicht mit dem
  Beteiligten (weder `System:`, `User:` noch fett oder in Großbuchstaben); der Satz steht für sich
  („Das System zeigt …“, „Möchte der User …“). Die Beteiligten-Zelle der Ablauftabelle wird deshalb
  **nicht** vor den Text gesetzt, sondern in `ignored` geführt (Begründung: „Beteiligter steht im
  Satz“). Das Plan-Feld `label` wird nicht für Beteiligte verwendet — der Builder verweigert
  `System`/`User` als `label`. Nennt ein Satz seinen Handelnden nicht (kein „System“/„User“ o. Ä. im
  Satz), ist das kein Grund für ein Präfix: Satz unverändert lassen und die Stelle im Bericht
  nennen, damit der Nutzer entscheidet.
* **Verzweigungen sind Frage + Aktion.** Der Kopf von `if`/`ifElse` ist eine Frage („Liegen für die
  Bilanz bereits Auswahlen vor?“); jeder Zweig (`Ja`/`Nein`) enthält die Aktion, die dann
  ausgeführt wird. Steht Bedingung und Folge in einem Absatz, wird er **nicht** als Ganzes Kopf,
  sondern in Frage und Zweigaktion zerlegt — das ist eine Umformulierung und läuft über Schritt 4b.
* **Konservativ flach lassen**, was keine echte Verzweigung ist: „Möchte der User …“ (Auslöser
  einer Aktion), Inline-„bzw.“ und „Wenn … dann“ in Hinweisen. Echte Verzweigungen sind etwa
  „Sofern … / Andernfalls …“ oder „Liegen … vor? … sonst …“.
* **Keine Stichpunkte bei Einzelschritten.** Ein Aufzählungspunkt der docx, der als eigener Schritt
  (z. B. Zweig einer Verzweigung) migriert wird, ist normaler Schritttext, keine einelementige Liste
  mit leerem Kopf: am `ref` `"flatLists": true` setzen. Der Build warnt bei einem Schritt mit leerem
  Schritttext. Mehrere zusammengehörige Stichpunkte dürfen weiter eine Liste sein.
* **Anmerkungen** („Anmerkung: …“) bleiben am Schritt hängen: per `areas` mit `kind: "text"` und
  `ref`, wenn der Kopf des Schritts eigener Text ist.
* **Verweise auf nummerierte Alternativen** („Für 1, 2 und 3 gilt …“, „Für 4 gilt …“) beziehen sich
  auf eine Liste im Vorschritt. Solche Verweise werden zu einer Frage umformuliert (Schritt 4b)
  und stehen im Bericht unter den Umformulierungen — nie unverändert als Zweigkopf übernehmen, wenn
  der Bezug im Ergebnis nicht mehr eindeutig ist.
* Eine Exception, auf die der Ablauf verweist, wird ein `break`-Schritt (`id` vergeben); der
  Ausnahme-Ablauf des docx wandert in den zugehörigen `catches`-Eintrag des umschließenden
  Containers.
* Bilder: Position im docx entscheidet — Bild in/neben einem Ablaufschritt → Area dieses
  Schritts, Bild unter einer Abschnittsüberschrift → `outro.sections` mit derselben Überschrift.
  Skalierung nur angeben, wenn der Default (Breite relativ zum Diagramm) offensichtlich nicht passt.
  Ist ein Bild kein PNG, den Nutzer um eine PNG-Konvertierung bitten (`pngFile`).
* Zweifelsfälle (ist das wirklich eine Verzweigung? gehört das Bild hierher?) **gesammelt** per
  `AskUserQuestion` klären, bevor der Plan geschrieben wird — oder konservativ flach lassen und
  im Bericht nennen.

## Schritt 4b — Formulierungen prüfen und freigeben lassen

Bei **jeder** Migration (nicht nur bei Verzweigungen) die Formulierungen der Schritttexte
durchsehen: unklare Sätze, fehlender Handelnder, Verzweigungen ohne Frage. Geändert wird nichts
ungefragt.

* Für jede Verzweigung, die zu Frage + Aktion umgebaut werden soll, **konkrete Formulierungen
  vorschlagen**: Originalabsatz → Frage (Kopf) → Aktion je Zweig. Alle Vorschläge **gesammelt**
  per `AskUserQuestion` vorlegen (Übernehmen / anders formulieren / flach lassen) — **bevor** der
  Plan geschrieben wird.
* Freigegebene Umformulierungen: Frage und Zweigaktion als eigener Text (`"Text"`) in den Plan, die
  ersetzten Originalabsätze in **`reworded`** (`reason`: „Bewusst zu Frage/Aktion umformuliert
  (Freigabe des Nutzers)“) — nicht in `ignored`.
* **Dubletten prüfen, bevor der Plan entsteht:**
  * Gleiche Bedingungen in aufeinanderfolgenden Schritten („Für 1, 2 und 3 gilt …“ / „Für 4 gilt …“
    in zwei Schritten) sind **eine** Verzweigung, nicht zwei. Nie zweimal 1:1 übernehmen.
  * Gleichartige Blöcke (z. B. Datenlisten) **Absatz für Absatz vergleichen**. Unterschiede (etwa
    ein abweichender Branchencode) **gesammelt** per `AskUserQuestion` vorlegen. Zusammengelegt
    werden nur wortgleiche Dubletten oder vom Nutzer freigegebene; die ersetzten Absätze stehen
    dann in `reworded` (mit Verweis auf den behaltenen Absatz im `reason`), nie in `ignored`.
* Nicht freigegeben: Absatz unverändert per `ref` übernehmen (flach, vollständig).
* Sonstige Auffälligkeiten ohne Umformulierung gehören in den Bericht (Schritt 9), nicht in den Plan.

## Schritt 5 — Plan schreiben

Plan als `plan.json` in den Arbeitsordner schreiben (`Write`). Inhalt nur per `ref`/Schlüsselwörter
des Plan-Formats; **jede** Id aus `outline.txt` wird entweder verwendet oder mit Begründung
(`reason`) in `ignored` geführt — und `ignored` ist nur für Beschriftungen, Leerzellen und
Strukturelemente, die die Vorlage selbst mitbringt, nie für Fachinhalt. Vom Nutzer freigegebene
Umformulierungen (Schritt 4b) stehen in `reworded`.

## Schritt 6 — Bauen

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-build-from-plan.mjs" --plan <plan.json> --extract <extract.json> --out <ziel.nsd> [--force] --json
```

* `unreferenced` im Fehler: diese Inhalte fehlen im Plan. **Plan korrigieren** (verwenden), nicht
  wegbegründen — außer es ist tatsächlich reine Struktur. Steht eigener Text anstelle eines
  Absatzes, gehört dieser nur dann in `reworded`, wenn der Nutzer in Schritt 4b zugestimmt hat.
* Sonstige Fehler (leerer Body, `case` mit < 2 Fällen, unbekannte Id, …): Plan anpassen, erneut
  bauen.
* `warnings` (aufgelöste Zellverbünde, abgeflachte Listen, Schritte mit leerem Schritttext) und
  `summary.defaultedBranchHeads` für den Bericht merken; fehlende Zweigbezeichnungen nachtragen,
  wenn das docx welche hergibt.
* **Jeder Neubau mit `--force` schreibt die Historie neu aus dem Extrakt.** Sobald Version, Autor und
  Folgeaktion aus Schritt 8 feststehen, beim Bauen `--migration-version <v> --migration-author
  "<Name>" --migration-followup <-|Review>` mitgeben (alle drei zusammen): die Migrationszeile wird
  dann gleich mitgeschrieben und geht bei Neubauten nicht verloren.

## Schritt 7 — Sanitizen und prüfen

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <ziel.nsd> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/migrate-verify.mjs" --extract <extract.json> --nsd <ziel.nsd> --plan <plan.json> --json
```

* `ERROR` vom Sanitizer: Ursache im Plan beheben, neu bauen (`--force`), erneut versuchen. Nie eine
  fehlerhafte Datei stehen lassen. Ist `SPECMAN_JAR` nicht gesetzt, bricht der Sanitizer ab:
  `node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-jar.mjs" --json` bestätigt das (es liest nur die
  Umgebungsvariable und sucht nicht selbst). Dann Nutzer fragen, ob nach dem JAR gesucht werden
  soll, und den Pfad nennen lassen oder bestätigen (siehe README) — Sanitizing wird nicht
  übersprungen.
* `warnings` in der Sanitizer-Antwort (bei jedem Status): jede Warnung dem Nutzer zeigen (Jar zu
  alt, Spezifikation von einem neueren Specman als die Jar).
* `stepNumberChanges` in der Sanitizer-Antwort: Der Sanitizer hat Schrittnummern verschoben. Bei
  einer frischen Migration harmlos. Wird eine bereits migrierte `.nsd` neu gebaut und verweisen
  Code-Kommentare auf ihre Schrittnummern, danach `sync-refs` vorschlagen.
* `migrate-verify` mit `ok:false`: `missing` (Absätze, die in der `.nsd` fehlen), abweichende
  Bild- oder Schrittzahl. Plan korrigieren und von Schritt 6 an wiederholen. Höchstens drei
  Durchläufe; danach den Stand und die offenen Lücken dem Nutzer vorlegen statt weiterzuraten.
  `reworded` in der Antwort listet die freigegebenen Umformulierungen — sie kommen getrennt in den
  Bericht.
* Arbeitsverzeichnis und Shell-Zustand werden nach jedem Bash-Aufruf zurückgesetzt: **absolute
  Pfade** verwenden.

## Schritt 8 — Migrationszeile in der Historie

Die Historie der docx steht bereits 1:1 in der Datei. Zusätzlich **eine** Zeile für die Migration:

1. Autor: `node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --get author --json`. Leer →
   Namen **im Freitext erfragen** (eine einzelne Option reicht für `AskUserQuestion` nicht),
   abkürzen lassen (`--abbreviate-name`), bestätigen, mit `--set author` merken (wie im
   `plan`-Skill). Nie ohne Rückfrage einen Namen annehmen.
2. `node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-history.mjs" --file <ziel.nsd> --mode read --json` →
   höchste als `<int>.<int>` parsbare Version bestimmen (`-`-Zeilen ignorieren).
3. `AskUserQuestion` mit **Version** und **Folgeaktion** (`-` oder `Review`). Das Muster der
   Versionszählung **aus den letzten Zeilen ableiten**, nicht blind `x.(y+1)` vorschlagen: zählt die
   Historie in Hauptversionen (`5.1`, `6.1` → Vorschlag `7.1`) oder in Nebenversionen (`2.1`, `2.2`
   → `2.3`)? Das abgeleitete Muster als erste Option, die Alternative als zweite; ohne parsbare
   Vorversion offen fragen.
4. Zeile schreiben und erneut sanitizen — **nur** wenn die Datei ohne `--migration-*`-Flags gebaut
   wurde; sonst steht die Zeile schon da (Schritt 6), und es bleibt beim Sanitizen:

   ```
   node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-history.mjs" --file <ziel.nsd> --mode append --version <v> --activity "Migration von Word nach Specman" --author "<Name>" --followup <-|Review> --json
   node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <ziel.nsd> --json
   ```

**Nie eine Review-Zeile schreiben** — ein Review ist ein manueller Vorgang.

Bei Neubauten (Schritt 6, z. B. nach Korrekturen aus dem Bericht) dieselben `--migration-*`-Werte
erneut mitgeben — Version und Folgeaktion werden nicht erneut erfragt.

## Schritt 9 — Bericht zur Freigabe

Klartext-Zusammenfassung pro Datei — **nie die rohe `.nsd` zeigen**:

* Zieldatei, Anzahl Schritte (Blatt/Struktur) und welche Verzweigungen/Schleifen/Exceptions
  erkannt wurden (kurz, mit Schrittüberschrift)
* Bilder (Anzahl, wohin)
* Historie (übernommene Zeilen + Migrationszeile)
* **Ergebnis der Treueprüfung** (`checkedParagraphs`, `missing` leer?)
* **Freigegebene Umformulierungen** (`reworded` aus Build/Verify) als eigener Abschnitt: je
  Eintrag Originalabsatz → neue Formulierung. Nicht mit den ignorierten Texten vermischen.
* **Alles Nicht-Abbildbare und alle Warnungen** (Zellverbünde, abgeflachte Listen, Fußnoten,
  Textfelder, Nicht-PNG-Bilder, defaultete Zweigbezeichnungen)
* **Liste der ignorierten Texte**, gruppiert nach Begründung (`ignored` aus der Build-Antwort), damit
  der Nutzer sieht, was bewusst nicht als eigener Inhalt übernommen wurde
* offene Zweifelsfälle

Das ist der erste und einzige Freigabepunkt je Datei. Der Arbeitsordner unter `.claude/tmp/scratch/`
bleibt für Rückfragen liegen (Bilder und `extract.json`); Pfad nennen.
