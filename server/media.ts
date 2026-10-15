import { arrInstance } from './arr.ts'
import { seerrConfigured } from './config.ts'
import { db, getSettings, now, sectionFilter, titleSummaries, type TitlePerson } from './db.ts'
import { t } from './i18n.ts'

export interface MediaStats {
  /** Bytes über alle Dateien des Films bzw. alle Folgen der Serie */
  size: number
  files: number
  /** Dateien, deren Pfad das Kennzeichen für umgewandelte Dateien enthält */
  converted: number
  video_codec: string | null
  audio_codec: string | null
  resolution: string | null
  /** kbit/s, bei Serien der Durchschnitt */
  bitrate: number | null
  container: string | null
}

/** Dateiangaben pro Film bzw. Serie. Haben die Folgen einer Serie verschiedene Werte, stehen dort alle, durch Komma getrennt. */
export function mediaStats(): Map<number, MediaStats> {
  const marker = getSettings().convertedMarker.trim().toLowerCase()
  const mixed = (column: string) => `GROUP_CONCAT(DISTINCT ${column}) AS ${column}`
  const rows = db
    .prepare(
      `SELECT item_key, SUM(size) AS size, COUNT(*) AS files,
         SUM(CASE WHEN ? <> '' AND instr(lower(file), ?) > 0 THEN 1 ELSE 0 END) AS converted,
         ${mixed('video_codec')}, ${mixed('audio_codec')}, ${mixed('resolution')}, ${mixed('container')},
         CAST(AVG(bitrate) AS INTEGER) AS bitrate
       FROM media_files GROUP BY item_key`,
    )
    .all(marker, marker)
  const stats = new Map<number, MediaStats>()
  for (const { item_key, ...rest } of rows) stats.set(item_key as number, rest as unknown as MediaStats)
  return stats
}

export interface FileItem extends MediaStats {
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  section: string | null
  /** Dateiname, nur bei Filmen */
  file: string | null
  /** Wie oft Plex diesen Titel bei der Wiedergabe umrechnen musste */
  transcodes: number
  last_transcode: Record<string, unknown> | null
  /** Einträge in Radarr bzw. Sonarr, in denen der Titel noch verwaltet wird; leer, wenn in keiner Instanz */
  arr: { instance: string; id: number; name: string; status: string | null; monitored: boolean; next_airing: number | null }[]
}

export function fileList(): FileItem[] {
  const stats = mediaStats()

  // Tautulli und Tracearr kennen die Vergangenheit, die eigene Erfassung die Einzelheiten; es zählt der höchste Wert
  const counts = new Map<number, number>()
  const count = (key: number, n: number) => counts.set(key, Math.max(counts.get(key) ?? 0, n))
  for (const r of db.prepare('SELECT item_key, COUNT(*) AS n FROM transcodes GROUP BY item_key').all()) {
    count(r.item_key as number, r.n as number)
  }
  for (const table of ['plays', 'tracearr_plays']) {
    for (const r of db
      .prepare(`SELECT COALESCE(show_key, rating_key) AS item_key, COUNT(*) AS n FROM ${table} WHERE decision = 'transcode' GROUP BY 1`)
      .all()) {
      if (r.item_key != null) count(r.item_key as number, r.n as number)
    }
  }
  const last = new Map<number, Record<string, unknown>>()
  for (const r of db
    // Der Name von damals steht in der Zeile; angezeigt wird der heutige
    .prepare('SELECT t.*, COALESCE(u.name, t.user_name) AS user_name FROM transcodes t LEFT JOIN users u ON u.id = t.user_id ORDER BY t.at')
    .all()) last.set(r.item_key as number, r)

  const names = new Map<number, string>()
  for (const r of db.prepare('SELECT rating_key, file FROM media_files WHERE rating_key = item_key').all()) {
    if (r.file) names.set(r.rating_key as number, String(r.file).split(/[\\/]/).pop()!)
  }

  // Filme hängen über die TMDB-ID an Radarr, Serien über die TVDB-ID (ersatzweise TMDB) an Sonarr.
  // Ein Titel kann in mehreren Instanzen stehen, etwa in 1080p und in 4K.
  const arrItems = db.prepare('SELECT instance, id, tmdb_id, tvdb_id, status, monitored, next_airing, file FROM arr_titles').all()
  const library = db.prepare('SELECT rating_key, type, title, year, thumb, section, tmdb_id, tvdb_id FROM library_items').all()

  // Liegt ein Film mehrfach in der Bibliothek (z. B. in 1080p und in 4K), gehört ein Radarr-Eintrag nur zu
  // einer der Kopien: zu der mit demselben Dateinamen, sonst zu der mit der passenden Auflösung.
  const is4k = (key: unknown) => stats.get(key as number)?.resolution === '4k'
  const fileName = (key: unknown) => names.get(key as number)?.toLowerCase()
  const belongsToCopy = (a: Record<string, unknown>, l: Record<string, unknown>) => {
    const copies = library.filter((x) => x.type === 'movie' && x.tmdb_id === l.tmdb_id)
    if (copies.length < 2) return true
    const file = a.file ? String(a.file).toLowerCase() : null
    if (file && copies.some((c) => fileName(c.rating_key) === file)) return fileName(l.rating_key) === file
    const wants4k = String(a.instance).endsWith('4k')
    return copies.some((c) => is4k(c.rating_key) === wants4k) ? is4k(l.rating_key) === wants4k : true
  }

  // Dasselbe bei Serien, die in zwei Mediatheken liegen, etwa in 1080p und in 4K, und in zwei Sonarr-Instanzen stehen.
  // Dateinamen kennt Blackbriar von Sonarr nicht; als 4K-Kopie gilt die, deren Folgen überwiegend in 4K vorliegen.
  // Ohne diese Zuordnung trüge das Löschen der einen Kopie die Serie aus beiden Instanzen aus.
  const share4k = new Map<number, boolean>()
  for (const r of db.prepare("SELECT item_key, COUNT(*) AS total, SUM(resolution = '4k') AS uhd FROM media_files WHERE rating_key <> item_key GROUP BY item_key").all()) {
    share4k.set(r.item_key as number, Number(r.uhd ?? 0) * 2 > Number(r.total))
  }
  const show4k = (key: unknown) => share4k.get(key as number) ?? false
  const sameShow = (x: Record<string, unknown>, l: Record<string, unknown>) =>
    x.type === 'show' && ((l.tvdb_id != null && x.tvdb_id === l.tvdb_id) || (l.tmdb_id != null && x.tmdb_id === l.tmdb_id))
  const showBelongsToCopy = (a: Record<string, unknown>, l: Record<string, unknown>) => {
    const copies = library.filter((x) => sameShow(x, l))
    if (copies.length < 2) return true
    const wants4k = String(a.instance).endsWith('4k')
    return copies.some((c) => show4k(c.rating_key) === wants4k) ? show4k(l.rating_key) === wants4k : true
  }

  const arrOf = (l: Record<string, unknown>): FileItem['arr'] =>
    arrItems
      .filter((a) => {
        const instance = arrInstance(a.instance as string)
        if (!instance || instance.app !== (l.type === 'movie' ? 'radarr' : 'sonarr')) return false
        const sameTmdb = a.tmdb_id != null && a.tmdb_id === l.tmdb_id
        if (l.type === 'movie') return sameTmdb && belongsToCopy(a, l)
        return (sameTmdb || (a.tvdb_id != null && a.tvdb_id === l.tvdb_id)) && showBelongsToCopy(a, l)
      })
      .map((a) => ({
        instance: a.instance as string,
        id: a.id as number,
        name: arrInstance(a.instance as string)!.name,
        status: a.status as string | null,
        monitored: Boolean(a.monitored),
        next_airing: a.next_airing as number | null,
      }))

  const empty: MediaStats = { size: 0, files: 0, converted: 0, video_codec: null, audio_codec: null, resolution: null, bitrate: null, container: null }
  return library.map((l) => {
      const key = l.rating_key as number
      const { tmdb_id: _tmdb, tvdb_id: _tvdb, ...item } = l
      return {
        ...(item as unknown as Pick<FileItem, 'rating_key' | 'type' | 'title' | 'year' | 'thumb' | 'section'>),
        arr: arrOf(l),
        ...(stats.get(key) ?? empty),
        file: names.get(key) ?? null,
        transcodes: counts.get(key) ?? 0,
        last_transcode: last.get(key) ?? null,
      }
  })
}

export interface RequestState {
  label: string
  /** Fortschritt eines laufenden Downloads, 0 bis 1 */
  progress: number | null
}

/** Stand der Seerr-Anfragen pro Titel, Schlüssel "typ:tmdbId". */
export function requestStates(): Map<string, RequestState> {
  const byTitle = new Map<string, Record<string, unknown>[]>()
  for (const r of db.prepare('SELECT type, tmdb_id, status, media_status, progress FROM requests').all()) {
    const key = `${r.type}:${r.tmdb_id}`
    byTitle.set(key, [...(byTitle.get(key) ?? []), r])
  }
  const states = new Map<string, RequestState>()
  for (const [key, list] of byTitle) {
    const progress = list.reduce<number | null>((max, r) => (r.progress == null ? max : Math.max(max ?? 0, r.progress as number)), null)
    let label: string
    if (list.some((r) => r.status === 1)) label = t('wartet auf Freigabe')
    else if (list.every((r) => r.status === 3)) label = t('abgelehnt')
    else if (progress != null) label = t('lädt, {n} %', { n: Math.round(progress * 100) })
    else if (list.some((r) => r.media_status === 4 || r.media_status === 5)) label = t('laut Seerr verfügbar')
    // Ein Titel kann mehrere Anfragen haben, etwa in HD und in 4K. Gelöscht gilt er nur, wenn keine davon noch läuft:
    // Eine gelöschte 4K-Fassung darf die offene HD-Anfrage nicht überdecken.
    else if (list.filter((r) => r.status !== 3).every((r) => r.media_status === 7)) label = t('wurde gelöscht')
    else if (list.some((r) => r.status === 4)) label = t('fehlgeschlagen')
    else label = t('genehmigt, noch nicht geladen')
    states.set(key, { label, progress })
  }
  return states
}

export interface CleanupPerson extends TitlePerson {
  requested: boolean
  on_watchlist: boolean
  /** Film gesehen oder alle vorhandenen Folgen gesehen */
  seen: boolean
  /** Fertig gesehen und bewertet; bei Leuten, die nie bewerten, reicht das Ansehen */
  done: boolean
}

/**
 * Serien, die laut Sonarr noch laufen, mit dem Termin der nächsten Folge, falls bekannt.
 * Wer so eine Serie löscht, sollte wissen, dass noch Folgen kommen.
 */
export function airingShows(): Map<number, { next: number | null }> {
  const shows = new Map<number, { next: number | null }>()
  for (const f of fileList()) {
    if (f.type !== 'show') continue
    const running = f.arr.filter((a) => a.status != null && a.status !== 'ended')
    if (!running.length) continue
    const dates = running.map((a) => a.next_airing).filter((n): n is number => n != null)
    shows.set(f.rating_key, { next: dates.length ? Math.min(...dates) : null })
  }
  return shows
}

export interface CleanupItem {
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  size: number
  files: number
  /**
   * 'requesters': alle, die es angefragt haben, sind fertig. 'owner': niemand sonst hat es angefragt, der Besitzer ist fertig.
   * 'unrated': alle haben es zu Ende gesehen, aber nicht alle bewertet, und die Wartezeit ist um.
   */
  reason: 'requesters' | 'owner' | 'unrated'
  people: CleanupPerson[]
  /** Namen der Radarr- bzw. Sonarr-Instanzen, in denen der Titel noch steht */
  arr: string[]
}

export interface EpisodeCleanupSeason {
  season: number
  /** Vom Besitzer gesehene Folgen, die noch auf der Platte liegen */
  watched: number
  /** Alle Folgen der Staffel, die noch auf der Platte liegen */
  total: number
  size: number
  /** ratingKeys der gesehenen Folgen */
  keys: number[]
}

export interface EpisodeCleanupItem {
  rating_key: number
  title: string
  year: number | null
  thumb: string | null
  episodes: number
  size: number
  seasons: EpisodeCleanupSeason[]
  arr: string[]
  /** Wer die Serie noch auf der Merkliste hat; nach den Regeln oben kann das nur der Besitzer selbst sein */
  watchlist: string[]
}

// Wer in den letzten 30 Tagen an einer Serie weitergeschaut hat, schaut sie vermutlich noch
const ACTIVE_VIEWER_SECONDS = 30 * 86400

/** Pro Bibliothekstitel, wer ihn angefragt oder auf der Merkliste hat und wie weit jeder ist. */
function cleanupContext() {
  const users = new Map<number, { name: string; owner: boolean; neverRates: boolean }>()
  for (const u of db.prepare('SELECT id, name, is_owner, never_rates FROM users WHERE active = 1').all()) {
    users.set(u.id as number, { name: u.name as string, owner: Boolean(u.is_owner), neverRates: Boolean(u.never_rates) })
  }
  const collect = (sql: string) => {
    const map = new Map<string, Set<number>>()
    for (const r of db.prepare(sql).all()) {
      if (!users.has(r.user_id as number)) continue
      const key = `${r.type}:${r.tmdb_id}`
      map.set(key, (map.get(key) ?? new Set()).add(r.user_id as number))
    }
    return map
  }
  const requesters = collect('SELECT type, tmdb_id, user_id FROM requests WHERE user_id IS NOT NULL AND status <> 3')
  const wishers = collect('SELECT type, tmdb_id, user_id FROM watchlist')
  const summaries = new Map(titleSummaries().map((t) => [t.rating_key, t]))
  const files = new Map(fileList().map((f) => [f.rating_key, f]))

  return db
    .prepare(`SELECT rating_key, type, title, year, thumb, leaf_count, tmdb_id FROM library_items l WHERE ${sectionFilter()}`)
    .all()
    .map((l) => {
      const key = `${l.type}:${l.tmdb_id}`
      const requested = requesters.get(key) ?? new Set<number>()
      const wished = wishers.get(key) ?? new Set<number>()
      const activity = summaries.get(l.rating_key as number)?.people ?? []
      const leaf = l.leaf_count as number
      const finished = (p: TitlePerson) => (l.type === 'show' ? leaf > 0 && (p.watched ?? 0) >= leaf : p.seen_at != null)

      const ids = new Set([...requested, ...wished, ...activity.filter((p) => users.has(p.user_id)).map((p) => p.user_id)])
      const people = [...ids].map((id): CleanupPerson => {
        const p = activity.find((x) => x.user_id === id) ?? { user_id: id, name: users.get(id)!.name, seen_at: null, watched: null, rating: null }
        const seen = finished(p)
        return { ...p, requested: requested.has(id), on_watchlist: wished.has(id), seen, done: seen && (p.rating != null || users.get(id)!.neverRates) }
      })
      const others = people.filter((p) => !users.get(p.user_id)!.owner)
      const file = files.get(l.rating_key as number)
      return {
        item: {
          rating_key: l.rating_key as number,
          type: l.type as string,
          title: l.title as string,
          year: l.year as number | null,
          thumb: l.thumb as string | null,
        },
        size: file?.size ?? 0,
        files: file?.files ?? 0,
        arr: (file?.arr ?? []).map((a) => a.name),
        people,
        others,
        owner: people.find((p) => users.get(p.user_id)!.owner),
        stillWatching: others.some(
          (p) => l.type === 'show' && !finished(p) && (p.watched ?? 0) > 0 && (p.seen_at ?? 0) > now() - ACTIVE_VIEWER_SECONDS,
        ),
      }
    })
}

/**
 * Titel, die vom Server können: Sie stehen bei niemandem mehr auf der Merkliste, und alle anderen,
 * die sie angefragt haben, haben sie gesehen und bewertet. Hat sie sonst niemand angefragt, muss der
 * Besitzer sie gesehen und bewertet haben.
 *
 * Wer nie bewertet, hält sonst alles auf: Haben alle den Titel zu Ende gesehen, aber nicht alle bewertet, erscheint er
 * nach der eingestellten Wartezeit mit dem Grund 'unrated'. Bis dahin haben die Erinnerungen Zeit zu wirken.
 */
export function cleanupCandidates(): CleanupItem[] {
  const items: CleanupItem[] = []
  const waited = now() - getSettings().cleanupWaitDays * 86400
  const noSeerr = !seerrConfigured()
  for (const c of cleanupContext()) {
    // Solange der Titel bei irgendwem auf der Merkliste steht, bleibt er
    if (c.people.some((p) => p.on_watchlist) || c.stillWatching) continue
    const requesting = c.others.filter((p) => p.requested)
    // Auf wen es ankommt: alle, die angefragt haben, sonst der Besitzer.
    // Ohne Seerr sind Wünsche und Merklisten unbekannt; dann zählt neben dem Besitzer jeder, der den Titel angefangen hat.
    const started = c.people.filter((p) => p !== c.owner && (p.seen_at != null || (p.watched ?? 0) > 0))
    const relevant = noSeerr ? (c.owner ? [c.owner, ...started] : []) : requesting.length ? requesting : c.owner ? [c.owner] : []
    const othersCount = noSeerr ? relevant.filter((p) => p !== c.owner).length : requesting.length
    let reason: CleanupItem['reason'] | null = null
    if (!relevant.length) reason = null
    else if (relevant.every((p) => p.done)) reason = othersCount ? 'requesters' : 'owner'
    else if (relevant.every((p) => p.seen && (p.done || (p.seen_at ?? Infinity) <= waited))) reason = 'unrated'
    if (reason) items.push({ ...c.item, size: c.size, files: c.files, reason, people: c.people, arr: c.arr })
  }
  return items.sort((a, b) => b.size - a.size)
}

/**
 * Serien, von denen der Besitzer einzelne Folgen gesehen hat, die noch auf der Platte liegen.
 * Nur solche, die sonst niemand angefragt hat, auf der Merkliste führt oder gerade schaut,
 * und die nicht schon als Ganzes unter den Löschkandidaten stehen.
 */
export function episodeCleanup(): EpisodeCleanupItem[] {
  const whole = new Set(cleanupCandidates().filter((c) => c.reason !== 'unrated').map((c) => c.rating_key))
  const episodes = db.prepare(
    'SELECT rating_key, season, size, owner_watched FROM media_files WHERE item_key = ? AND rating_key <> item_key ORDER BY season, episode',
  )
  const items: EpisodeCleanupItem[] = []
  for (const c of cleanupContext()) {
    if (c.item.type !== 'show' || whole.has(c.item.rating_key) || c.stillWatching) continue
    if (c.others.some((p) => p.requested || p.on_watchlist)) continue

    const seasons = new Map<number, EpisodeCleanupSeason>()
    for (const e of episodes.all(c.item.rating_key)) {
      const number = (e.season as number | null) ?? 0
      const season = seasons.get(number) ?? { season: number, watched: 0, total: 0, size: 0, keys: [] }
      season.total++
      if (e.owner_watched) {
        season.watched++
        season.size += e.size as number
        season.keys.push(e.rating_key as number)
      }
      seasons.set(number, season)
    }
    const watched = [...seasons.values()].filter((s) => s.watched > 0)
    if (!watched.length) continue
    items.push({
      rating_key: c.item.rating_key,
      title: c.item.title,
      year: c.item.year,
      thumb: c.item.thumb,
      episodes: watched.reduce((n, s) => n + s.watched, 0),
      size: watched.reduce((n, s) => n + s.size, 0),
      seasons: watched,
      arr: c.arr,
      watchlist: c.people.filter((p) => p.on_watchlist).map((p) => p.name),
    })
  }
  return items.sort((a, b) => b.size - a.size)
}

export interface NotInPlexItem {
  type: 'movie' | 'show'
  title: string
  year: number | null
  poster: string | null
  /** 'continuing', 'ended' oder 'upcoming' bei Serien */
  status: string | null
  next_airing: number | null
  /** Dateien auf der Platte, über alle Instanzen zusammengezählt */
  files: number
  total: number
  size: number
  /** In mindestens einer Instanz wird noch gesucht und geladen */
  monitored: boolean
  instances: { instance: string; name: string; monitored: boolean; files: number }[]
}

/** Was Radarr und Sonarr verwalten, aber nicht in der Plex-Bibliothek liegt. Ein Titel in mehreren Instanzen ergibt eine Zeile. */
export function notInPlex(): NotInPlexItem[] {
  const library = db.prepare('SELECT type, tmdb_id, tvdb_id FROM library_items').all()
  const inPlex = (type: string, tmdb: unknown, tvdb: unknown) =>
    library.some((l) => l.type === type && ((tmdb != null && l.tmdb_id === tmdb) || (type === 'show' && tvdb != null && l.tvdb_id === tvdb)))

  const titles = new Map<string, NotInPlexItem>()
  for (const a of db.prepare('SELECT * FROM arr_titles ORDER BY instance').all()) {
    const instance = arrInstance(a.instance as string)
    if (!instance) continue
    const type = instance.app === 'radarr' ? 'movie' : 'show'
    if (inPlex(type, a.tmdb_id, a.tvdb_id)) continue
    const key = `${type}:${a.tvdb_id ?? a.tmdb_id ?? `${a.instance}-${a.id}`}`
    let entry = titles.get(key)
    if (!entry) {
      entry = {
        type,
        title: a.title as string,
        year: a.year as number | null,
        poster: a.poster as string | null,
        status: a.status as string | null,
        next_airing: a.next_airing as number | null,
        files: 0,
        total: 0,
        size: 0,
        monitored: false,
        instances: [],
      }
      titles.set(key, entry)
    }
    const files = (a.files as number | null) ?? 0
    entry.files += files
    entry.total = Math.max(entry.total, (a.total as number | null) ?? 0)
    entry.size += (a.size as number | null) ?? 0
    entry.monitored ||= Boolean(a.monitored)
    entry.instances.push({ instance: instance.id, name: instance.name, monitored: Boolean(a.monitored), files })
  }
  return [...titles.values()].sort((x, y) => x.title.localeCompare(y.title, 'de'))
}
