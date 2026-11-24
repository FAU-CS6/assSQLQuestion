# Chrome-Abnahme der StudOn-Fragenbestände am 6. November 2026

**Abnahme bestanden:** Alle 699 Bestandsfragen wurden im installierten Google
Chrome mit getrennten Lehrenden- und Studierendenkonten geprüft. Der endgültige
reguläre Test zeigt **699/699 beantwortete Fragen und 2259/2259 Punkte**.
Import, Export und erneuter Import aller fünf Pools sind ebenfalls bestanden.

| Endprüfung | Ergebnis |
| --- | --- |
| Native Lehrenden-Importe auf finalem Stand | 699/699 |
| Native XML-ZIP-Exporte und erneute Importe | 699/699 |
| Originale und rückimportierte Kopien semantisch geprüft | 1398/1398 |
| Tatsächliche Studierenden-Fragenseiten und Abgaben | 699/699 |
| Ergebnisrelationen und Metriken gegenüber Referenz | 699/699 identisch |
| Eindeutige autorisierte Antworten und gespeicherte Bewertungen | 699/699 |
| Endpunktzahl laut Produktions-Scorer, Passcache und Chrome-Übersicht | 2259/2259 |
| Manuelle Punkteüberschreibungen | 0 |

## Umfang und Umgebung

Plugin 0.1.1 auf `ilias-11-update`, Datenbankstand 6. Lokales ILIAS 11.5 mit
PHP 8.4.27 und MariaDB 10.11. Die fünf vom Lehrstuhl bereitgestellten Exporte
stammen aus StudOn/ILIAS 9.24.0 und enthalten ausschließlich SQL-Fragen:

| Original-Pool | Fragen |
| --- | ---: |
| 4127735 | 23 |
| 4127775 | 65 |
| 4126457 | 504 |
| 4127759 | 68 |
| 4127793 | 39 |
| **Gesamt** | **699** |

Verwendet wurde der tatsächlich installierte Google Chrome **156.0.8078.80**
unter macOS. Nach dem Wunsch nach Tests ohne aufspringende Fenster liefen alle
weiteren Durchläufe mit demselben installierten Chrome im Headless-Modus.
Die Endabnahme verwendet getrennte fensterlose Chrome-Prozesse für Lehrenden-
und Studierendenabläufe; Playwright steuert diese lokal. Private Bestände,
Sitzungen und Anmeldedaten werden nicht an einen Browser-Cloud-Dienst übergeben.

ILIAS 11.5 benötigt die bereits offiziell veröffentlichte
[Kernkorrektur 635bd4ec40200c7b6e88aab71eca4a914c9dc6f4](https://github.com/ILIAS-eLearning/ILIAS/commit/635bd4ec40200c7b6e88aab71eca4a914c9dc6f4)
für die native Fragenliste. Sie wurde ausschließlich im wegwerfbaren Testclient
mit dem SHA-geprüften Skript `tests/ilias11/prepare-question-type-core.php`
übernommen. Das Plugin lädt oder verändert selbst keine ILIAS-Kerndateien.

## Getrennte Konten

- `sql.chrome.teacher`: Standardbenutzer und lokale Lehrendenrolle im Testbereich.
  Darf dort Fragenpools und Tests anlegen und bearbeiten; keine Systemadministration.
- `sql.chrome.student`: Standardbenutzer ohne Lehrenden- oder Administratorrolle.
  Beantwortet die Fragen über einen regulären ILIAS-Test. Zugriffe auf die
  Autoren-, Import- und Exportfunktionen der Quellpools werden abgewiesen.

Die Fixture `tests/ilias11/chrome-accounts.php` erzeugt zufällige Kennwörter nur
im privaten Zustand des Testclients. Sie legt keine Teilnehmerantworten an.
Neu über die Autorenoberfläche angelegte Fragen gehören dem Lehrendenkonto;
Owner und aktivierte SQL-Hilfen wurden zusätzlich schreibgeschützt in der
Datenbank abgeglichen.

## Import und Export

Alle 699 Fragen wurden über die native Chrome-Oberfläche des Lehrendenkontos
importiert, als XML-ZIP exportiert, heruntergeladen und erneut importiert.
Schreibgeschützte Vergleiche prüfen beide Kopien gegen jede Originalfrage:
SQL A/B/C, Aufgaben- und Feedbacktexte, Metadaten, Ausführungszustand,
Ergebnisrelation, Bewertungsmetriken und Gewichte sowie Taxonomien und deren
Fragenzuordnungen. Zusätzlich wurde derselbe vollständige Bestand mit den
nativen ILIAS-Import-/Export-APIs geprüft.

Automatisch erzeugte Taxonomie-Wurzelbezeichnungen enthalten die neue Objekt-ID;
nur diese technische ID wird beim Vergleich normalisiert. Echte Namen, Titel,
Hierarchiepfade und Zuordnungen bleiben strikt geprüft. Bei neun alten Fragen
wird ein leerer Editor-Modus entsprechend dem dokumentierten ILIAS-Importverhalten
als RTE/`default` interpretiert; nichtleere Modi und alle Lifecycle-Werte werden
unverändert verglichen. Beim alten 504er-Archiv
behält die native Aktion „Import Questions“ in einen bestehenden Zielpool dessen
bewusst gewählten Containertitel. Die Fragen selbst bleiben unverändert; der
anschließende Export erhält diese Zielpool-Metadaten.

## Regulärer Studierendenlauf

Die Test-Fixture übernimmt alle 699 Fragen in einen regulären Test und schreibt
keine Antworten. Der Studierenden-Treiber wartet auf die tatsächliche
Bereitschaft der nativen ILIAS-Oberfläche und prüft vor jeder Eingabe die aktuelle
Sequenz in URL, Formularaktion und Autosave-Konfiguration gegen die unveränderliche
Zuordnung zur tatsächlichen Testfrage. Er gibt die jeweilige Musterlösung in
CodeMirror ein, klickt „Execute“, speichert mit den nativen Weiter-/Abgabeschritten
und beendet den gesamten Test über die Oberfläche.

Jede aktuelle Ergebnisrelation und jede Bewertungsmetrik wird geprüft. Die
SQL-Sequenzen laufen zusätzlich mit dem vorherigen Ausführungscode aus Commit
`7ed7a5c`; die SQL.js-Engine bleibt unverändert. Bei identischer Ergebnisrelation
wird die gespeicherte FD-Metrik des Originalexports als Referenz verwendet.
Eine erneute Berechnung mit dem alten FD-Verfahren erfolgt gezielt zur Diagnose
von Abweichungen. Die unabhängigen FD-Äquivalenztests ergänzen diesen Vergleich;
der Bericht behauptet keine vollständige Neuberechnung aller alten FD-Metriken.

HTML-Textareas und Formulartransport normalisieren LF/CRLF. Der HTML-Parser
verwirft außerdem genau ein erstes LF unmittelbar nach dem öffnenden Textarea-
Tag; die Erwartung für die verborgenen Sequenzen A/C berücksichtigt diese native
Browserregel. Der eingegebene SQL-Text B und übriger Whitespace werden nicht
getrimmt. Native SQL-/QTI-Snapshots bleiben bytegenau verglichen. Ein schreibgeschützter Abschluss-
bericht kontrolliert eindeutige autorisierte Antworten, gespeicherten SQL-Text,
Produktionsbewertung jeder Frage, persistierte Punkte, Summe und den endgültigen
Abschlussstatus gegen die sichtbare Ergebnisseite.

Zusätzlich wird an der ersten Antwort die echte AJAX-Speicherung eines geänderten
Entwurfs und des danach ausgeführten Modells mit der sichtbaren bestätigten
Speicheranzeige geprüft. Der Treiber setzt keine SQL-Laufzeitgrenze.

## Korrigierte Überbewertung bei Duplikaten

Der vollständige Abschlussabgleich deckte einen bisherigen Bewertungsfehler auf:
Bei einer Frage enthielt das Ergebnis zwei Spaltennamen jeweils doppelt. Die
Jaccard-Berechnung bereinigte die Vereinigungsmenge, zählte die Schnittmenge
aber mehrfach. Dadurch wurden 4 statt maximal 3 Fragenpunkte und insgesamt
2260 statt maximal 2259 Testpunkte vergeben.

Spaltennamen werden jetzt nach der bisherigen Kleinschreibung dedupliziert;
FD-Einträge verwenden dafür den bestehenden Vergleich nach Groß-/Kleinschreibung
und Attributreihenfolge. Die Formel arbeitet mit echten Mengen, ohne nachträgliches
Abschneiden der Gesamtpunkte. Sechs neue Regressionstests reproduzieren diese
Fehler. Frontend und SQL-Ergebnisse bleiben identisch.

Zwei neue reguläre Studierendenabgaben derselben betroffenen Bestandsfrage
wurden nach der Korrektur erneut im Chrome ausgeführt und erhalten jeweils
korrekt 3/3 Punkte; die native Übersicht und der gespeicherte Durchlauf zeigen
6/6 Punkte. Alle 699 tatsächlich gespeicherten Modelle erhalten mit dem neuen
Produktions-Scorer genau ihre jeweiligen Maximalpunkte; weitere 1398 Prüfungen
für Entwurfs-/Fehlerzustände ergeben jeweils null Punkte.

Anschließend wurde über das reguläre Lehrenden-UI eine unveränderte Zeile des
Bewertungsschemas gespeichert und dadurch die native ILIAS-Neuberechnung aller
699 Antworten ausgelöst. Der dafür vorübergehend deaktivierte Ergebniszugriff
und sämtliche 33 ursprünglichen Einstellungswerte wurden exakt wiederhergestellt.
Markierungsschema, Feedback und manuelle Bewertungsflags blieben gleich.

Der unabhängige Datenbankabgleich und die erneut geladene Studierenden-Übersicht
bestätigen **2259/2259 Punkte, 699/699 autorisierte Antworten und
`finished_by_participant`**. Die SHA-256-Summe sämtlicher tatsächlicher
Antwort-JSONs vor und nach Neuberechnung ist identisch:
`526403b29a907f46397229d150486042cdbf18d3a068ad6c9fb58e9c3128c917`.
Damit wurde der neue PHP-Scorer an allen real im Chrome eingegebenen Antworten
geprüft; SQL-Frontend und Worker wurden bei dieser Korrektur nicht verändert.

## Autorenfunktionen im echten Chrome

Die reproduzierbare Prüfung `tests/browser/author-acceptance.cjs` legt über das
Lehrendenkonto einen neuen Pool und eine neue Frage an und prüft:

- alle vier anonymen Beispiele einschließlich Integritätsmodus und Schutz
  vorhandener SQL-Sequenzen vor Überschreiben;
- Schema aus A und pro Frage gespeicherte SQL-Hilfen;
- Cmd+Enter bei unverändertem SQL-Text;
- manuellen Abbruch einer laufenden rekursiven Abfrage, erhaltenen SQL-Text und
  erneut nutzbaren Editor; es gibt keinen Ausführungs-Timeout;
- HTML-Zeichen in Ergebniszellen und Spaltennamen als Text sowie NULL/Leerstring;
- 201 Ergebniszeilen auf drei Seiten, korrekte numerische Zeilenanzeige und
  vollständige 201 Zeilen für Speicherung und Bewertung;
- natives Speichern und erneutes Laden der Frage einschließlich Hilfen-Option.

## Identität der ausgelieferten JavaScript-Dateien

Die im finalen Chrome-Lauf geladenen Dateien stimmen mit dem neu gebauten
Plugin-Image überein:

| Datei | SHA-256 |
| --- | --- |
| Dynamische Ausgabe von `js/min.js.php` | `fa88bec49bb200bb5f513758188a26ec83347f6872d82644760ee56890088309` |
| `codemirror_sqlquestion.bundle.js` | `6bdabb70f394970647e03e3dff3c4d811a387fd327db38331f01ad98654f7dfe` |

Der lokale Docker-Build und die Prüfung der Laufzeitdateien bestanden. Private
Testnachweise und Fragenexporte sind im gebauten Image nicht enthalten; der
mitgelieferte PHP-Minifier ist vollständig vorhanden.

## Weitere Prüfungen

- 29 Bewertungs-Unit-Tests mit 51 Assertions unter PHP 8.3.36 und PHP 8.4.27.
  Sechs neue Regressionen prüfen insbesondere doppelte Spaltennamen und semantisch
  gleiche FD-Einträge; beide Jaccard-Metriken verwenden echte Mengen.
- Alle 34 Plugin-Klassen gegen ILIAS 11.0/PHP 8.3 und ILIAS 11.5/PHP 8.4 geladen.
- 10 Integrationstests mit 55 Assertions: Persistenz, Eigentümer, Kopieren,
  Synchronisieren, Legacy-Import, QTI-Rundreise, HTML-Ausgabe und Bewertung.
- 11 vorhandene Jasmine-Spezifikationen im installierten Chrome: 0 Fehler.
- Acht Editor-/Hilfen-Prüfgruppen und fünf Ausgabe-/Abbruch-/Autosave-Prüfgruppen
  im installierten fensterlosen Chrome.
- Sechs FD-Äquivalenztests, darunter 250 deterministische Zufallsrelationen,
  Sonderwerte, Änderungen zwischen Aufrufen und eine Relation mit 26.000 Zeilen.
  Die Optimierung erhält die bisherige FD-Ausgabe und reduziert lediglich
  wiederholte Sucharbeit.
- Fünf Audit-Regressionstests, reproduzierbarer bytegleicher Editor-Build und
  separate Audits für beide Composer-Dateien und beide npm-Verzeichnisse.
  Die einzige eng begrenzte Audit-Ausnahme betrifft die offiziell zurückgezogene
  CVE-2026-93753; andere Meldungen werden weiterhin als Fehler behandelt.

## Private Nachweise und Reproduktion

Originale Prüfungsfragen, Lösungen, Kennwörter und Sitzungen sind nicht Teil des
Commits. Detaillierte lokale Nachweise liegen im ignorierten Verzeichnis
`test-results/` und werden aus dem Docker-Build-Kontext ausgeschlossen.

Die generischen Werkzeuge sind im Repository enthalten:

- `tests/ilias11/extract-pool-corpus.py`: private ZIPs erfassen und prüfen;
- `tests/ilias11/pool-corpus.php`: native Rundreisen, semantischer Vergleich,
  Test-Fixture ohne Antworten und schreibgeschützter Ergebnisabgleich;
- `tests/ilias11/scoring-state.php`: schreibgeschützte Vorher-/Nachher-Prüfung
  von Antworten, Punkten, manuellen Flags und Einstellungen;
- `tests/browser/pool-transfer.cjs`: Lehrenden-Import/-Export über die Oberfläche;
- `tests/browser/pool-corpus.cjs`: regulärer Studierenden-Test im Chrome;
- `tests/browser/author-acceptance.cjs`: native Autoren- und Komfortfunktionen.

Die Bestände bleiben außerhalb des Repositorys beziehungsweise unter
`test-results/`. PHP-Fixtures verlangen CLI-Ausführung und
`ILIAS_TEST_WRITES=1` in einem wegwerfbaren Testclient. CLI-Importe sollten unter
dem Webserverbenutzer laufen, damit temporäre Verzeichnisse auch für den nativen
Browser-Upload schreibbar bleiben. Für die großen ZIPs wurden im Testclient
2 GiB PHP-Speicher und 64 MiB Uploadgröße bereitgestellt.

Die übersetzten nativen Detailtypen wurden in abgeschlossenen Durchläufen mit
10 und 2 Fragen geprüft. Die normale Übersicht des 699-Fragen-Tests wurde nach
der Neuberechnung vollständig geprüft. Die Core-Ansicht aller 699 vollständigen
Korrekturkarten auf einmal überlastete den lokalen Browser-Renderer; sie ist
nicht als performant abgenommen. Verwendet wurden deshalb die kleinen nativen
Einstellungsdialoge für die Neuberechnung und die reguläre Ergebnisübersicht.
Alle 699 fachlichen Ergebnisse und Einzelbewertungen sind davon unabhängig
vollständig geprüft.

Die Abnahme läuft lokal auf dem offiziellen ILIAS-Kern mit der genannten
Upstream-Korrektur. FAU-spezifische StudOn-Anpassungen und gleichzeitige
Prüfungsteilnahmen sind dadurch nicht als Produktivbetrieb abgenommen.
