# Änderungsverlauf

[English version](CHANGELOG.md)

Was sich in Blackbriar geändert hat, neueste Fassung zuerst.
Bis zur Freigabe zählt die mittlere Zahl neue Funktionen, die letzte Korrekturen dazwischen.

## bb.0.18.5 – 16.10.2026

- Einstellungen → Plex, Radarr und Sonarr: „Neuen Schlüssel erzeugen“ ersetzt den Schlüssel in den Webhook-Adressen, etwa wenn eine Adresse auf einem Bildschirmfoto zu sehen war. Die alten Adressen gelten sofort nicht mehr; die neuen müssen in Plex, Radarr und Sonarr eingetragen werden.

## bb.0.18.4 – 16.10.2026

- Hinweise unter „Im Blick behalten“ stehen jetzt immer in der eingestellten Sprache. Bisher blieben sie in der Sprache, in der sie entstanden waren, auch nach einem Wechsel. Ältere Hinweise zu Release-Gruppen werden beim nächsten Abgleich umgestellt.
- Der Änderungsverlauf ist jetzt zweisprachig: `CHANGELOG.md` auf Englisch, auch für die Release-Texte auf GitHub, und `CHANGELOG.de.md` auf Deutsch.

## bb.0.18.3 – 15.10.2026

- Fremde Webseiten können nichts mehr an Blackbriar schicken. Bisher hätte eine präparierte Seite, die man im selben Browser öffnet, im Hintergrund etwa einen Löschauftrag auslösen können, solange man angemeldet war. Webhooks von Plex, Radarr und Sonarr sind davon nicht betroffen.
- Sicherheits-Kopfzeilen: Blackbriar lässt sich nicht mehr in fremde Seiten einbetten, und der Browser lädt keine Skripte von außen.

## bb.0.18.2 – 15.10.2026

- Einstellungen → Allgemein: Passwort ändern und „Auf allen anderen Geräten abmelden“. Nach einer Änderung des Passworts sind die anderen Geräte von selbst abgemeldet.
- Passwort vergessen: Den Container einmal mit `AUTH_RESET=1` starten. Das löscht das Konto mit Passwort und alle Anmeldungen, die Daten bleiben. Ist Plex verbunden, meldet man sich danach über Plex an; sonst gibt es einen neuen Einrichtungscode.

## bb.0.18.1 – 15.10.2026

- Wer mit eigenem Konto eingerichtet hat, verbindet Plex unter Einstellungen → Plex mit einem Knopf, statt das Token von Hand zu suchen. Das Plex-Konto, das dort bestätigt, gilt als Besitzer; danach geht auch die Anmeldung über Plex.

## bb.0.18.0 – 15.10.2026

- Eigenes Konto mit Benutzername und Passwort: Bei einer frischen Installation lässt sich nach dem Einrichtungscode wahlweise ein Konto anlegen statt sich mit Plex anzumelden. So kommt man in Blackbriar, bevor Plex verbunden ist.
- Wer schon über Plex hineinkommt, kann unter Einstellungen → Allgemein ein Konto mit Passwort dazunehmen. Dann geht die Anmeldung auch, wenn plex.tv nicht erreichbar ist. Die Anmeldung über Plex bleibt.
- Nach zehn falschen Passwörtern ist die Anmeldung zehn Minuten gesperrt.

## bb.0.17.0 – 13.10.2026

- Webhook für Radarr und Sonarr: Tragen sie die Adresse aus Einstellungen → Radarr bzw. Sonarr ein, bekommt Blackbriar Änderungen sofort mit, etwa ein ausgetauschtes Release, einen neuen Film oder eine gelöschte Datei. Hinweise zu Serien, Warteliste und Speicherplatz stimmen dann nach Sekunden statt nach bis zu einer Stunde.
- Ohne den Webhook bleibt alles wie bisher: Blackbriar fragt stündlich nach.

## bb.0.16.2 – 12.10.2026

- Info-Fenster: Längere Werte wie „Aktuelle Serien“ oder „hevc und h264“ brechen nicht mehr in zwei Zeilen um.

## bb.0.16.1 – 12.10.2026

- Info-Fenster, „Auf dem Server“: Die Angaben zur Datei stehen jetzt mit Beschriftung darüber da (Mediathek, Größe, Folgen, Auflösung, Video-Codec, Bitrate, Dateiformat). Haben die Folgen einer Serie verschiedene Werte, werden sie genannt, etwa „hevc und h264“; erst ab vier verschiedenen steht dort „gemischt“. Das gilt auch in der Bibliothek.
- Info-Fenster: Darunter steht der Pfad der Datei, bei Serien der gemeinsame Ordner aller Folgen, mit einem Knopf zum Kopieren.

## bb.0.16.0 – 12.10.2026

- Trailer nur noch in der eingestellten Sprache, keine Teaser mehr. Gibt es keinen, steht das da, mit einem Link zum englischen Trailer, falls vorhanden.
- Hat TMDB eine Inhaltsangabe nur auf Englisch, steht ein Hinweis darüber. Für Titel auf dem Server kommt stattdessen zuerst der Text aus Plex.
- Beides gilt auch für die Seite hinter „Mehr dazu“ in den Mails.

## bb.0.15.1 – 12.10.2026

- Hinweise zu Serien: Gemischte Release-Gruppen werden schon bei Gleichstand gemeldet, etwa wenn die ersten zwei Folgen einer Staffel von zwei Gruppen stammen. So lässt sich eingreifen, bevor weitere Folgen von der falschen Gruppe kommen.

## bb.0.15.0 – 12.10.2026

- Info-Fenster: Lange Inhaltsangaben stehen zunächst gekürzt da, „mehr anzeigen“ klappt sie auf.
- Löschen gesehener Folgen: Steht die Serie noch auf einer Merkliste, warnt der Dialog davor, wie beim Löschen ganzer Titel.

## bb.0.14.3 – 12.10.2026

- Behoben: Nach dem Löschen vieler Folgen war der Dialog höher als der Bildschirm, und „Schließen“ ließ sich nicht mehr erreichen. Der Dialog passt jetzt immer auf den Bildschirm und lässt sich notfalls rollen.
- Für gelöschte Folgen steht eine Zeile da („In Plex gelöscht: 23 Folgen“) statt einer je Folge, auch im Protokoll.

## bb.0.14.2 – 12.10.2026

- Eine frische Installation übernimmt für „Was kommt“ das Land aus der Sprache des Browsers. Vorgewählt sind die weltweiten Anbieter, jetzt auch HBO Max; in Deutschland, Österreich und der Schweiz zusätzlich WOW, RTL+, Joyn Plus und Discovery+. Wer Land und Anbieter schon gespeichert hat, behält seine Auswahl.
- Die Meldungen im Protokoll des Containers stehen in der eingestellten Sprache; vor dem ersten Aufruf auf Englisch.
- Das Dashboard meldet „Keine Warnungen“ erst, wenn Plex verbunden ist.

## bb.0.14.1 – 12.10.2026

- Kann Blackbriar nicht in seinen Datenordner schreiben, sagt es das beim Start mit dem passenden Befehl zur Abhilfe, statt mit einem Programmfehler abzubrechen. Das passiert vor allem, wenn `user:` nachträglich gesetzt wird.
- Beispiel-YAML mit der Zeile für den Betrieb ohne Root.

## bb.0.14.0 – 12.10.2026

- Einrichtungscode: Eine frische Installation fragt bei der ersten Anmeldung nach einem Code, der im Protokoll des Containers steht. So kann sie nur einrichten, wer an den Server herankommt, und nicht, wer zufällig zuerst die Adresse findet.
- Bestehende Installationen merken davon nichts. Mit `PLEX_TOKEN` als Umgebungsvariable oder `AUTH=off` gibt es keinen Code.

## bb.0.13.2 – 12.10.2026

- Ohne Seerr ist „Kann weg“ strenger: Ein Titel erscheint erst, wenn der Besitzer und alle anderen, die ihn angefangen haben, ihn zu Ende gesehen und bewertet haben. Bisher zählte dann nur der Besitzer.
- Ein Hinweis über der Liste sagt, dass Blackbriar ohne Seerr weder Wünsche noch Merklisten kennt.
- Ohne Seerr entfallen die Kachel „Wünsche in Arbeit“ und die Zeile „auf keiner Merkliste“.

## bb.0.13.1 – 11.10.2026

- Einrichtung: Die Auswahl des Plex-Servers steht jetzt oben auf der Seite und sucht von selbst. Bisher war sie ein unauffälliger Knopf unter dem Formular.
- „Verbindung testen“ sagt bei Plex, dass nur noch die Adresse fehlt.

## bb.0.13.0 – 11.10.2026

- Erster Start: Eine frische Installation übernimmt die Sprache des Browsers, Deutsch oder Englisch. Umstellen lässt sie sich wie bisher unter Einstellungen → Allgemein.
- Nach der ersten Anmeldung mit Plex geht es direkt zu Einstellungen → Plex, wo der Server gewählt wird.
- Der Hinweis „Plex ist noch nicht verbunden“ sagt, was zu tun ist, und führt mit einem Link zu den Einstellungen.
- Am ersten Tag warnt das Dashboard nicht mehr vor einer fehlenden Sicherung.

## bb.0.12.6 – 11.10.2026

- Dashboard: „Im Blick behalten“ steht jetzt über „Neu in den letzten sieben Tagen“. Gibt es keine Warnungen, ist das ein schmaler Balken; darunter folgt der Block mit Newsletter und Wochenrückblick.
- Dashboard: Bei mehr als drei Hinweisen zu Serien stehen zunächst die ersten drei da, der Rest lässt sich aufklappen.

## bb.0.12.5 – 11.10.2026

- Erinnerung: Einleitung und Anleitung richten sich danach, was wirklich offen ist. Steht ein Titel nur noch auf der Merkliste, ist nicht mehr von einer fehlenden Bewertung die Rede.

## bb.0.12.4 – 11.10.2026

- Erinnerung: Der Satz zum Behalten ist kürzer und eindeutig: „Willst du etwas noch einmal sehen? Was auf deiner Merkliste steht, bleibt auf dem Server.“

## bb.0.12.3 – 11.10.2026

- Erinnerungsmail mit klareren Texten: Betreff und Überschrift nennen den Server („Noch offen auf Name [Plex]“), am Titel steht, was zu tun ist („Bitte in Plex bewerten“).
- Die Erinnerung erklärt jetzt, wie ein Titel auf dem Server bleibt: Wer etwas noch einmal sehen will, lässt es auf der Merkliste oder setzt es wieder darauf.
- Der Link in der Fußzeile heißt „Erinnerungen abbestellen“.
- Wunsch-Mail kürzer: „ein Titel von deiner Merkliste ist jetzt auf Name [Plex]“.

## bb.0.12.2 – 10.10.2026

- Behoben: Liegt eine Serie in zwei Mediatheken (1080p und 4K) und steht in zwei Sonarr-Instanzen, trägt das Löschen der einen Kopie sie nur noch aus der zugehörigen Instanz aus, nicht mehr aus beiden.

## bb.0.12.1 – 10.10.2026

- Seitenleiste unten links: „Projektseite“ als eigener Link, darunter „Version: …“.
- Was kommt: größere Poster in den Kacheln.

## bb.0.12.0 – 10.10.2026

- Was kommt: Jede Kachel hat „Ausblenden“. Der Titel verschwindet dann aus allen Bereichen und aus „Meine Themen“. Über „… Titel ausgeblendet“ oben lässt er sich wieder einblenden.
- Die Versionsnummer steht unten links in der Seitenleiste; ein Klick öffnet die Projektseite. Der Link steht auch unter Einstellungen → Status.
- Ein Klick auf das Logo führt zur Startseite.

## bb.0.11.1 – 10.10.2026

- Mails: Steht „Poster von Blackbriar laden“ auf ein, werden auch Logo und Kalenderwoche im Kopf geladen. Die Mail hat dann keinen Anhang mehr.

## bb.0.11.0 – 10.10.2026

- Mails: neue Einstellung unter Einstellungen → E-Mail, „Poster von Blackbriar laden statt anhängen“. Damit entfällt die Anhang-Liste, die manche Mailprogramme unter der Mail zeigen, und die Mail wird deutlich kleiner.
- Die Infoseite hinter „Mehr dazu“ zeigt ein Poster von TMDB, wenn Plex keines hat.

## bb.0.10.0 – 10.10.2026

- Newsletter: Knopf „Probe senden“. Er schickt alles aus den letzten 7 Tagen an einen Benutzer, zum Ausprobieren. Die Probe zählt nicht als verschickt.

## bb.0.9.1 – 09.10.2026

- Newsletter: Am Handy stehen jetzt immer zwei Kacheln nebeneinander, auch wenn das Mailprogramm wenig Platz lässt.

## bb.0.9.0 – 09.10.2026

- Blackbriar hat jetzt eine Versionsnummer. Sie steht unter Einstellungen → Status, dahinter klein der Kurzcode des Builds.
- Dieser Änderungsverlauf beginnt; die früheren Schritte sind nachgetragen.

## bb.0.8.0 – 09.10.2026

- Newsletter: höchstens 10 Kacheln je Abschnitt. Was darüber hinausgeht, steht als Liste darunter; jeder Titel führt zur Seite mit Inhalt und Trailer.
- Mails: Hat Plex kein Poster, kommt es von TMDB.
- Newsletter: Unter den Bewertungen stehen nur Titel, die noch auf dem Server liegen und die der Empfänger öffnen kann.

## bb.0.7.0 – 09.10.2026

- Was kommt: Streaming-Filme der letzten 30 Tage bei den gewählten Anbietern.
- Was kommt: Auswahl „Filme und Serien / Nur Filme / Nur Serien“ und das Häkchen „Nur Dokus“.
- Was kommt: neuer Bereich „Meine Themen“ mit eigenen Schlagwörtern, etwa Krankenhaus und Rettung.
- Was kommt: Kacheln statt Zeilen, über die volle Breite.
- Einstellungen → TMDB: Suche in der Anbieterliste, damit auch Anbieter von weiter hinten wählbar sind.

## bb.0.6.0 – 08.10.2026

- Verlauf: Gelöschte Titel bleiben stehen, gekennzeichnet als „nicht mehr auf dem Server“.
- Verlauf: Oben steht, was zuletzt wirklich gelaufen ist.
- Bewertungen gelöschter Titel bleiben erhalten.

## bb.0.5.0 – 07.10.2026

- Info-Fenster: Ein Klick auf einen Titel zeigt Inhalt, Datei, Staffeln, Personen und Wiedergaben.
- Mediatheken aus Plex als Filter in der Bibliothek; einzelne Mediatheken lassen sich ausnehmen.
- „Als gesehen markiert“ aus Plex zählt mit.
- Benutzer lassen sich als „bewertet nie“ markieren; „Kann weg“ zeigt zusätzlich „Gesehen, aber nicht bewertet“.
- Mails richten sich nach den Freigaben in Plex: Jeder sieht nur, was er öffnen kann.
- Testnachricht je Benutzer; die Erinnerung lässt sich von Hand erneut schicken.
- Der Plex-Webhook liest bei einem neuen Titel sofort die Bibliothek neu.

## bb.0.4.0 – 05.10.2026

- Hinweise im Dashboard: Staffel komplett, Folgen von verschiedenen Release-Gruppen.
- Löschen: Warnung bei Serien, die noch laufen.
- Eigenes Logo in der Seitenleiste.

## bb.0.3.0 – 04.10.2026

- Dashboard als Startseite, mit den laufenden Wiedergaben.
- Protokoll: was Blackbriar wann getan hat.
- Tägliche Sicherung der Datenbank.
- Sofort-Mail, wenn ein gewünschter Titel angekommen ist.
- Speicherplatz, inaktive Benutzer und Links zu Radarr und Sonarr.

## bb.0.2.0 – 03.10.2026

- E-Mail: eigenes Postfach, Newsletter „Neu auf dem Server“ und Erinnerung an offene Bewertungen, pro Benutzer einstellbar.
- Eigene Namen für Benutzer, Briefing-Ton für die Mails.
- Hinweis, wenn Plex einen gewünschten Titel vermutlich falsch zugeordnet hat.
- Löschen einzelner Folgen mit Abgleich in Sonarr.

## bb.0.1.0 – 02.10.2026

- Grundstein: laufende Wiedergaben, Verlauf und Bewertungen aller Benutzer, mit Telegram-Nachricht.
- Merklisten über Seerr, offene Bewertungen, „Kann weg“, Bibliothek, Statistik und Warteliste.
- Adminbereich für alle Verbindungen; Radarr und Sonarr.
- Anmeldung über Plex, Löschen aus Blackbriar heraus.
- Einmaliger Import aus Tautulli und Tracearr.
- „Was kommt“: Neustarts im Kino und bei Streaminganbietern, dazu der Kalender aus Radarr und Sonarr.
- Oberfläche für Handy, Tablet und große Monitore, auf Deutsch und Englisch.
