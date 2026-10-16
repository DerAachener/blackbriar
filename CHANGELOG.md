# Changelog

[Deutsche Fassung](CHANGELOG.de.md)

What changed in Blackbriar, newest version first.
Until the 1.0 release, the middle number counts new features and the last one counts fixes in between.

## bb.0.19.2 – 2026-10-16

- README: the example version tags now exist (`:0.19.1`, `:0.19`), with a link to all releases. The old examples pointed to tags that are gone.
- README: `docker run` uses `"$(pwd)/data:/data"`, which also works with Docker versions older than 23.
- `docker-compose.yml` in the repository matches the README example and has English comments.
- An error that nothing else catches is now written to the log instead of stopping the container.
- Local image builds leave out all `.env.*` files.

## bb.0.19.1 – 2026-10-16

- "Project page" in the sidebar and under Settings → Status now opens the repository on GitHub. The old project page is gone.
- The repository has a "Sponsor" button that leads to Buy Me a Coffee.

## bb.0.19.0 – 2026-10-16

- Coming up: new checkbox "Hide what is already on the server" for streaming and cinema, as already in "My topics". Only titles you do not have yet remain. The choice applies to all three and is remembered in the browser.

## bb.0.18.5 – 2026-10-16

- Settings → Plex, Radarr and Sonarr: "Create new key" replaces the key in the webhook addresses, for example when an address showed up on a screenshot. The old addresses stop working at once; the new ones have to be entered in Plex, Radarr and Sonarr.

## bb.0.18.4 – 2026-10-16

- Notices under "Keep an eye on" now always use the language set in Blackbriar. Before, they stayed in the language they were created in, even after switching. Older notices about release groups switch over at the next sync.
- The changelog is now bilingual: `CHANGELOG.md` in English, also used for the release notes on GitHub, and `CHANGELOG.de.md` in German.

## bb.0.18.3 – 2026-10-15

- Other websites can no longer send anything to Blackbriar. Before, a crafted page opened in the same browser could have triggered a delete in the background while you were signed in. Webhooks from Plex, Radarr and Sonarr are not affected.
- Security headers: Blackbriar can no longer be embedded in other pages, and the browser loads no scripts from elsewhere.

## bb.0.18.2 – 2026-10-15

- Settings → General: change the password and "Sign out on all other devices". After a password change, all other devices are signed out automatically.
- Forgot the password: start the container once with `AUTH_RESET=1`. This removes the password account and all sign-ins; your data stays. If Plex is connected, you then sign in with Plex; otherwise there is a new setup code.

## bb.0.18.1 – 2026-10-15

- If you set up Blackbriar with your own account, you now connect Plex under Settings → Plex with one button instead of looking up the token by hand. The Plex account that confirms there becomes the owner; after that, sign-in with Plex works too.

## bb.0.18.0 – 2026-10-15

- Own account with user name and password: after the setup code, a fresh installation can create an account instead of signing in with Plex. That way you get into Blackbriar before Plex is connected.
- If you already sign in with Plex, you can add an account with a password under Settings → General. Sign-in then also works when plex.tv is unreachable. Sign-in with Plex stays.
- After ten wrong passwords, sign-in is locked for ten minutes.

## bb.0.17.0 – 2026-10-13

- Webhook for Radarr and Sonarr: enter the address from Settings → Radarr or Sonarr there, and Blackbriar picks up changes at once, such as a replaced release, a new movie or a deleted file. Series notices, waiting list and disk space are then up to date within seconds instead of up to an hour.
- Without the webhook nothing changes: Blackbriar checks once an hour.

## bb.0.16.2 – 2026-10-12

- Info window: longer values such as a library name or "hevc and h264" no longer wrap onto two lines.

## bb.0.16.1 – 2026-10-12

- Info window, "On the server": the file details now have labels above them (library, size, episodes, resolution, video codec, bitrate, file format). If the episodes of a series differ, the values are listed, for example "hevc and h264"; only from four different values on does it say "mixed". The same applies in the library.
- Info window: below that is the path of the file, or for series the common folder of all episodes, with a button to copy it.

## bb.0.16.0 – 2026-10-12

- Trailers only in the language set in Blackbriar, no more teasers. If there is none, a note says so, with a link to the English trailer if one exists.
- If TMDB only has an English overview, a note says so. For titles on the server, the text from Plex comes first instead.
- Both also apply to the page behind "More about it" in the emails.

## bb.0.15.1 – 2026-10-12

- Series notices: mixed release groups are reported even on a tie, for example when the first two episodes of a season come from two groups. That way you can step in before more episodes arrive from the wrong group.

## bb.0.15.0 – 2026-10-12

- Info window: long overviews are shortened at first; "show more" expands them.
- Deleting watched episodes: if the series is still on a watchlist, the dialog warns about it, as it does for whole titles.

## bb.0.14.3 – 2026-10-12

- Fixed: after deleting many episodes, the dialog was taller than the screen and "Close" could not be reached. The dialog now always fits the screen and scrolls if needed.
- Deleted episodes get one line ("Deleted in Plex: 23 episodes") instead of one per episode, in the log as well.

## bb.0.14.2 – 2026-10-12

- A fresh installation takes the country for "Coming up" from the browser language. Preselected are the worldwide providers, now including HBO Max; in Germany, Austria and Switzerland also WOW, RTL+, Joyn Plus and Discovery+. If country and providers were already saved, the selection stays.
- Messages in the container log use the language set in Blackbriar; English before the first visit.
- The dashboard only reports "No warnings" once Plex is connected.

## bb.0.14.1 – 2026-10-12

- If Blackbriar cannot write to its data folder, it says so at startup with the command to fix it, instead of crashing. This mostly happens when `user:` is added later.
- Example YAML with the line for running without root.

## bb.0.14.0 – 2026-10-12

- Setup code: on the first sign-in, a fresh installation asks for a code that is printed in the container log. Only someone with access to the server can set it up, not whoever happens to find the address first.
- Existing installations are not affected. With `PLEX_TOKEN` as an environment variable or `AUTH=off`, there is no code.

## bb.0.13.2 – 2026-10-12

- Without Seerr, "Cleanup" is stricter: a title only appears once the owner and everyone else who started it have finished and rated it. Before, only the owner counted.
- A note above the list says that without Seerr, Blackbriar knows neither requests nor watchlists.
- Without Seerr, the "Requests in progress" tile and the line "on no watchlist" are gone.

## bb.0.13.1 – 2026-10-11

- Setup: picking the Plex server is now at the top of the page and searches by itself. Before, it was an inconspicuous button below the form.
- "Test connection" for Plex says when only the address is missing.

## bb.0.13.0 – 2026-10-11

- First start: a fresh installation takes the browser language, German or English. It can be changed as before under Settings → General.
- After the first sign-in with Plex you go straight to Settings → Plex to pick the server.
- The note "Plex is not connected yet" says what to do and links to the settings.
- On the first day, the dashboard no longer warns about a missing backup.

## bb.0.12.6 – 2026-10-11

- Dashboard: "Keep an eye on" now comes before "New in the last seven days". Without warnings it is a slim bar; below follows the block with newsletter and weekly review.
- Dashboard: with more than three series notices, the first three are shown and the rest can be expanded.

## bb.0.12.5 – 2026-10-11

- Reminder: intro and instructions depend on what is actually open. If a title is only still on the watchlist, the email no longer talks about a missing rating.

## bb.0.12.4 – 2026-10-11

- Reminder: the sentence about keeping a title is shorter and clear: "Want to watch something again? Whatever is on your watchlist stays on the server."

## bb.0.12.3 – 2026-10-11

- Reminder email with clearer texts: subject and heading name the server ("Still open on Name [Plex]"), and each title says what to do ("Please rate in Plex").
- The reminder now explains how a title stays on the server: whoever wants to watch it again keeps it on the watchlist or adds it again.
- The footer link is called "Unsubscribe from reminders".
- Request email shorter: "a title from your watchlist is now on Name [Plex]".

## bb.0.12.2 – 2026-10-10

- Fixed: if a series is in two libraries (1080p and 4K) and in two Sonarr instances, deleting one copy now only removes it from the matching instance, not from both.

## bb.0.12.1 – 2026-10-10

- Sidebar, bottom left: "Project page" as its own link, with "Version: …" below.
- Coming up: larger posters in the tiles.

## bb.0.12.0 – 2026-10-10

- Coming up: every tile has "Hide". The title then disappears from all sections and from "My topics". It can be shown again through "… titles hidden" at the top.
- The version number is at the bottom left of the sidebar; a click opens the project page. The link is also under Settings → Status.
- A click on the logo goes to the start page.

## bb.0.11.1 – 2026-10-10

- Emails: with "Load posters from Blackbriar" switched on, the logo and calendar week in the header are loaded too. The email then has no attachments at all.

## bb.0.11.0 – 2026-10-10

- Emails: new setting under Settings → Email, "Load posters from Blackbriar instead of attaching them". This removes the attachment list that some mail apps show below the email, and the email gets much smaller.
- The page behind "More about it" shows a poster from TMDB when Plex has none.

## bb.0.10.0 – 2026-10-10

- Newsletter: "Send sample" button. It sends everything from the last 7 days to one user, to try it out. The sample does not count as sent.

## bb.0.9.1 – 2026-10-09

- Newsletter: on phones there are now always two tiles side by side, even when the mail app leaves little room.

## bb.0.9.0 – 2026-10-09

- Blackbriar now has a version number. It is shown under Settings → Status, followed by the short code of the build.
- This changelog starts; earlier steps were added afterwards.

## bb.0.8.0 – 2026-10-09

- Newsletter: at most 10 tiles per section. Anything beyond that is listed below; each title leads to a page with overview and trailer.
- Emails: if Plex has no poster, it comes from TMDB.
- Newsletter: the ratings section only lists titles that are still on the server and that the recipient can open.

## bb.0.7.0 – 2026-10-09

- Coming up: streaming movies from the last 30 days at the selected providers.
- Coming up: choice of "Movies and series / Movies only / Series only" and the "Documentaries only" checkbox.
- Coming up: new section "My topics" with your own keywords, for example hospital and rescue.
- Coming up: tiles instead of rows, across the full width.
- Settings → TMDB: search in the provider list, so providers further down can be picked too.

## bb.0.6.0 – 2026-10-08

- History: deleted titles stay listed, marked as "no longer on the server".
- History: the top shows what actually played most recently.
- Ratings of deleted titles are kept.

## bb.0.5.0 – 2026-10-07

- Info window: a click on a title shows overview, file, seasons, people and plays.
- Libraries from Plex as a filter in the library view; single libraries can be excluded.
- "Marked as watched" in Plex counts.
- Users can be marked as "never rates"; "Cleanup" additionally shows "Watched but not rated".
- Emails follow the sharing settings in Plex: everyone only sees what they can open.
- Test message per user; the reminder can be sent again by hand.
- The Plex webhook rereads the library at once when a new title arrives.

## bb.0.4.0 – 2026-10-05

- Notices on the dashboard: season complete, episodes from different release groups.
- Deleting: warning for series that are still running.
- Own logo in the sidebar.

## bb.0.3.0 – 2026-10-04

- Dashboard as the start page, with the current sessions.
- Log: what Blackbriar did and when.
- Daily backup of the database.
- Instant email when a requested title has arrived.
- Disk space, inactive users and links to Radarr and Sonarr.

## bb.0.2.0 – 2026-10-03

- Email: your own mailbox, newsletter "New on the server" and a reminder about open ratings, adjustable per user.
- Custom names for users, briefing tone for the emails.
- Notice when Plex has probably matched a requested title wrongly.
- Deleting single episodes, kept in sync with Sonarr.

## bb.0.1.0 – 2026-10-02

- Foundation: current sessions, history and ratings of all users, with Telegram messages.
- Watchlists through Seerr, open ratings, "Cleanup", library, statistics and waiting list.
- Admin area for all connections; Radarr and Sonarr.
- Sign-in with Plex, deleting from within Blackbriar.
- One-time import from Tautulli and Tracearr.
- "Coming up": new releases in cinemas and at streaming providers, plus the calendar from Radarr and Sonarr.
- Interface for phone, tablet and large screens, in German and English.
