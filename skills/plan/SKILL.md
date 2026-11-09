---
name: plan
description: "Interviews the user to design a new Specman SUC (or sub-SUC) specification, then generates the .nsd file from the template and sanitizes it. Use only when a genuinely new specification needs to be created from scratch. Not for editing an existing .nsd (use edit) or for implementing code from one (use implement)."
argument-hint: "[--dir <spec-ordner>] [--parent <suc-nummer>]"
allowed-tools:
  - Read
  - Write
  - AskUserQuestion
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# plan

Baut eine neue Spezifikation in zwei Phasen: erst ein Interview mit einer privaten
Arbeits-Outline (nie zur Freigabe vorgelegt), dann Erzeugung und Sanitizing der eigentlichen
`.nsd`-Datei (die einzige Freigabe-relevante Ausgabe).

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

## Schritt 1 — Zielordner und Nummer

Ordner vom Nutzer erfragen, falls nicht über `--dir` gegeben (der projektspezifische Spec-Ordner,
siehe `.claude/specman.local.md` → `specDir`, falls vorhanden).

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-suc-number.mjs" --dir <ordner> [--parent <suc-nummer>] --json
```

Ergebnis (`number`) dem Nutzer vorschlagen, nicht stillschweigend übernehmen — er kennt die
richtige Themen-Range (z. B. `9xx`) und kann eine andere Nummer wollen.

## Schritt 2 — Eigener Unter-SUC oder nicht?

Falls der Nutzer einen größeren, mehrteiligen Ablauf beschreibt: **eine Frage stellen**, ob ein
Teilablauf einen eigenen Unter-SUC verdient (separate `.nsd`-Datei, hierarchisch benannt,
z. B. `SUC-902.4 <Titel>.nsd`) oder als Subsequenz innerhalb dieser einen Datei bleibt. Das ist
eine Urteilsfrage — keine automatische Aufteilungslogik. Querverweise zwischen SUC-Dateien sind
immer reiner Fließtext im Stil „Siehe SUC-902.1.2 <Titel>", nie ein struktureller Link.

## Schritt 3 — Interview

Ein Punkt pro Nachfrage, bis Folgendes klar ist:

1. Zweck / Kurzbeschreibung
2. Auslöser / Vorbedingungen
3. Akteure
4. Hauptablauf (Schritt für Schritt)
5. Ausnahmen / Abbruchfälle
6. Nachbedingungen / Ergebnis(e)
7. Geschäftsregeln / nichtfunktionale Anforderungen (optional)

Bevorzugt `AskUserQuestion` mit klaren Optionen, wo sinnvoll; sonst offene Fragen.

## Schritt 4 — Private Arbeits-Outline

Halte den Interview-Stand als Markdown fest unter
`C:/Users/<user>/.claude/tmp/scratch/<slug>-outline.md` (Konvention für flüchtige
Zwischendateien aus dem globalen CLAUDE.md des Nutzers). Diese Datei ist ein reines Arbeitsmittel
für dich selbst — **niemals dem Nutzer zur Freigabe vorlegen**, niemals darauf verweisen als wäre
sie das Ergebnis. Nach erfolgreichem Sanitizing in Schritt 7 löschen.

## Schritt 5 — Datei anlegen

Vorlage `${CLAUDE_PLUGIN_ROOT}/reference/suc-template.nsd` nach `<ordner>/SUC-<nummer> <Titel>.nsd`
kopieren (`Read` + `Write`, keine Bash-Kopie — Konsistenz mit dem Rest des Plugins).

## Schritt 6 — Struktur befüllen

Anhand der Outline aus Schritt 4 die Ablaufspezifikation aufbauen — pro Hauptschritt eine
Subsequenz oder ein einfacher Schritt, je nach Komplexität. Verzweigungen (Bedingungen,
Fallunterscheidungen, Schleifen) direkt als solche abbilden, nicht als Fließtext-Ersatz:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-locate.mjs" --file <datei> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-insert-step.mjs" --file <datei> --parent <sequence-key> --position end --kind simple|break|while|doWhile|subsequence|if|ifElse|case [--branches <n>] --html <html> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <datei> --step <id> --area <key> --html <html> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <datei> --step <id> --op insert --kind text|list|table --position start|end|after:tail[i] [...] --json
```

Nie selbst DSL-Text von Hand schreiben, auch nicht für Titel und intro/outro (Details im
`edit`-Skill, Schritt 2 und 4):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-locate.mjs" --file <datei> --step intro --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <datei> --step intro --title "SUC-<nummer> <Titel>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <datei> --step intro --area <tail-key aus sections> --section Beschreibung --text "<Klartext>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <datei> --step intro --area <liste>.items[0] --html <html> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <datei> --step intro --op add-item --area <liste> --position end --html <html> --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-set-text.mjs" --file <datei> --step outro --area head --section Geschäftsregeln --text "<Klartext>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <datei> --step outro --op insert --kind text --position after:<tail-key> --heading Akzeptanzkriterien --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-area.mjs" --file <datei> --step outro --op insert --kind table --position after:<tail-key> --rows '[["Nr","Kriterium"],["1","..."]]' --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-catch.mjs" --file <datei> --op add --break <break-stepId> --head "<Klartext>" --json
```

Pflicht nach dem Befüllen: Titel gesetzt (nicht mehr `SUC-000 Template`), Beschreibung sowie
Auslöser- und Resultat-Listen aus dem Interview, Geschäftsregeln/Akzeptanzkriterien soweit
erhoben, und zu jedem Ausnahme-/Abbruchfall ein `break` mit `catch` (Interview-Punkt 5) —
`nsd-locate` ohne `--step` darf am Ende keine `uncaughtBreaks` melden. Soll ein Schritt aus einer
anderen Spec seine ID behalten: `nsd-insert-step ... --id <8 Hex>`.

Weitere Regeln: Tabellen und Listen als echte Areas über `nsd-area.mjs`
anlegen (siehe `edit`-Skill Schritt 4 für alle Operationen und Optionen), nicht als Fließtext
imitieren. Bei einem strukturierten Kind (`while`/`doWhile`/
`subsequence`/`if`/`ifElse`/`case`) füllt `nsd-insert-step.mjs` jeden zwingenden Zweig/Body
zunächst mit einem Platzhalter — `insertedStepId`/`placeholderStepIds` aus der Antwort sofort mit
`nsd-set-text.mjs` befüllen (Zweig-Überschriften über die Areas `ifBranch.head`/`elseBranch.head`/
`defaultBranch.head`/`caseBranch[n].head`, siehe `edit`-Skill Schritt 4 für Details). Beschreibung,
Ablaufspezifikation und Offene-Punkte aus dem Template beibehalten (siehe
`reference/suc-template.nsd`), Inhalte aus dem Interview einsetzen.

## Schritt 6a — Dokumentenhistorie befüllen

Die Vorlage bringt bereits eine Zeile `0.1 | Initiale Erstellung | (leer) | (leer) | (leer)` mit.
Autor auflösen und die drei leeren Zellen befüllen:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --get author --json
```

Leer (erste Nutzung) → Namen erfragen, abkürzen lassen, bestätigen, merken:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --abbreviate-name "<voller Name>" --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/specman-config.mjs" --set author --value "<bestätigter, abgekürzter Name>" --json
```

Dann die Zeile schreiben (Version `0.1` und Aktivität `Initiale Erstellung` bleiben unangetastet,
Datum ist das heutige):

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-history.mjs" --file <datei> --mode fill-initial --author "<Name>" [--followup <-|Review>] --json
```

Die Folgeaktion ist standardmäßig `Review` (eine frisch geplante Spec wartet auf ihr Review);
`--followup -` nur, wenn der Nutzer das ausdrücklich will.

## Schritt 7 — Sanitizen

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sanitize.mjs" --file <datei> --json
```

Bei `ERROR`: Ursache beheben, erneut versuchen. Bei `OK`/`SANITIZED`: Outline-Datei aus Schritt 4
löschen. Enthält die Antwort ein `warnings`-Array (z. B. Jar älter als Specman 1.4.0), jede
Warnung dem Nutzer zeigen.

## Schritt 8 — Zusammenfassung zur Freigabe

Klartext-Zusammenfassung des Ergebnisses zeigen (Dateiname, Hauptschritte, offene Punkte) — **nie
die rohe `.nsd` als Freigabe-Artefakt zeigen**. Das ist der erste und einzige Freigabepunkt in
diesem Skill.
