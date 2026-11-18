# Graph-based QSS: Implementierung und Abnahmestand vom 9. November 2026

**Plugin 0.2.1, Modell 2.0.1, Branch `ilias-11-update-with-qss`: Die technischen
Abnahmeläufe für alle 699 Quellfragen sind bestanden.** Jede Frage wurde in
echtem Chrome mit Musterlösung, sicherer Formatvariante und gezielt falscher
Antwort verglichen sowie regulär durch einen Studentenaccount beantwortet und
gespeichert. Die native Prüfung verteilt sich auf vier vollständig abgeschlossene
Tests mit disjunkten Quellbereichen. Das belegt die getesteten Abläufe und die
Konsistenz des Graphmodells; es ersetzt keine menschliche Kalibrierung der Punkte.
Frühere Entwicklungsstände einschließlich der 90d4-Durchläufe werden getrennt
aufbewahrt und nicht als Nachweis für den unten eingefrorenen Endstand verwendet.

## Bezug zur Arbeit und zum vorherigen Experiment

Die aktuelle Implementierung `graph-qss-sqlite-v2`, Modellversion 2.0.1, folgt dem
grundsätzlichen Vorgehen aus den Abschnitten 4.2–4.7 von
[Köberlein, Probst und Lenz: Graph-based QSS](https://www.cs6.tf.fau.eu/files/2025/03/Koeberlein-Graph-based_QSS-141_b.pdf).
Sie verwendet konkrete SQL-ASTs als Zustände, benannte SQL-Edits als Kanten und
eine Suche nach dem kostenminimalen gerichteten Pfad von der Studentenantwort
zur Musterlösung.

Der frühere Commit `b04c305` verwendete dagegen eine generische Distanz zwischen
normalisierten Syntaxbäumen. Der [damalige Bericht](qss-abnahme-2026-11-09.md)
ist ausdrücklich historisch gekennzeichnet. Seine erfolgreichen Durchläufe und
Bewertungssummen gelten nicht als Nachweis für diese neue Implementierung.
Weder die alte Baumdistanz noch deren Cap-5-Punkteskala werden weiter als
Bewertungsverfahren akzeptiert.

Das neue SQLite-AST-Modell und der Editkatalog sind eine Erweiterung gegenüber
dem eingeschränkten SELECT-Prototyp. Das Vorgehen entspricht der Arbeit; die
konkrete Auswahl und Bepreisung der Edits ist eine eigene, offengelegte
Konfiguration. Eine numerische Gleichheit mit dem ursprünglichen Prototyp oder
eine vollständige Entscheidung semantischer SQL-Äquivalenz wird nicht behauptet.

## Knoten, Edits und Suche

Ein Graphknoten behält die SQL-Rollen von Anweisungen, Klauseln, Ausdrücken und
Attributen. Er darf fehlende Komponenten und ungesetzte Attribute enthalten.
Die leere Argumentstelle in `AVG()` und eine mehrdeutige oder unbekannte
Spaltenreferenz sind deshalb mögliche Start- und Zwischenzustände. Ein Fehler
bei der Ausführung von B oder der unabhängigen Kontrollsequenz C verhindert
keine statische QSS-Bewertung, sofern B als SQL-AST darstellbar ist. Nicht
repräsentierbare Grammatik bleibt ausdrücklich nicht unterstützt; es gibt
keinen Ersatz durch String- oder Syntaxbaumähnlichkeit.

Die Korrektur in 2.0.1 entfernt ausschließlich die doppelte Darstellungsmarkierung
`parentheses_symbol` an einem SELECT, das bereits als `Subquery.ast` explizit
eingeklammert ist. Der Parser konnte diese Markierung bei gleichwertigen
Grammatikzweigen unterschiedlich setzen. Das Entfernen vermeidet einen
zusätzlichen Schein-Edit. Die Gruppierung zusammengesetzter SELECTs wird dadurch
nicht normalisiert; semantisch relevante Klammerstruktur und die Zuordnung von
`ORDER BY` und `LIMIT` zu ihrem tatsächlichen Abfragebereich bleiben erhalten.

Atomare Komponenten- und Attributänderungen sowie fachliche Shortcuts haben
feste, nichtnegative Kosten. Sie dürfen an allen kompatiblen Positionen wirken,
auch wenn eine Änderung nicht unmittelbar zum Ziel führt. Atomare Konstruktoren
erzeugen neue Komponenten flach mit Lücken oder als intrinsische Blätter;
vollständige Musterteilbäume werden nicht zum Preis einer kleinen Änderung
eingesetzt. Fachliche Shortcuts können dagegen vorhandene Ausdrücke erhalten,
umformen oder unter ihren Bedingungen duplizieren.

Kostenfreie Äquivalenz-Edits sind tatsächliche Graphkanten an Zwischenzuständen.
Dazu gehören abgesicherte Aliasumbenennungen, geeignete Boolesche Umformungen,
Vergleichsumformungen und INNER-JOIN-/WHERE-Verlagerungen. Die vergrößernde
Idempotenzrichtung ist vorhanden: Der in Abbildung 7 der Arbeit beschriebene
Pfad kann zunächst ein Prädikat kostenlos duplizieren und danach eine Kopie
gegen positive Kosten ändern. Eine einmalige Vorab-Normalisierung ersetzt diese
Pfade nicht.

Die Suche verwendet exaktes verzögertes A* mit bewiesenen Untergrenzen oder
Uniform-Cost-Suche, wenn die benötigte Zertifizierung fehlt. Symbol-, notwendige
SQL-Arbeits- und Prädikatsinformationen steuern die Suche und können einen
mathematischen Nullpunktnachweis liefern. Bei der
Kostenaufteilung wird geprüft, dass zusammengefasste Untergrenzen pro Kante nicht
mehr als deren tatsächliche Kosten beanspruchen; andernfalls wird ein sichereres
Maximum verwendet. Diese Untergrenzen sind keine zusätzliche Bewertungsformel
und erlauben keine Greedy-Beschränkung der Nachbarn. Fertige Editfolgen werden
nachgespielt; Endzustand und Summe der Kosten werden geprüft.

Eine unmittelbar nachgewiesene Editkante darf die Suche bereits abschließen,
wenn ihre tatsächlichen Kosten exakt der bewiesenen globalen Start-Untergrenze
entsprechen. Unter- und Obergrenze sind dann gleich. Ohne dieses Zertifikat
bleibt die vollständige Suche erhalten; Nachbarn werden nicht auf vermeintlich
gute Zielpositionen beschränkt.

Die letzte Laufzeitkorrektur ergänzt eine abgesicherte Untergrenze für
DML-WHERE-Signaturen am jeweiligen Skriptanweisungsindex. Ein Prädikat aus einer
anderen, ähnlichen UPDATE-Anweisung kann damit den Reparaturbedarf der
betroffenen Anweisung nicht mehr verdecken. Das vermeidet eine unnötig große
Suche durch kostenfreie Umformungen. AST, zulässige Edits, Kosten und Metrik
bleiben unverändert. Die Untergrenze verwendet nur den abgesicherten Mindestbedarf
bei einer fehlenden Signatur und summiert keine Strafen pro Anweisung auf.

Wertemengen und Konstruktoren stammen aus beiden Eingabe-ASTs, dem Schema und
einem endlichen festen SQL-Konstruktorvorrat. Dieser enthält beispielsweise den
Wert 1 für den ausdrücklich bepreisten Aufbau einer JOIN-Bedingung `1=1`.
Das Ergebnis nennt zusätzlich endliche Grenzen für AST-Knotenzahl, Tiefe,
Listenlänge und Boolesche Höhe. Diese lassen temporäre Lücken und Vergrößerungen
zu, definieren aber ausdrücklich einen begrenzten Graphen. Optimalität gilt
innerhalb des angegebenen Katalogs, der Wertemenge und dieser Strukturgrenzen.
Es gibt keinen Nachweis unbeschränkter globaler SQL-Optimalität. Nicht
implementierte Äquivalenzen können weiterhin positive Distanz erhalten.

Kostenfreie Regeln haben Kontextprüfungen: Aliasumbenennungen dürfen weder
unbekannte Referenzen reparieren noch äußere Bindungen einfangen. Auch explizit
leere Aliasnamen bleiben echte Bindungen. Ausdrucksregeln berücksichtigen
volatile SELECT-Aliase sowie Spalten aus Unterabfragen, CTEs und bekannten Views.
Der SQL-Worker liefert dazu den SQLite-Objekttyp `table` oder `view`; ohne diese
Metadaten wäre versteckte View-Volatilität nicht erkennbar. Unbeteiligte
Funktionsprojektionen sperren keine Regel für gewöhnliche Basisspalten.
INNER-JOIN-Verlagerungen behalten die FROM-Reihenfolge einschließlich `SELECT *`
bei; USING-/NATURAL-Joins und unbewiesene Übertragungen auf äußere Joins bekommen
keine solche kostenfreie Gleichsetzung.

## Vorläufige Kosten und lineare Punkte

Die Bewertung verwendet die Formel aus Abschnitt 4.7:

```text
Vergleichspunkte = max(Maximalpunkte - Distanz * Skala, 0)
```

Die konstante Skala ist zunächst 1. Gewöhnliche atomare Änderungen und positive
SQL-Shortcuts kosten zunächst 1, DISTINCT-Änderungen 2 und das Hinzufügen oder
Entfernen einer ganzen Skriptanweisung 5. Semantisch abgesicherte Äquivalenz-Edits
kosten 0. Beispielsweise kann das Entfernen einer zusätzlichen binären Operation
unter Beibehaltung eines Operanden ein positiver Reparaturschritt sein.
Die Kennung dieser vorläufigen Rubrik lautet `paper-linear-v1`.

Diese konkrete Kalibrierung ist vorläufig. Es liegen keine unabhängig menschlich
benoteten echten Studentenantworten vor, die faire Noten für dieses Editset und
die Skala belegen. Bestehende ILIAS-Punkte sind eine Vergleichsgröße, kein Orakel,
an das die neue Bewertung numerisch angepasst werden muss.

Eine mathematische Untergrenze kann Nullpunkte bereits beweisen. Dann lautet der
Status `score-zero-certified`, der exakte Abstand bleibt unbekannt
(`distance: null`), und eine Untergrenze wird angezeigt. Das ist keine
Zeitbegrenzung und keine erfundene optimale Editfolge.

## Clientseitiger Ablauf

SQL und QSS laufen vollständig in Browser-Workern. Es gibt weder einen Node-Dienst
noch eine SQL-/QSS-Ausführung auf dem StudOn-Server. Der Server speichert nur die
begrenzte optionale Diagnose neben der bisherigen Antwort.

Fortschritt erscheint direkt an der Frage als Phase und Suchzähler ohne
erfundene Restzeit. Sichtbare Ergebnistabelle und manuelle Navigation warten
auf das Ende der Bewertung. Ein ausdrücklicher manueller Abbruch ist möglich;
danach wird das bereits ermittelte reguläre SQL-Ergebnis freigegeben. Es gibt
keinen Ausführungs-Timeout, kein Limit besuchter Suchknoten und keine
nachgelagerte Abschlussseite. Die native ILIAS-Testzeit läuft weiter. Reguläre
Ergebnisse stehen bereits nach SQL für Autosave und Fristabgabe bereit.

Die zusätzliche Bewertung bleibt ein Parallelvergleich. Sie ist keine auswählbare
Alternative und verändert keine regulären ILIAS-Punkte. Modell-, Referenz- und
Antwortstand werden beim Anzeigen gespeicherter Diagnosen berücksichtigt.

## Abgeschlossene Prüfungen

Die native Testumgebung verwendet ILIAS 11.5 mit der dokumentierten offiziellen
Fragentyp-Kernkorrektur, PHP 8.4 und MariaDB. Chrome lief tatsächlich als
Google Chrome 156.0.8078.80, ausschließlich headless in eigenen Testprofilen.
Getrennte reguläre Dozenten- und Studentenaccounts ohne Systemadministratorrolle
wurden eingesetzt. Die normalen Browserfenster des Nutzers wurden nicht verwendet.

| Prüfung des Endstands | Nachgewiesenes Ergebnis |
|---|---:|
| npm-Tests für Modell, Edits, Suche, Engine, SQLite-Semantik, Orakel und Testgenerator | 156 bestanden |
| PHP-Unit-Tests unter PHP 8.3 | 41 Tests / 156 Assertions bestanden |
| PHP-Unit-Tests unter PHP 8.4 | 41 Tests / 156 Assertions bestanden |
| Integration mit realem ILIAS | 14 Tests / 94 Assertions bestanden |
| Chrome-UI-Regressionsfälle | 5 bestanden |
| Nativer Studentenlauf über vier abgeschlossene Tests | 699/699 Quellfragen |
| Autorisierte gespeicherte Antworten, QSS-Diagnosen und exakte Selbstvergleiche | jeweils 699/699 |
| Gespeicherte reguläre Bewertungsdatensätze | 699/699 |
| Reguläre Punkte dieser vier Tests | 2259/2259 |
| Manuelle Punkteüberschreibungen | 0 |
| Zusätzlicher nativer Zehn-Fragen-Lauf samt gespeicherten Diagnosen | 10/10, 21/21 reguläre Punkte |
| Native Autorenmaske und vier Vorschauauswertungen | bestanden |
| Vorschau: geänderter Literalwert, benannter Edit mit Kosten 1 | 1/2 Vergleichspunkte |
| Native Ergebnisansicht des Zehn-Fragen-Laufs | 10 QSS-Karten / 20 reguläre Tabellen |
| Erstimport aller fünf Pools durch den Dozentenaccount | 699 Fragen |
| Export und Reimport dieser Pools | 699 Fragen |
| Erneuter Inhaltsvergleich von Erst- und Reimport am Endstand | jeweils 699/699 erhalten, 0 Fehler |
| Erhaltene gültige Taxonomiezuordnungen | 581 |

Die fünf UI-Regressionsfälle prüfen unter anderem Ergebnissperre, manuellen
Abbruch, sichere Ausgabe von Editbeschreibungen, SQL-Fehler mit statischer
QSS-Bewertung und den veralteten Status gespeicherter 2.0.0-Diagnosen.
Die an den Worker übergebenen Schemadaten enthalten die tatsächlichen SQLite-
Objekttypen für Tabellen und Views. Die Autorenprüfung enthält neutrale,
gezielt veränderte und wiederholte Eingaben mit sichtbarem benanntem Editfeedback.
Die native Ergebnisansicht zeigt gespeicherte Diagnosen ohne aktive
Editor-Konfiguration oder veraltete Karten.

Die Poolübertragung erzeugte 699 Erstimporte und 699 Reimporte unter dem
Dozentenaccount. Frageinhalt, A/B/C, Flags, Musterergebnisse, Metriken, Punkte und
Feedback blieben erhalten. Die geprüfte installierte Pluginversion ist 0.2.1.
Der erneute lesende Inhaltsvergleich am Endstand bestätigte beide Mengen ohne
Inhaltsfehler sowie 581 gültige Taxonomiezuordnungen. Neun historische leere
Editor-Modi werden auf den vorgesehenen Standard gesetzt. Die Übertragung selbst
fand vor den letzten Änderungen am QSS-Worker statt; der dafür zuständige
Import-/Export-PHP-Code blieb seitdem unverändert.

### Native Abdeckung aller 699 Quellfragen

Die Poolgrößen sind **23 + 65 + 504 + 68 + 39 = 699**. Es wurde weder auf eindeutige
SQL-Texte reduziert noch dieselbe importierte Frage mehrfach als unterschiedliche
Quellfrage gezählt. Die endgültige native Prüfung bestand aus vier getrennten,
regulär durch den Studentenaccount abgeschlossenen Tests:

| Originale Quellpositionen | Fragen | Reguläre Punkte |
|---|---:|---:|
| 1–175 | 175 | 575/575 |
| 176–350 | 175 | 591/591 |
| 351–525 | 175 | 638/638 |
| 526–699 | 174 | 455/455 |
| Gesamt | 699 | 2259/2259 |

Das [lesende Abdeckungsgate](../tests/qss/verify-native-ranges.cjs) bestätigt die
lückenlose disjunkte Quellabdeckung, 699 unterschiedliche Originalfragen und
699 unterschiedliche native Testfragen. Browser- und gespeicherte Datenbankbelege
stimmen überein: 699 autorisierte Antworten, 699 aktuelle QSS-Diagnosen,
699 exakte Selbstvergleiche, 699 reguläre Bewertungsdatensätze, keine manuelle
Punkteüberschreibung und vier vom Teilnehmer abgeschlossene Versuche. Die
regulären SQL-Ergebnisse und bisherigen Metriken entsprechen in allen 699 Fällen
dem vorherigen Worker. Die zusätzliche Zehn-Fragen-Prüfung dient der Autoren-
und Ergebnisansicht; sie wird nicht zu den 699 Quellfragen hinzugezählt.

### Vollständiger Chrome-Korpusvergleich

Der [Korpusrunner](../tests/browser/qss-corpus.cjs) hat jede der 699 Quellfragen
mit ihrer Musterlösung, einer sicheren Formatvariante und einer gezielt falschen
Antwort geprüft: **2097 Vergleiche aus den Quellfragen**. Vier vollständig
abgeschlossene Quellbereiche wurden durch das [Merge-Gate](../tests/qss/merge-corpus.cjs)
zusammengeführt. Es prüft Quellidentität, unveränderte Bundle-Hashes,
Modellidentität, Punkteformel und Editkosten beziehungsweise Nullpunktzertifikate.
Alle 699 Originalschlüssel sind genau einmal abgedeckt. Die Rohbelege wurden
nicht überschrieben; es waren keine nachträglichen Ersatzfälle erforderlich.
Sieben zusätzliche Semantik- und acht Bewertungskontrollen sind bestanden und
werden im zusammengeführten Bericht jeweils einmal gezählt.

| Vergleich | Ergebnis |
|---|---:|
| Musterlösung gegen sich selbst | 699/699 volle Punkte, Abstand 0 |
| Sichere Formatvarianten | 699/699 volle Punkte, Abstand 0 |
| Ausgewählte falsche Antworten | 699/699 bewertet, jeweils Punktabzug |
| Davon erfolgreich ausgeführte, beobachtbar falsche Antworten | 643 |
| Davon statisch bewertete Ausführungs- oder Ergebnisfehler | 56 |
| Exakte Abstände bei falschen Antworten | 548, jeweils Abstand 1 |
| Zertifizierte Nullpunkte bei falschen Antworten | 151 |
| Ungelöste ausgewählte Fälle / fehlgeschlagene Abnahmeprüfungen | 0 / 0 |

Die 56 Fehlerfälle verteilen sich auf zwei Fremdschlüsselverletzungen in B,
50 Ausführungsfehler der Kontrollsequenz C und vier Fälle ohne sichtbares
Ergebnis. Bei C wurden 24 fehlende Spalten, 13 fehlende Tabellen, zehn
CHECK-Verletzungen, ein SQLite-Worker-Abbruch und zwei andere Ausführungsfehler
beobachtet. Diese Fälle sind keine erfolgreich ausgeführten Gegenbeispiele und
bleiben getrennt protokolliert. Die darstellbare Antwort B erhält trotzdem eine
statische QSS-Bewertung nach demselben Editgraphen; eine gesonderte Fehlernote
wird nicht erfunden. Das ändert die bisherige reguläre Fehlerbewertung nicht.
Bei den 151 Nullpunktzertifikaten wird ausdrücklich kein exakter Abstand
behauptet. Alle 2097 Punkteformeln und alle vorhandenen Tracekostensummen
beziehungsweise Untergrenzen sind konsistent.

Bei fünf Formatvarianten waren die Rohresultate nicht bytegleich: drei Unterschiede
betrafen Groß-/Kleinschreibung von Spaltenbeschriftungen oder unbestimmte
Zeilenreihenfolge; zwei die Schreibweise eines SQL-NULL-Defaults in
SQLite-Katalogmetadaten. Gesonderte
Katalog- und NULL-Proben bestätigen die Neutralität der letzten beiden Fälle.
Nur diagnostische Testkopien der qualifizierten Metadatenabfrage berücksichtigen
diese Schreibweise. Originalantworten, ursprüngliche Kontrollsequenzen,
Rohresultate und bisherige Punkte bleiben unverändert erhalten. Gewöhnliche
Ergebniszeichenketten werden dafür nicht pauschal normalisiert.

### Bewertungsvergleich

Die Musterlösungen und Formatvarianten erreichen im neuen Verfahren jeweils
2259 von 2259 Punkten. Für die 699 ausgewählten falschen Antworten ergibt sich:

| Vergleichsgröße | Ergebnis |
|---|---:|
| Graph-based QSS | 1415/2259 Punkte |
| Bisherige Bewertung derselben Antworten | 1128,4589/2259 Punkte |
| QSS höher / gleich / niedriger als bisher | 345 / 178 / 176 Antworten |
| Bisher volle Punkte trotz beobachtbarem Fehler, QSS mit Abzug | 89 Antworten |

Die Mutationsgruppen verteilen sich wie folgt; die Tabelle enthält auch die
jeweils zugehörigen Ausführungs- und Ergebnisfehler:

| Mutationsgruppe | n | Maximum | QSS | Bisher | Teilpunkte / Nullpunkte |
|---|---:|---:|---:|---:|---:|
| Vergleichsoperator geändert | 31 | 80 | 49 | 24,7107 | 27 / 4 |
| Literalwert geändert | 223 | 841 | 618 | 405,1380 | 209 / 14 |
| Anweisung ausgelassen | 7 | 24 | 0 | 0 | 0 / 7 |
| Projektionsausdruck verändert | 324 | 1072 | 748 | 657,6102 | 312 / 12 |
| Antwort durch unpassende Anweisung ersetzt | 114 | 242 | 0 | 41 | 0 / 114 |

Von den 643 erfolgreich ausgeführten falschen Antworten erhalten 533 Teilpunkte
und 110 Nullpunkte. Die übrigen 56 Fälle werden separat behandelt: 15 erhalten
statische Teilpunkte und 41 zertifizierte Nullpunkte. Ihre Ausführungsprobleme
werden damit nicht als erfolgreiche SQL-Ausführung ausgegeben.

Die 89 bisherigen Vollbewertungen trotz nachgewiesenem Fehler umfassen
45 Projektions-, 32 Literal- und zwei Vergleichsfehler sowie zehn vollständig
ersetzte Antworten. Bei den letzten zehn wurde die geforderte UPDATE-Lösung
durch ein unpassendes konstantes SELECT ersetzt. Die bisherigen Form- und
Abhängigkeitsmetriken vergaben dafür noch volle Punkte, teilweise 4/4; QSS
zertifiziert jeweils Nullpunkte. Weitere plausible Korrekturen sind ein falscher
DEFAULT-Wert mit bisher 2/2 und nun 1/2 Punkten sowie ein um 1 verfälschter
Projektionsausdruck mit bisher 3/3 und nun 2/3 Punkten.

Die Abzugshöhe ist dennoch nicht automatisch angemessen. Bei einer veränderten
COUNT-Schwelle ergeben sich beispielsweise bisher 1,5/7 und nun 6/7 Punkte.
In einer umfangreichen 25-Punkte-Aufgabe verändert ein falscher Modulo-Divisor
im WHERE-Filter die sichtbaren Daten; QSS vergibt bei exakter Distanz 1 noch
24/25 Punkte, die bisherige Bewertung 10/25. Viel korrekte SQL-Arbeit bleibt
erhalten, aber eine zentrale Auswahlbedingung kann fachlich schwer wiegen.
24/25 wird deshalb ausdrücklich nicht als nachgewiesen faire Note ausgegeben.
Mit Skala 1 kostet derselbe Einheitsedit bei einer Ein-Punkt-Aufgabe 100 Prozent
der Punkte, bei einer 25-Punkte-Aufgabe nur vier Prozent.

Die Punktesumme ist kein Qualitätsmaß. Der Vergleich enthält gezielt erzeugte
Fehler und keine unabhängig menschlich benoteten echten Studentenabgaben.
Insbesondere sind 548 Teilpunktefälle gezielt erzeugte Ein-Edit-Fehler; die
151 Nullpunktefälle wurden nur bis zur mathematisch sicheren Nullpunktgrenze
untersucht. Die Verteilung mit 324 Projektions- und 223 Literaländerungen ist
stark durch den Generator geprägt. Der Vergleich belegt, dass die neue Bewertung
Änderungen erkennt und reproduzierbar nach dem deklarierten Graphmodell bepreist.
Ob Kosten und Skala pädagogisch angemessen sind, muss an Aufgaben und fachlich
benoteten echten Antworten kalibriert werden.

## Laufzeiten und Grenzen der Aussage

Im vollständigen Korpuslauf wurden SQL-Vorbereitung, Musterlösung, Formatvariante
und alle Kandidaten getrennt gemessen, ebenso QSS pro Vergleich und die gesamte
Prüfung pro Quellfrage. Die folgenden QSS-Zeiten verwenden einen wiederverwendeten,
bereits gestarteten Worker; Worker-Startkosten sind darin nicht enthalten.

| QSS-Vergleich im vollständigen Korpus | n | Median | 95. Perzentil | Maximum |
|---|---:|---:|---:|---:|
| Selbstvergleich | 699 | 4,6 ms | 9,8 ms | 21,8 ms |
| Formatvariante | 699 | 4,3 ms | 9,1 ms | 19,2 ms |
| Gezielt falsche Antwort | 699 | 13,4 ms | 566,3 ms | 2267,9 ms |

Eine zusätzliche gezielte Stichprobe umfasst zwanzig Fragen aus allen fünf Pools.
Hier wurde jeweils ein frischer QSS-Worker vom Aufruf seines Konstruktors bis zum
Ergebnis gemessen, einschließlich Worker-Startkosten:

| Vergleich mit frischem Worker | n | Median | Maximum |
|---|---:|---:|---:|
| Selbstvergleich | 20 | 38,15 ms | 56,6 ms |
| Erfolgreich ausgeführte falsche Variante | 8 | 95,4 ms | 303 ms |

Zwölf weitere Varianten liefern keine geeignete beobachtbare Änderung für diese
Latenzprobe und sind deshalb nicht als falsche Antworten der Stichprobe gezählt.
Von den acht bewerteten Varianten haben sieben einen exakten Abstand; bei einer
sind Nullpunkte durch eine Untergrenze zertifiziert. Die Auswahl ist gezielt,
keine repräsentative Verteilung echter Studentenabgaben oder Endgeräte.
Parallele Browserprüfungen beanspruchen dieselbe CPU; ein frischer Worker bedeutet
keinen kalten Betriebssystem- oder HTTP-Cache.

Lange SQL-Ausführung ist ein eigenes Laufzeitrisiko. Im vollständigen Korpus
benötigte die längste SQL-Ausführung einer Musterlösung **90,824 Sekunden**.
Der längste von insgesamt 1203 Kandidatenversuchen benötigte **137,071 Sekunden**.
Die längste gesamte Korpusprüfung einer Frage dauerte **316,336 Sekunden**;
das umfasst Vorbereitung, mehrere Varianten und gegebenenfalls verworfene
Kandidaten und ist keine Zeitmessung einer einzelnen Studentenabgabe.

Auch die QSS-Suche hat keine zugesicherte maximale Dauer: Ein zusätzlicher
anonymer CTE-Stresstest innerhalb der aktuellen 156 npm-Tests benötigte etwa
**44,05 Sekunden**. Dieser Fall liegt außerhalb der 699 gewählten Korpusvarianten.
Aus kurzen Medianzeiten folgt deshalb weder eine Gerätegarantie noch eine
belastbare maximale Wartezeit. Fortschritt und manueller Abbruch bleiben
relevant. Ein Ausführungs-Timeout wurde nicht eingebaut.

## Artefaktstand und verbleibende Migrationsgrenzen

Alle endgültigen QSS- und nativen Browsernachweise verwenden Modell 2.0.1 und
denselben eingefrorenen Bundle-Stand. Der Worker hat SHA-256
`5a90aaa1442ec8b6aaab93cde4d5badeecfe5dbc268477bca7cacc14caf030c8`.
Das QSS-API-Bundle hat SHA-256
`715e1d0d25066b3e23d620e6b4cfe4e5064c569185c19b718486ba25d9cf6bf3`.
Der zugehörige JavaScript-Laufzeitstand hat SHA-256
`defc00f9cfeb7546afdd05a0fab8186c9496b63bcbe2eef664411e50c01c984e`.
Die tatsächlich ausgelieferten Dateien wurden vor und nach den Läufen geprüft.
Bei einer späteren Änderung sind betroffene Nachweise erneut zu erbringen.
Private Archive, SQL-Antworten, Antwortfingerabdrücke, Zugangsdaten und Screenshots
werden nicht versioniert.

**Prüfungsgrenze:** Die vollständige Muster-SQL ist im Teilnehmerbrowser
zugänglich. Browserdiagnosen sind veränderbare und nicht vertrauenswürdig
signierte Daten. Dieser Stand ist ein transparenter Shadow-/Übungspilot, keine
Prüfungsfreigabe mit geheimer Musterlösung und kein automatischer Notenersatz.

**StudOn-Migration:** Die bereits untersuchten 36 Beschreibungen von
Taxonomieknoten sind StudOn-Zusatzfelder ohne Speichergegenstück im offiziellen
ILIAS-Modell. Die StudOn-Core-Erweiterung muss sie bei der Migration erhalten;
der neue QSS-Vergleich löst diese unabhängige Einschränkung nicht. Der lesende
[Taxonomie-Vorabcheck](../tests/ilias11/check-taxonomy-import.php) und die
[Migrationshinweise](ilias-11.md#studon-zusatzdaten-in-taxonomien-vor-der-migration-prüfen)
erkennen und erklären den Fall.
