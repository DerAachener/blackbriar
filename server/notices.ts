import { arrInstance, arrLink, getSeriesFiles, rescanArr, unmonitorSeason, type SeriesFiles } from './arr.ts'
import { telegramConfigured, tmdbConfigured } from './config.ts'
import { db, getSetting, getSettings, now, setSetting } from './db.ts'
import { logEvent } from './events.ts'
import { t } from './i18n.ts'
import { fileList } from './media.ts'
import { plexDelete } from './plex.ts'
import { escapeHtml, sendTelegram } from './telegram.ts'
import { getSeasonPlan, type SeasonPlan } from './tmdb.ts'

// Hinweise für den Besitzer zu Serien, die gerade Folgen bekommen:
//  - Eine Staffel ist komplett und könnte in Sonarr auf „nicht beobachtet“.
//  - Eine neue Folge stammt von einer anderen Release-Gruppe als der Rest der Staffel.
//  - Eine Folge liegt in derselben Fassung doppelt vor (siehe „Doppelte Versionen“).
// Jeder Hinweis bleibt offen, bis der Besitzer ihn erledigt oder ausblendet.

db.exec(`CREATE TABLE IF NOT EXISTS notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,
  rating_key INTEGER NOT NULL,
  season     INTEGER NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  state      TEXT NOT NULL DEFAULT 'open'
)`)

// Seit bb.0.18.4: die Zahlen hinter dem Hinweis als JSON. Der Satz entsteht beim Anzeigen in der eingestellten Sprache;
// `detail` hält nur noch die Fassung von damals, für Hinweise ohne diese Angaben.
if (!db.prepare('PRAGMA table_info(notices)').all().some((c) => c.name === 'data')) {
  db.exec('ALTER TABLE notices ADD COLUMN data TEXT')
  // „Staffel komplett“ von früher: Die Folgenzahl steht im gespeicherten Satz
  for (const n of db.prepare("SELECT id, detail FROM notices WHERE kind = 'complete'").all()) {
    const total = Number(/\d+/.exec(String(n.detail))?.[0])
    if (total) db.prepare('UPDATE notices SET data = ? WHERE id = ?').run(JSON.stringify({ total }), n.id)
  }
}

type NoticeData = { total: number } | { groups: [string, number[]][]; main: string | null; count: number } | { versions: number } | { folders: string[] } | { episodes: number }

/** Der Satz zu einem Hinweis, in der gerade eingestellten Sprache. */
function noticeText(data: NoticeData): string {
  if ('total' in data) return t('Alle {n} Folgen sind da. Soll die Staffel in Sonarr auf „nicht beobachtet“?', { n: data.total })
  if ('versions' in data) return t('{n} Versionen derselben Fassung liegen nebeneinander.', { n: data.versions })
  if ('episodes' in data) return t(data.episodes === 1 ? 'Eine Folge liegt doppelt vor.' : '{n} Folgen liegen doppelt vor.', { n: data.episodes })
  if ('folders' in data) return t('Plex führt {n} Ordner als einen Film: {folders}.', { n: data.folders.length, folders: data.folders.join(', ') })
  const parts = data.groups.map(([group, episodes]) =>
    t(episodes.length === 1 ? 'Folge {episodes} ist von {group}' : 'Folgen {episodes} sind von {group}', { episodes: episodeList(episodes), group }),
  )
  return data.main ? `${parts.join('; ')}. ${t('Die übrigen {n} sind von {group}.', { n: data.count, group: data.main })}` : `${parts.join('; ')}. ${t('Eine Mehrheit gibt es noch nicht.')}`
}

function groupData(mix: { main: string | null; count: number; outliers: Outlier[] }): NoticeData {
  const byGroup = new Map<string, number[]>()
  for (const o of mix.outliers) byGroup.set(o.group, [...(byGroup.get(o.group) ?? []), o.episode])
  return { groups: [...byGroup], main: mix.main, count: mix.count }
}

// So weit zurück gelten Folgen als „gerade angekommen“
const WINDOW = 7 * 86400

interface Outlier {
  episode: number
  group: string
}

/**
 * Welche Folgen einer Staffel von einer anderen Release-Gruppe stammen als die meisten.
 * Bei Gleichstand gibt es keine Hauptgruppe (`main` ist null); dann stehen alle Folgen mit ihrer Gruppe da,
 * damit man eingreifen kann, bevor weitere Folgen von der falschen Gruppe kommen.
 */
export function groupOutliers(files: { episode: number; group: string }[], ignore: string): { main: string | null; count: number; outliers: Outlier[] } | null {
  // Ohne Gruppe oder mit dem eigenen Kennzeichen für umgewandelte Dateien sagt eine Datei nichts über ihre Herkunft
  const skip = ignore.replace(/^-/, '').toLowerCase()
  const known = files.filter((f) => f.group && f.group.toLowerCase() !== skip)
  if (known.length < 2) return null
  const counts = new Map<string, { name: string; n: number }>()
  for (const f of known) {
    const id = f.group.toLowerCase()
    const c = counts.get(id) ?? { name: f.group, n: 0 }
    c.n++
    counts.set(id, c)
  }
  const [main, second] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)
  // Ohne klare Mehrheit lässt sich nicht sagen, welche Folge abweicht: Dann werden alle genannt
  if (second && second[1].n === main![1].n) return { main: null, count: 0, outliers: [...known].sort((a, b) => a.episode - b.episode) }
  const outliers = known.filter((f) => f.group.toLowerCase() !== main![0]).sort((a, b) => a.episode - b.episode)
  return { main: main![1].name, count: main![1].n, outliers }
}

const episodeList = (episodes: number[]) => episodes.join(', ')

async function announce(html: string, thumb: string | null, silent: boolean): Promise<void> {
  if (silent || !telegramConfigured() || !getSettings().notifySeasons) return
  await sendTelegram(html, thumb).catch((err) => console.error(t('Hinweis nicht per Telegram verschickt:'), (err as Error).message))
}

/**
 * Ist die Staffel vollständig? Gezählt wird nach Sonarr, denn Sonarr nummeriert die Staffeln wie Plex; TMDB zählt manche
 * Serien anders (Staffel 1 dort ist Staffel 2 hier). TMDB bremst nur, wenn es die Staffel mindestens so groß kennt
 * und dort noch eine Folge angekündigt ist. Gibt die Zahl der Folgen zurück oder null.
 */
export function completeSeason(sonarr: SeriesFiles, season: number, onServer: number, plan: SeasonPlan | null): number | null {
  const episodes = sonarr.episodes.filter((e) => e.season === season && e.episode > 0)
  if (!episodes.length || episodes.some((e) => !e.hasFile)) return null
  // Ohne Sendedatum oder mit einem in der Zukunft kommt noch etwas
  if (episodes.some((e) => !e.airDate || Date.parse(e.airDate) > Date.now())) return null
  // Was Sonarr als vorhanden führt, muss auch in Plex liegen
  if (onServer < episodes.length) return null
  const tmdbCount = plan?.episodes.get(season) ?? 0
  if (plan && plan.airing === season && tmdbCount >= episodes.length) return null
  return episodes.length
}

interface SeasonCheck {
  rating_key: number
  season: number
  /** Folgen kamen gerade an: Ein Hinweis „Staffel komplett“ darf neu entstehen */
  fresh: boolean
  /** Release-Gruppen prüfen */
  groups: boolean
  /** Ohne Telegram-Nachricht */
  silent: boolean
}

/** Prüft die Serien, die zuletzt Folgen bekommen haben, und legt neue Hinweise an. Läuft im Abgleich mit. */
export async function checkSeasons(): Promise<void> {
  // Beim allerersten Lauf entstehen die Hinweise ohne Telegram-Nachricht: Was schon da ist, wäre sonst eine Flut
  const first = !getSetting('notices_started')
  // Seit bb.1.5.1 zählt Sonarr die Folgen. Einmal werden dafür alle Staffeln auf dem Server geprüft, still und ohne Release-Gruppen
  const catchUp = !getSetting('notices_sonarr_count')
  const marker = getSettings().convertedMarker
  const seasonsSince = db.prepare(
    `SELECT f.item_key AS rating_key, f.season FROM media_files f
     WHERE f.rating_key <> f.item_key AND f.season > 0 AND f.added_at > ?
     GROUP BY f.item_key, f.season`,
  )
  const seasons = new Map<string, SeasonCheck>()
  const add = (r: Record<string, unknown>, check: Omit<SeasonCheck, 'rating_key' | 'season'>) => {
    const key = `${r.rating_key}:${r.season}`
    if (!seasons.has(key)) seasons.set(key, { rating_key: r.rating_key as number, season: r.season as number, ...check })
  }
  for (const r of seasonsSince.all(now() - WINDOW)) add(r, { fresh: true, groups: true, silent: first })
  // Offene Hinweise werden mitgeprüft, damit sie verschwinden, sobald sie nicht mehr stimmen
  for (const r of db.prepare("SELECT rating_key, season FROM notices WHERE kind = 'groups' AND state = 'open'").all()) add(r, { fresh: false, groups: true, silent: true })
  for (const r of db.prepare("SELECT rating_key, season FROM notices WHERE kind = 'complete' AND state = 'open'").all()) add(r, { fresh: false, groups: false, silent: true })
  if (catchUp) for (const r of seasonsSince.all(0)) add(r, { fresh: true, groups: false, silent: true })

  const library = new Map(fileList().map((f) => [f.rating_key, f]))
  const tmdbOf = db.prepare('SELECT tmdb_id FROM library_items WHERE rating_key = ?')
  const onServer = db.prepare('SELECT COUNT(DISTINCT episode) AS n FROM media_files WHERE item_key = ? AND rating_key <> item_key AND season = ? AND episode > 0')
  const exists = db.prepare('SELECT state FROM notices WHERE key = ?')
  const insert = db.prepare('INSERT OR IGNORE INTO notices (key, kind, rating_key, season, title, detail, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  // Hinweise zu Release-Gruppen von vor bb.0.18.4 bekommen ihre Zahlen beim nächsten Durchlauf nachgetragen
  const fillData = db.prepare("UPDATE notices SET data = ? WHERE key = ? AND data IS NULL AND state = 'open'")
  const closeComplete = db.prepare("UPDATE notices SET state = 'done' WHERE kind = 'complete' AND rating_key = ? AND season = ? AND state = 'open'")
  const sonarrCache = new Map<number, SeriesFiles | null>()

  for (const s of seasons.values()) {
    const item = library.get(s.rating_key)
    // Ohne Sonarr gibt es weder Release-Gruppen noch etwas, das sich auf „nicht beobachtet“ stellen ließe
    const entry = item?.arr.find((a) => arrInstance(a.instance)?.app === 'sonarr')
    if (!item || !entry) {
      closeComplete.run(s.rating_key, s.season)
      continue
    }
    if (!sonarrCache.has(s.rating_key)) {
      sonarrCache.set(s.rating_key, await getSeriesFiles(arrInstance(entry.instance)!, entry.id).catch(() => null))
    }
    const sonarr = sonarrCache.get(s.rating_key)
    // Antwortet Sonarr nicht, bleibt alles, wie es ist
    if (!sonarr) continue
    const seasonName = t('Staffel {n}', { n: s.season })

    // Release-Gruppen
    if (s.groups) {
      const mix = groupOutliers(sonarr.files.filter((f) => f.season === s.season), marker)
      const groupKeyPrefix = `groups:${s.rating_key}:${s.season}:`
      if (mix?.outliers.length) {
        // Der Schlüssel enthält die abweichenden Folgen: Kommt eine weitere dazu, ist das ein neuer Hinweis
        const key = groupKeyPrefix + mix.outliers.map((o) => `${o.episode}=${o.group.toLowerCase()}`).join(',')
        const data = groupData(mix)
        if (exists.get(key)) fillData.run(JSON.stringify(data), key)
        else {
          const detail = noticeText(data)
          // Ältere Fassungen desselben Hinweises ablösen
          db.prepare("UPDATE notices SET state = 'done' WHERE kind = 'groups' AND rating_key = ? AND season = ? AND state = 'open'").run(s.rating_key, s.season)
          insert.run(key, 'groups', s.rating_key, s.season, item.title, detail, JSON.stringify(data), now())
          logEvent('sync', `${item.title} · ${seasonName}: ${detail}`, 'warn')
          await announce(`⚠️ <b>${escapeHtml(item.title)}</b> · ${escapeHtml(seasonName)}: ${escapeHtml(t('gemischte Release-Gruppen'))}\n${escapeHtml(detail)}`, item.thumb, s.silent)
        }
      } else {
        db.prepare("UPDATE notices SET state = 'done' WHERE kind = 'groups' AND rating_key = ? AND season = ? AND state = 'open'").run(s.rating_key, s.season)
      }
    }

    // Staffel komplett, solange Sonarr sie noch beobachtet
    const tmdbId = tmdbConfigured() ? (tmdbOf.get(s.rating_key)?.tmdb_id as number | null | undefined) : null
    const plan = tmdbId ? await getSeasonPlan(tmdbId).catch(() => null) : null
    const total = sonarr.seasons.get(s.season) === false ? null : completeSeason(sonarr, s.season, Number(onServer.get(s.rating_key, s.season)?.n ?? 0), plan)
    if (!total) {
      // Gelöschte Folgen, Staffel schon unbeobachtet o. Ä.: Ein offener Hinweis stimmt nicht mehr
      closeComplete.run(s.rating_key, s.season)
      continue
    }
    if (!s.fresh) continue
    const key = `complete:${s.rating_key}:${s.season}`
    if (exists.get(key)) continue
    const data: NoticeData = { total }
    insert.run(key, 'complete', s.rating_key, s.season, item.title, noticeText(data), JSON.stringify(data), now())
    logEvent('sync', t('{title} · {season} ist komplett', { title: item.title, season: seasonName }))
    await announce(
      `📦 <b>${escapeHtml(item.title)}</b> · ${escapeHtml(t('{season} ist komplett', { season: seasonName }))}\n${escapeHtml(t('In Blackbriar kannst du sie in Sonarr auf „nicht beobachtet“ setzen.'))}`,
      item.thumb,
      s.silent,
    )
  }
  if (first) setSetting('notices_started', String(now()))
  if (catchUp) setSetting('notices_sonarr_count', String(now()))
}

// ---------- Doppelte Versionen bei Filmen ----------

// 4K und alles darunter sind zwei Fassungen, die man bewusst nebeneinander hält; doppelt ist nur, was in derselben liegt
const quality = (resolution: string | null) => (String(resolution ?? '').toLowerCase() === '4k' ? '4k' : 'hd')

interface VersionRow {
  media_id: number
  rating_key: number
  file: string | null
  size: number
  video_codec: string | null
  audio_codec: string | null
  audio_channels: number | null
  resolution: string | null
}

/** Ordner einer Datei, so wie Plex den Pfad meldet (Windows oder Linux). */
const folderOf = (file: string | null) => String(file ?? '').replace(/[\\/][^\\/]*$/, '')
const folderName = (folder: string) => folder.split(/[\\/]/).pop() ?? folder
const episodeCode = (season: number | null, episode: number | null) => (season == null || episode == null ? '' : `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`)

interface FileGroup {
  rating_key: number
  title: string
  versions: VersionRow[]
}

/** Alle Dateien der Filme, die Plex mit mehr als einer Datei führt, je Film gesammelt. */
function multiFileMovies(): Map<number, FileGroup> {
  const rows = db
    .prepare(
      `SELECT v.media_id, v.rating_key, v.file, v.size, v.video_codec, v.audio_codec, v.audio_channels, v.resolution, i.title, i.year
       FROM media_versions v JOIN library_items i ON i.rating_key = v.rating_key WHERE i.type = 'movie' ORDER BY v.media_id`,
    )
    .all() as unknown as (VersionRow & { title: string; year: number | null })[]
  const movies = new Map<number, FileGroup>()
  for (const r of rows) {
    const m = movies.get(r.rating_key) ?? { rating_key: r.rating_key, title: r.year ? `${r.title} (${r.year})` : r.title, versions: [] }
    m.versions.push(r)
    movies.set(r.rating_key, m)
  }
  for (const [key, m] of movies) if (m.versions.length < 2) movies.delete(key)
  return movies
}

/**
 * Legt Hinweise zu Filmen mit mehreren Dateien an und erledigt die, die sich erledigt haben. Läuft nach dem Abgleich der Bibliothek.
 *  - Mehrere Dateien derselben Fassung (4K oder darunter) im selben Ordner: eine davon ist meist alt, etwa nach dem Umwandeln.
 *  - Dateien in verschiedenen Ordnern: Plex hat zwei Filme zu einem zusammengelegt. Hier wird nie etwas gelöscht.
 */
export function checkVersions(): void {
  const live = new Set<string>()
  const insert = db.prepare('INSERT OR IGNORE INTO notices (key, kind, rating_key, season, title, detail, data, created_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)')
  for (const m of multiFileMovies().values()) {
    const folders = [...new Set(m.versions.map((v) => folderOf(v.file)))]
    if (folders.length > 1) {
      const key = `merged:${m.rating_key}:${m.versions.map((v) => v.media_id).join(',')}`
      live.add(key)
      const data: NoticeData = { folders: folders.map(folderName) }
      if (insert.run(key, 'merged', m.rating_key, m.title, noticeText(data), JSON.stringify(data), now()).changes) {
        logEvent('sync', t('{title}: Plex führt {n} Ordner als einen Film', { title: m.title, n: folders.length }), 'warn')
      }
    }
    // Je Ordner und Fassung: Liegen dort mehrere Dateien, ist das ein Fall für „alte Version löschen“
    const groups = new Map<string, VersionRow[]>()
    for (const v of m.versions) {
      const id = `${folderOf(v.file)}\n${quality(v.resolution)}`
      groups.set(id, [...(groups.get(id) ?? []), v])
    }
    for (const [id, versions] of groups) {
      if (versions.length < 2) continue
      // Der Schlüssel enthält die Dateien: Kommt eine weitere dazu, ist das ein neuer Hinweis, auch wenn der alte ausgeblendet war
      const key = `versions:${m.rating_key}:${id.split('\n')[1]}:${versions.map((v) => v.media_id).join(',')}`
      live.add(key)
      const data: NoticeData = { versions: versions.length }
      if (insert.run(key, 'versions', m.rating_key, m.title, noticeText(data), JSON.stringify(data), now()).changes) {
        logEvent('sync', t('{title}: {n} Versionen derselben Fassung', { title: m.title, n: versions.length }))
      }
    }
  }
  checkEpisodeVersions(live)
  for (const n of db.prepare("SELECT id, key FROM notices WHERE kind IN ('versions', 'merged', 'episodes') AND state = 'open'").all()) {
    if (!live.has(String(n.key))) db.prepare("UPDATE notices SET state = 'done' WHERE id = ?").run(n.id)
  }
}

/**
 * Folgen, die in derselben Fassung (4K oder darunter) im selben Ordner mehr als einmal vorliegen, je Staffel zu einem Hinweis.
 * Liegen sie in verschiedenen Ordnern, ist das meist Absicht, etwa eine zweite Sonarr-Instanz für 4K; dann gibt es keinen Hinweis.
 */
function checkEpisodeVersions(live: Set<string>): void {
  const insert = db.prepare('INSERT OR IGNORE INTO notices (key, kind, rating_key, season, title, detail, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  const rows = db
    .prepare(
      `SELECT v.media_id, v.rating_key, v.file, v.size, v.video_codec, v.audio_codec, v.audio_channels, v.resolution, f.item_key, f.season, s.title, s.year
       FROM media_versions v
       JOIN media_files f ON f.rating_key = v.rating_key
       JOIN library_items s ON s.rating_key = f.item_key AND s.type = 'show'
       WHERE v.rating_key IN (SELECT rating_key FROM media_versions GROUP BY rating_key HAVING COUNT(*) > 1)
       ORDER BY v.media_id`,
    )
    .all() as unknown as (VersionRow & { item_key: number; season: number | null; title: string; year: number | null })[]
  // Staffel → Dateien, die zu einer doppelten Folge gehören
  const seasons = new Map<string, { item_key: number; season: number; title: string; ids: number[]; episodes: Set<number> }>()
  const groups = new Map<string, typeof rows>()
  for (const r of rows) {
    const id = `${r.rating_key}\n${folderOf(r.file)}\n${quality(r.resolution)}`
    groups.set(id, [...(groups.get(id) ?? []), r])
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const first = group[0]!
    const season = first.season ?? 0
    const id = `${first.item_key}:${season}`
    const entry = seasons.get(id) ?? { item_key: first.item_key, season, title: first.year ? `${first.title} (${first.year})` : first.title, ids: [], episodes: new Set<number>() }
    entry.ids.push(...group.map((v) => v.media_id))
    entry.episodes.add(first.rating_key)
    seasons.set(id, entry)
  }
  for (const entry of seasons.values()) {
    // Wie bei den Filmen steckt die Dateiliste im Schlüssel: Kommt eine Datei dazu, ist es ein neuer Hinweis
    const key = `episodes:${entry.item_key}:${entry.season}:${entry.ids.sort((a, b) => a - b).join(',')}`
    live.add(key)
    const data: NoticeData = { episodes: entry.episodes.size }
    if (insert.run(key, 'episodes', entry.item_key, entry.season, entry.title, noticeText(data), JSON.stringify(data), now()).changes) {
      logEvent('sync', t('{title}: {n} Folgen doppelt', { title: entry.title, n: entry.episodes.size }))
    }
  }
}

/** Die Dateien zu einem Hinweis (ihre Nummern stehen im Schlüssel), mit Kennzeichnung der umgewandelten. */
function versionsOf(key: string): (NoticeVersion & { folder: string })[] {
  const ids = (key.split(':').pop() ?? '').split(',').map(Number).filter(Boolean)
  const marker = getSettings().convertedMarker.trim().toLowerCase()
  const select = db.prepare('SELECT media_id, file, size, video_codec, audio_codec, audio_channels, resolution FROM media_versions WHERE media_id = ?')
  return ids
    .map((id) => select.get(id) as unknown as VersionRow | undefined)
    .filter((v): v is VersionRow => Boolean(v))
    .map((v) => describeVersion(v, marker))
}

function describeVersion(v: VersionRow, marker: string): NoticeVersion & { folder: string } {
  return {
    media_id: v.media_id,
    file: String(v.file ?? '').split(/[\\/]/).pop() ?? '',
    folder: folderName(folderOf(v.file)),
    size: v.size,
    video_codec: v.video_codec,
    audio_codec: v.audio_codec,
    audio_channels: v.audio_channels,
    resolution: v.resolution,
    converted: Boolean(marker) && String(v.file ?? '').toLowerCase().includes(marker),
  }
}

/** Die doppelten Folgen eines Hinweises (die Dateinummern stehen im Schlüssel), je Folge mit ihren Dateien. */
function episodesOf(key: string): NoticeEpisode[] {
  const ids = (key.split(':').pop() ?? '').split(',').map(Number).filter(Boolean)
  const marker = getSettings().convertedMarker.trim().toLowerCase()
  const select = db.prepare(
    `SELECT v.media_id, v.rating_key, v.file, v.size, v.video_codec, v.audio_codec, v.audio_channels, v.resolution, f.season, f.episode, f.title AS episode_title
     FROM media_versions v LEFT JOIN media_files f ON f.rating_key = v.rating_key WHERE v.media_id = ?`,
  )
  const episodes = new Map<number, NoticeEpisode>()
  for (const id of ids) {
    const v = select.get(id) as unknown as (VersionRow & { season: number | null; episode: number | null; episode_title: string | null }) | undefined
    if (!v) continue
    const entry = episodes.get(v.rating_key) ?? { rating_key: v.rating_key, season: v.season, episode: v.episode, title: v.episode_title, versions: [] }
    entry.versions.push(describeVersion(v, marker))
    episodes.set(v.rating_key, entry)
  }
  return [...episodes.values()].sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
}

/**
 * Löscht eine Version eines Films oder einer Folge in Plex. Die letzte Version bleibt immer. Danach liest Radarr bzw. Sonarr
 * den Titel neu ein, damit es die verbliebene Datei übernimmt, statt ihn als fehlend zu führen und neu zu laden.
 */
export async function deleteVersion(noticeId: number, mediaId: number, user: string): Promise<string> {
  if (!getSettings().allowDelete) throw new Error(t('Das Löschen ist in den Einstellungen nicht erlaubt.'))
  const notice = db.prepare("SELECT key, kind, rating_key, title FROM notices WHERE id = ? AND kind IN ('versions', 'episodes') AND state = 'open'").get(noticeId)
  if (!notice) throw new Error(t('Diesen Hinweis gibt es nicht mehr.'))
  const isEpisodes = notice.kind === 'episodes'
  const ratingKey = notice.rating_key as number
  // Je Datei die Nummer, unter der Plex die Folge bzw. den Film führt; „die letzte bleibt“ gilt je Folge
  const all = isEpisodes
    ? episodesOf(String(notice.key)).flatMap((e) => e.versions.map((v) => ({ ...v, owner: e.rating_key, label: episodeCode(e.season, e.episode) })))
    : versionsOf(String(notice.key)).map((v) => ({ ...v, owner: ratingKey, label: '' }))
  const version = all.find((v) => v.media_id === mediaId)
  if (!version) throw new Error(t('Diese Version gibt es nicht mehr.'))
  const same = all.filter((v) => v.owner === version.owner)
  if (same.length < 2) throw new Error(t('Die letzte Version bleibt.'))
  // Zweite Sicherung: Dateien in verschiedenen Ordnern sind verschiedene Filme, keine Versionen
  if (new Set(same.map((v) => v.folder)).size > 1) throw new Error(t('Die Dateien liegen in verschiedenen Ordnern. Das sind verschiedene Filme; bitte in Plex aufteilen.'))
  const title = [notice.title as string, version.label].filter(Boolean).join(' ')
  try {
    await plexDelete(`/library/metadata/${version.owner}/media/${mediaId}`)
  } catch (err) {
    logEvent('delete', `${title} · ${version.file} · ${user}: ${(err as Error).message}`, 'error')
    throw err
  }
  db.prepare('DELETE FROM media_versions WHERE media_id = ?').run(mediaId)
  const steps = [t('In Plex gelöscht: {file}', { file: version.file })]
  const item = fileList().find((f) => f.rating_key === ratingKey)
  for (const entry of (item?.arr ?? []).filter((a) => arrInstance(a.instance)?.app === (isEpisodes ? 'sonarr' : 'radarr'))) {
    try {
      await rescanArr(arrInstance(entry.instance)!, entry.id)
      steps.push(t(isEpisodes ? '{name} liest die Serie neu ein' : '{name} liest den Film neu ein', { name: entry.name }))
    } catch (err) {
      steps.push(t('{name} nicht erreicht: {detail}', { name: entry.name, detail: (err as Error).message }))
    }
  }
  checkVersions()
  logEvent('delete', `${title} · ${t('alte Version')} · ${user}: ${steps.join(' · ')}`)
  return steps.join(' · ')
}

export interface NoticeVersion {
  media_id: number
  file: string
  size: number
  video_codec: string | null
  audio_codec: string | null
  audio_channels: number | null
  resolution: string | null
  /** Trägt das Kennzeichen für umgewandelte Dateien */
  converted: boolean
  /** Name des Ordners, in dem die Datei liegt */
  folder: string
}

export interface NoticeEpisode {
  rating_key: number
  season: number | null
  episode: number | null
  title: string | null
  versions: NoticeVersion[]
}

export interface Notice {
  id: number
  kind: 'complete' | 'groups' | 'versions' | 'merged' | 'episodes'
  rating_key: number
  season: number
  title: string
  detail: string
  created_at: number
  thumb: string | null
  /** Adresse der Serie in Sonarr bzw. des Films in Radarr, falls er dort steht */
  url: string | null
  /** Nur bei doppelten Versionen: die Dateien, und ob das Löschen erlaubt ist */
  versions?: NoticeVersion[]
  /** Nur bei doppelten Folgen: die Folgen mit ihren Dateien */
  episodes?: NoticeEpisode[]
  canDelete?: boolean
}

export function openNotices(): Notice[] {
  const library = new Map(fileList().map((f) => [f.rating_key, f]))
  return db
    .prepare("SELECT id, key, kind, rating_key, season, title, detail, data, created_at FROM notices WHERE state = 'open' ORDER BY id DESC")
    .all()
    .map((n) => {
      const item = library.get(n.rating_key as number)
      const entry = item?.arr.find((a) => arrInstance(a.instance)?.app === (n.kind === 'versions' || n.kind === 'merged' ? 'radarr' : 'sonarr'))
      const slug = entry ? (db.prepare('SELECT slug FROM arr_titles WHERE instance = ? AND id = ?').get(entry.instance, entry.id)?.slug as string | null) : null
      const { data, key, ...rest } = n as unknown as Notice & { data: string | null; key: string }
      const detail = data ? noticeText(JSON.parse(data) as NoticeData) : rest.detail
      const base = { ...rest, detail, thumb: item?.thumb ?? null, url: entry ? arrLink(arrInstance(entry.instance)!, { slug }) : null }
      if (rest.kind === 'versions') return { ...base, versions: versionsOf(key), canDelete: getSettings().allowDelete }
      if (rest.kind === 'episodes') return { ...base, episodes: episodesOf(key), canDelete: getSettings().allowDelete }
      if (rest.kind === 'merged') return { ...base, versions: versionsOf(key), canDelete: false }
      return base
    })
}

/** Blendet einen Hinweis aus, ohne etwas zu ändern. */
export function dismissNotice(id: number): void {
  db.prepare("UPDATE notices SET state = 'ignored' WHERE id = ?").run(id)
}

/**
 * Stellt die Staffeln aller offenen Hinweise „Staffel komplett“ auf „nicht beobachtet“. Je Serie ein Durchgang für alle
 * ihre Staffeln. Veraltete Hinweise werden nur erledigt; was Sonarr ablehnt, bleibt als Hinweis offen.
 */
export async function unmonitorAllNotices(user: string): Promise<string> {
  const notices = db.prepare("SELECT id, rating_key, season, title FROM notices WHERE kind = 'complete' AND state = 'open'").all()
  const library = new Map(fileList().map((f) => [f.rating_key, f]))
  const bySeries = new Map<number, typeof notices>()
  for (const n of notices) bySeries.set(n.rating_key as number, [...(bySeries.get(n.rating_key as number) ?? []), n])
  const done = db.prepare("UPDATE notices SET state = 'done' WHERE id = ?")
  let seasons = 0
  let stale = 0
  const failed: string[] = []
  for (const [ratingKey, list] of bySeries) {
    const entries = (library.get(ratingKey)?.arr ?? []).filter((a) => arrInstance(a.instance)?.app === 'sonarr')
    if (!entries.length) {
      for (const n of list) done.run(n.id)
      stale += list.length
      continue
    }
    try {
      for (const entry of entries) await unmonitorSeason(arrInstance(entry.instance)!, entry.id, list.map((n) => n.season as number))
      for (const n of list) done.run(n.id)
      seasons += list.length
    } catch (err) {
      failed.push(`${list[0]!.title}: ${(err as Error).message}`)
    }
  }
  const parts = [t('{n} Staffeln stehen in Sonarr auf „nicht beobachtet“', { n: seasons })]
  if (stale) parts.push(t('{n} veraltete Hinweise erledigt', { n: stale }))
  if (failed.length) parts.push(t('nicht geklappt: {list}', { list: failed.join('; ') }))
  const message = parts.join(' · ')
  logEvent('settings', `${message} · ${user}`, failed.length ? 'warn' : 'info')
  return message
}

/** Stellt die Staffel eines Hinweises in allen Sonarr-Instanzen auf „nicht beobachtet“ und erledigt ihn damit. */
export async function unmonitorNotice(id: number): Promise<string> {
  const notice = db.prepare("SELECT kind, rating_key, season, title FROM notices WHERE id = ? AND state = 'open'").get(id)
  if (!notice) throw new Error(t('Diesen Hinweis gibt es nicht mehr.'))
  const item = fileList().find((f) => f.rating_key === notice.rating_key)
  const entries = (item?.arr ?? []).filter((a) => arrInstance(a.instance)?.app === 'sonarr')
  // Ein veralteter Hinweis: Er wird erledigt, und die Meldung sagt, woran es lag
  if (!item || !entries.length) {
    db.prepare("UPDATE notices SET state = 'done' WHERE id = ?").run(id)
    throw new Error(item ? t('Die Serie steht nicht in Sonarr. Der Hinweis ist erledigt.') : t('Die Serie ist nicht mehr in Plex. Der Hinweis ist erledigt.'))
  }
  for (const entry of entries) await unmonitorSeason(arrInstance(entry.instance)!, entry.id, notice.season as number)
  db.prepare("UPDATE notices SET state = 'done' WHERE id = ?").run(id)
  const message = t('{title} · Staffel {n} steht in {where} auf „nicht beobachtet“', { title: notice.title as string, n: notice.season as number, where: entries.map((e) => e.name).join(', ') })
  logEvent('settings', message)
  return message
}
