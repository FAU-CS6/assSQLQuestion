# Konfigurierbare QSS-Kosten für die spätere Bewertungsalternative

Diese Anforderung betrifft die spätere Freischaltung von QSS als auswählbare
Bewertung. Der aktuelle Stand bleibt eine parallele Bewertung mit Standardkosten;
die folgende Dozentenoberfläche ist noch nicht implementiert.

Das [Graph-QSS-Paper, insbesondere Abschnitt 4.3.1](https://www.cs6.tf.fau.eu/files/2025/03/Koeberlein-Graph-based_QSS-141_b.pdf)
berücksichtigt unterschiedliche pädagogische Vergleichsziele. Eine semantisch
äquivalente Umformung kann deshalb in einem bestimmten Aufgabenkontext Kosten
erhalten. Während einer einzelnen Graphsuche müssen die gewählten Editkosten
fest und nichtnegativ sein.

## Geplante Bedienung

- Eine Frage startet mit den vollständigen Standardkosten des jeweiligen
  Editkatalogs. Die Oberfläche zeigt verständliche Beschreibungen und Kosten.
- Dozenten können einzelne Werte überschreiben und einzeln oder vollständig
  auf die Standardwerte zurücksetzen.
- Auch bisher kostenlose Äquivalenz-Edits können positive Kosten erhalten.
- Die Bearbeitung unterscheidet übersichtlich zwischen Äquivalenzen, logischen
  Reparaturen und grundlegenden Konstruktoren. Die stabilen Edit-IDs bleiben
  für Speicherung und Diagnose erhalten.
- Eine Vorschau mit Beispielantworten macht die Auswirkungen der gewählten
  Kosten sichtbar.

Die Engine nimmt solche Überschreibungen bereits als `costs` entgegen und prüft
Editnamen und nichtnegative ganzzahlige Werte. Diese technische API ist noch
keine in ILIAS gespeicherte Dozenteneinstellung. Für feinere Abstufungen wäre
eine exakt repräsentierbare Kostenskala vorzusehen; ungenaue Fließkomma-Vergleiche
dürfen keine Optimalitätszertifikate erzeugen.

Vor einer Speicherung braucht der Katalog eine stabile Validierung unabhängig
vom einzelnen Antwort-AST. Ein bekanntes, konfiguriertes Edit kann auf eine
bestimmte Antwort nicht anwendbar sein; allein das darf die Auswertung nicht
abbrechen. Die aktuelle API weist Kosten-IDs außerhalb des jeweils aufgebauten
Graphkatalogs noch ab. Das muss bei der Einführung gespeicherter Kostenprofile
berücksichtigt werden.

## Speicherung und Bewertungsbindung

Zur Frage gehören die Version des Standardkatalogs, die gewählten
Kostenüberschreibungen und ausdrückliche Methodenvorgaben. Die aufgelöste
Kostentabelle muss während eines Bewertungsjobs unverändert bleiben.

Diese Konfiguration muss bei Fragenkopien sowie Import und Export erhalten
bleiben und in den Fingerabdruck der Bewertungsrevision eingehen. Eine Änderung
der Kosten macht frühere parallele Diagnosen als Bewertung des neuen Profils
ungültig. Für bereits begonnene beziehungsweise abgegebene Prüfungsversuche
muss die dort gültige Konfiguration nachvollziehbar bleiben. Bestehende Fragen
ohne eigene Konfiguration verwenden die dokumentierten Standardwerte.

Die Browserauswertung muss genau die gespeicherte Kostentabelle erhalten.
Konfigurierbare Kosten rechtfertigen keine Näherungsnote: Auch damit zählt der
günstigste tatsächliche Editpfad im definierten Graphen. Suchoptimierungen müssen
für geänderte Kosten weiterhin korrekt sein oder ihre unbewiesenen Schranken
deaktivieren. Die aktuellen Tests berücksichtigen bereits kostenlose
Überschreibungen ursprünglich kostenpflichtiger Edits.

## Methodenvorgaben

Das Verteuern eines einzelnen Äquivalenz-Edits garantiert nicht, dass ein
bestimmtes Konstrukt verwendet wird: Der Graph kann einen anderen kostenlosen
Pfad enthalten. Verlangt die Aufgabe etwa ausdrücklich ein bestimmtes JOIN-
oder WITH-Konstrukt, muss diese Vorgabe zusätzlich ausdrücklich konfigurierbar
und Bestandteil der Bewertungsrevision sein. Die dazugehörigen Kosten und
zulässigen Umformungen müssen zusammen geprüft werden.

Vor einer Freischaltung sind die Konfiguration, ihre Speicherung und Migration,
unterschiedliche Kostenprofile, Methodenvorgaben sowie Import/Export im nativen
Dozenten- und Studentenablauf zu prüfen. Die derzeit laufende Abnahme verwendet
weiterhin das unveränderte Standardprofil.
