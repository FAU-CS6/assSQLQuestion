> **Historischer Syntaxvergleich (Commit b04c305):** Dieser Bericht dokumentiert
> das inzwischen ersetzte strukturelle Verfahren. Er ist kein Abnahmenachweis
> für die aktuelle Implementierung nach dem Graph-based-QSS-Paper.

# QSS-Parallelvergleich: Abnahme vom 9. November 2026

Plugin **0.2.0**, Branch `ilias-11-update-with-qss`, wurde mit allen **699 Fragen
aus fünf bereitgestellten StudOn-Pools** geprüft. Der native Studentenlauf hat
699 Antworten vollständig gespeichert und abgeschlossen; die reguläre Bewertung
bleibt **2259/2259 Punkte**. Die parallele Bewertung verändert diese Testpunkte
nicht. Sie ist noch keine auswählbare Bewertungsalternative.

**Der erweiterte Vergleich funktioniert technisch für alle 699 Musterlösungen.
Eine verlässliche menschliche Notengebung ist damit nicht nachgewiesen.** Das
ursprüngliche SELECT-Editmodell deckt den Bestand nicht vollständig ab;
die verwendete Erweiterung und ihre Grenzen sind unten getrennt ausgewiesen.

## Umgebung und Ablauf

- ILIAS 11.5, PHP 8.4.27 und MariaDB in der lokalen Testinstanz; zusätzlich
  PHP-Unit-Tests mit PHP 8.3.36.
- Tatsächlich installiertes Google Chrome **156.0.8078.80**, ausschließlich
  headless und mit eigenen Testprofilen. Normale Browserfenster und Nutzertabs
  wurden nicht verwendet.
- Getrennte reguläre Konten: Lehrender 335, Student 336. Beide ohne globale
  Administratorrolle. Die Quellpools erlauben dem Studenten keinen Import,
  Export oder Zugriff auf die Autorenformulare.
- Nach dem Versionsbump wurden regulär `composer dump-autoload --no-interaction`
  im ILIAS-Root und anschließend
  `php cli/setup.php update --legacy-plugin assSQLQuestion --yes` ausgeführt.
  Frisch geprüft: verfügbare und installierte Pluginversion 0.2.0, aktiv,
  kein Update ausstehend, Datenbankschritt weiterhin 6. Ein neuer Schemaschritt
  ist für die optionale JSON-Diagnose nicht nötig.

SQL läuft wie bisher in einem eigenen Browser-Worker. Das tatsächliche Schema
nach A wird ebenfalls dort ermittelt. Die bisherigen Ergebnis-/Metrikfelder
stehen bereits nach erfolgreicher SQL-Ausführung für Autosave und eine native
Fristabgabe bereit. Während der anschließenden Parallelbewertung bleiben die
sichtbare Ergebnistabelle und manuelle Weiter-Schaltflächen gesperrt.
Fortschritt wird direkt an der Frage angezeigt. Ein ausdrücklicher Abbruch gibt
das bereits vorhandene reguläre SQL-Ergebnis frei. Es gibt weder einen
Ausführungszeit-Timeout noch einen zusätzlichen Dienst oder eine Abschlussseite.
Die reguläre ILIAS-Testzeit läuft unverändert weiter.

## Vollständigkeit und Speicherung

Die Poolgrößen sind **23 + 65 + 504 + 68 + 39 = 699**. Der Pool mit 504 Fragen
ist somit nur ein Teil des geprüften Bestands. Es wurde nicht auf eindeutige
SQL-Texte reduziert: Jede exportierte Frage mit ihren eigenen Gewichten und
Kontrollsequenzen wurde berücksichtigt.

| Prüfung | Ergebnis |
|---|---:|
| Native Studenten-Fragenseiten in Chrome | 699/699 |
| Eingaben über Editor und reguläres Weiter/Abgeben | 699/699 |
| SQL-Ergebnisse gegenüber bisherigem Worker unverändert | 699/699 |
| Bestehende Bewertungsmetriken unverändert | 699/699 |
| Parallele Selbstbewertung: Abstand 0, volle Vergleichspunkte | 699/699 |
| Autorisierte Antworten mit gespeicherter QSS-Diagnose | 699/699 |
| Antwort- und Referenzfingerabdrücke gültig | 699/699 |
| Native abgeschlossene Bewertung | 2259/2259 |

Der abschließende native Versuch ist Pass 3 des lokalen Testobjekts 9; die
vorherigen Entwicklungsversuche sind nicht der Abschlussnachweis. Die gespeicherten
Antworten wurden nach Abschluss nur gelesen, nicht durch Testskripte angelegt,
umgeschrieben oder manuell aufgewertet. Zusätzlich wurde eine kleine native
Ergebnisansicht geprüft: zehn gespeicherte QSS-Karten, zwanzig reguläre
Muster-/Antworttabellen und sichtbare Diagnose nach normalem Aufklappen des
ILIAS-Detailpanels, ohne veraltete Karten oder JavaScript-Fehler.

## Vergleichsmodell und Bewertungsprüfung

Der Browser-Worker enthält zwei ausdrücklich getrennte Modelle:

| Modell | Selbstvergleich aller 699 Fragen |
|---|---:|
| Original-Editmodell mit modernem Parseradapter | 147 akzeptiert, 552 ausdrücklich nicht unterstützt |
| SQLite-Syntax-Editgraph, verwendete Erweiterung | 699 akzeptiert |

Beim Originalmodell wurden hier Identitäten geprüft, keine allgemeine
Laufzeitgarantie für abweichende Studierendenantworten. Die Erweiterung verwendet
gewichtete Knoten-/Unterbaumänderungen und konservative Äquivalenzumformungen.
Ein optimaler Abstand ist ausschließlich innerhalb dieses Modells exakt. Ein
positiver Abstand beweist keine semantische Ungleichheit. Sie ist kein stiller
Fallback unter der Bezeichnung der ursprünglichen semantischen Metrik.

Zusätzlich zum nativen Lauf wurden alle 699 Fragen im echten Browser mit
Musterlösung, sicherer Keyword-/Kommentar-/Whitespace-Variante und einem gezielten
Fehlerfall untersucht. Insgesamt wurden 2810 QSS-Vergleiche einschließlich
Originalmodell-Identitäten und 14 anonymen Kontrollen sowie 2638 SQL-Ausführungen
protokolliert. Die Testmutanten vermeiden insbesondere das Auflösen selektiver
Spalte-Spalte-Verknüpfungen zu riesigen Zwischenresultaten; das begrenzt die
Testfallauswahl, nicht die Produktionsausführung oder deren Laufzeit.

| Gegenprüfung | Ergebnis |
|---|---:|
| Formatvarianten mit Abstand 0 und vollen Vergleichspunkten | 699 |
| Fehlerfrei ausgeführte, sichtbar falsche Varianten mit Abzug | 643 |
| Davon Teilpunkte / null Vergleichspunkte | 242 / 401 |
| Ausführungs-/Ergebnisfehler ohne erfundene Vergleichspunktzahl | 56 |
| Belegte falsche Varianten mit voller bisheriger Wertung und QSS-Abzug | 86 |
| Falsche Variante mit unberechtigten vollen QSS-Punkten | 0 |

Die 56 ungeklärten Fälle sind drei Fehler in B, fünfzig Fehler der Kontrollsequenz
C und drei Fälle ohne sichtbares Ergebnis. Sie sind nicht pauschal syntaktisch
ungültiges SQL. Der aktuelle Pilot liefert dafür `unsupported` und `points: null`;
die bisherige Fehlerbehandlung bleibt maßgeblich.

Die vorläufige Skala lautet
`Maximalpunkte × max(0, 1 − Distanz / min(Leerantwortdistanz, 5))`.
Für dieselben 643 auflösbaren Fehlerfälle mit maximal 2133 Punkten ergeben sich:

| Skala | Summe |
|---|---:|
| Verwendete vorläufige Cap-5-Skala | 706,2 |
| Vollständige Normierung gegen die Leerantwort | 1767,533 |
| Ein Punkt Abzug je Kosteneinheit | 637 |
| Bisherige Ergebnis-/Abhängigkeitsbewertung | 1110,958875 |

Diese Summen sind keine Qualitätsrangfolge. Es fehlen unabhängig menschlich
benotete Originalantworten; die automatisch erzeugten Fehlerfälle sind keine
repräsentative Verteilung tatsächlicher Studierendenfehler.

Eine fachliche Einzelprüfung dokumentiert konkrete Verbesserungen und Schwächen
im [Bewertungsvergleich](qss-bewertungsvergleich-2026-11-09.md). Beispielsweise
erkennt der Vergleich einen falschen DEFAULT-Wert trotz bisheriger Vollpunkte.
Eine lokale Ausdruckserweiterung kann dagegen wegen der Unterbaumkosten zu hart
bestraft werden. Diese Befunde werden nicht durch Angleichung an alte Punkte
versteckt.

### Darstellungsabhängige Kontrollabfragen

Bei Formatvarianten sind 694 Ergebnis-JSONs exakt gleich; 697 Kontrollausgaben
stimmen nach der dokumentierten Normalisierung von Spaltennamen und nicht
festgelegter Zeilenreihenfolge überein. Zwei weitere Fälle sind separat belegt:
SQLite speichert die Defaultausdruck-Texte `NULL` beziehungsweise `null` in
`pragma_table_info.dflt_value`. Die unveränderten Kontrollabfragen vergleichen
diesen Text mit exakt `'NULL'` und vergeben deshalb bisher **0/2** statt **2/2**.
Die Defaultwirkung ist identisch; die QSS-Formatbewertung **2/2** ist sachlich
plausibel.

Gezielte Browserproben bestätigen die gleiche NULL-Wirkung und zeigen, dass nur
der Metadatentext betroffen ist. Eine ausschließlich testseitige, eng begrenzte
Repräsentationsprüfung erklärt den Unterschied. Originalfragen, Kontrollabfragen,
Rohbeobachtungen und alte Punkte blieben unverändert. Die ursprünglichen zwei
zu strengen Testorakel-Fehler bleiben im Rohbericht erhalten; ein separater
Abnahme-Replay belegt ihre vollständige Erklärung. Beliebige Zeichenketten oder
unbekannte Ausgabedifferenzen werden nicht pauschal normalisiert.

## Import und Export

Alle fünf unveränderten Quellarchive wurden mit ihren ursprünglichen SHA-256-Werten
abgeglichen, über das reguläre Lehrendenkonto nativ importiert, exportiert und
in fünf weitere neue Pools reimportiert. Alle 1398 neu angelegten Fragen und zehn
Pools gehören dem Lehrendenkonto. Frageinhalt, A/B/C, Flags, Musterergebnisse,
Metriken, Punkte und Feedback bleiben bei **699 Erst- und 699 Reimporten** erhalten.

Taxonomiepfade, Titel, Typen, Reihenfolge und 581 gültige Zuordnungen bleiben
ebenfalls erhalten. **36 StudOn-Beschreibungen von Taxonomieknoten sind jedoch
ein Zusatzfeld ohne Gegenstück im offiziellen ILIAS-Modell.** Sie lassen sich
in einer unveränderten ILIAS-Installation nicht verlustfrei ablegen. Dafür muss
die StudOn-Core-Erweiterung bei der Migration beibehalten werden; dies wurde nicht
heimlich im Fragenplugin oder in Kerndateien nachgebaut. Der neue lesende
[Taxonomie-Vorabcheck](../tests/ilias11/check-taxonomy-import.php) erkennt diesen
Fall und angepasste DataSet-Deklarationen. Sechs weitere Zuordnungen verweisen
bereits im Original auf nicht enthaltene Fragen und sind keine neue Regression.
Neun alte leere Editormodi verwenden den dokumentierten ILIAS-RTE-Standard.

## Weitere Prüfungen und Laufzeit

- PHP 8.3.36 und 8.4.27: jeweils 39 Unit-Tests mit 138 Assertions bestanden.
- Reales ILIAS: 14 Integrationstests mit 89 Assertions bestanden.
- Engine und SQLite-Semantik: 55 Regressionen bestanden, einschließlich NULL,
  Datentypen, Kollationen, Alias-/Unterabfragescopes und manueller Abbrüche.
- Weitere Chrome-Tests prüfen Ergebnisbarriere, Navigation, Fristdaten,
  Abbruch, verspätete Nachrichten, AJAX-Wechsel, gespeicherte Diagnosen und XSS.
- Drei gezielte Orakel-Regressionen schützen die Metadatenklassifikation.
- Beide Browserbundles sind reproduzierbar; neue QSS-Abhängigkeiten haben keine
  npm-Audit-Funde. Beim bestehenden Editor bleiben ausschließlich die explizit
  dokumentierten zurückgezogenen Advisory-Meldungen ausgenommen.

Eine zusätzliche Stichprobe von zwanzig Fragen aus allen Pools misst den Start
eines frischen QSS-Workers bis zum Ergebnis, einschließlich Startkosten:

| Vergleich | n | Median | p95 | Maximum |
|---|---:|---:|---:|---:|
| Selbstvergleich | 20 | 62,75 ms | 73,70 ms | 148,70 ms |
| Fehlerfrei ausführbare falsche Variante | 8 | 63,15 ms | 524,40 ms | 524,40 ms |

Zwölf weitere Varianten wurden mangels gültiger beobachtbarer Änderung nicht
als Latenzprobe gewertet. Die getrennte SQL-Ausführung dauerte in einem Fall
28,03 Sekunden. Die gezielte Stichprobe, parallele Testlast und teilweise warme
Browsercaches erlauben keine Garantie für andere Geräte oder alle möglichen
Antworten. Es wurde kein Timeout eingebaut.

Der einheitlich geprüfte finale Worker hat SHA-256
`be7c702cbf37e7a277c1b793843f6a12a0debaced4234289a44b24565c5c1efe`.
Die vorläufigen Entwicklungsstände sind vom Abschlussnachweis getrennt.
Private Archive, Antworten, Antwortfingerabdrücke, Zugangsdaten und Screenshots liegen
ausschließlich außerhalb der versionierten Dateien beziehungsweise unter dem
ignorierten `test-results/`.

**Prüfungsgrenze:** Die vollständige Muster-SQL wird in diesem Ablauf bereits
vor Abgabe an den Teilnehmerbrowser geliefert und ist dort auslesbar. Unveränderte
reguläre Punkte verhindern diese Offenlegung nicht. Dieser Branch ist ein
transparenter Shadow-/Übungspilot, keine Freigabe für Prüfungen mit geheimer
Musterlösung oder für einen automatischen Notenersatz.
