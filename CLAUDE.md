# Blackbriar – Hinweise für die Arbeit am Code

## Architektur und Stack

- Server: Node.js 24, TypeScript ohne Build-Schritt (`node server/index.ts`), Fastify, Datenbank `node:sqlite`.
  Läuft auf Port 8787 (`PORT`), Daten unter `DATA_DIR` (Standard `./data`).
- Oberfläche: React 19, Vite, Tailwind v4 in `web/`. Im Entwicklungsbetrieb läuft Vite auf Port 5173 und
  leitet `/api` an `API_TARGET` weiter (Standard `http://localhost:8787`).
- Docker-Image für amd64 und arm64 über GitHub Actions: Push auf `main` baut `:dev`, ein Tag `vX.Y.Z` baut
  `:X.Y.Z`, `:X.Y`, `:latest` und legt ein Release mit dem Text aus `CHANGELOG.md` (englisch) an.
- Befehle: `npm run dev:server`, `npm run dev:web`, `npm run typecheck`, `npm run build`.

## Texte

- Knapper, sachlicher Ton für Admins. Fachbegriffe so, wie sie in Plex und den Arr-Apps heißen:
  Direct Play, Transcoding, Monitored, Release-Gruppe.
- Kein Marketing, keine KI-Floskeln, keine Füllsätze. Lieber konkret sagen, was passiert und was zu tun ist.
- Alles zweisprachig. Der deutsche Text ist der Schlüssel; jede neue Zeichenkette braucht ihre englische
  Fassung in `server/i18n.ts` bzw. `web/src/i18n.ts`.
- Jede Änderung bekommt einen Eintrag in `CHANGELOG.md` (englisch) und `CHANGELOG.de.md` (deutsch), mit derselben
  Versionsnummer (neue Funktion: mittlere Zahl, Korrektur: letzte). Datum im englischen Verlauf als JJJJ-MM-TT.

## Sicherheit und Logik

- Tokens der freigegebenen Plex-Benutzer holt Blackbriar bei plex.tv und hält sie nur im Arbeitsspeicher.
  Sie werden nie gespeichert, protokolliert oder an die Oberfläche gegeben.
- Plex-Token des Besitzers und API-Schlüssel der Dienste liegen in der Datenbank (Einstellungen). Sie gehören
  nie in Protokolle, Fehlermeldungen oder Antworten an die Oberfläche.
- Passwörter nur als scrypt-Hash, Sitzungen nur als Hash des Cookies.
- Löschreihenfolge immer: erst Radarr bzw. Sonarr (austragen oder Folgen auf unmonitored), dann Plex die
  Dateien löschen lassen, zuletzt Seerr zurücksetzen. Sonst lädt Radarr/Sonarr den Titel neu herunter.
  Löschen ist aus, bis es in den Einstellungen erlaubt wird; jeder Schritt wird protokolliert.
- Schreibende Anfragen nimmt der Server nur von der eigenen Seite an (`server/security.ts`); Webhooks sind
  davon ausgenommen und prüfen ihren Schlüssel selbst.
- Der Container läuft auch ohne Root, etwa mit `user: "568:568"` bei TrueNAS-Apps. Alles, was Dateien schreibt,
  schreibt nur unter `DATA_DIR`; keine festen Pfade, keine Annahmen über UID/GID. Ist der Datenordner nicht
  beschreibbar, bricht der Start mit einer verständlichen Meldung samt `chown`-Hinweis ab.
- Keine persönlichen Daten ins Repo: keine echten Benutzernamen, Mailadressen, IP-Adressen oder Pfade aus einem
  echten Heimnetz, auch nicht in Kommentaren oder Beispielen.
