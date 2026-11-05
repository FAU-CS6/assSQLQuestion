# Drei vollständige Testversuche in Google Chrome

Am **5. November 2026** wurde das aktualisierte Plugin im installierten
**Google Chrome 156.0.8078.80 unter macOS** geprüft. Die Browserbedienung erfolgte
über die Chrome-Erweiterung mit sichtbaren Seiten, Texteingaben und Klicks.
Diese Prüfung ergänzt die automatisierten Chromium-Tests vom Vortag.

## Umgebung und Vorgehen

- Lokaler, isolierter Compose-Client `ass_sql_ilias11_chrome`, erreichbar unter
  `http://localhost:8080`; ILIAS 11.5 und PHP 8.4.27.
- Eigenes Teilnehmerkonto `sql.chrome.test` mit der normalen Benutzerrolle.
- Echter ILIAS-Test mit zwei SQL-Fragen und mehreren erlaubten Versuchen.
- SELECT-Frage: zwei Namen aus einer vorbereiteten Tabelle ausgeben, 5 Punkte;
  Änderungen der Datenbank sind durch die Integritätsprüfung untersagt.
- UPDATE-Frage: Punkte erhöhen; Sequenz C zeigt anschließend die qualifizierten
  Personen an, 5 Punkte.
- Autosave aktiviert, Intervall zwei Sekunden, Ergebnisse nach Testabschluss
  für den Teilnehmer sichtbar.

Die Fixture `tests/ilias11/exam-fixture.php` erzeugt nur Testkonto, Aufgaben und
Konfiguration. **Alle Antworten, Navigationen und Abgaben erfolgten im Browser.**
Die Fixture schreibt keine Lösungen oder Testergebnisse. Ihr Befehl `report`
liest die anschließend vorhandenen Datenbankeinträge zur Gegenprüfung.

## Durchläufe

| Versuch | SELECT-Frage | UPDATE-Frage | Erwartet | Chrome-Ergebnis | Gespeichert |
| --- | --- | --- | --- | --- | --- |
| 1 | Korrekte Antwort, ausgeführt | Korrektes UPDATE mit Ausgabe über C | 5 + 5 | **10/10** | **10/10** |
| 2 | Richtige Tupelzahl, falscher Spaltenname | Absichtlich nicht vorhandene Tabelle | 2 + 0 | **2/10** | **2/10** |
| 3 | Zunächst korrekt abgegeben, danach geändert und nicht erneut ausgeführt | Korrektes UPDATE mit Ausgabe über C | 0 + 5 | **5/10** | **5/10** |

Jeder Versuch wurde über „Start Test“ begonnen und über „Finish Test“ samt
Bestätigungsdialog abgeschlossen. Die Ergebnisübersicht zeigte danach drei
getrennte Versuche. Zu Beginn der weiteren Versuche waren die Eingaben leer;
Antworten aus dem vorherigen Versuch wurden nicht ungewollt übernommen.

## Zusätzlich beobachtete Funktionen

1. **Echter Autosave:** Eine SQL-Antwort ohne vorherige Ausführung wurde eingegeben.
   Der Hintergrundrequest erzeugte einen nicht autorisierten Zwischenstand in
   `tst_solutions`. Nach vollständigem Neuladen stellte Chrome den SQL-Text wieder
   her. Die Seite zeigte „Autosave successful...“.
2. **Navigation:** Im ersten Versuch wurde zwischen beiden Aufgaben vor- und
   zurückgeblättert. SQL-Text und Ausführungsergebnis blieben erhalten.
3. **Integritätsprüfung:** Ein `UPDATE people ...` in der geschützten SELECT-Frage
   wurde mit der erwarteten Meldung zu unerlaubten Datenbankänderungen abgewiesen.
4. **SQL-Fehler:** `UPDATE missing_table ...` zeigte den erwarteten Fehler
   `no such table: missing_table`; die betroffene Aufgabe erhielt null Punkte.
5. **Änderung nach Abgabe:** Im dritten Versuch wurde eine bereits gespeicherte
   korrekte SELECT-Antwort verändert. Die Ausgabe wurde ungültig. Vor der nächsten
   Abgabe existierten der autorisierte alte Stand (`executed_bool=true`) und der
   neue Autosave-Entwurf (`executed_bool=false`) getrennt. Ein Neuladen stellte
   den Entwurf wieder her. Nach Übernahme wurde die SELECT-Frage mit **0/5**
   bewertet; ihre alten fünf Punkte wurden nicht weiterverwendet.
6. **Detailansicht:** Für Versuch 3 wurden beide Aufgaben mit Teilnehmerantwort,
   Musterlösung und einzelnen Metriken aufgeklappt. Die Einzelbewertungen
   **0/5** und **5/5** stimmen mit der Gesamtsumme überein.
7. **Datenbankabgleich:** `tst_pass_result` enthält die Summen **10, 2, 5**.
   `tst_test_result` enthält die sechs Einzelwerte **5, 5, 2, 0, 0, 5**.
   Sechs autorisierte Antworten sind mit den in Chrome eingegebenen SQL-Texten
   und den passenden Ausführungszuständen gespeichert.

## Reproduktion

```sh
docker compose -p ass_sql_ilias11_chrome up -d
docker compose -p ass_sql_ilias11_chrome exec -T -e ILIAS_TEST_WRITES=1 ilias \
  php public/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/tests/ilias11/exam-fixture.php
```

Die Ausgabe nennt URL und Zugangsdaten des neu erzeugten Testkontos. Mit diesem
Konto in Chrome anmelden und die drei oben beschriebenen Versuche durchführen.
Nach einem Seitenwechsel die ILIAS-Initialisierung abwarten, bevor Eingaben
erfolgen: Der Kern sperrt währenddessen die Benutzerinteraktion kurzzeitig.
Für die Autosave-Prüfung die Erfolgsmeldung abwarten und dann die Seite neu laden.

Anschließend ausschließlich lesend die gespeicherten Antworten prüfen:

```sh
docker compose -p ass_sql_ilias11_chrome exec -T -e ILIAS_TEST_WRITES=1 ilias \
  php public/Customizing/global/plugins/Modules/TestQuestionPool/Questions/assSQLQuestion/tests/ilias11/exam-fixture.php report
```

Die Fixture verlangt einen wegwerfbaren Client und `ILIAS_TEST_WRITES=1`.
Zum Entfernen ausschließlich dieser Testinstallation:

```sh
docker compose -p ass_sql_ilias11_chrome down -v
```

## Nachweise und Grenzen

Lokale Nachweise liegen im Git-ignorierten Verzeichnis `test-results/chrome/`:

- `three-attempts.png` und `three-attempts.dom.txt`: Chrome-Ergebnisübersicht.
- `attempt-1.png`, `attempt-2.png`: Ergebnisse nach den ersten beiden Abgaben.
- `integrity-check.png`, `sql-error.png`, `autosave-restored-draft.png`: Randfälle.
- `attempts-database.json`: gespeicherte Versuche, Punkte und Antworten nach Abschluss.
- `autosave-draft-database.json`: getrennte autorisierte Antwort und Zwischenstand
  vor der letzten Übernahme des Entwurfs.

In den geprüften Abläufen wurden keine zusätzlichen Fehler beim Ausführen,
Speichern, Wiederherstellen oder Bewerten festgestellt. Zwei Anzeigeauffälligkeiten
bleiben dokumentiert: Die ILIAS-Kerndetailansicht übersetzt den Fragetyp nicht
(`-assSQLQuestion-`); bei der nicht erneut ausgeführten Teilnehmerantwort bleibt
das Ausgabefeld der Detailansicht leer. Die Nullbewertung wird korrekt angezeigt.

Die drei Versuche ersetzen keine Lastprüfung und keine Abnahme auf der echten
StudOn-Installation mit FAU-Anpassungen. Weitere Metriken wurden durch die
vorhandenen Unit-Tests geprüft; die hier beschriebenen realen Versuche verwenden
Tupelzahl und Spaltennamen.
