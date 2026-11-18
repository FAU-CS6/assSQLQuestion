# QSS als experimentelle Parallelbewertung

**Historischer Stand bis 10. November 2026.** Seit Plugin 0.3.0 wird pro Frage
zwischen Ergebnisbewertung und echter QSS-Bewertung gewählt. Die aktuelle
Bedienung, Kompatibilität und Abnahme stehen in [QSS-Bewertung](qss-bewertung.md).
Die folgende Beschreibung dokumentiert den vorherigen Parallelbetrieb.

Der Branch `ilias-11-update-with-qss` ergänzt Graph-based QSS als
separate Diagnose nach dem Vorgehen der verlinkten Arbeit. Die vorhandenen Bewertungsmetriken und die reguläre
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

Dieser technische Modellabschnitt ist auf 2.7.0 aktualisiert; der oben beschriebene
Parallelbetrieb bleibt historisch. Für aktuelle native Abnahme, exklusive
Bewertung, neutrale Studentenanzeige und Altimporte siehe
[QSS-Bewertung](qss-bewertung.md).

Das Modell `graph-qss-sqlite-v2` folgt den Abschnitten 4.2–4.7 von
[Graph-based QSS](https://www.cs6.tf.fau.eu/files/2025/03/Koeberlein-Graph-based_QSS-141_b.pdf).
Es erweitert die SQL-Abdeckung des SELECT-Prototyps durch einen neuen SQLite-AST
und SQL-spezifische Editregeln. Der frühere Syntaxbaumabgleich und dessen Cap-5-Skala
werden nicht mehr als Bewertung verwendet.

Ein Knoten ist ein konkreter SQL-AST, der auch ungesetzte Attribute, fehlende
Argumente und nicht ausführbare Referenzen enthalten darf. Benannte SQL-Edits mit
festen, nichtnegativen Kosten erzeugen seine Nachbarn. Atomare Komponenten- und
Attributänderungen sowie fachliche Shortcuts sind an allen kompatiblen Positionen
zulässig; die Suche beschränkt sich nicht auf direkt zum Ziel führende Änderungen.

Die gerichtete Suche läuft von der Studentenantwort zur Musterlösung. Eine exakte,
verzögerte A*-Suche nutzt bewiesene Untergrenzen; ohne passenden Nachweis verwendet
sie Uniform-Cost-Suche. Kostenfreie Äquivalenz-Edits sind tatsächliche Kanten auch
an Zwischenzuständen. Dazu gehören abgesicherte Aliasumbenennungen, Boolesche
Umformungen einschließlich der vergrößernden Idempotenzrichtung sowie geeignete
INNER-JOIN-/WHERE-Umformungen. Unbewiesene Varianten, beispielsweise die pauschale
Übertragung auf LEFT JOIN, werden nicht gleichgesetzt. Fertige Pfade werden
nachgespielt und ihre Gesamtkosten geprüft.

Da alle Editkosten ganzzahlig sind, lässt sich eine bewiesene gebrochene
Untergrenze auf die nächste ganze Zahl anheben. Brüche und Kostenaufteilung
werden dafür exakt mit BigInt berechnet. Für noch nicht erzeugte Edits wird
die maximale Abnahme exakt abgezogen und erst der Rest aufgerundet; die
verzögerte Suche bleibt zulässig. Eine Untergrenze von 4,8 genügt damit bereits für den Fünf-Kosten-
Nullpunktnachweis. Das ändert weder Graphkanten noch Umformungskosten.
Kurze Browser-Taskpausen verwenden MessageChannel mit anschließend geschlossenen
Ports; Abbruchprüfungen und Pausenhäufigkeit bleiben unverändert.

Bei der Verlagerung eines INNER-JOIN-Prädikats bleibt die Reihenfolge der
FROM-Quellen erhalten. Daher ist diese kostenfreie Regel auch für `SELECT *`
anwendbar. USING- und NATURAL-Joins sind von ihr ausgeschlossen. Änderungen an
äußeren Joins können über gesonderte positive Reparaturkosten bewertet werden.

Spalten können volatile Ausdrücke über SELECT-Aliase, Unterabfragen, CTEs oder
Views verbergen. Solche Herkünfte sperren die betroffenen kostenfreien
Ausdrucks-/JOIN-Regeln. Dafür liefert der SQL-Worker neben Spalteninformationen
auch den SQLite-Objekttyp `table` oder `view`; ohne diese Angabe ist versteckte
View-Volatilität für den statischen Vergleich nicht erkennbar. Ein unbeteiligter
Funktionsausdruck in der Projektion sperrt dagegen keine Regel für gewöhnliche
Basisspalten. Sichere Aliasumbenennungen bleiben kostenfrei möglich.

Wertemengen und Konstruktoren sind durch beide Eingabe-ASTs und das Schema
begrenzt. Zusätzlich nennt das Ergebnis endliche Grenzen für AST-Größe, Tiefe,
Listenlänge und Boolesche Höhe. Sie lassen temporäre Lücken und Vergrößerungen zu,
begrenzen aber ausdrücklich das konfigurierte Modell. Optimalität gilt innerhalb
dieses Modells, nicht für einen unbeschränkten SQL-Graphen. Es gibt keinen
Zeit-Timeout oder ein Limit besuchter Suchknoten. Auch ein endlicher Graph kann
lange Rechenzeit erfordern.

Die lineare Bewertung gemäß Abschnitt 4.7 lautet:

```text
Vergleichspunkte = max(Maximalpunkte - Abstand * Skala, 0)
```

Die Skala ist pro Frage fest auf `Maximalpunkte / 5` gesetzt (bei Maximum 0 auf 1).
Ein lokaler Edit mit Kosten 1 zieht damit 20 Prozent der Maximalpunkte ab.
Die API erlaubt weiterhin eine ausdrücklich gesetzte feste Skala. Die Rubrik
heißt `paper-linear-v2`, die aktuelle Modellversion `2.7.0` (Kostenprofil 7,
71 einzeln konfigurierbare Positionen).
Gewöhnliche atomare Änderungen und positive Shortcuts kosten zunächst 1,
DISTINCT-Änderungen 2 und das Hinzufügen/Entfernen einer ganzen Skriptanweisung
oder Datenquelle sowie das Ändern ihrer Relation 5. Neue atomare Komponenten
werden als flache Konstruktoren mit Lücken aufgebaut. Benannte logische
Reparaturen ergänzen beispielsweise eine einzelne deklarierte Bedingung oder
einen Ausgabenausdruck, aber keine vollständige Datenabfrage oder Unterabfrage
für Kosten 1. Semantisch abgesicherte Äquivalenz-Edits kosten 0.
Ein positiver Shortcut entfernt beispielsweise eine binäre Operation unter
Beibehaltung eines Operanden für Kosten 1 (`removeExtraneousBinaryTerm`). Eine
zusätzliche Rechnung `+ 1` kann damit als ein logischer Reparaturschritt entfernt
werden. Das ist keine kostenfreie Gleichsetzung und gilt unabhängig davon, ob
die gewählte Position direkt zur Musterlösung führt.
Diese konkrete Kostenkalibrierung ist vorläufig und nicht durch unabhängig von
Lehrenden bewertete echte Antwortpaare validiert.

`score-zero-certified` bedeutet, dass eine mathematische Untergrenze bereits
Nullpunkte beweist. Dann bleibt der genaue Abstand unbekannt (`distance: null`),
und die Oberfläche zeigt die Untergrenze. Nicht unterstützte, fehlerhafte oder
abgebrochene Vergleiche bekommen keine erfundene Punktzahl.

Ein Laufzeitfehler in B oder der separaten Kontrollsequenz C verhindert keine
statische QSS-Bewertung, wenn B als SQL-AST darstellbar ist. Beispielsweise sind
eine mehrdeutige Spaltenreferenz und eine fehlende Argumentstelle wie `AVG()`
zulässige Startzustände. Nicht repräsentierbare Grammatik bleibt ausdrücklich
`unsupported`; es erfolgt kein Wechsel auf String- oder Syntaxbaumähnlichkeit.
Die vorhandene reguläre Fehlerbehandlung bleibt unabhängig davon erhalten.

Der [Bericht vom 9. November](qss-abnahme-2026-11-09.md) beschreibt das vorherige
Syntaxexperiment und belegt keine Abnahme dieser neuen Graph-QSS-Implementierung.
Der [Graph-QSS-Abnahmebericht](qss-graph-abnahme-2026-11-09.md) dokumentiert die
erneute vollständige Chrome-Prüfung aller 699 Originalfragen auf Modell 2.0.1,
gespeicherte native Studentenabgaben und gezielt falsche Varianten. Er trennt
diese technischen Nachweise von der noch ausstehenden menschlichen Kalibrierung
der Editkosten und Punkteskala.
Der [Bericht zu studentischen Antwortvarianten vom 10. November](qss-studentenvarianten-2026-11-10.md)
dokumentiert Modell 2.1.0. Der [damalige Robustheitsbericht](qss-robustheit-2026-11-10.md)
bestätigt Modell 2.1.1 mit 6.812 frischen nativen Chrome-Fällen auf allen 699
unveränderten Originalfragen, 132 zusätzlichen anonymen Fällen, gespeicherten
Noten und fünf Pool-Roundtrips. Er enthält getrennte Laufzeitmessungen sowie
verbleibende Varianten-, Laufzeit- und Kalibrierungsgrenzen.
Die damals formulierten Anforderungen an
[konfigurierbare Editkosten](qss-kostenkonfiguration.md) sind inzwischen als
eigene Bewertungsalternative umgesetzt. Der aktuelle Ablauf und seine native
Abnahme stehen in [Ergebnisbewertung oder Graph-QSS](qss-bewertung.md).
Modell, Schnittstelle und reproduzierbare Builds stehen in
[lib/qss/README.md](../lib/qss/README.md).

## Browser-Konfiguration und Vertrauensgrenze

`JsBlock` stellt die Konfiguration als HTML-escaped JSON in
`#qpisql-qss-config[data-config]` bereit. Der Kontext ist `author` oder
`participant`. Engine-/Modellversion, Rubrik und die konstante Skala sind ebenfalls
Teil der Konfiguration; gespeicherte Diagnosen eines anderen Modells gelten als veraltet. Im Autorenkontext wird die aktuelle Sequenz B im Editor als
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
