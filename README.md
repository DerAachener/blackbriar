# Blackbriar

[![License: GPL-3.0](https://img.shields.io/badge/license-GPL--3.0-blue)](LICENSE) ![Platforms: amd64, arm64](https://img.shields.io/badge/platforms-amd64%20%7C%20arm64-lightgrey) [![Image on ghcr.io](https://img.shields.io/badge/image-ghcr.io%2Fderaachener%2Fblackbriar-2ea44f)](https://github.com/DerAachener/blackbriar/pkgs/container/blackbriar)

**A companion app for people who share their Plex server with friends and family.**

Blackbriar tracks playback status, active watchlists, and requests across your users so you always know what can safely be removed when disk space runs low. It can also notify users when requested media arrives.

[Deutsche Fassung](README.de.md) · [Changelog](CHANGELOG.md)

![Dashboard with a live session, open ratings, cleanup and free space](docs/screenshots/dashboard.png)

## What Blackbriar does differently

**Watching and watchlists come first.** A title only lands on the safe-to-delete list when nobody is currently watching it, nobody has it saved on their watchlist, and everyone who requested it via Seerr has watched it. You do not have to piece together complex rule sets for that.

**Ratings are the icing on the cake.** Plex stores ratings per user account, which tools like Tautulli do not show across all users. Blackbriar reads them for everyone, so you can see whether your users liked a title before you delete it. By default a title also waits for a rating from those who rate. Turn ratings off for a user and watching alone counts as done for them.

**Automatic reminders:** Users with inactive items lingering on their watchlist can get an automated email reminder so they either watch it or release it.

Blackbriar is made for servers with a few users and limited disk space. If you collect only for yourself, you probably do not need it.

## What it does

### Watch & Intent
- Live sessions with progress, client device, and Direct Play vs. transcoding
- Watch history of all accounts, per title: who watched it and when. Deleted titles remain logged in the history
- Titles marked as watched manually in Plex are recognized and tagged accordingly
- Server statistics per user, weekday, hour, device, and playback type

### Clean up
- **Cleanup:** titles that are safe to delete because they are on nobody's watchlist, nobody is currently watching them, and everyone who requested them has watched them (and rated them, unless ratings are turned off for that user)
- Delete directly from Blackbriar, coordinated with Radarr, Sonarr, and Seerr, for entire titles or just watched episodes. Deleting is completely disabled until you explicitly turn it on in the settings
- Library overview with file size, codec, resolution, and bitrate, filtered by Plex library
- Free disk space with an estimate of how long your current storage will last based on library growth
- TV show notices: completed seasons still marked as monitored in Sonarr, or mixed release groups within the same season
- Alerts when Plex has matched a title to the wrong entry, which causes Seerr to request it repeatedly

![Cleanup: titles that are safe to delete, with who requested, watched and rated them](docs/screenshots/cleanup.png)

### Ratings (the extra)
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
    image: ghcr.io/deraachener/blackbriar:latest
    container_name: blackbriar
    restart: unless-stopped
    # Optional: do not run as root. The data folder must then belong to this user.
    # user: "1000:1000"
    ports:
      - "8787:8787"
    environment:
      TZ: Europe/Berlin
    volumes:
      - ./data:/data
```

```bash
docker compose up -d
```

Without Compose, the same as one command:

```bash
docker run -d --name blackbriar --restart unless-stopped -p 8787:8787 -e TZ=Europe/Berlin -v "$(pwd)/data:/data" ghcr.io/deraachener/blackbriar:latest
```

On TrueNAS, paste the YAML above under Apps → Discover → Install via YAML and point the volume to a dataset of your own. The folder has to exist already, TrueNAS does not create it. With `user: "568:568"`, the `apps` user of TrueNAS, create it like this:

```bash
sudo mkdir -p /mnt/<pool>/blackbriar
```

```bash
sudo chown -R 568:568 /mnt/<pool>/blackbriar
```

This applies everywhere: if you set `user:`, give that user the data folder, otherwise Blackbriar cannot write its database and does not start.

If port 8787 is taken, change the left number under `ports`, for example `"8790:8787"`.

`:latest` is the newest released version. To stay on a fixed version, use a tag like `:1.7.4`, or `:1.7` for the newest fix of that line. All versions are listed under [Releases](../../releases). Images are built for amd64 and arm64.

1. Open `http://<your-server>:8787`. The first time, Blackbriar asks for a setup code. You find it in the container log (`docker logs blackbriar`, on TrueNAS under “Logs” of the app). Then sign in with the Plex account that owns the server, or create your own account with user name and password. In that case you connect Plex afterwards with one click under Settings → Plex. From now on only this Plex account and your password get in.
2. Under Settings → Plex, pick your server from the list.
3. Go through the other tabs of the settings and enter what you use. Every connection has a test button.
4. Optional, with Plex Pass: copy the webhook address from Settings → Plex into Plex under Settings → Webhooks.
5. Optional: copy the address from Settings → Radarr or Sonarr into Radarr and Sonarr under Settings → Connect → Webhook. Blackbriar then notices a new or replaced release within seconds instead of up to an hour.

The first sync reads the complete watch history and all ratings. On a large server this takes a few minutes. Ratings and plays that already exist do not trigger notifications or reminders.

### Updating

```bash
docker compose pull
```

```bash
docker compose up -d
```

On TrueNAS, restarting the app only fetches the new image if the YAML contains `pull_policy: always`. Put that line below `image:` if you use `:latest`.

What changed is listed in the [changelog](CHANGELOG.md). The running version is shown at the bottom of the sidebar.

### Access from outside

Emails to your users contain links to title pages and to the unsubscribe page. For these to work, Blackbriar must be reachable under a public address (reverse proxy or tunnel, with https), entered as "Public address" under Settings → Email or as the environment variable `PUBLIC_URL`. Without it, emails are still sent, but without those links.

### Environment variables

Every connection can be entered in the settings. As an alternative they can be preset through environment variables; what is saved in the settings takes precedence. See [.env.example](.env.example).

| Variable | Meaning |
|---|---|
| `PLEX_URL`, `PLEX_TOKEN` | Plex server address, e.g. `http://192.168.1.10:32400`, and the owner's token |
| `SEERR_URL`, `SEERR_API_KEY` | Seerr, e.g. `http://192.168.1.10:5055` |
| `RADARR_URL`, `RADARR_API_KEY`, `SONARR_URL`, `SONARR_API_KEY` | Radarr and Sonarr |
| `RADARR_4K_URL`, `RADARR_4K_API_KEY`, `SONARR_4K_URL`, `SONARR_4K_API_KEY` | Second instances for 4K |
| `TMDB_API_KEY` | Key from themoviedb.org |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram bot and the chat that receives the messages |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD` | Mailbox for sending; port 465 or 587 |
| `MAIL_FROM`, `MAIL_FROM_NAME` | Sender address and name |
| `PUBLIC_URL` | Address under which Blackbriar is reachable from outside |
| `TAUTULLI_URL`, `TAUTULLI_API_KEY`, `TRACEARR_URL`, `TRACEARR_API_KEY` | Only for the one-time import |
| `SYNC_INTERVAL_SECONDS` | Seconds between two syncs (default 300) |
| `AUTH` | `off` runs Blackbriar without sign-in. Only behind your own access protection, or as a way back in if you are locked out |
| `AUTH_RESET` | `1` removes the password account and all sign-ins at start, for example after a forgotten password. Your data stays. Remove it again afterwards |
| `TZ` | Time zone, used for the sending times of emails |

## If something does not work

- **The container keeps restarting.** Look at the log. If it says Blackbriar cannot write to its data folder, the folder does not belong to the user set with `user:`. The message names the `chown` command to fix it.
- **The setup code is not accepted.** It is in the container log and stays valid until the first sign-in has worked. After ten wrong attempts the field is locked for ten minutes; a restart lifts the lock.
- **No server is found after signing in.** You probably used a Plex account that does not own the server. Stop the container, empty the data folder and start again. Blackbriar starts from scratch, with a new setup code.
- **Forgot the password:** start the container once with `AUTH_RESET=1`. If Plex is connected, sign in with Plex and set a new password under Settings → General. Otherwise a new setup code is in the log.
- **You cannot get in anymore,** for example because plex.tv is unreachable. Set the environment variable `AUTH=off` for a moment, then Blackbriar runs without sign-in. Remove it again afterwards.
- **The old version still runs after a restart.** The image was not pulled again, see “Updating”.
- **Plex refuses to delete.** “Allow media deletion” is switched off in Plex, see “How it works”.

## Coming from Tautulli or Tracearr

Plex itself only keeps a plain history without duration, device or playback type. If you have used Tautulli or Tracearr, import their plays once under Settings → Import. If you have both, import the one that reaches back furthest. After the import Blackbriar records every play itself and the other tool is no longer needed for it.

## How it works

- **Ratings:** Plex stores ratings per account. Blackbriar asks plex.tv for the access token each shared user has for your server and reads that user's ratings with it. The tokens stay in memory and are never stored.
- **Watched:** a movie counts as watched once it appears in the history or is marked as watched, a series once all available episodes have been watched.
- **Watchlists:** come through Seerr, because only Seerr holds the plex.tv sign-ins of your users. They are read every 15 minutes.
- **Cleanup:** a title appears when it is on nobody's watchlist and everyone who requested it in Seerr has watched and rated it. If nobody else requested it, the owner's own watch status and rating apply. Without Seerr, Blackbriar knows neither requests nor watchlists. A title then only appears once you and everyone else who started it are done, and the list is a hint at best: whether someone still wants to watch a title, Blackbriar cannot tell.
- **Deleting:** Blackbriar first removes the title from Radarr or Sonarr, or stops monitoring single episodes, then lets Plex delete the files, then resets the title in Seerr. Every deletion is confirmed individually and logged. For Plex to delete, “Allow media deletion” must be switched on there under Settings → Library.
- **Emails:** sent through your own mailbox, encrypted only. Images are attached to the email itself. If a mail app lists them as attachments, you can let Blackbriar serve them instead; this needs the public address.
- **Timing:** sessions every few seconds; history and ratings every five minutes or at once through the webhook; watchlists every 15 minutes; library hourly; Radarr and Sonarr hourly or at once through their webhook.

## Privacy and security

Blackbriar runs entirely on your own hardware and sends nothing to its author. It talks only to the services you connect, to plex.tv and to TMDB. Email addresses come from the Plex accounts of your users and are used only for the emails you switch on.

Blackbriar holds your Plex token and the API keys of the connected services, and it can delete files if you allow it. Treat it like Radarr or Sonarr: do not put it on the internet without https, and keep sign-in switched on.

## Status

Blackbriar is a hobby project. I built it because the existing tools lacked features I needed for my own server. What the app should do and the rules it follows are the result of weeks of thinking and of daily use.

I am not a developer. The code was written by an AI assistant (Claude) to my specifications, and I tested every change on my own server. There is no warranty. Please keep that in mind before you allow deleting, and keep backups of anything you cannot replace.

Blackbriar was made for a single server; expect rough edges on setups that differ from it. Seerr is the tested request tool. Overseerr and Jellyseerr use the same interface but have not been tested.

Bug reports and suggestions are welcome as [issues](../../issues).

## Development

Needs Node.js 24.

```bash
npm install
```

```bash
npm run dev:server
```

```bash
npm run dev:web
```

The backend runs on port 8787, the interface with live reload on port 5173. Copy `.env.example` to `.env` first.

## License

[GPL-3.0](LICENSE)
