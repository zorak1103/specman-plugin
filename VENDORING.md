# Vendoring — Herkunft und Aktualisierung der Referenzdateien

Dieses Dokument ist **nicht Teil des Plugin-Verhaltens** — kein Skill, kein Agent und kein Script
liest diese Datei zur Laufzeit. Sie dient ausschließlich der Pflege des Plugins selbst: woher die
Dateien unter `reference/` stammen und wie sie bei einem Update von Specman neu bezogen werden.

## Quelle

Upstream-Repository: `https://github.com/j-specman/specman`
Lizenz: BSD-3-Clause-artig (`license.txt` im Upstream-Repo) — Redistribution mit Copyright-Hinweis
und Haftungsausschluss ist erlaubt. Beim Neu-Vendoring den Lizenztext gegenprüfen, falls sich das
Upstream-Projekt umlizenziert.

## Vendorte Dateien

| Datei hier | Upstream-Pfad | Bezogen am |
|---|---|---|
| `reference/SpecmanModel_V002.g4` | `src/main/antlr4/specman/model/v002/SpecmanModel_V002.g4` | 2026-09-16 |
| `reference/specman-reference-v1.3-model-v2.nsd` | `specman-reference-v1.3-model-v2.nsd` (Repo-Root) | 2026-09-16 |

`reference/suc-template.nsd` ist **keine Upstream-Datei** — sie ist projekteigen (abgeleitet aus
`suc-template.nsd`, ursprünglich im alten V001-JSON-Format, von Hand einmal in Specman 1.3.0
geöffnet und gespeichert, um sie auf das V2-Textformat zu heben). Bei einer Aktualisierung dieser
Datei: in Specman öffnen, prüfen, speichern, dann hierher kopieren — kein Bezug von GitHub nötig.

## Was bewusst NICHT vendort wird

- Die Sanitizer-Jar (`specman-*-jar-with-dependencies.jar`, ~48–50 MB) — zu groß fürs Git-Repo.
  Nutzer:innen stellen den Pfad über die Environment-Variable `SPECMAN_JAR` bereit (siehe
  `README.adoc`).
- `gutenmorgen.nsd` — persönliches Scratch-File aus der lokalen Specman-Installation, kein
  Distributionsbestandteil.
- `specman.bat` — der Launcher hat aktuell einen Bug (`%1` statt `%*`, verschluckt Argumente wie
  `--sanitize <file>`); das Plugin ruft `java -jar` ohnehin direkt auf und umgeht die `.bat`
  vollständig.

## Wie ein Update aussieht

1. Neue Version der Grammatik/Referenz/Jar aus `github.com/j-specman/specman`
   beziehen (lokal z. B. unter `C:\Users\<user>\Desktop\specman-installation\` oder per
   `git clone`/`git pull` auf `github.com/j-specman/specman`).
2. `reference/SpecmanModel_V002.g4` und `reference/specman-reference-v1.3-model-v2.nsd` durch die
   neuen Versionen ersetzen.
3. `diff` gegen die vorherige Version laufen lassen — jede neue Grammatik-Produktion,
   jedes neue optionale Attribut kann `scripts/lib/nsd-ast.mjs` betreffen (Parser **und**
   Serializer, siehe deren Kommentare zu Produktions-Abdeckung). Insbesondere prüfen:
   - Neue Schritt-Typen oder neue optionale Parameter je Schritt-Typ.
   - Geänderte Lexer-Präzedenz (z. B. `STEP_ID` vs. `INT` vs. `STEP_NUM`).
   - Geänderte Semantik von `change=`/`markups=` (Änderungsarten, erlaubte Konstruktionen).
4. `node --test "test/**/*.test.mjs"` laufen lassen — insbesondere die
   Rundtrip-Tests gegen die neue Referenzdatei (Parse → Serialize → erneut Parse).
5. Betroffene Skripte/Skills anpassen, `plugin.json`-Version nach SemVer erhöhen, committen.

## Bekannte Eigenheiten des Formats (Stand 2026-09-16, siehe Skript-Kommentare für Details)

- `change=(added|removed|source|target, changeset[, sourceStep=<id>])` — kein „modified"; das
  wurde 2021 im Specman-Code explizit entfernt (`Aenderungsart.Bearbeitet` gestrichen).
- `source`/`target`-Verknüpfung (Schritt-Verschiebung mit Tracking) wird von Specman selbst nicht
  validiert — ein falsches `sourceStep=` crasht die GUI beim Laden. Dieses Plugin erzeugt solche
  Paare bewusst nicht selbst (siehe Plan-Dokument der ursprünglichen Implementierung).
- Reale Bestandsspezifikationen liegen oft noch im alten V001-JSON-Format vor — die V2-Werkzeuge
  dieses Plugins lehnen solche Dateien mit einer klaren Meldung ab, statt sie falsch zu
  interpretieren.
