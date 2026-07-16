# Kundenportal für Montageaufträge

## Empfehlung

Das Kundenportal wird als eigener, klar abgegrenzter Bereich der bestehenden Rapporte-Anwendung umgesetzt. Kunden erhalten keine interne Rolle und keinen Zugriff auf die Planer-, Admin- oder Monteur-Oberfläche. Die Anmeldung läuft über `/kundenportal` und getrennte Kundenkonten, die immer genau einem Eintrag im bestehenden Kundenstamm zugeordnet sind.

Diese Trennung ist sicherer als eine zusätzliche Rolle in der internen Benutzertabelle. Sie verhindert insbesondere, dass ein Kunde durch einen Fehler Aufträge anderer Kunden, interne Bemerkungen, Monteurfelder oder administrative Funktionen sehen kann.

## Ablauf

1. Ein Admin legt beim Kundenstamm einen oder mehrere Portalbenutzer an.
2. Planer können bestehende Aufträge diesem Kunden zuordnen und für das Portal freigeben.
3. Der Kunde sieht eine mobile Auftragsliste mit Status, Objekt, Adresse und Termin.
4. Der Kunde kann einen Auftrag öffnen, die Felder ergänzen und direkt mit dem Smartphone ein Foto der vorgesehenen Montageposition aufnehmen. Jede Änderung wird automatisch gespeichert und ist sofort für Planer sichtbar.
5. Neue Aufträge erscheinen ab dem ersten Speichern als „Kundenerfassung unvollständig“ in der Planeransicht. Es gibt keinen separaten Übermitteln-Schritt.
6. Die Schaltfläche „Für Helbling freigeben“ bleibt immer sichtbar. Fehlen Pflichtangaben, nennt die Oberfläche die fehlenden Felder und setzt den Fokus auf das erste davon. Ein Termin ist nie Pflicht.
7. Nach vollständigen Objekt- und Kontaktangaben sowie mindestens einem Montagepositionsfoto kann der Kunde den Auftrag für Helbling freigeben. Planer ergänzen anschliessend Arbeiten und Artikel und übernehmen den Auftrag in die Planung.
8. Sobald ein Planer den Auftrag sperrt oder die Montage begonnen hat, ist er für den Kunden schreibgeschützt. Eine Rückfrage kann ihn wieder zur Bearbeitung öffnen.

## Darstellung in der Planeransicht

Ein Kundenauftrag ist sofort sichtbar, auch wenn er noch unvollständig ist. Die Liste zeigt zusätzlich zur normalen Auftragsinformation:

- Status `Kundenerfassung unvollständig` oder `Für Helbling freigegeben`
- Kennzeichnung `Kundenportal`
- verknüpfter Kunde aus dem Kundenstamm, beispielsweise `Privera AG`
- `Besteller`: vollständiger Name aus dem Portalbenutzerprofil
- `Erfasst von`: Benutzername beziehungsweise vollständiger Name des Portalbenutzers

Der Benutzername wird nicht als Firmenname gespeichert. Das Portal-Login ist mit einem bestehenden Kundenstamm verknüpft. Dadurch bleiben `Kunde`, `Besteller`, E-Mail und Telefon in allen Aufträgen konsistent. Beim Erstellen eines Auftrags werden diese Werte aus dem Portalprofil übernommen; der Kunde muss sie nicht jedes Mal neu erfassen. Planer ergänzen danach Arbeitsarten, Artikel, interne Angaben, Monteur und Terminplanung.

## Sichtbare und bearbeitbare Kundendaten

- Anlagen-/Projektnummer des Kunden
- Objektbezeichnung
- Montageadresse: Objekt, Strasse, PLZ, Ort
- Kontaktperson vor Ort: Name, Telefon und E-Mail
- Terminwunsch:
  - innerhalb der nächsten vier Wochen
  - Ausführung ab einem bestimmten Datum
  - Express innerhalb einer Woche
- Strombezug vor Ort und ergänzende Angabe
- Parkierung unmittelbar beim Montagestandort
- Parkbewilligung erforderlich
- Zufahrtsbewilligung erforderlich
- eingeschränkte Arbeitszeiten
- weitere bauseitige Boxen zu montieren
- Untergrund/Fassade als Mehrfachauswahl:
  - Mauerwerk/Beton
  - Isolation/Verputz
  - Blechfassade
  - unbekannt (schliesst die drei konkreten Angaben aus)
- Bemerkungen des Kunden
- mindestens ein Foto der vorgesehenen Montageposition vor der Freigabe
- optional weitere Fotos, Lageplan oder PDF

Nicht sichtbar sind interne Planernotizen, Zuweisung und Reihenfolge der Monteure, interne Versanddaten, Änderungsprotokolle anderer Rollen sowie nicht freigegebene Rapportdaten.

## Datenmodell

- `customer_portal_users`: separates Login, Passwort-Hash, Benutzername, vollständiger Bestellername, E-Mail, Telefon, Aktivstatus und zwingende `customer_id`
- `orders.customer_portal_status`: `in_erfassung`, `freigegeben`, `rueckfrage`, `uebernommen`
- `orders.customer_edit_locked`: explizite Bearbeitungssperre
- `orders.customer_created_by`: Verweis auf den Portalbenutzer
- zusätzliche strukturierte Spalten für Terminoption, Strom, Parkierung, Zufahrt, Arbeitszeiten und bauseitige Boxen
- `orders.facade_types_json`: validierte Liste der Fassadentypen
- vorhandene Foto-/Anhangstabellen weiterverwenden, aber Upload und Download über eigens abgesicherte Kundenportal-Endpunkte
- Änderungen des Kunden im bestehenden Änderungsverlauf mit Rolle `kunde` und Portalbenutzer protokollieren

Alle Portalabfragen müssen serverseitig `order.customer_id = session.customerId` erzwingen. Eine vom Browser übermittelte Kunden-ID darf nie für die Berechtigung verwendet werden.

## Sicherheitsregeln

- getrennte Kunden-Session und getrennte Middleware
- Login-Rate-Limit und sichere Passwortregeln
- Session-Cookie in Produktion `secure`, `httpOnly` und `sameSite=lax`
- CSRF-Schutz für schreibende Portalaktionen
- Bildprüfung nach tatsächlichem Dateityp, nicht nur nach Dateiendung
- maximal 10 Bilder, je maximal 15 MB; serverseitige Orientierungskorrektur und sinnvolle Verkleinerung
- keine Pfade oder internen Dateinamen in API-Antworten
- Aufträge anderer Kunden liefern immer 404 statt verräterischem 403
- Sperre gegen Änderungen nach Montagebeginn beziehungsweise nach manueller Freigabe

## Oberfläche und CI

Die Oberfläche folgt der Helbling-CI: HE-Blau `#1C1B78`, Schwarz und Weiss, Arial als Dokumentschrift und ausschliesslich das vorhandene Original-Logo. Auf dem Smartphone steht der Ablauf im Vordergrund: Objekt wählen, Angaben ergänzen, Foto aufnehmen und für Helbling freigeben. Änderungen werden automatisch gespeichert. Das Foto-Feld nutzt `accept="image/*"` und `capture="environment"`, bietet aber zusätzlich Dateiauswahl, Vorschau und Löschen vor dem Upload.

## Abnahmekriterien

- Ein Kunde kann sich anmelden und sieht ausschliesslich Aufträge seines Kundenstamms.
- Direktaufrufe fremder Auftrags- oder Datei-IDs sind wirkungslos.
- Ein freigegebener, aber nicht gesperrter Auftrag lässt sich mobil ergänzen.
- Ein neuer Auftrag ist durch Autosave sofort intern sichtbar; die Freigabe ist erst mit vollständigen Objekt-/Kontaktdaten und Montagefoto möglich.
- „unbekannt“ kann nicht gleichzeitig mit einem konkreten Fassadentyp gespeichert werden.
- Ein gesperrter oder bereits in Bearbeitung befindlicher Auftrag ist schreibgeschützt.
- Planer sehen Quelle, Erfassungs-/Freigabestatus und Änderungen des Kunden.
- Die bestehende öffentliche Kundenanfrage funktioniert weiterhin.
- Automatisierte Tests decken Mandantentrennung, Feldrechte, Uploadprüfung und den bisherigen Anfrageablauf ab.
