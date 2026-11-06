# Umstieg auf ILIAS 11

Plugin-Version **0.1.1**, Branch **ilias-11-update**. Diese Version setzt ILIAS 11
und PHP 8.3 oder 8.4 voraus. Für ILIAS 8/9 bleibt der bisherige Plugin-Stand nötig.

## Änderungen

- Die Autosave-Markierung verwendet `ILIAS\TestQuestionPool\Questions\QuestionAutosaveable`.
  Die entfernte Schnittstellendatei unter `Modules/` wird nicht mehr eingebunden.
- Die Signaturen der Frage und ihrer GUI entsprechen ILIAS 11. Kopieren,
  Duplizieren, Synchronisieren und die endgültigen XML-Einstiegsmethoden verwenden
  die Implementierungen des ILIAS-Kerns.
- `getAdditionalTableName()` liefert die primäre Datentabelle als String.
  Die Löschroutine entfernt auch die zweite Tabelle mit den Bewertungsmetriken.
- Die Frage implementiert die Protokollierung und die Textausgabe für
  Ergebnisexporte. Die entfernte Excel-Hilfsklasse wird nicht mehr verwendet.
- QTI-Importe verwenden das übergebene Importverzeichnis und die neue
  Elternzuordnung für Fragenpool und Test. Generisches Feedback wird über die
  Importklasse konvertiert und mit dem erforderlichen Boolean übergeben.
- CSS, JavaScript und SQL-Worker verwenden das von ILIAS ermittelte relative
  Plugin-Verzeichnis. Installation und Docker-Mount liegen unter `public/`.
- CodeMirror überträgt Änderungen sofort in die versteckte Textarea und meldet
  Änderungen an ILIAS. Dadurch enthält auch das per AJAX serialisierte
  Autosave-Formular den aktuellen SQL-Text. Änderungen verwerfen die bisherigen
  Ausführungsergebnisse; nicht ausgeführte oder fehlerhafte Antworten erhalten
  keine Punkte für veraltete Metriken.
- Mehrfaches Rendern auf derselben Seite, beispielsweise Antwort und
  Musterlösung in der Vorschau, erzeugt keine mehrfach deklarierten
  JavaScript-Klassen. Die Musterlösung erhält den Ausführungshandler der
  bearbeitbaren Antwort.
- Eigene Formularbereiche initialisieren jetzt die ILIAS-Elternklasse.
  Die Bearbeitungsmaske nutzt die neue Formularverwaltung der Frage-GUI.
- Composer erfasst die PHP-Anforderung; PHPUnit 11 und seine Abhängigkeiten sind
  aktualisiert. Jenkins führt Unit-Tests und einen Klassenabgleich vor dem Build aus.

Die Tabellen `il_qpl_qst_qpisql_qd` und `il_qpl_qst_qpisql_qsm` sowie das gespeicherte
Antwortformat bleiben erhalten. Datenbank-Schritt **6** ergänzt ausschließlich die
Opt-in-Einstellung `editor_assistance` mit Standardwert `0`. Bestehende Fragen
und alte QTI-Importe erhalten damit weiterhin keine zusätzlichen Hilfen.

## Bedienung und Kompatibilität ab 0.1.1

- **Ausführen:** Der Button und `Strg+Enter` beziehungsweise `Cmd+Enter` starten
  dieselbe Ausführung. Das Tastenkürzel verändert den SQL-Text nicht.
- **Manuell abbrechen:** Der Abbruch beendet den SQLite-Worker, erhält den SQL-Text
  und gibt den Editor wieder frei. Eine abgebrochene Antwort erhält keine Punkte
  für frühere Ergebnisse. Das Plugin hat **keinen Ausführungs-Timeout**.
- **Status:** Ausführungsstatus und Speicherstatus werden getrennt angezeigt.
  „Gespeichert“ erscheint erst nach bestätigter erfolgreicher ILIAS-Autosave-Antwort;
  Änderungen während einer laufenden Speicherung verwerfen deren Statusbestätigung.
- **Ergebnistabellen:** 100 Zeilen pro Seite, Zeilenanzahl, feste Überschriften,
  horizontales Scrollen und unterscheidbare NULL-/Leerstring-Werte. Alle Ergebniszeilen
  bleiben für Speicherung und Bewertung erhalten. Die FD-Gruppierung verwendet
  effizientere Schlüssel-Lookups bei unveränderter Vergleichssemantik.
- **Hilfen je Frage:** Die Autorenoption aktiviert SQL-Vervollständigung und eine
  Schemaübersicht für Teilnehmende. Tabellen und Spalten werden auf ausdrücklichen
  Klick ausschließlich aus Sequenz A ermittelt; Musterlösung B und Kontrollabfrage C
  werden dafür nicht ausgeführt. Auch das Laden des Schemas ist manuell abbrechbar.
  Neue Hilfen sind bei bestehenden Fragen und alten Importen ausgeschaltet.
- **Anonyme Beispiele:** Die Autorenmaske enthält neue kleine Beispiele für JOIN/
  Gruppierung und UPDATE, DELETE sowie INSERT mit Kontrollabfrage C. Sie orientieren
  sich an den Aufgabentypen der Bestände, enthalten keine Original-Prüfungsdaten und
  können ausschließlich in leere SQL-Felder übernommen werden. Fragetext und
  Bewertungsgewichte legt die Lehrperson fest.
- **Bewertung:** Spaltennamen und FD-Einträge werden für den Jaccard-Vergleich
  dedupliziert. Wiederholte Namen oder gleichwertige FD-Einträge können die Punkte
  damit nicht mehr über das Maximum der Metrik erhöhen.
- **Eigentümer:** Nativ neu angelegte Fragen werden dem aktuellen Lehrendenkonto
  zugeordnet. Beim Laden vorhandener Fragen bleibt der gespeicherte Eigentümer
  erhalten.
- **Darstellung:** SQL, Ergebniswerte, Spaltennamen, Metriken und Fehlermeldungen
  werden in ihrem jeweiligen HTML-Kontext sicher ausgegeben. Gespeicherte SQL- und
  QTI-Daten werden dabei nicht umgeschrieben. Nicht ausgeführte Antworten zeigen
  auch in der Detailansicht eine Erklärung; der Fragetypname wird übersetzt.

Gespeicherte Altbewertungen bleiben bis zu einer nativen ILIAS-Neuberechnung
bestehen. Diese wendet die korrigierte Mengensemantik an; bei den nachgewiesenen
Dopplungen wird damit eine frühere Überbewertung korrigiert.

Die neue Option wird als QTI-Metadatum `EDITOR_ASSISTANCE` exportiert und importiert
und beim Kopieren, Duplizieren und Synchronisieren erhalten. Das Teilnehmer-
Antwortformat und die drei vorhandenen Bewertungsmetriken bleiben kompatibel.

## Installation und Update

Vor dem StudOn-Umstieg das ILIAS- und Plugin-Update auf einer Kopie der Installation
mit bestehenden SQL-Fragen und Testdurchläufen abnehmen. Die folgenden Pfade sind
relativ zum ILIAS-Hauptverzeichnis:

1. Plugin-Dateien unter
   `public/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion`
   ablegen. Der Plugin-Slot heißt weiterhin `Modules/TestQuestionPool/Questions`.
2. Im Plugin-Verzeichnis `composer install --no-dev --prefer-dist` ausführen.
3. Im ILIAS-Hauptverzeichnis `composer dump-autoload` ausführen. Damit werden auch
   die Controller-Artefakte für das Plugin aufgebaut.
4. Bei bestehender Installation
   `php cli/setup.php update --legacy-plugin assSQLQuestion` ausführen.
   Für eine Erstinstallation stattdessen
   `php cli/setup.php install --legacy-plugin assSQLQuestion` verwenden.
5. Den Plugin-Status in der Administration prüfen. Das Update aktiviert ein zuvor
   deaktiviertes Plugin nicht automatisch.

Die Befehle mit dem für die ILIAS-Installation vorgesehenen Systembenutzer
ausführen. Der Webserver muss das ILIAS-Verzeichnis `public/` ausliefern.

### Erforderliche ILIAS-Kernkorrektur

Die unveränderte ILIAS-Version 11.5 enthält einen Fehler in
`ilAssQuestionType::completeMissingPluginName()`: Nach einem erfolgreichen Import
stürzt die native Fragenliste für aktive Fragenplugins mit `Undefined array key
"type_tag"` ab. Im offiziellen `release_11` wurde dies am 27. Oktober 2026 mit
[Commit 635bd4ec40200c7b6e88aab71eca4a914c9dc6f4](https://github.com/ILIAS-eLearning/ILIAS/commit/635bd4ec40200c7b6e88aab71eca4a914c9dc6f4)
behoben. Der eingesetzte ILIAS-Patchstand muss diese Korrektur enthalten.

Die Chrome-Abnahme verwendet ILIAS 11.5 mit genau dieser verifizierten
Upstream-Korrektur. Das Plugin verändert selbst keine Kerndateien. Für das
wegwerfbare `srsolutions/ilias:11`-Testimage ist die Vorbereitung reproduzierbar:

```sh
docker compose -p ass_sql_ilias11 exec -T -e ILIAS_TEST_CORE_PATCH=1 ilias \
  php public/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/tests/ilias11/prepare-question-type-core.php
docker compose -p ass_sql_ilias11 exec -T ilias apache2ctl -k graceful
```

Das Testskript akzeptiert ausschließlich die geprüften SHA-256-Werte der
unveränderten und korrigierten Kerndatei; bei unbekanntem Stand bricht es ohne
Änderung ab. Es wird niemals vom Plugin geladen.

## Reproduzierbare Tests

### Unit-Tests und Klassenabgleich

Im Plugin-Verzeichnis:

```sh
composer install
composer test
```

Alternativ ohne lokale PHP-Installation:

```sh
docker run --rm --entrypoint sh -v "$PWD:/plugin" -w /plugin \
  srsolutions/ilias:11 -c 'composer install --no-interaction && composer test && php tests/ilias11/check-classes.php'
```

`tests/ilias11/check-classes.php` lädt alle 34 Plugin-Klassen gegen die echten
ILIAS-Basisklassen. Es benötigt keine Datenbank. Mit `ILIAS_PATH` kann ein anderer
ILIAS-Quellstand mit generiertem Composer-Autoloader angegeben werden.

### Integration mit ILIAS und MariaDB

Die Integrationssuite erzeugt und löscht eigene Fragenpools und Testdaten.
Sie ist ausschließlich für einen wegwerfbaren Testclient vorgesehen und verlangt
deshalb ausdrücklich `ILIAS_TEST_WRITES=1`.

```sh
docker compose -p ass_sql_ilias11 up -d
docker compose -p ass_sql_ilias11 logs ilias
```

Nach abgeschlossener Installation:

```sh
docker compose -p ass_sql_ilias11 exec -T -e ILIAS_TEST_WRITES=1 ilias \
  vendor/composer/vendor/bin/phpunit \
  -c public/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/tests/ilias11/phpunit.xml
```

Hier wird bewusst das PHPUnit **der ILIAS-Installation** verwendet. Der parallele
PHPUnit-Autoloader des Plugins darf nicht in diese Ausführung geladen werden.
Der Bootstrap verwendet den ILIAS-CLI-Kontext mit dem Testbenutzer `root` und
übergibt die Fehlerbehandlung anschließend an PHPUnit. PHP-Warnungen und Notices
werden für den Plugin-Quellcode geprüft; bekannte Hinweise aus dem ILIAS-Kern
sind weiter unten separat vermerkt.

### Chromium und bestehende Jasmine-Tests

Zuerst die Browser-Testfrage erzeugen:

```sh
docker compose -p ass_sql_ilias11 exec -T -e ILIAS_TEST_WRITES=1 ilias \
  php public/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/tests/ilias11/browser-fixture.php
```

Die Ausgabe enthält `edit_url` und `preview_url`. Im Verzeichnis `tests/browser`:

```sh
npm ci
npx playwright install chromium
export ILIAS_TEST_URL=http://localhost:8080
export ILIAS_TEST_PASSWORD='Passwort aus den Docker-Setup-Logs'
export ILIAS_EDIT_URL='edit_url aus der Fixture-Ausgabe'
export ILIAS_PREVIEW_URL='preview_url aus der Fixture-Ausgabe'
npm test
```

Der Test schreibt Screenshots nach `test-results/` im Arbeitsverzeichnis.
Bei Ausführung im Playwright-Docker-Image kann `ILIAS_PROXY_TARGET=http://ilias`
verwendet werden. Der Test startet dann einen lokalen HTTP-Proxy zur Compose-
Instanz und erhält den von ILIAS geprüften Hostnamen `localhost:8080`.
Verwendetes Browser-Image: `mcr.microsoft.com/playwright:v1.56.1-noble`.

Anschließend die Fixture entfernen:

```sh
docker compose -p ass_sql_ilias11 exec -T -e ILIAS_TEST_WRITES=1 ilias \
  php public/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/tests/ilias11/browser-fixture.php delete
```

## Abnahme der Bestandsfragen vom 6. November 2026

Plugin 0.1.1 wurde mit allen **699 Fragen aus fünf realen StudOn-Pools** geprüft:
native Chrome-Importe, Exporte und erneute Importe über ein reguläres Lehrendenkonto
sowie 699 echte Abgaben über ein getrenntes Studierendenkonto. Ergebnis:
**699/699 beantwortet, nach korrigierter Mengenbewertung 2259/2259 Punkte**.
Alle 699 Antworten blieben bei der nativen Neuberechnung nachweislich unverändert.
Siehe [vollständigen Abnahmebericht](chrome-abnahme-2026-11-06.md) für Umgebungsstand,
Prüfgrenzen, den gefundenen Bewertungsfehler und die reproduzierbaren Werkzeuge.

## Testergebnis vom 4. November 2026

Ergänzend wurden am 5. November drei vollständige Testversuche im installierten
Google Chrome durchgeführt. Siehe [Chrome-Abnahme](chrome-abnahme-2026-11-05.md)
für die Ergebnisse 10/10, 2/10 und 5/10 sowie den echten Autosave- und
Datenbankabgleich.

| Prüfung | Umgebung | Ergebnis |
| --- | --- | --- |
| PHP-Syntax und 23 Bewertungs-Unit-Tests | PHP 8.3.36 | erfolgreich |
| 23 Bewertungs-Unit-Tests und PHP-Syntax | PHP 8.4.27 | erfolgreich |
| Laden aller 33 Plugin-Klassen | Original ILIAS 11.0, PHP 8.3.36 | erfolgreich |
| Laden aller 33 Plugin-Klassen | ILIAS 11.5, PHP 8.4.27 | erfolgreich |
| Erstinstallation und Aktivierung | ILIAS 11.5, MariaDB 10.11.19 | erfolgreich |
| 7 Integrationstests, 38 Assertions | ILIAS 11.5, PHP 8.4.27, MariaDB | erfolgreich |
| Update-Simulation 0.0.83 → 0.1.0 | bestehende SQL-Frage unter ILIAS 11.5 | erfolgreich; Prüfsumme der SQL-Daten identisch, Plugin aktiv, DB-Stand 5 |
| Browserabläufe und 11 vorhandene Jasmine-Spezifikationen | Chromium 141 / Playwright 1.56.1 | erfolgreich |
| Composer-Validierung und Audit | aktualisierter Lockstand | erfolgreich, keine gemeldeten Advisories |
| Compose-Konfiguration und Docker-Build | `srsolutions/ilias:11` | erfolgreich |

Die Integrationssuite prüft Persistenz, Metriken, Metadaten, Kopieren,
Duplizieren, Synchronisieren, Löschen, QTI-Import/-Export mit generischem Feedback,
Vorschau, Protokollierung, Textausgabe, Zwischenstände, endgültige Abgabe und
Bewertung. Nicht erneut ausgeführte Entwürfe werden mit null Punkten bewertet;
der zuvor autorisierte Stand bleibt bis zur nächsten Abgabe erhalten.

Die Browserprüfung umfasst die reale Autorenmaske, sofortige Übertragung von
Editoränderungen in Formulardaten, den SQLite-Worker, SQL-Fehler,
Integritätsprüfung, Änderungsabfragen mit Sequenz C, Speichern und Laden sowie
Abgabe, Wiederherstellung und Bewertung in der Teilnehmer-Vorschau. Nach dem
Einblenden der Musterlösung bleibt die Antwort erneut ausführbar. Die absichtlich
ungültige SQL-Abfrage erzeugt den erwarteten Worker-Fehler; weitere JavaScript-
Fehler und fehlgeschlagene Plugin-Asset-Anfragen werden als Fehler gewertet.

Verwendetes ILIAS-Image:
`srsolutions/ilias@sha256:6217f7933210ce6b2c581974292e7c0c78de6ccb2c53ef3d4d655c46816def9d`.
Die Compose-Datei verfolgt weiterhin den Major-Tag `11` und erhält damit spätere
11er-Korrekturen.

### Grenzen und Hinweise aus dem ILIAS-Kern

Die Tests liefen lokal gegen den offiziellen ILIAS-Code, nicht auf einer
StudOn-Installation mit FAU-Anpassungen. Die automatisierten Browser-Tests vom
4. November liefen in Chromium; die ergänzende Prüfung vom 5. November im
installierten Google Chrome. Weitere Browser und ILIAS-11.0-Laufzeitabläufe,
gleichzeitige Prüfungsteilnahmen und die konkrete StudOn-Konfiguration wurden
nicht durch einen Produktivtest abgedeckt. Die Update-Simulation prüft den
Plugin-Updater und den Erhalt bestehender Daten, keinen vollständigen ILIAS-9-
auf-11-Systemumzug.

Das verwendete ILIAS-11.5-Image zeigte unter anderem folgende vom Plugin unabhängige Hinweise:

- Die Kern-Datei `assets/js/moment-with-locales.min.js` wurde mit HTTP 404
  beantwortet. Die Plugin-Assets wurden erfolgreich geladen.
- Der Sprach-Update-Schritt des ILIAS-Kerns erzeugt unter PHP 8.4 eine
  Deprecation wegen einer dynamischen Eigenschaft eines anonymen `ilObjUser`.
- `ilAssQuestionFeedback::deleteGenericFeedbacks()` im ILIAS-Kern referenziert
  eine undefinierte Variable `$page_object_id`. Bei aktivierter Umwandlung von
  Warnungen in Exceptions kann dies die Kern-Löschroutine beeinträchtigen.
  Der Test-Bootstrap übergibt PHP-Hinweise an PHPUnit und begrenzt deren
  Fehlerwertung auf Plugin-Dateien. Diese Kernstelle wurde im Plugin nicht
  verändert und sollte beim eingesetzten ILIAS-Patchstand geprüft werden.

Referenzen: [ILIAS 11.0](https://github.com/ILIAS-eLearning/ILIAS/tree/v11.0),
[ILIAS 11.5](https://github.com/ILIAS-eLearning/ILIAS/tree/v11.5),
[ILIAS-Installation](https://github.com/ILIAS-eLearning/ILIAS/blob/release_11/docs/configuration/install.md),
[Plugin-Setup über CLI](https://github.com/ILIAS-eLearning/ILIAS/blob/release_11/components/ILIAS/setup_/README.md).
