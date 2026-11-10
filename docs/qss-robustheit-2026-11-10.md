# QSS: unterschiedliche Antworten und Performance – 10. November 2026

**Die erneute vollständige native Abnahme von Modell 2.1.1 ist bestanden.**
Das schreibgeschützte Gesamtabnahme-Gate wurde am 10. November um 14:20 UTC
erfolgreich abgeschlossen. Es bindet alle vier frischen nativen Läufe an
denselben eingefrorenen Produktionsstand und den neuen Lehrer-Rundlauf.
Der [Bericht zu Modell 2.1.0](qss-studentenvarianten-2026-11-10.md) dokumentiert
den vorherigen, eingefrorenen Build. Seine 6.812 ausgewählten Fälle belegen
keine allgemeine Robustheit für alle denkbaren Studentenantworten.

## Unveränderte Fragen als Testdaten

Die Originalfragen, Aufgabentexte, Musterlösungen und Kontrollabfragen werden
nicht repariert oder für die Auswertung passend gemacht. Sie dienen als
unveränderte Beispiele für mögliche Fragenpools. Änderungen betreffen das
Plugin und die Testwerkzeuge. Studentische Varianten werden in eigenen
Testversuchen ausgeführt.

Der private Korpus und seine Archive bleiben außerhalb des Repositorys.
Auch Übergabedokumente liegen ausschließlich außerhalb des Projektordners.
Die erreichbaren Git-Inhalte wurden auf diese Daten geprüft. Die im Repository
ergänzten SQL-Prüffälle sind anonyme, unabhängig formulierte Beispiele.
Auch die alten, bereits ignorierten Exporte und Laufartefakte wurden aus
`test-results` heraus verschoben und per SHA-256 geprüft. Die Browserwerkzeuge
verwenden für ihre Ausgabe standardmäßig ein Verzeichnis im temporären Ordner
des Betriebssystems außerhalb des Repositorys.

## Graph-QSS bleibt die Grundlage

Das [Paper, Abschnitte 4.2–4.7](https://www.cs6.tf.fau.eu/files/2025/03/Koeberlein-Graph-based_QSS-141_b.pdf),
bildet weiterhin die Grundlage: konkrete AST-Zustände, benannte Edits mit festen
nichtnegativen Kosten, günstigster gerichteter Editpfad und lineare Punktabzüge.
Ein endlicher Ergebnisgleichstand ist kein Beweis einer allgemeinen SQL-Äquivalenz.
Kostenpflichtige Fehlerreparaturen werden von kostenlosen Äquivalenz-Edits
unterschieden. Insbesondere ist das Verschieben zwischen `LEFT JOIN … ON` und
`WHERE` keine kostenlose Äquivalenz.

Die Implementierung weist tatsächliche Editpfade nach und spielt sie bis zum
Referenz-AST zurück. Eine Suchuntergrenze liefert nur dann vorzeitig einen
exakten Abstand, wenn die Kosten eines tatsächlichen Pfads dieselbe globale
Untergrenze erreichen. Andernfalls bleibt die vollständige Suche erhalten.
Die Punkte werden nicht aus String-, Baum- oder bloßer Ergebnisähnlichkeit
geschätzt. Die Deklaration der endlichen AST-Grenzen bleibt ausdrücklich Teil
des Vergleichsmodells.

SQL und QSS laufen im Browser. Ausführungsfristen und Besuchsknotenbudgets werden
nicht eingeführt. QSS bleibt parallel zur bisherigen offiziellen Bewertung.

## Änderungen an der Implementierung

`graphKey()` speichert innerhalb eines Graphjobs die bereits berechneten
kanonischen Schlüssel unveränderlicher AST-Teilbäume. Strukturell geteilte
Teilbäume müssen nicht für jeden Nachbarn neu serialisiert werden. Der öffentliche
`stableKey()` beobachtet weiterhin Änderungen gewöhnlicher veränderlicher Objekte.
Die Definition gleicher Graphzustände bleibt unverändert.

Die Größenberechnung für die bestehenden AST-Grenzen verwendet ebenfalls lokale
Zwischenergebnisse. Ein mehrfach verwendeter Teilbaum zählt weiterhin an jeder
Vorkommensstelle. Knotenzahl, Tiefe und Boolesche Höhe werden dadurch nicht zu
anderen Modellgrenzen.

Ein zusätzliches binäres Suchzertifikat berücksichtigt überzählige abstrakte
Symbole: Wenn alle dafür deklarierten erhaltenden Edits deren Menge bewahren,
braucht das Entfernen eines solchen Symbols mindestens den günstigsten
nichterhaltenden Edit. Unbekannte Effektdeklarationen oder ein kostenloser
nichterhaltender Edit deaktivieren diese Schranke. Sie wird mit überlappenden
Schranken durch Maximum kombiniert und erzeugt keine Mehrfachabzüge.

`relocateOuterJoinPredicate` umfasst nun auch das Verschieben eines einzelnen
reinen Konjunktionsteils zwischen `ON` und `WHERE`, während das Join-Prädikat
erhalten bleibt. Die Kosten sind fest 1. Das ist eine allgemeine logische
Fehlerreparatur mit nachspielbarem Pfad. Wegen der Katalogerweiterung wurde die
Modellversion auf 2.1.1 erhöht; Rubrik `paper-linear-v2` und Skala `Pmax / 5`
bleiben erhalten.

Die bestehende Berechnung minimaler funktionaler Abhängigkeiten erzeugt jede
Determinantenmenge einmal, statt zuerst alle Permutationen zu materialisieren.
Die bisherige Gleichheit, Reihenfolge und Minimierung bleiben erhalten. Die
öffentliche vollständige Permutationsabfrage wird dadurch nicht ersetzt.

## Unabhängige zusätzliche Antwortfälle

Der neue anonyme Katalog enthält 33 vorab definierte Antwortpaare auf vier
Datensätzen: 132 Prüfungen, davon 96 korrekte Alternativen und 36 gezielte
Gegenbeispiele. Die Datensätze enthalten NULL, Duplikate, gemischte Typen und
eine leere Relation. Die Auswahl hängt nicht von erhaltenen QSS-Punkten ab.

Die Familien umfassen Vergleichskomplemente, De Morgan, Assoziativität,
Idempotenz, kombinierte Umformungen, dreiwertige CASE-Ausdrücke, COUNT,
Ganzzahlkonstanten, gebundene Aliase, INNER JOIN/WHERE sowie DML- und DDL-Varianten.
Gegenbeispiele betreffen unter anderem äußere Joins, Kollationen, NULL bei COUNT,
DISTINCT, Ganzzahlüberlauf, int64-Präzision, Affinität und UNION gegenüber UNION ALL.
Alle 132 Prüfungen bestehen auf dem eingefrorenen Worker von Modell 2.1.1.

Der historische SQL-Worker lässt bei leeren Ergebnissen die Spaltenmetadaten weg.
Der Test erfasst diese Namen als unbeobachtet und stützt deren Erhaltung auf die
gesonderte Umformungsbegründung. Echte SQL-Fehler werden nicht als leeres Ergebnis
umgedeutet. Große Ganzzahlen werden innerhalb von SQLite über Typbeobachtungen
beziehungsweise präfixierten Text unterschieden, damit eine Umwandlung in
JavaScript-Zahlen die Gegenbeispiele nicht verschluckt.

Die zusätzliche Worker-Messung einschließlich Start ergibt bei vier gleichzeitig
laufenden Prüfern einen Median von etwa 37 ms, ein 95. Perzentil von etwa 5,1 s
und maximal etwa 12,4 s. Insbesondere kombinierte COUNT-/DISTINCT-Fehler bleiben
teurer. Diese Zahlen belegen keine universelle obere Laufzeitgrenze.

## Weitere Prüfungen

| Prüfung | Ergebnis |
| --- | --- |
| JavaScript-Modell, Edits, Suche, Generator und Nachweiswerkzeuge | 213 Tests bestanden |
| Funktionale Abhängigkeiten gegen eingefrorene bisherige Implementierung | sieben Tests bestanden, einschließlich 250 erzeugter Relationen |
| Reproduzierbarer Bundle-Neubau | bytegleich |
| PHP 8.3 | 42 Tests, 163 Assertions bestanden |
| PHP 8.4 | 42 Tests, 163 Assertions bestanden |
| ILIAS-Integration | 14 Tests, 96 Assertions bestanden |
| Chrome-UI: Fortschritt, Navigation, Abbruch und Stale-/AJAX-Schutz | fünf Prüfgruppen bestanden |

## Vollständige native Abnahme

Die vier Quellbereiche wurden erneut als normale Studentenversuche ausgeführt,
mit getrennten normalen Dozenten- und Studentenkonten in installiertem,
isoliertem Headless-Chrome. Die vier Versuche wurden regulär abgeschlossen.

| Quellbereich | Fragen | Korrekte Antworten | Lokale Fehler | Grobe Fehler | Fälle |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1–175 | 175 | 688 | 448 | 525 | 1.661 |
| 176–350 | 175 | 694 | 523 | 525 | 1.742 |
| 351–525 | 175 | 694 | 524 | 525 | 1.743 |
| 526–699 | 174 | 687 | 457 | 522 | 1.666 |
| Gesamt | **699** | **2.763** | **1.952** | **2.097** | **6.812** |

Alle ausgewählten korrekten Antworten erhalten volle QSS-Punkte. Von den lokalen
Fehlern behalten 1.947 jeweils 80 Prozent und fünf jeweils 60 Prozent des Maximums;
die groben Fehler erhalten null Punkte. Alle 699 anschließend wiederhergestellten
Original-Musterlösungen reproduzieren den gespeicherten Ergebnis-Hash und erhalten
das offizielle Maximum. Die autorisierten gespeicherten Abgaben enthalten die
passenden Antwort- und Referenzbindungen sowie QSS-Modell 2.1.1; die vier offiziellen
Versuchsnoten ergeben zusammen **2.259 / 2.259 Punkte**, ohne manuelle Eingriffe.
Vorherige Versuche bleiben erhalten.

Für jeden der 6.812 Fälle liefert die unveränderte offizielle PHP-Auswertung mit
und ohne optionales QSS denselben Wert. Zusätzlich wurden 6.809 Antworttexte mit
dem vorherigen Modell-2.1.0-Lauf über Quellordinal, Variantenname und Antwort-Hash
verglichen: offizielle Metriken bytegleich, offizielle Punkte gleich und keine
QSS-Punkteänderung. Bei Frage 52 wurden drei zuvor deklarierte grobe Kandidaten
statt drei anderer grober Kandidaten verwendet; diese sechs unterschiedlichen
Texte sind ausdrücklich kein Paarvergleich.

Die SQL-Pipeline einschließlich
Vorbereitung und Schemaaufnahme, die offiziellen Metriken und die QSS-Phase
werden getrennt erfasst. Die QSS-Phase enthält Digest, Workerstart und Rückmeldung;
sie ist keine reine CPU-Messung der Graphsuche.

| Phase der nativen Varianten, Millisekunden | Median | 95. Perzentil | Maximum |
| --- | ---: | ---: | ---: |
| SQL-Pipeline | 541,9 | 1.511,8 | 73.612,8 |
| QSS | 32,7 | 114,9 | 1.087,0 |
| Minimale funktionale Abhängigkeiten | 0,1 | 1,7 | 993,9 |
| Gesamter Browserlauf | 597,4 | 1.579,0 | 73.692,6 |

Die Phasen können sich zeitlich überlagern und sind nicht zu addieren. Die
Metrikmessung erfasst die Berechnung minimaler funktionaler Abhängigkeiten,
nicht sämtliche UI-Arbeit. Lange unveränderte SQL-Abfragen, insbesondere im
Quellbereich um 168, bleiben langsam; die Auswertung erhält dafür keinen Timeout.

Zwei identische native Antworten zeigen die konkreten Verbesserungen:

- Frage 626, Literalfehler: Gesamtlauf zuvor 78.987 ms, jetzt 513 ms;
  QSS jetzt 35,2 ms bei unverändertem Abstand 1 und denselben Punkten.
- Frage 590, zusätzliche Ausgabespalte: zuvor 92.588 ms, jetzt 1.508 ms;
  QSS 37,3 ms und funktionale Abhängigkeiten 993,9 ms. Hier lag der wesentliche
  Aufwand außerhalb der QSS-Suche. Offizielle Metriken und Punkte bleiben gleich.

Ein gesonderter anonymer Chrome-Vergleich mit neun Spalten und vier Zeilen
benötigt für dieselben 72 minimalen funktionalen Abhängigkeiten zuvor 39.487,6 ms
und jetzt 438,3 ms, bei bytegleicher Ausgabe. Die Werte stammen aus lokalen
Messungen und sind keine garantierten Laufzeiten auf anderen Geräten.

## Grenzen der Variantenabdeckung

Die 2.763 korrekten Antworten bestehen aus 699 Musterlösungen, 1.226 fachlichen
Umformungen und 838 Darstellungs-/Kommentarvarianten. Darstellung ist keine
zusätzliche Lösungsstrategie. Bei 203 Fragen wurde keine fachliche Alternative
ausgewählt. 666 Fragen haben vier korrekte Varianten, 33 nur drei; 631 haben drei
lokale Fehler, 19 zwei, 21 einen und 28 keinen. Insgesamt verfehlen 93 Fragen
mindestens eines der Ziele „vier korrekte“ oder „drei lokale“ Varianten.

Die zusätzlich unabhängig formulierten 132 Fälle erweitern die Prüfung über den
privaten Pool hinaus. Auch zusammen sind beide Kataloge endlich: beliebige SQL-
Strategien und sämtliche denkbaren Studentenantworten sind damit nicht abgedeckt.
Unimplementierte Äquivalenzen können weiter Abzüge erzeugen, und große kostenlose
Graphabschlüsse können lange dauern. Die Kostenkalibrierung bleibt vorläufig;
eine unabhängige menschliche Bewertung realer Antwortpaare steht aus.

## Lehrer-Import, Export und Reimport

Der normale Dozent hat alle fünf Pools mit 23, 65, 504, 68 und 39 Fragen über die
native Chrome-Oberfläche importiert, exportiert und in eigene neue Pools
reimportiert. Der strikte semantische Abgleich bestätigt **699 + 699 Fragen**,
alle 1.398 Frage-Eigentümer, die Pool-Eigentümer, Inhalte, SQL-Sequenzen, Metriken,
Feedback, Poolmetadaten und die vom offiziellen ILIAS unterstützten Taxonomien.
Der QSS-Worker blieb unverändert.

Ein nativer Export enthielt zunächst nur Metadaten ohne QTI-Fragen. Ein danach
diagnostisch geprüfter Export aus der Fragenliste enthielt zwar die Fragen,
aber keine vollständigen Poolmetadaten. Beide Ergebnisse wurden als fehlgeschlagen
aufbewahrt. Der finale Lauf verwendet frische vollständige native Exportpakete
mit QTI und Manifest; Archive, Fragen und erwartete Metadaten wurden nicht zum
Bestehen angepasst. Das Testwerkzeug überprüft die Paketvollständigkeit vor dem
Reimport und lädt das neu erzeugte Paket statt eines älteren Exportlinks.
Die vermutete Datumsgrenze zwischen generischem Wrapper und Legacy-QTI-Export
bleibt eine Diagnose des ILIAS-Exportwegs, keine nachgewiesene Core-Reparatur.

Die bekannte Einschränkung bleibt: 36 StudOn-spezifische Taxonomie-Beschreibungen
benötigen die StudOn-Core-Erweiterung; neun ursprünglich ungesetzte Editor-Modi
werden durch natives ILIAS auf den unterstützten RTE-Standard gesetzt. Eine
vollständige StudOn-Metadatenverlustfreiheit wird daraus nicht abgeleitet.

## Hashbindungen und private Belege

Die Rohdaten und Laufbelege bleiben außerhalb des Repositorys in privaten
temporären Verzeichnissen. Das Gesamtabnahme-Gate liest Quellen und Beobachtungen,
führt weder SQL noch QSS aus und schreibt seinen Erfolgsbeleg nur bei vollständigem
Bestehen. Es prüft unter anderem Quellidentitäten ohne SQL-Deduplizierung,
Antwortbindung, Fortschritt/Navigation, Workerfreigabe, offizielle Noten,
finalisierte Versuche und sämtliche eingefrorenen Quelldateien.

| Beleg | SHA-256 |
| --- | --- |
| Unveränderter Originalkorpus | `5e95da73024a4a74c407563a0c0b675b4dbe8ff0683846f1a9e24dafb6544bbb` |
| Vorab deklarierte Antwortpläne | `fa12a0fa56750d3e630c1a239cbef73976c97a0eaba3284b664a555c8a823427` |
| Eingefrorener Quellstand | `1889cff7c1b83b50dbe56b772f1eaa68a7069158989153af3750d253f8693f3f` |
| QSS-Worker | `3af0d83103ae229e69bf0ec8d0a081cba04c2712857d78c5a57be8c5deab3f43` |
| Ausgelieferte Laufzeit | `9ec94f908787681a3b002ed9ffcad899ca46e6bf174a8c56b966c3b7558b315e` |
| Native Fälle 1–175 | `33812f6011d0e6d87e23e1a1f2f4e9acf93aac828163e414d673c941193d63ca` |
| Native Fälle 176–350 | `bbcebb13c1bf5759080e98abe2564d4cf8b8ad0dc6b064b0adae8d607b8d5b6a` |
| Native Fälle 351–525 | `adfb6e51284610193920c8cbff03de458c3f5d99d47746e6a17a411592ef0804` |
| Native Fälle 526–699 | `f3234b79bbf6df481638284e6a43c0fd6edf22eb07579222ddc9d5124776e1cf` |
| Lehrer-Rundlauf | `d02e562566784281f267a6f6ff8df4f89389963015679d5c7080982c054b4983` |
| Semantischer Lehrerabgleich | `34c08249a7f60ed547284888690021905271cf982731739cb51ef59b83814e34` |
| Zusätzliche 132 anonyme Fälle | `910d49cd7cfa68a33ca1121244cd3b797c77150ac5b8ab07ef64cf1c9dea327d` |
| Vergleich mit bisherigen offiziellen Metriken | `955374af91ea8e763b7ad217fb5b22f71238b5577f9ef8069a877fb759505b9c` |
| Gesamtabnahme | `bec78bcbd5df9f20beaf2f42f3e9ec9015dfa8fc307a2126d9e68392f68edde7` |

## Spätere konfigurierbare Bewertung

Für die spätere Freischaltung einer QSS-Bewertungsalternative sind
[konfigurierbare Kosten und ausdrückliche Methodenvorgaben](qss-kostenkonfiguration.md)
festgehalten. Die aktuelle Dozentenoberfläche bietet diese Einstellung noch
nicht an. Diese Abnahme verwendet die Standardkosten.
