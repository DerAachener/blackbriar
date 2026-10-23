# Blackbriar

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE) ![Platforms: amd64, arm64](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-lightgrey) [![Image on ghcr.io](https://img.shields.io/badge/image-ghcr.io%2Fderaachener%2Fblackbriar-2ea44f)](https://github.com/DerAachener/blackbriar/pkgs/container/blackbriar)

**A companion app for people who share their Plex server with friends and family.**

Blackbriar tracks playback status, active watchlists, and requests across your users so you always know what can safely be removed when disk space runs low. It can also notify users when requested media arrives.

[Deutsche Fassung](README.de.md) · [Changelog](CHANGELOG.md)

![Dashboard with a live session, open ratings, cleanup and free space](docs/screenshots/dashboard.png)

## What Blackbriar does differently

**Activity and intent over guesswork.** A title only lands on the safe-to-delete list when nobody is currently watching it, nobody has it saved on their watchlist, and the person who requested it via Seerr has finished it. You do not have to piece together complex rule sets for that.

**Ratings as bonus context.** Plex stores ratings per user account, which tools like Tautulli do not show across all users. Blackbriar pulls them in so you can see if your users actually liked or disliked a title before purging it. It is handy context for edge cases, but pure watch status and watchlists always take priority.

**Automatic reminders:** Users with inactive items lingering on their watchlist can get an automated email reminder so they either watch it or release it.

Blackbriar is made for servers with a few users and limited disk space. If you collect only for yourself, you probably do not need it.

## What it does

### Watch & Intent
- Live sessions with progress, client device, and Direct Play vs. transcoding
- Watch history of all accounts, per title: who watched it and when. Deleted titles remain logged in the history
- Titles marked as watched manually in Plex are recognized and tagged accordingly
- Server statistics per user, weekday, hour, device, and playback type

### Clean up
- **Cleanup:** titles that are safe to delete because they are on nobody's watchlist, nobody is currently watching them, and everyone who requested them has finished them
- Delete directly from Blackbriar, coordinated with Radarr, Sonarr, and Seerr, for entire titles or just watched episodes. Deleting is completely disabled until you explicitly turn it on in the settings
- Library overview with file size, codec, resolution, and bitrate, filtered by Plex library
- Free disk space with an estimate of how long your current storage will last based on library growth
- TV show notices: completed seasons still marked as monitored in Sonarr, or mixed release groups within the same season
- Alerts when Plex has matched a title to the wrong entry, which causes Seerr to request it repeatedly

![Cleanup: titles that are safe to delete, with who requested, watched and rated them](docs/screenshots/cleanup.png)

### Ratings (Secondary context)
- Reads the ratings of all users on the server, not just the owner's
- Lists what someone has finished but not rated yet (for those who want feedback)
- Optional Telegram notification when a user rates a title
- Users who never rate can be flagged so pure watch status counts as done for them

### Keep your users informed
- **Instant email** when a title from someone's watchlist has arrived
- **Newsletter** with new movies, seasons, and episodes, plus recent ratings (without usernames)
- **Reminders** for titles someone finished but has not rated, or still keeps on their watchlist
- Every user only sees titles from the libraries shared with them
- Every email links to a page with summary, cast, and trailer, plus an unsubscribe link
- Notifications can be set as a global default or customized per user

<img src="docs/screenshots/newsletter.png" alt="Newsletter with new movies, series and recent ratings" width="420">

### Look ahead
- New cinema and streaming releases for your country and providers via TMDB
- "My topics": custom interests built from TMDB keywords (e.g. documentaries on a specific subject)
- Hide titles you do not care about
- Request a title in Seerr with one click, or jump straight to it in Radarr or Sonarr

### For the owner
- Dashboard: active playback, pending items, free disk space
- Unified info window for every title from any view
- Audit log of actions taken by Blackbriar
- Daily database backup (last seven days retained)
- Sign-in with Plex; only the server owner gets admin access
- Available in German and English

![Info window of a title](docs/screenshots/info.png)

User names in the screenshots are made up.

## What you need

| Service | Required | Used for |
|---|---|---|
| Plex Media Server | yes | Sessions, history, ratings, library |
| Seerr | recommended | Watchlists, requests, Cleanup |
| Radarr and Sonarr | optional | Cleanup, disk space, series notices. Second 4K instances supported |
| TMDB API key (free) | optional | Upcoming releases, title pages, season metadata |
| Telegram bot | optional | Notifications to the owner |
| SMTP mailbox | optional | Emails to your users |
| Tautulli or Tracearr | optional | One-time import of past play history |

Plex Pass is only needed for the webhook that delivers live notifications instantly. Without it, Blackbriar polls every five minutes.

Blackbriar works with Plex only. Jellyfin and Emby are not supported.

## Installation

Blackbriar runs as a single Docker container and keeps its data in one folder.

```yaml
services:
  blackbriar:
