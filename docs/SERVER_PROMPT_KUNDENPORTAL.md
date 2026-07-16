# Prompt für die Umsetzung auf dem Server

Arbeite direkt im bestehenden Repository der Helbling-Rapporte-Anwendung auf dem Server. Setze die folgende Aufgabe vollständig um, teste sie mit einer isolierten Testdatenbank und nimm die produktive Anwendung erst nach bestandenen Tests wieder in Betrieb.

## Ausgangslage

- Repository: `kueni08/helbling-rapporte`
- Grundlage ist Draft-PR #56 auf `claude/caddy-https-login-setup-E5CKI`. Prüfe den aktuellen Remote-HEAD; Commit `0a9d85d5a7f58118e55f57df4e731d9c800b8729` muss darin als Vorfahr enthalten sein.
- Prüfe zuerst den tatsächlichen Serverstand mit `git status`, Branch, HEAD, Remote und laufendem Prozess. Übernimm keine Annahme blind und überschreibe keine lokalen Serveränderungen.
- Sichere vor jeder Migration die produktive SQLite-Datenbank inklusive WAL/SHM sowie den Upload-Ordner. Prüfe die Sicherung.
- Lies und beachte `C:\Users\sibox\.codex\ci.md`, sofern die Datei auf dem Server vorhanden ist. Für das Portal gelten HE-Blau `#1C1B78`, Schwarz/Weiss, Arial und vorhandene Original-Logo-Assets.

## Teil 1: Bestehende Kundenanfrage reparieren

Die öffentliche Kundenanfrage funktioniert auf dem lokalen PR-Stand in einem isolierten Test: `GET /anfrage` liefert 200, `POST /api/anfrage` liefert 201 und erzeugt einen Token. Der Fehler ist daher wahrscheinlich deployment-, proxy-, cookie-, dateirechte- oder datenbankspezifisch.

1. Reproduziere den Fehler auf dem Server über Browser/Netzwerkprotokoll und mit einem kleinen Multipart-Request.
2. Prüfe Anwendungs- und Reverse-Proxy-Logs, Schreibrechte für `UPLOADS_DIR`, Datenbankschema/Migrationen, Request-Grössen und den tatsächlich ausgelieferten Commit.
3. Behebe die konkrete Ursache. Keine pauschale Neuinstallation und keine produktiven Daten löschen.
4. Der vorhandene Test `npm run test:anfrage` muss bestehen. Er verwendet `DB_PATH`, `SESSIONS_DB_DIR` und `UPLOADS_DIR`, damit keine Produktivdaten berührt werden.

## Teil 2: Sicheres Kundenportal umsetzen

Setze das Konzept aus `docs/KUNDENPORTAL_KONZEPT.md` um. Die zentralen Anforderungen sind verbindlich:

- gleicher Server und gleiche Rapporte-Domain, aber eigener Bereich und eigenes Login unter `/kundenportal`; Kunden werden nach der Anmeldung ausschliesslich auf das reduzierte Portal geleitet
- separate Tabelle und Authentifizierung für Kundenportal-Benutzer; keine Erweiterung der internen Rollen um unkontrollierten Zugriff
- jedes Kundenkonto ist zwingend genau einem Eintrag aus `customers` zugeordnet
- strikte Mandantentrennung in jeder einzelnen API-Abfrage über die Kunden-ID aus der serverseitigen Session
- Kunde sieht eigene Portalaufträge sowie intern für ihn freigegebene Aufträge seines Kundenstamms und ausschliesslich kundengeeignete Felder
- neue Aufträge ab der ersten Eingabe automatisch speichern; auch unvollständige Datensätze sind sofort in der Planeransicht sichtbar
- vorerfasste, freigegebene Aufträge ergänzen, solange sie nicht gesperrt oder in Bearbeitung sind
- keine Schaltflächen „Entwurf speichern“ oder „Übermitteln“; Änderungen per Autosave sichern
- Schaltfläche „Für Helbling freigeben“ immer anzeigen; bei fehlenden Pflichtangaben konkrete Meldung ausgeben und nicht freigeben
- Pflichtfelder: Anlagen-/Projektnummer, Objektbezeichnung, vollständige Montageadresse, Kontaktperson vor Ort und Telefonnummer; Termin ist ausdrücklich optional
- mindestens ein Montagepositionsfoto ist vor der Kundenfreigabe Pflicht
- Portalzugang mit bestehendem Kundenstamm verknüpfen; Firma als `Kunde`, Profilname als `Besteller` und Portalbenutzer als `Erfasst von` übernehmen
- Benutzername, vollständiger Bestellername, Besteller-E-Mail und Besteller-Telefon im Portalzugang hinterlegen und beim Anlegen jedes Auftrags serverseitig übernehmen
- freigegebene Aufträge in der Planeransicht klar markieren; Planer ergänzt anschliessend Arbeiten, Artikel, interne Angaben und Zuweisung
- Smartphone-Kamera direkt anbieten, mit Vorschau und Löschen vor Upload
- Fassaden-/Untergrundauswahl: `Mauerwerk/Beton`, `Isolation/Verputz`, `Blechfassade`, `unbekannt`; `unbekannt` ist exklusiv
- weitere Felder des alten Formulars: Anlage/Projekt, Objekt und Adresse, Kontakt vor Ort, Terminoption, Strom, Parkierung, Bewilligungen, eingeschränkte Arbeitszeiten, weitere bauseitige Boxen und Bemerkungen
- Planer/Admin können im Kundenstamm Portalzugänge anlegen, deaktivieren und Passwörter zurücksetzen
- Planer/Admin können Aufträge für das Portal freigeben, sperren und zur Rückfrage wieder öffnen
- Kundenänderungen im Änderungsverlauf protokollieren
- bestehende Planer-, Admin- und Monteurabläufe nicht verschlechtern

Verwende die vorhandenen gemeinsamen Auftragsfelddefinitionen, wo sie passen. Lege für Portalantworten explizite Allow-Lists an; niemals vollständige Datenbankzeilen an den Kunden senden.

## Tests und Abnahme

Erweitere die automatisierten Tests mindestens um:

1. öffentliche Kundenanfrage mit Foto, Token-Bearbeitung und interner Liste
2. Kundenlogin erfolgreich/fehlgeschlagen/deaktiviert
3. Kunde A kann Auftrag A lesen und ändern
4. Kunde A kann Auftrag B von Kunde B weder lesen, ändern noch dessen Dateien laden
5. Kunde kann interne Felder, Status, Zuweisung und `customer_id` nicht manipulieren
6. Autosave ohne Foto und mit unvollständigen Feldern ist möglich; Freigeben ohne vollständige Objekt-/Kontaktdaten oder ohne Foto wird abgelehnt
7. gültiges Bild wird akzeptiert; falscher Dateityp und Übergrösse werden abgelehnt
8. `unbekannt` zusammen mit konkretem Fassadentyp wird abgelehnt
9. gesperrter/in Bearbeitung befindlicher Auftrag ist für Kunden schreibgeschützt
10. Admin kann Portalzugang und Freigabe verwalten

Führe Syntaxprüfungen, `npm test` und einen HTTP-Smoke-Test durch. Teste die mobile Oberfläche mindestens in einer schmalen Browseransicht. Verwende ausschliesslich eine isolierte Testdatenbank und ein isoliertes Upload-Verzeichnis für Tests.

## Produktive Inbetriebnahme

- Zeige vor produktiver Migration kurz die gefundenen Ursachen, geplanten Schemaänderungen und den getesteten Commit.
- Migrationen müssen wiederholbar und mit der vorhandenen SQLite-Datenbank kompatibel sein.
- Spiele keine Demo-Daten in die Produktivdatenbank ein.
- Die lokalen Dateien `public/kundenportal-demo.html` und `public/kundenportal-mobile.html` sind nur Designprototypen. Vor der produktiven Inbetriebnahme entfernen oder durch die echte, authentifizierte Portaloberfläche ersetzen; niemals als frei zugängliche Produktionsseiten belassen.
- Starte den vorhandenen Dienst kontrolliert neu und prüfe Login, öffentliche Anfrage, Kundenportal, Planeransicht, Uploads und Logs.
- Erzeuge für den Test einen Kunden `Privera AG`, einen Portalbenutzer mit einem temporären, zufälligen Passwort und zwei eindeutig als Test markierte Aufträge. Gib das Passwort nur im direkten Abschlussbericht aus und erzwinge einen Passwortwechsel beim ersten Login.
- Veröffentliche oder merge Änderungen erst, wenn ich dies ausdrücklich bestätige. Hinterlasse einen sauberen, nachvollziehbaren Arbeitsstand und berichte geänderte Dateien, Tests, offene Risiken und Rücksetzweg.
