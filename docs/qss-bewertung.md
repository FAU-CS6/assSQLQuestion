# Ergebnisbewertung oder Graph-QSS ab Plugin 0.3.0

Der Fragenersteller wählt im Bewertungsbereich ausdrücklich zwischen
**Ergebnisbasierter Bewertung** und **Graph-QSS-Bewertung**. Es wird nur das
ausgewählte Bewertungsverfahren ausgeführt. Der vorherige parallele QSS-Betrieb
ist nicht mehr der normale Fragenablauf.

## Bedienung

Bei der Ergebnisbewertung bleiben die bisherigen Einstellungen für Zeilenanzahl,
Spaltennamen und funktionale Abhängigkeiten sowie deren Punkteberechnung erhalten.
Es startet kein QSS-Worker; die QSS-Musterlösung wird nicht an diesen Browserablauf
übergeben.

Bei QSS stellt der Autor eigene Maximalpunkte und die
[vorbelegten Umformungskosten](qss-kostenkonfiguration.md) ein. 56 benannte
Umformungs-/Reparaturschritte und 15 Kategorien atomarer Grundoperationen sind
einzeln einstellbar, auch bisher kostenlose Äquivalenzen. Ein Knopf setzt alle
Kosten zurück. Die Einstellungen der anderen Bewertungsart bleiben gespeichert,
werden aber nicht zur Bewertung herangezogen.

Vor dem Speichern einer neuen oder geänderten QSS-Konfiguration muss die
Musterlösung mit den aktuellen Einstellungen ausgeführt werden. Unveränderte
Referenzen und Kosten erfordern bei reinen Metadatenänderungen keine neue
Ausführung. Die normale Vorschau ermöglicht das Testen studentischer Varianten.

Beim Beantworten zeigt der QSS-Bereich ausschließlich eine neutrale Warteanzeige
mit unbestimmtem Fortschrittsbalken. Suchzustände, Untergrenzen, Punkte, Editkosten
und Bewertungsdetails werden dort nicht angezeigt, auch nicht nach Abschluss oder
erneutem Laden einer gespeicherten Antwort. Die Abschlussmeldung verweist auf die
freigegebene Auswertung; deren Zugang steuert weiterhin ILIAS. In der
Aufgabenerstellung und der zugänglichen Lösungsansicht bleiben die Details
verfügbar. Die vorhandene SQL-Ausgabe bleibt davon unabhängig.

## Bewertung und Speicherung

SQL-Ausführen mit Vorbereitung A, Antwort B und gegebenenfalls Kontrolle C bleibt
für die sichtbare Ausführung vorhanden. Für QSS wird zusätzlich das Schema nach A
im Browser gelesen. Die alten Bewertungsmetriken werden im QSS-Modus weder im
Browser berechnet noch auf dem Server zur Punktevergabe aufgerufen.

QSS berechnet weiterhin einen günstigsten tatsächlichen gerichteten Editpfad
innerhalb des dokumentierten Graphmodells. Das [Paper, Abschnitte 4.2–4.7](https://www.cs6.tf.fau.eu/files/2025/03/Koeberlein-Graph-based_QSS-141_b.pdf),
bleibt die Grundlage. Kosten sind je Job fest und nichtnegativ. Standardkosten,
AST-Grenzen und die lineare Abbildung bleiben erhalten:

```text
Punkte = max(Maximalpunkte - Abstand * (Maximalpunkte / 5), 0)
```

Der Server prüft Modell, Rubrik, Zertifizierungsstatus, Maximalpunkte, Skala sowie
Antwort- und Referenzbindung. Er berechnet die Punkte selbst aus dem gelieferten
Abstand; ein zusätzlich geposteter Punktewert wird nicht übernommen. Er führt
weder SQL noch eine Graphsuche aus. SQL-Laufzeitfehler schließen eine statische
QSS-Teilbewertung nicht grundsätzlich aus. Fehlende, abgebrochene, veraltete oder
nicht unterstützte QSS-Nachweise liefern keine Ergebnisbewertung als Ersatz.

Der Server speichert zu einer QSS-Abgabe die verwendete Kosten-/Modellrevision
und die daraus berechnete offizielle Punktzahl. Diese wird auch bei späteren
Konfigurationsänderungen beibehalten; gespeicherte Nullpunkte bleiben ausdrücklich
Nullpunkte. Eine spätere Graphauswertung alter Antworten geschieht nicht heimlich
auf dem Server. Die normalen ILIAS-Kopien einer Poolfrage in einen Test bleiben
erhalten und trennen Poolbearbeitung und Teststand.
Der vorhandene einzelne JSON-Antworttransport bleibt erhalten. Im QSS-Modus wird
die fertig bewertete Antwort erst nach dem Graphjob veröffentlicht; der frühere
SQL-Zwischenstand der Parallelbewertung wird nicht als fertige Bewertung gespeichert.

Fortschritt, Ergebnissperre, Navigation, manuelle Abbruchmöglichkeit und der Schutz
gegen veraltete AJAX-/Worker-Callbacks bleiben bestehen. Es gibt keine SQL-/QSS-
Ausführungsfrist und kein Besuchsknotenbudget. Native ILIAS-Prüfungsfristen werden
nicht verlängert; ein noch nicht abgeschlossener QSS-Nachweis liefert dabei keine
erfundenen Teilpunkte.

## Update und ältere Exporte

Die additive Datenbankmigration 7 ergänzt Bewertungsart, QSS-Maximalpunkte und
Kostenprofil. Bestehende Fragen erhalten ausschließlich den Modus `result`.
Bestehende Metriken, SQL-Sequenzen, Musterlösungen, Antworten und Noten werden
nicht umgerechnet. Neue Fragen starten ebenfalls mit Ergebnisbewertung.

Alte QTI-Dateien ohne `ASSESSMENT_MODE`, `QSS_MAXIMUM_POINTS` und `QSS_COSTS`
werden weiterhin ergebnisbewertet. Neue Exporte übertragen Modus, Maximalpunkte
und das versionierte Kostenprofil. Fragenkopien und Testkopien erhalten dieselben
Angaben. Ungültige oder unbekannte neue Profile werden abgewiesen.

Für die Installation sind wie bisher der aktualisierte ILIAS-Autoloader und
`php cli/setup.php update --legacy-plugin assSQLQuestion` erforderlich. Details
stehen im [ILIAS-11-Upgrade-Leitfaden](ilias-11.md).

## Native Nachprüfung von Modell 2.7.0 am 13. November 2026

Der abschließend geprüfte Browserstand verwendet Kostenprofil 7 mit 71 Positionen:
56 benannte Schritte und 15 atomare Kategorien. Alle bisherigen 64 Preise bleiben
unverändert; ältere Profile einschließlich 2.6.0 und 2.6.1 behalten ihre Overrides.
Sechs neue Schritte sind standardmäßig kostenlos, der Wechsel zwischen IN/NOT IN
und einem skalaren Unterabfragevergleich kostet 1. Die
[Kostenbeschreibung](qss-kostenkonfiguration.md) und der
[technische Katalog](../lib/qss/README.md) erläutern die sieben Regeln und ihre
Bindungs-, Eindeutigkeits-, NULL-, Duplikat- und Affinitätsbedingungen.

Die bestehende AND-/OR-Vertauschung deckt zusätzlich genau eine nachweislich
unkorrelierte, deterministische Unterabfrage im äußeren WHERE ab. Funktionen,
Views, Trigger, unbekannte Bindungen, weitere verschachtelte Abfragen und andere
nicht nachgewiesene Kontexte bleiben ausgeschlossen. Die Unterabfrage selbst
wird dabei nicht geändert. Die Suche bleibt eine exakte gerichtete
kürzeste-Pfad-Suche im konfigurierten Graphmodell. Neue Untergrenzen und eine
frühere Prüfung bereits vorhandener Schranken sparen Rechenarbeit; sie liefern
keine geschätzten Noten und ändern keine Kosten. Die SQLite-Laufzeit bleibt
unverändert 3.22.0, ebenso die lineare Punkteskala und der Verzicht auf
Ausführungsfristen oder Besuchsknotenbudgets.

| Finale native Antwortmatrix | Ergebnis |
| --- | --- |
| 30 unveränderte QSS-Antworten in der nativen Vorschau | 23 exakte Pfade, 7 zertifizierte Nullpunktnachweise; kein unvollständiger QSS-Lauf |
| 3 bisher ergebnisbewertete Antworten | Unveränderte Metriken und Ausgaberelationen; zwei erfolgreiche SQL-Läufe und ein bereits historisch vorhandener SQL-Fehler |
| Ausschließlich gewählte Bewertung | Keine Ergebnis-Metrikberechnung bei QSS, kein QSS-Worker bei Ergebnisbewertung |
| Fragendaten vor/nach jeder Vorschau | SQL A/B/C, Aufgabentext, Modus, Maximalpunkte, Metrikgewichte und Kosten unverändert |
| Studentenanzeige | Neutrale Warte-/Abschlussanzeige; Punkte und Graphdetails bleiben vor Freigabe verborgen |
| UI-Ausführungszeit der 33 Fälle | Median 754 ms, Maximum 4.035 ms |
| QSS-Workerzeit der 30 QSS-Fälle | Median 91,8 ms, Maximum 3.557,2 ms |
| Dieselbe Äquivalenz mit Kosten 0 beziehungsweise 2 | Exakte Abstände 0 beziehungsweise 2; 10/10 beziehungsweise 6/10 Punkte; Kosten-2-Workerzeit 3.206,2 ms |

Die UI-Zeiten enthalten SQL, Anzeige, Screenshots und kurze Beobachtungsintervalle;
die Workerzeiten messen nur QSS. Die Lehrendenfälle wurden seriell ausgeführt,
die beiden Admin-Kostenfälle in einem eigenen isolierten Chrome-Kontext. Diese
endliche Matrix beweist keine allgemeine Höchstlaufzeit. Insbesondere kann die
unveränderte SQL-Ausführung A/B/C mehr Zeit benötigen als der statische Vergleich.
Originalfragen und Musterlösungen wurden nicht angepasst. Die Nachprüfungen
speichern keine neue offizielle Studentenabgabe und berechnen historische Noten
nicht neu.

Ein authentisches Archiv aus der Zeit vor QSS wurde über die native Oberfläche
importiert: Alle 23 Fragen blieben ergebnisbewertet. Export und erneuter Import
behielten die alten SQL-Sequenzen und Bewertungsangaben; die beiden importierten
Stände absolvierten zusammen 46 native Ergebnis-Selbstprüfungen. Native Profile
der Versionen 5 und 6 wurden ebenfalls importiert und erneut exportiert; alle
vorhandenen Overrides blieben erhalten, nur neue Schritte erhielten Standardwerte.

Für die nachgewiesene Kollision sekundengenauer ILIAS-Formularzeitstempel stellt
das Plugin pro gerendertem Testformular eine eigene serverseitige Kennung bereit.
Derselbe Renderstand behält dieselbe Kennung auch bei Autosave und wiederholtem
Absenden; ein neu gerendertes Formular erhält eine neue. Die native
Doppelabgabeprüfung bleibt erhalten. Der ILIAS-Kern wurde nicht verändert.
Schnelle native Fragewechsel und gewöhnliche Wiederholungsabgaben wurden geprüft.

Der Stand besteht 342 Kern-Testgruppen und 89 Engine-Testgruppen im isolierten
Chrome, jeweils 58 PHP-Tests mit 671 Assertions unter PHP 8.3 und 8.4 sowie
19 ILIAS-Integrationstests mit 141 Assertions. Acht separat deklarierte
Browser-Oracle-Gruppen sind in der Kernzahl nicht als bestanden mitgezählt.
Beide öffentlichen QSS-Bundles sind bytegleich reproduzierbar.

| Bindung des finalen Browserstands | Wert |
| --- | --- |
| Modell / Kostenprofil | `2.7.0` / `7` |
| Workerrevision | `1794568226` |
| QSS-Worker SHA-256 | `4bbfe76447e476bdbe36a615adc81583a7486c2d77770188c7f5b94afb47daae` |
| QSS-API SHA-256 | `8bcec3b32108a81262dfa48c3d0f44aca5c936134f35b81ba8f85871fbba0501` |

Auch die erneute native Selbstprüfung aller 699 unveränderten Musterlösungen
ist auf diesem finalen Stand abgeschlossen. Drei disjunkte Bereiche wurden
gegen den vollständigen Fragenindex abgeglichen: jede Frage genau einmal,
kein fehlender oder doppelter Fall. Alle 351 QSS-Fragen ergaben einen exakten
Abstand 0 und volle Punkte; alle 348 Ergebnisfragen führten erfolgreich die
bisherigen Metriken aus. Die jeweils andere Bewertungsart blieb inaktiv.
Alle 699 vor/nach dem Lauf verglichenen Frage-Fingerabdrücke sind identisch;
kein Fragenformular wurde gespeichert. Alle drei isolierten Chrome-Kontexte
belegen den oben angegebenen tatsächlich geladenen Worker-Hash.

Die QSS-Selbstvergleiche benötigten im Median 66,3 ms und höchstens 173,2 ms.
Die gesamte UI-Ausführung lag im Median bei 649 ms; ihr Maximum von 74.651 ms
entfiel fast vollständig auf eine unveränderte SQL-Ausführung von 74.515,3 ms
im Ergebnisbewertungsmodus. Diese drei Bereiche liefen in getrennten Browsern
parallel und teilen sich die Rechnerlast. Die Zahlen belegen daher weder eine
allgemeine Höchstlaufzeit noch einen neuen Test mit studentischen Varianten.

## Historische 100-Durchläufe-Prüfung vor Modell 2.7.0

Die unabhängige Prüfung mit Admin-, Lehrenden- und Studentenkonto umfasste genau
100 native Testabgaben. Jede Abgabe enthielt zehn verschiedene Fragen, jeweils
zwei aus jedem der fünf Pools. Die 1.000 Antwortpositionen umfassten 361 verschiedene
Fragen; die offizielle Passliste wurde unabhängig abgeglichen. Ein 101. Versuch
wurde nicht gestartet. Dies war kein erneuter 100-Durchläufe-Test von Modell 2.7.0.

Der historische Lauf umfasste mehrere Entwicklungsstände: 496 Antworten wurden
ergebnisbasiert und 504 mit QSS bearbeitet. Die letzten zehn Durchläufe nutzten
Modell 2.6.0. Alle 46 Ergebnisbewertungen wurden abgeschlossen; von 54 QSS-Antworten
wurden 37 abgeschlossen und 17 nach individueller Beobachtung manuell abgebrochen.
Die Mediane abgeschlossener UI-Ausführungen lagen bei 535 ms beziehungsweise
703 ms; die abgebrochenen Suchen waren darin nicht enthalten.

Patch 2.6.1 ergänzte exakte ganzzahlige Untergrenzen, Browser-Taskpausen ohne
Timer-Klemmung und die Korrektur für optionales COLUMN bei beobachteten
Schema-Metadaten. Die damalige Nachprüfung benötigte in einzelnen Fällen noch
rund 17 beziehungsweise 27 Sekunden. IN-/JOIN- und bestimmte Aliasvarianten waren
noch nicht durch freie Pfade abgedeckt. Deshalb war dieser damalige Stand nicht
vollständig freigegeben. Die oben dokumentierten 2.7.0-Nachprüfungen behandeln
diese Befunde mit unveränderten Antworten; die alten offiziellen Noten behalten
ihren gespeicherten Modellstand.

Auch die Formularzeitstempel-Kollision wurde in diesem historischen Lauf
beobachtet. Damals wurde die betroffene Antwort unverändert wiederhergestellt
und ihre Speicherung nach einem Seitenwechsel geprüft. Die oben beschriebene
Formularkennung ist die spätere Plugin-Korrektur.

Private Pools, Antworten, Screenshots und detaillierte Belege bleiben außerhalb
des Repositorys.

## Historische Abnahme des Aktivierungsstands am 11. November 2026

Die folgenden Zahlen beziehen sich auf den unten gebundenen Aktivierungsstand,
nicht auf den später erweiterten Graphkatalog. Die anschließende historische Prüfung mit
100 zufälligen Studententests fand lange, manuell abgebrochene QSS-Suchen.
Die Nachprüfung dieser Befunde unter 2.7.0 ist oben getrennt dokumentiert. Ein fehlender QSS-Nachweis wird auf der freigegebenen
Lösungsansicht ausdrücklich als nicht abgeschlossen ausgewiesen. ILIAS führt
in seiner numerischen Punktesumme weiterhin den Platzhalter 0; dieser ist keine
zertifizierte QSS-Nullpunktbewertung.

Die historische Abnahme verwendet getrennte normale Dozenten-/Studentenkonten und ausschließlich
isoliertes installiertes Headless-Chrome. Private Archive, Antworten und Laufbelege
bleiben außerhalb des Repositorys. Originalfragen wurden nicht für Tests angepasst.

| Prüfung | Ergebnis |
| --- | --- |
| Migration: alle 15.177 vorhandenen Fragekopien, 45.534 Metriken, 5.538 Antworten und 5.538 Noten | vor/nach Update identische Fingerabdrücke; alle alten Fragen `result` |
| Historische finale native Abgaben | alle 699 weiterhin 2.259/2.259 offizielle Punkte, ohne manuelle Korrektur |
| Natives Dozentenformular | Auswahl, Standardkosten, Einzeländerung, Zurücksetzen und Speichern bestanden |
| Nativer gemischter Studententest | Ergebnisbewertung 10/10, lokaler QSS-Fehler 8/10, verteuerte Äquivalenz 6/10; offiziell 24/30 |
| Native neue Fragepool-Exporte | drei Fragen mit Modus, Kosten, Maximum, SQL und bisherigen Einstellungen identisch reimportiert |
| Alte Exporte aus Plugin 0.2.2 | alle fünf Pools mit 699 importierten und 699 reimportierten Fragen semantisch bestanden; 1.398 Frage-Eigentümer geprüft |
| Anonyme SQL-/QSS-Gegenproben mit vollständigem Standard-Kostenprofil | 132/132 bestanden (96 korrekt, 36 Gegenbeispiele) |
| JavaScript-Suite | 216 Tests bestanden |
| PHP 8.3 und 8.4 | jeweils 44 Tests, 175 Assertions bestanden |
| ILIAS-Integration | 19 Tests, 141 Assertions bestanden |
| Chrome-UI-Regressionen | sechs Prüfgruppen bestanden, einschließlich exklusiver Bewertung |
| Reproduzierbarer Neubau | beide QSS-Bundles bytegleich |

Die originalen temporären ZIP-Quellpfade waren beim Wiederanlauf nicht mehr
vorhanden. Für den älteren Exportweg werden deshalb die unveränderten nativen
Archive der bereits dokumentierten Plugin-0.2.2-Abnahme verwendet. Ihre Herkunft
ist an den früheren Transferbericht gebunden; keine der 699 Fragen darin enthält
die neuen Bewertungsfelder. Die Archive werden nicht angepasst. Ihr semantischer
Abgleich verwendet weiterhin den unveränderten Originalkorpus.

Die finale native Abnahme prüft URL- und Formularidentität vor jeder Antwort.
Fehlgeschlagene Navigationsdiagnosen und frühere Testkopien bleiben als solche
privat erhalten und werden nicht als bestandene Läufe zusammengezählt.

| Bindung des finalen Abnahmebelegs | SHA-256 |
| --- | --- |
| Unveränderter Originalkorpus | `5e95da73024a4a74c407563a0c0b675b4dbe8ff0683846f1a9e24dafb6544bbb` |
| Ausgelieferter QSS-Worker | `9e43f89d099d0537d591d98c979af09cedf1c74fa851626750d955a595dae744` |
| Ausgelieferte JavaScript-Laufzeit | `6958cf9e60b4e8d180ae48e567b6503e8e955d586d24ccb143b2acc6af580e7e` |
| Zusammengesetzte Gesamtabnahme | `5d94d78b11f9ca6967f14fae30e52e70badb3ed454a75b9e41995547cadda942` |

Der private Gesamtabnahmebeleg des Aktivierungsstands `7fb13a3` bindet 96
Produktionsdateien sowie die einzelnen Browser-, Upgrade-, Noten-, Export- und
Testberichte. Er enthält keine Umdeutung
fehlgeschlagener Vorläufe und keine vollständige SQL-Äquivalenzgarantie.

Die anschließende Änderung der Studentenanzeige wurde mit sieben Chrome-
Regressionsgruppen, 44 PHP-Tests mit 177 Assertions unter PHP 8.3 und 8.4 sowie
19 ILIAS-Integrationstests mit 141 Assertions geprüft. Ein nativer anonymer
Studententest bestätigt neutrale Anzeigen während der Bewertung, nach Abschluss
und beim Wiederaufrufen der gespeicherten Antwort. Nach Abgabe erscheinen die
offiziellen 3/5 Punkte und QSS-Details auf der freigegebenen Auswertungsseite.
Bei vorübergehend gesperrter Ergebnisfreigabe verweigert auch deren direkte URL
den Zugriff; die ursprüngliche Freigabe wurde danach wiederhergestellt. Die
SQL-/QSS-Berechnung und die Standardkosten wurden dabei nicht geändert.

## Grenzen

Die Standardkosten und der Maßstab sind weiterhin vorläufig und nicht durch
unabhängige menschliche Bewertungen kalibriert. Endliche Testkataloge beweisen
keine vollständige SQL-Äquivalenzabdeckung. Große Graphabschlüsse können auch mit
anderen Kosten langsam bleiben. Das Verteuern einer einzigen Umformung erzwingt
kein Konstrukt, wenn ein anderer günstigerer Pfad existiert.

Wie die bisherige Ergebnisbewertung verwendet auch QSS clientseitige Nachweise.
Der Browser besitzt bei QSS die Musterlösung; Punkte-/Hashvalidierung ist keine
Manipulationssicherheit gegen einen kontrollierten Browser. Die Umstellung fügt
keine serverseitige unabhängige SQL-/Graphprüfung hinzu.

Die bekannte Einschränkung beim Wechsel von StudOn zu unverändertem offiziellem
ILIAS bleibt bestehen: 36 spezielle Taxonomie-Beschreibungen benötigen die
StudOn-Core-Erweiterung. Neun ursprünglich ungesetzte Editor-Modi werden durch
natives ILIAS auf den unterstützten RTE-Standard gesetzt.
