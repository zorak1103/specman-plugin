---
name: implement
description: "Reads a Specman SUC .nsd specification and either implements the corresponding code directly (small SUCs) or proposes a phased implementation plan for it (large SUCs), with SUC-XXX Schritt N (ID: xxx) references in the generated Javadoc/JSDoc comments. Use only when code needs to be written or changed to match an existing spec. Not for editing the spec itself (use edit) or creating a new one (use plan)."
argument-hint: "<suc-datei>"
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

## Schritt 1 — Spezifikation lesen

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/nsd-locate.mjs" --file <suc-datei> --json
```

Schlägt der Aufruf mit einem Hinweis auf V001/`modelType` fehl: Stopp, Nutzer bitten, die Datei
einmal in Specman 1.3.0+ zu öffnen und zu speichern. `sequences` gibt einen Überblick über die
Struktur (Anzahl Hauptschritte je Sequenz); für den vollen Ablauftext gezielt mit `--step` pro
Hauptschritt nachfragen (siehe `edit`-Skill für die Adressierung).

## Schritt 2 — Umfang einschätzen

Grober Anhaltspunkt: mehr als ~15-20 Schritte insgesamt, mehrere Akteure, oder mehrere
unabhängige Ausnahmepfade sprechen für "groß". Bei Unsicherheit lieber nachfragen als raten.

**Bei großem Umfang:**

> „Der zu implementierende SUC ist sehr groß, ich würde nicht zur Umsetzung sondern stattdessen
> einen phasenweisen Umsetzungsplan erstellen."

`AskUserQuestion` (`header: "Umfang"`) — Zustimmung? Bei Ja: einen Phasenplan als Markdown-Datei
erstellen (Ablageort per Rückfrage; ohne Vorgabe neben der `.nsd`-Datei). Pro Phase: Schrittbereich
(Schritt-IDs aus `nsd-locate`), betroffene Komponenten/Dateien, Abhängigkeiten zu anderen Phasen
und ein Prüfkriterium. Danach ausdrücklich sagen: **die Phasen werden in eigenen Sessions
umgesetzt** — in dieser Session nicht mit der Implementierung weitermachen, auch nicht teilweise.

**Bei kleinem Umfang:** weiter mit Schritt 3.

## Schritt 3 — Direkt umsetzen

Normale Implementierungsarbeit — bestehende Muster im Zielprojekt befolgen, Tests wie im Projekt
üblich. Zusätzlich, wo eine Methode/Klasse einen Schritt der Spezifikation umsetzt, eine
Referenz im Javadoc- bzw. JSDoc-Kommentar ergänzen:

```
SUC-<nummer> Schritt <aktuelle-nummer> (ID: <id>)
```

Die aktuelle Nummer und ID **immer frisch aus `nsd-locate` übernehmen**, nie aus dem Gedächtnis
oder aus einer alten Referenz im Code kopieren — Schrittnummern verschieben sich bei jeder
Sanitize-Runde.

Triffst du auf eine bereits bestehende Referenz mit einer Nummer, die nicht mehr zum aktuellen
Stand der `.nsd`-Datei passt: die ID ist der stabile Anker, korrigiere die Nummer (siehe auch das
eigenständige `sync-refs`-Skill für einen ganzen Datei-/Projektlauf).

## Schritt 4 — Referenzen synchron halten

Nach der Implementierung, oder wenn nur bestehende Referenzen aufgefrischt werden sollen, ohne
sonst etwas zu ändern:

```
/specman:sync-refs
```
