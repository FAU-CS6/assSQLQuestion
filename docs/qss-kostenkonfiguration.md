# Konfigurierbare QSS-Kosten

Seit Plugin **0.3.0** wählt der Fragenersteller im Bewertungsbereich zwischen
„Ergebnisbasierte Bewertung“ und „Graph-QSS-Bewertung“. Neue und bestehende
Fragen verwenden zunächst die Ergebnisbewertung. Die bisherige Bedienung und
Berechnung bleiben dabei erhalten.

## QSS einstellen

Für QSS gibt es eine eigene Maximalpunktzahl sowie **71 vorbelegte Kostenwerte**:
56 benannte Äquivalenzumformungen beziehungsweise logische Reparaturen und
15 Kategorien grundlegender Komponenten-/Attributoperationen. Letztere gelten
für alle entsprechenden atomaren Edits, unabhängig vom konkreten SQL-AST.
Die Gruppen können aufgeklappt werden; jede Kostenposition ist einzeln änderbar.
Ein Knopf setzt alle Kosten auf die Standardwerte zurück. Verborgene Einstellungen
der jeweils anderen Bewertungsart werden beim Umschalten nicht überschrieben.

Kosten sind ganze Zahlen von **0 bis 1.000.000**. Auch bisher kostenlose
Äquivalenzumformungen können Kosten erhalten und kostenpflichtige Schritte
können kostenlos werden. Die Maximalpunkte lassen bis zu vier Nachkommastellen zu.
Der Maßstab bleibt `Maximalpunkte / 5`: Kosten 1 ziehen 20 Prozent des Maximums ab.
Standardwerte und Skala sind weiterhin vorläufig und nicht menschlich kalibriert.

Das [Graph-QSS-Paper, Abschnitte 4.3 und 4.7](https://www.cs6.tf.fau.eu/files/2025/03/Koeberlein-Graph-based_QSS-141_b.pdf)
bleibt die Grundlage. Auch mit eigenen Kosten zählt der günstigste tatsächliche
Editpfad im konfigurierten Graphen. Die gewählten nichtnegativen Kosten bleiben
während eines Jobs fest. Suchoptimierungen benötigen weiterhin gültige Beweise;
kostenlose Überschreibungen dürfen keine unbewiesene positive Schranke erzeugen.

## Sieben neue Schritte in Modell 2.7.0

Die bisherigen 64 Kosten werden unverändert übernommen. Sechs neue Schritte
sind standardmäßig kostenlos: redundante Projektionsnamen und identische
Tabellenaliase bei mehreren Basistabellen, ein durch Schlüssel und Filter
abgesicherter IN-/INNER-JOIN-Wechsel, lokale Spaltenpräfixe und identische
Tabellenaliase in unkorrelierten Unterabfragen sowie das Vertauschen zweier
geeigneter INNER-JOIN-Quellen. Sie gelten nur, wenn ihre jeweiligen Bedingungen
für Bindungen, NULL, Duplikate, Datentypaffinität und Ausgabenamen nachgewiesen
sind. Aus gleichen Ergebnissen eines Beispieldatensatzes folgt keine freie Kante.

Der siebte Schritt `changeSubqueryComparison` kostet standardmäßig **1**:
Er wechselt zwischen IN/NOT IN und einem skalaren Unterabfragevergleich, ohne
die innere Abfrage zu verändern. Er ist eine Reparatur, keine allgemeine
Äquivalenz: mehrere Treffer und NULL können das Ergebnis verändern. Alle sieben
Preise sind unabhängig einstellbar. Die einzelnen IDs und ihre Grenzen stehen
im [technischen Katalog](../lib/qss/README.md#provisional-costs-and-linear-grading).

## Speichern und Übertragen

Die Frage speichert Bewertungsart, QSS-Maximalpunkte, Katalogversion und vollständig
aufgelöste Kosten. Das Profil verwendet Version 7 zum Graphmodell 2.7.0. Ältere Profile der
Versionen 1 (Modell 2.1.1), 2 (Modell 2.2.0), 3 (Modell 2.3.0), 4 (Modell 2.4.0),
5 (Modell 2.5.0) und 6 (Modelle 2.6.0 und 2.6.1) behalten alle eingestellten Kosten;
neu hinzugekommene Schritte erhalten ihre Standardwerte. Bekannte
Schritte dürfen im aktuellen Antwortpaar fehlen; das macht das Profil nicht ungültig.
Unbekannte Kostenpositionen, nicht ganzzahlige oder negative Werte und unbekannte
Profilversionen werden abgewiesen.

Kopien, Testfragen und QTI-Import/Export behalten diese Angaben. Alte Fragen und
Exporte ohne die neuen Angaben bleiben ausdrücklich ergebnisbewertet. Ihre
Maximalpunkte und bisherigen Bewertungsmetriken werden nicht umgerechnet.

Beim Ändern von SQL, Aufgabenbedingungen, Maximalpunkten oder Kosten wird die
aktuelle Browserauswertung ungültig. Vor dem Speichern einer neuen oder geänderten
QSS-Konfiguration muss die Musterlösung erfolgreich mit QSS ausgeführt werden.
Unveränderte Einstellungen erfordern bei einer reinen Titeländerung keine neue
Ausführung. Eine Vorschau erlaubt das Erproben von Studentenantworten.

Zu jeder gespeicherten QSS-Abgabe hält der Server die verwendete Kostenrevision
und die aus dem Browserabstand berechneten offiziellen Punkte fest. Spätere
Kosten-/Modelländerungen rechnen diese historischen Abgaben nicht stillschweigend
neu oder zu null um. Der Server führt dafür weder SQL noch eine Graphsuche aus.
Die normalen ILIAS-Testkopien trennen Poolbearbeitung und laufende Tests weiterhin.

## Methodenvorgaben

Das Verteuern eines einzelnen Edits garantiert kein bestimmtes Konstrukt:
Es kann einen anderen günstigeren Pfad geben. Fachliche Methodenvorgaben müssen
im Aufgabentext ausdrücklich genannt werden. Die vorhandene Erkennung solcher
Vorgaben bleibt bestehen; ein eigener zusätzlicher Methodenvorgaben-Editor ist
nicht Teil dieser Änderung.

Die [Abnahme und Grenzen](qss-bewertung.md) dokumentieren echte native Abläufe,
ältere Exporte, gespeicherte Noten und die verbleibende Vertrauensgrenze der
clientseitigen Bewertung.
