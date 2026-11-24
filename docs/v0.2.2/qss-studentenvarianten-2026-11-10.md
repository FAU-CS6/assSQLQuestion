# Graph-QSS und studentische Antwortvarianten – 10. November 2026

**Technische Abnahme bestanden am 10. November 2026, 13:15 Uhr MEZ.**
Das schreibgeschützte Gesamtabnahme-Gate bestätigt alle 699 Originalfragen mit
6.812 Varianten im regulären ILIAS-Studentenformular. Alle vier Versuche wurden
durch die native Abschlussfunktion beendet. Es gab keine Bewertungsfehler,
JavaScript-Seitenfehler oder manuellen Notenänderungen. Die Berichte vom
9. November belegen ausschließlich ihre damaligen Builds.

## Vollständige native Matrix

Installiertes Google Chrome `157.0.8103.50`, ausschließlich headless mit isolierten
Profilen; ILIAS 11.5, PHP 8.4, Plugin 0.2.2. Alle Segmente verwenden denselben
Produktivbuild. Vollständige Fragecheckpoints unterbrochener nativer Läufe wurden
mit unveränderten Datensätzen übernommen; angefangene Fragen wurden wiederholt.
Entwicklungsvorläufe fließen nicht in die folgenden Ergebnisse ein.

| Quellbereich | Fragen | Korrekt | Lokale Fehler | Grobe Fehler | Fälle | Gespeicherte offizielle Punkte |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1–175 | 175 | 688 | 448 | 525 | 1.661 | 575 / 575 |
| 176–350 | 175 | 694 | 523 | 525 | 1.742 | 591 / 591 |
| 351–525 | 175 | 694 | 524 | 525 | 1.743 | 638 / 638 |
| 526–699 | 174 | 687 | 457 | 522 | 1.666 | 455 / 455 |
| Gesamt | **699** | **2.763** | **1.952** | **2.097** | **6.812** | **2.259 / 2.259** |

Alle korrekten Varianten erhalten volle QSS-Punkte. 1.947 lokale Fehler behalten
80 Prozent und fünf lokale Fehler 60 Prozent des jeweiligen Maximums. Alle
2.097 groben Fehler erhalten durch eine mathematische Untergrenze zertifizierte
Nullpunkte; deren genauer Abstand wird nicht behauptet. Die übrigen 4.715 Fälle
haben einen exakten Abstand innerhalb des deklarierten Graphmodells.

Der unveränderte offizielle PHP-Scorer bestätigt die erfassten offiziellen Punkte
aller 6.812 Varianten und liefert mit beziehungsweise ohne QSS dieselben Werte.
Zusätzlich wurden alle 699 autorisierten gespeicherten Musterabgaben mit ihren
Antwort-/Referenzbindungen, offiziellen Einzelnoten und finalisierten Versuchen
direkt aus ILIAS geprüft. Die 699 erneut ausgeführten Musterlösungen reproduzieren
die unveränderten Original-Ergebnisrelationen.

Der normale Dozent hat alle fünf Pools mit 23, 65, 504, 68 und 39 Fragen nativ
importiert, exportiert und reimportiert. Der anschließende semantische Abgleich
bestätigt 699 importierte und 699 reimportierte Fragen, einschließlich 1.398
geprüfter Frageeigentümer. Dozent und Student sind getrennte Konten ohne
Systemadministratorrolle. Die unten beschriebene Grenze bei 36 StudOn-spezifischen
Taxonomie-Beschreibungen bleibt bestehen.

## Tatsächliche Variantenabdeckung

| Zahl ausgewählter Varianten pro Frage | Korrekte Antworten einschließlich Musterlösung | Lokale Fehler | Fachliche korrekte Alternativen ohne Darstellung/Kommentare |
| --- | ---: | ---: | ---: |
| 0 | 0 | 28 | 203 |
| 1 | 0 | 21 | 90 |
| 2 | 0 | 19 | 82 |
| 3 | 33 | 631 | 324 |
| 4 | 666 | 0 | 0 |

Jede Frage hat genau drei grobe Fehlervarianten. Von den 2.763 korrekten Fällen
sind 699 Musterantworten, 1.226 fachliche Umformungen und 838 reine
Darstellungsvarianten. Bei 203 Fragen wurde keine fachliche Alternative ausgewählt;
Formatierung und Kommentare ersetzen dort keine zusätzliche Lösungsstrategie.
Bei 68 Fragen wurden weniger als drei lokale Fehler gefunden. Insgesamt verfehlen
93 Fragen mindestens eines der Ziele „vier korrekte“ oder „drei lokale“ Varianten.
Die Matrix behauptet deshalb keine drei fachlich verschiedenen Lösungswege und
keine drei sinnvoll kleinen Fehler für jede atomare DROP-/DDL-Aufgabe.

Ganz ohne ausgewählten lokalen Fehler bleiben die Ordinale 20, 34, 38, 44, 50,
55, 58, 59, 61, 62, 71, 74, 77, 78, 79, 80, 81, 84, 86, 605, 622, 625, 630,
632, 647, 648, 656 und 699. Die vollständigen Diagnosen und Auswahlgründe sind
in den privaten frageweisen Auswahlprotokollen erhalten. Diese technische
Abnahme ist keine menschliche Kalibrierung und kein vollständiger Beweis aller
SQL-Äquivalenzen oder aller denkbaren Studentenantworten.

## Beobachtete Laufzeiten

Die gemessene Formularlaufzeit vom Ausführen bis zur Freigabe beträgt im Median
613 ms, beim 95. Perzentil 1.919 ms und maximal 92.588 ms. Sie enthält SQL, QSS,
Darstellung und Testinstrumentierung; sie ist keine isolierte QSS-Zeitmessung.

Bei Ordinal 168 benötigt bereits der unabhängige SQL-Worker rund 70,9 Sekunden
für die Musterlösung; das native Formular benötigt rund 71,5 Sekunden und QSS
besucht dabei einen Zustand. Daneben bleiben teure QSS-Fälle: Der lokale
Projektionsfehler bei 590 benötigt insgesamt rund 92,6 Sekunden trotz zertifiziertem
Abstand 1; der Literalfehler bei 626 rund 79 Sekunden mit 15.456 besuchten Zuständen.
Die unabhängigen SQL-Ausführungen dieser beiden Varianten benötigen jeweils nur
rund 0,25 beziehungsweise 0,27 Sekunden. Such- und Zertifikatsarbeit kann daher
weiterhin deutlich langsamer als SQL sein. Alle Fälle wurden ohne Ausführungsfrist
oder Besuchsknotenbudget beendet.

## Nachweisbindung

Der private Aggregatbericht hat `accepted: true`, `completed: true` und eine leere
Fehlerliste. Er bindet Korpus, Antwortplan, eingefrorene Quellen, vier Fallströme,
wiederhergestellte Musterantworten, Browserberichte, gespeicherte Noten und
Lehrer-Roundtrip über SHA-256 aneinander. Folgende Hashes erlauben die Zuordnung,
ohne Originalfragen, Antworten oder Kontodaten zu veröffentlichen:

| Artefakt | SHA-256 |
| --- | --- |
| Gesamtabnahmebericht | `a6507f1c65d77305a695c12a9f11874b0a5d018da22458d4836bd7b99c38d456` |
| Originalkorpus | `5e95da73024a4a74c407563a0c0b675b4dbe8ff0683846f1a9e24dafb6544bbb` |
| Antwortplan | `fa12a0fa56750d3e630c1a239cbef73976c97a0eaba3284b664a555c8a823427` |
| Eingefrorener Buildnachweis | `4d5e9b79be114607aad4f48a7cf40de14e03f2e153a454545d733422742de40d` |
| QSS-API-Bundle | `8e2cc2b51d3654b0e08650b9e0fadd0a2008f6bee80c9538b3f50a67e5fe17d6` |
| QSS-Worker | `9a68ce75ee5fabc4d003abf50aca13987a5244e6abfff6004b96becaa9e1151f` |
| Ausgelieferte JavaScript-Runtime | `ae02da02a17163cee7f253f38b2355a3ca07f3131d468afe52cbae7ebe1c87b6` |
| Native Fälle 1–175 | `054f34036474207c1d9276d33ef097606f12809fb56588d5675459790accbb24` |
| Native Fälle 176–350 | `d457ab23ad9adfe0304bc828d9ae63ac7964facbb868ed75dd4ab45c821866c4` |
| Native Fälle 351–525 | `82cba71a6589ef963fa947933a1fec18a224d02bf309a67002956103c751080f` |
| Native Fälle 526–699 | `a081dd3b28a94adbe9707d0607668dba2dec482ac04b2bce6644a75ba574f203` |
| Lehrer-Roundtrip | `a006b307a87e2720006a69b60b5da229d6132f50449823f7ef61ed9347f6f180` |
| Semantischer Lehrerabgleich | `34c08249a7f60ed547284888690021905271cf982731739cb51ef59b83814e34` |

Der Gesamtauswerter berücksichtigt, dass die letzte native Frage keine
Weiter-Schaltfläche hat, und verlangt dort ebenfalls den tatsächlich finalisierten
Versuch. Fehlende Weiter-Schaltflächen vor der letzten Frage sowie vorhandene,
weiterhin gesperrte Schaltflächen werden abgewiesen. Positive und negative
Regressionstests sichern diese Korrektur des Auswerters ab; die erfassten
Bewertungsdaten wurden dafür nicht verändert.

## Modell und Korrekturen

Modell `graph-qss-sqlite-v2`, Version `2.1.0`, Rubrik `paper-linear-v2`.
Die Implementierung verwendet konkrete SQL-ASTs als Zustände eines impliziten
Graphen und benannte, gewichtete SQL-Edits als Kanten gemäß
[Graph-based QSS](https://www.cs6.tf.fau.eu/files/2025/03/Koeberlein-Graph-based_QSS-141_b.pdf).
Die gerichtete Distanz ist die Kosten eines kürzesten nachspielbaren Editpfads
innerhalb des deklarierten Katalogs, Symbolbereichs und der AST-Grenzen.

Strukturelle Vergleichswerte steuern ausschließlich die Suchreihenfolge und
Versuche, einen optimalen Pfad nachzuweisen. Sie liefern keine Punkte.
Ein vorzeitig gefundener Pfad wird nur akzeptiert, wenn seine Kosten einer
bewiesenen globalen Untergrenze entsprechen oder sein tatsächlicher Nullkostenpfad
unter nichtnegativen Editkosten bereits die Optimalität beweist. Andernfalls
bleibt die vollständige Suche erhalten.

Die Skala ist für jede Frage fest auf `Pmax / 5` gesetzt. Ein lokaler Edit mit
Kosten 1 zieht 20 Prozent des Maximums ab; eine grundlegende fehlende Datenquelle
oder Skriptoperation mit Kosten 5 schöpft es aus. Explizite API-Skalen bleiben
möglich. Dies ist eine vorläufige Kostenkalibrierung ohne unabhängig menschlich
bewertete echte Studentenabgaben.

Ergänzt wurden insbesondere:

- abgesicherte De-Morgan-/Komplement-Edits, NULL-erhaltende Boolesche CASE-Formen,
  exakte int64-Konstantenausdrücke und COUNT(*)/COUNT(1);
- Fremdschlüsselumstellungen unter Erhaltung der Aktionsreihenfolge, mit einem
  unabhängigen CASCADE-/SET-NULL-Gegenbeispiel gegen eine unsichere Umstellung;
- logische lokale Reparaturen für deklarierte Bedingungen, Ausgabenausdrücke
  und Spaltendeklarationen mit gequoteten CHECK-Bindungen;
- passende SQLite-Namensauflösung in DDL, DML, vorausgehenden Views,
  Stern-Unterabfragen, ALTER-ADD-CHECK und UNION-ORDER-BY;
- deterministische Aggregat-Aliase und bekannte abgeleitete Quellen, während
  volatile/ungeklärte Funktionsherkünfte und Kollationsschutz erhalten bleiben;
- ausschließlich ausdrücklich formulierte Methodenvorgaben und aufgabengebundene
  Regeln für freie Gruppenlabels beziehungsweise technische Rückmeldetupel.

Der unberechtigte Abzug bei Ordinal 664 entstand durch eine fehlende
Namensauflösung im CHECK einer neu angelegten ALTER-Spalte. Der Serializer
quotierte den Namen, den der Adapter deshalb als Textliteral behandelte. Die
Korrektur bindet bestehende und neue Spalten im CHECK, ohne den unabhängigen
DEFAULT-Kontext umzudeuten. Anonyme SQLite-Gegenproben prüfen zusätzlich NULL,
erlaubte und abzuweisende Werte. Weitere gefundene Kontextlücken betrafen
UNION-ORDER-BY und lokale ALTER-Bedingungen.

Die native Wiederholungsprüfung von Ordinal 664 ergibt:

| Varianten | Abstand | QSS-Punkte |
| --- | --- | --- |
| Musterlösung und die drei zuvor betroffenen korrekten Umformungen | jeweils 0 | jeweils 2 / 2 |
| Spaltennamenfehler, fehlendes NOT NULL, falsches lokales Literal | jeweils 1 | jeweils 1,6 / 2 |
| Drei grundlegend falsche Antworten | Nullpunkte durch Untergrenze zertifiziert | jeweils 0 / 2 |

Auch die früher auffälligen Ordinale 108 und 515 erhalten für alle ausgewählten
korrekten Varianten volle Punkte. Bei Ordinal 200 gilt das ebenfalls für freie
Gruppenlabels, ihre Inversion und das ausdrücklich freigegebene Rückmeldetupel.

## Prüfverfahren und Grenzen

Der Originalkorpus wird mit allen 699 Quellidentitäten in fünf Pools mit
23, 65, 504, 68 und 39 Fragen gestreamt. Gleicher SQL-Text wird nicht dedupliziert.
Private Originaltexte, Antworten, Kontozugänge, Screenshots und Laufprotokolle
bleiben außerhalb des Repositorys.

Vor einer QSS-Bewertung wählt ein unabhängiger Chrome-SQL-Worker die Kandidaten
aus einem reproduzierbaren Antwortplan. Korrekte Kandidaten benötigen zusätzlich
einen abgesicherten Transformationsgrund; endlicher Ergebnisgleichstand allein
beweist keine allgemeine SQL-Äquivalenz. Leichte Fehler benötigen eine unabhängig
beobachtete Abweichung. Unterschiedliche Fehlerfamilien werden vor weiteren
Kandidaten einer bereits belegten Familie bevorzugt. QSS-Punkte beeinflussen
diese Auswahl nicht. Nicht passende Kandidaten bleiben als Diagnosen erhalten.

Pro Frage werden möglichst vier korrekte Antworten einschließlich Musterlösung,
drei lokale Fehler und drei grobe Fehler geprüft. Reine Darstellung und Kommentare
gelten ausdrücklich nicht als zusätzliche fachliche Lösungsstrategie. Bei atomaren
DROP-/DDL-Aufgaben können weniger lokale Fehler oder fachlich verschiedene
korrekte Strategien verfügbar sein; diese Lücken werden gesondert ausgewiesen.
Der Testgenerator hat bei 27 Originalantworten Parserlücken und kann dort keine
vollständige Auswahl von AST-Umformungen anbieten. Das ist eine zusätzliche
Grenze des Variantenkatalogs; der Produktionsadapter unterstützt mehr Syntax.

Die finale Matrix verwendet die regulären ILIAS-Studentenformulare für die
Quellbereiche 1–175, 176–350, 351–525 und 526–699. Sie prüft Antwort-/Musterbindung,
Fragenreihenfolge und Autosave-Ziel, Fortschritt an der Frage, die Barriere vor
Ergebnistabelle und Navigation, Freigabe sowie Entsorgung der Worker. Anschließend
wird die Musterantwort erneut ausgeführt, gegen die ursprüngliche Ergebnisrelation
geprüft und durch die native Navigation beziehungsweise den Testabschluss abgegeben.

`student-variants-report.php` vergleicht jeden erfassten Fall mit dem unveränderten
offiziellen PHP-Scorer, mit und ohne QSS-Sidecar. `qss-report.php` prüft die tatsächlich
autorisierten gespeicherten Antworten, Fingerabdrücke, offiziellen Einzelnoten und
den durch den Teilnehmer finalisierten Versuch. Der schreibgeschützte Aggregator
`verify-student-variants.cjs` führt diese Nachweise mit Quellkorpus, Antwortplan,
Build-Hashes und dem abschließenden Lehrer-Roundtrip zusammen. Unvollständige,
gemischte oder inkonsistente Nachweise bestehen dieses Gate nicht.

SQL-Ausführung und QSS bleiben vollständig im Browser. Es gibt keinen produktiven
Node-Dienst, keine Ausführungszeitgrenze und kein Besuchsknotenbudget. Die Tests
verwenden ausschließlich installiertes Google Chrome im Headless-Modus mit
dedizierten temporären Profilen sowie getrennte normale Dozenten-/Studentenkonten.
Manuell abgebrochene Entwicklungsläufe sind keine finale Abnahme.

Der native Lehrer-Roundtrip umfasst Import, Export, Reimport und einen semantischen
Abgleich aller Fragen. Die bekannte Grenze bleibt: 36 StudOn-spezifische
Taxonomie-Beschreibungen benötigen die StudOn-Core-Erweiterung. Daraus wird keine
vollständige Metadatenverlustfreiheit unter unverändertem offiziellem ILIAS abgeleitet.

## Vorabprüfungen des eingefrorenen Builds

| Prüfung | Ergebnis |
| --- | --- |
| JavaScript-Modell, Suche, SQLite-Gegenbeispiele, Generator, Orakel, Gate und Wiederaufnahme | 208 Tests bestanden |
| Reproduzierbarer Bundle-Neubau | beide Dateien bytegleich |
| PHP 8.3 | 42 Tests, 163 Assertions bestanden |
| PHP 8.4 | 42 Tests, 163 Assertions bestanden |
| ILIAS-11-Integration | 14 Tests, 96 Assertions bestanden |
| Chrome-UI-Barriere, Abbruch, Stale-/AJAX-Schutz und Zeilenmetadaten | fünf Prüfgruppen bestanden |
| Normale Dozentenbearbeitung und native Vorschau | Autorenlauf und vier Vorschauvarianten bestanden |

Die isolierten Entwicklungsvorläufe dienten der Fehlersuche. Sie ersetzen weder
die vollständige native Matrix noch gespeicherte, finalisierte Studentenabgaben.

## Betrieb und untersuchte Sonderfälle

Unterbrochene Läufe werden ausschließlich an vollständigen Fragegrenzen in einen
neuen privaten Artefaktordner übernommen. Die Eingaben bleiben erhalten; Hashes
belegen die unveränderten übernommenen Datensätze. Die angefangene nächste Frage
wird vollständig wiederholt. Auch eine bereits geprüfte Musterantwort zählt erst
nach erfolgreicher nativer Navigation als abgeschlossener Fragecheckpoint.
Die Wiederaufnahme darf bekannte Bewertungsfehler nicht durch Weglassen verdecken.

Während dieser Abnahme erreichte der 59-GB-Docker-Datenträger seine Kapazität.
MariaDB brach einen Reimport mit Fehler 1114 ab. Vollständig auf den Mac gesicherte
und per SHA-256 geprüfte generierte Laufzeitkopien im Testcontainer wurden entfernt;
Originalfragen und Datenbankinhalte blieben erhalten. Unvollständige Reimportpools
bleiben diagnostisch erhalten; der vollständige Reimport verwendet einen frischen
Zielpool. Nach einem zusätzlichen Stopp der lokalen Dienste wurden dieselben
Container wieder gestartet und das bereits bereitgestellte Plugin regulär auf
0.2.2 aktualisiert und aktiviert. Worker- und Runtime-Hashes blieben unverändert.

Bei Ordinal 64 erzeugt die unbedingte Kontrollverknüpfung ohne die geforderte
Löschung 2.201.684 statt 724 Zeilen. Die Darstellung beziehungsweise Übertragung
dieser vollständig materialisierten Ausgabe überfordert Chrome. Für Aufgaben mit
dieser Kontrollstruktur (Ordinal 52 und 64) stehen deshalb drei vorab festgelegte
andere grobe Fehler zur Auswahl: Tabelle statt Tupel löschen, eine fehlende Quelle
abfragen oder aus der falschen Quelle löschen. Die ursprünglichen Kandidaten
bleiben im privaten Plan erhalten. Diese Auswahl basiert nicht auf QSS-Punkten;
sie führt weder eine produktive Zeilenbegrenzung noch eine Ausführungsfrist ein.
Eine beliebig große SQL-Ergebnismenge bleibt von den Browserressourcen abhängig.

Der Testadapter unterscheidet explizit zwischen einem nicht ladbaren SQL-Worker
und gewöhnlichen SQLite-Ausführungsfehlern: Der historische SQL-Worker meldet
Letztere ebenfalls als Worker-Fehlerereignis. Infrastrukturfehler brechen die
unabhängige Auswahl ab; sie werden nicht als falsche Studentenantwort gewertet.
