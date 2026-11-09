# QSS als experimentelle Parallelbewertung

Der Branch `ilias-11-update-with-qss` ergänzt den strukturellen QSS-Vergleich als
separate Diagnose. Die vorhandenen Bewertungsmetriken und die reguläre
ILIAS-Punkteberechnung verwenden keine QSS-Werte. QSS ist keine weitere
auswählbare Bewertungsmetrik.

## Ablauf an der Frage

1. „Ausführen“ startet wie bisher die Sequenzen A, B und C in einem eigenen
   SQL-Worker. Nach A wird zusätzlich das tatsächliche Tabellen-/Spaltenschema
   mit SQLite-Metadatenabfragen im selben Browser-Worker ermittelt.
2. Die regulären SQL-Ergebnisse und Bewertungsmetriken stehen bereits nach der
   SQL-Ausführung für Autosave und eine native Fristabgabe bereit. Die sichtbare
   Ergebnistabelle bleibt während der parallelen QSS-Auswertung verborgen.
3. Ein eigener QSS-Worker zeigt die aktuelle Phase und bearbeitete Zustände an.
   Die Anzeige verspricht keine geschätzte Restzeit. Manuelle Weiter-/Zurück- und
   Formularaktionen warten auf das Ende der Auswertung.
4. Nach Ende der Auswertung erscheinen Vergleichspunkte, Abstand und optional
   die Änderungen; anschließend wird die Ergebnistabelle sichtbar. Ein expliziter
   manueller QSS-Abbruch beendet nur den Vergleich und gibt das schon vorhandene
   reguläre SQL-Ergebnis frei. Ein SQL-Abbruch vor einem Ergebnis bleibt ein
   regulär abgebrochener SQL-Lauf.

Es gibt keinen SQL-/QSS-Zeit-Timeout und keine nachgelagerte Abschlussseite.
Die native ILIAS-Testzeit läuft während der Bearbeitung unverändert weiter.
Automatische ILIAS-Fristabgaben werden durch die UI-Sperre nicht aufgehalten.
Ein Browser-/AJAX-Seitenwechsel verwirft alte Worker-Callbacks; sie dürfen weder
neue Antworten noch deren Diagnosefelder verändern.

## Vergleichsmodell und vorläufige Punkte

Das ursprüngliche Repository deckt nur einen begrenzten SELECT-Ausschnitt ab.
Dieser Branch enthält dessen Quellcode, einen getrennten Originalmodell-Adapter
und einen isolierten Suchalgorithmus. Die Voreinstellung für den gesamten
Fragenbestand heißt ausdrücklich `sqlite-syntax-edit-graph-v1`: eine Erweiterung
mit vollständigem SQLite-Syntaxbaum, konservativen Äquivalenzumformungen und
gewichteten Änderungen an Knoten und Unterbäumen. Das ist nicht die unveränderte
semantische Metrik des ursprünglichen Prototyps. Ein optimaler Abstand gilt nur
innerhalb des angegebenen Edit-Modells; ein positiver Abstand beweist keine
semantische Ungleichheit. Details, Herkunft und reproduzierbare Builds stehen in
[lib/qss/README.md](../lib/qss/README.md).

Die vorläufige Skala lautet:

```text
Bezugsabstand = min(Kosten von Leerantwort zu Musterlösung, 5)
Vergleichspunkte = Maximalpunkte * max(0, 1 - Abstand / Bezugsabstand)
```

Sie verhindert, dass eine lange Abfrage durch viele unveränderte Syntaxknoten
einen einzelnen materiellen Fehler fast vollständig verdünnt. Eine Änderung mit
Kosten 1 zieht damit mindestens 20 % der Maximalpunkte ab. Die volle Normierung
gegen die Leerantwort und ein Abzug von einem Punkt je Edit werden im
Korpusbericht als weitere Kalibrierungsvarianten betrachtet. Keine dieser
Skalen ist allein durch die technischen Tests als menschlich faire Benotung
validiert. Dafür sind von Lehrenden bewertete echte Antwortpaare erforderlich.

`score-zero-certified` bezeichnet einen bewiesenen Nullpunktwert innerhalb
dieses Modells, sobald der relevante Abstand vollständig ausgeschöpft ist.
Dabei ist der exakte Abstand unbekannt (`distance: null`) und die Oberfläche
zeigt eine Untergrenze. Nicht unterstützte, fehlerhafte oder abgebrochene
Vergleiche erhalten keinen erfundenen QSS-Punktwert.

Ein ausdrücklich gemeldeter SQL-Laufzeitfehler führt im Parallelvergleich zu
`unsupported` und `points: null`. Das gilt im aktuellen Ablauf auch für Fehler
der Kontrollsequenz C, obwohl B allein gültig gewesen sein kann. Teilpunkte für
solche Fälle sind noch nicht modelliert; die reguläre Fehlerbehandlung bleibt
unverändert. Die Bewertung solcher Antworten wird im Korpusbericht getrennt
von gültigen, aber inhaltlich falschen Antworten ausgewiesen.

## Browser-Konfiguration und Vertrauensgrenze

`JsBlock` stellt die Konfiguration als HTML-escaped JSON in
`#qpisql-qss-config[data-config]` bereit. Der Kontext ist `author` oder
`participant`. Im Autorenkontext wird die aktuelle Sequenz B im Editor als
Referenz verwendet. Im Teilnehmerkontext enthält `referenceSql` die gespeicherte
Musterlösung B. `referenceExecutionValid` bezeichnet ausschließlich die bereits
vorhandene erfolgreiche Ausführungsmarkierung dieser Musterlösung; der Server
führt für QSS kein SQL aus.

**Dieser clientseitige Vergleich macht die vollständige Musterlösung für
Teilnehmende im Browser zugänglich.** Eine versteckte Anzeige oder Minifizierung verhindert dies
nicht. Dieser Branch verwendet diesen Aufbau ausdrücklich für den angeforderten
clientseitigen Parallelvergleich. Auch die gespeicherten QSS-Metadaten stammen
aus dem Browser und sind keine vertrauenswürdige Grundlage für Prüfungsnoten.

`referenceRevision` ist ein SHA-256-Fingerabdruck von Sequenz A, Musterlösung B,
Kontrollabfrage C und den vorhandenen Lösungsmetriken. Er bezeichnet den
Referenzstand und ist keine Signatur des Browserergebnisses. `answerDigest`
bezeichnet entsprechend den Antwortstand. Die UI kann diese Angaben zum
Erkennen veralteter Diagnosen verwenden.

Die Antwortfingerabdrücke nutzen Web Crypto. Für die Speicherung der
Parallelbewertung ist daher ein sicherer Browserkontext erforderlich: HTTPS
oder die lokale Testadresse `localhost`/`127.0.0.1`.

## Speicherung

Das verborgene Formularfeld `qss_evaluation` wird als optionales gleichnamiges
JSON-Objekt innerhalb der bestehenden Teilnehmerantwort gespeichert. Ohne QSS
bleibt das bisherige Antwortformat unverändert. Alte Antworten ohne dieses Feld
werden weiterhin eingelesen; ungültige optionale Metadaten verwerfen die Antwort
nicht. Dafür sind weder eine neue Tabelle noch ein Datenbank-Update erforderlich.

Die PHP-Seite übernimmt ausschließlich begrenzte Diagnosefelder: Status,
Engine-/Modellversion, Abstand, Vergleichspunkte, Suchmetadaten, Änderungen und
Einschränkungen. Sie validiert Typen, endliche Zahlen, Hashformate, Zeichenlängen
und die Gesamtgröße von höchstens 16 KiB. Es bleiben höchstens 50 Änderungen
erhalten; weitere Einträge werden mit `editsTruncated` kenntlich gemacht.
Vollständige SQL-/AST-Snapshots sind keine erlaubten Top-Level-Felder. Die
regulären Bewertungsmetriken werden durch diese Daten nicht ergänzt.

Für gespeicherte Antworten liefert die Ergebnisansicht die Metadaten über
`data-qss-evaluation`, die Texte über `data-qss-labels` und den aktuellen
Referenzfingerabdruck über `data-qss-reference-revision`. Diese Werte stehen
als Datenattribute bereit; sie werden nicht in JavaScript-Quelltext eingesetzt.
