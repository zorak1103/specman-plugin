---
name: sync-refs
description: "Scans Java Javadoc and TypeScript/Angular JSDoc comments for SUC-XXX Schritt N (ID: xxx) references and corrects the step number wherever it has drifted from the step's current number in the actual .nsd file, resolved via the stable ID. Use whenever spec step numbers may have shifted (after editing a spec, or as a standalone check) and code comments need to stay accurate. Not for editing the spec itself."
argument-hint: "[<datei-oder-ordner>] [--spec-dir <ordner>]"
allowed-tools:
  - Read
  - Grep
  - Glob
  - Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/*" *)
---

# sync-refs

## Schritt 1 — Ziel und Spec-Ordner bestimmen

Ohne Argument: den aktuellen Diff bzw. die zuletzt bearbeiteten Dateien des Projekts annehmen
(`Grep` nach `SUC-\d+.*Schritt.*\(ID:` über das Projekt, falls nichts anderes genannt wurde). Der
Spec-Ordner kommt aus `--spec-dir`, oder aus `.claude/specman.local.md` (`specDir`), oder wird
einmal erfragt.

## Schritt 2 — Pro Datei aktualisieren

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/sync-refs.mjs" --file <datei> --spec-dir <ordner> --json
```

Für jede betroffene Datei einzeln aufrufen (Java- wie TypeScript/Angular-Dateien gleichermaßen —
das Skript erkennt beide Kommentarstile über dasselbe Muster).

## Schritt 3 — Ergebnis berichten

- `changedCount`: Anzahl korrigierter Referenzen — kurz auflisten, welche Datei/Referenz betroffen
  war.
- `unresolved`: Referenzen, die nicht aufgelöst werden konnten (Spec-Datei nicht gefunden, oder
  die ID existiert nicht mehr im Spec). Beides dem Nutzer melden, nicht stillschweigend
  ignorieren — eine nicht mehr existierende ID deutet auf einen gelöschten Schritt hin, den der
  Code-Kommentar noch referenziert.
