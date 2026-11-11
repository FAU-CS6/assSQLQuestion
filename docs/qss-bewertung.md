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
[vorbelegten Umformungskosten](qss-kostenkonfiguration.md) ein. 35 benannte
Umformungs-/Reparaturschritte und 15 Kategorien atomarer Grundoperationen sind
einzeln einstellbar, auch bisher kostenlose Äquivalenzen. Ein Knopf setzt alle
Kosten zurück. Die Einstellungen der anderen Bewertungsart bleiben gespeichert,
werden aber nicht zur Bewertung herangezogen.

Vor dem Speichern einer neuen oder geänderten QSS-Konfiguration muss die
Musterlösung mit den aktuellen Einstellungen ausgeführt werden. Unveränderte
Referenzen und Kosten erfordern bei reinen Metadatenänderungen keine neue
Ausführung. Die normale Vorschau ermöglicht das Testen studentischer Varianten.

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

## Abnahme am 11. November 2026

Die Abnahme verwendet getrennte normale Dozenten-/Studentenkonten und ausschließlich
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

Der private Gesamtabnahmebeleg bindet 96 Produktionsdateien sowie die einzelnen
Browser-, Upgrade-, Noten-, Export- und Testberichte. Er enthält keine Umdeutung
fehlgeschlagener Vorläufe und keine vollständige SQL-Äquivalenzgarantie.

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
