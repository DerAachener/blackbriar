import { arrInstance, arrLink, getSeriesFiles } from './arr.ts'
import { db, getSettings } from './db.ts'
import { pms } from './plex.ts'
import { airingShows, fileList, requestStates, type FileItem } from './media.ts'

// Alles, was Blackbriar zu einem einzelnen Titel weiß, für das Info-Fenster:
// wer ihn gesehen, bewertet, gewünscht oder auf der Merkliste hat, die Datei und die letzten Wiedergaben.

export interface DetailPerson {
  user_id: number
  name: string
  seen_at: number | null
  /** Bei Serien die Zahl der gesehenen Folgen, bei Filmen null */
  watched: number | null
  rating: number | null
  /** Davon nur in Plex als gesehen markiert: Zahl der Folgen, bei Filmen 1 */
  marked: number
  requested: boolean
  on_watchlist: boolean
}

export interface DetailSeason {
  season: number
  episodes: number
  size: number
  /** Release-Gruppen laut Sonarr mit der Zahl ihrer Folgen, häufigste zuerst */
  groups: { name: string; episodes: number }[]
}

export interface TitleDetail {
  /** null, wenn der Titel nicht auf dem Server liegt */
  rating_key: number | null
  type: string
  tmdb_id: number | null
  title: string
  year: number | null
  thumb: string | null
  /** Inhaltsangabe aus Plex, in der Sprache der Mediathek; null, wenn der Titel nicht auf dem Server liegt */
  summary: string | null
  poster: string | null
  section: string | null
  added_at: number | null
  leaf_count: number
  /** Pfad der Datei, so wie Plex ihn sieht; bei Serien der gemeinsame Ordner aller Folgen */
  path: string | null
  file: Pick<FileItem, 'size' | 'files' | 'converted' | 'video_codec' | 'audio_codec' | 'resolution' | 'bitrate' | 'container' | 'file'> | null
  arr: { name: string; monitored: boolean; status: string | null; url: string }[]
  airing: { next: number | null } | null
  seasons: DetailSeason[]
  /** Stand der Anfrage in Seerr, falls es eine gibt */
  request: string | null
  people: DetailPerson[]
  plays: { user_name: string; viewed_at: number; season: number | null; episode: number | null; title: string }[]
  plays_total: number
}

export interface TitleRef {
  key?: number
  type?: string
  tmdb?: number
}

/** Findet den Bibliothekstitel zu einem Schlüssel, der auch der einer einzelnen Folge sein darf. */
function libraryItem(ref: TitleRef): Record<string, unknown> | undefined {
  const byKey = db.prepare('SELECT * FROM library_items WHERE rating_key = ?')
  if (ref.key != null) {
    const direct = byKey.get(ref.key)
    if (direct) return direct
    const parent =
      db.prepare('SELECT item_key AS k FROM media_files WHERE rating_key = ?').get(ref.key)?.k ??
      db.prepare('SELECT show_key AS k FROM history WHERE rating_key = ? AND show_key IS NOT NULL LIMIT 1').get(ref.key)?.k
    if (parent != null) return byKey.get(parent as number)
  }
  if (ref.type && ref.tmdb != null) return db.prepare('SELECT * FROM library_items WHERE type = ? AND tmdb_id = ? ORDER BY rating_key LIMIT 1').get(ref.type, ref.tmdb)
  return undefined
}

async function releaseGroups(item: FileItem | undefined): Promise<Map<number, Map<string, number>>> {
  const groups = new Map<number, Map<string, number>>()
  const entry = item?.arr.find((a) => arrInstance(a.instance)?.app === 'sonarr')
  if (!entry) return groups
  // Antwortet Sonarr nicht zügig, erscheint das Fenster eben ohne Release-Gruppen
  const files = await Promise.race([
    getSeriesFiles(arrInstance(entry.instance)!, entry.id).catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
  ])
  const marker = getSettings().convertedMarker.replace(/^-/, '').toLowerCase()
  for (const f of files?.files ?? []) {
    if (!f.group || f.group.toLowerCase() === marker) continue
    const season = groups.get(f.season) ?? new Map<string, number>()
    season.set(f.group, (season.get(f.group) ?? 0) + 1)
    groups.set(f.season, season)
  }
  return groups
}

/** Pfad eines Films bzw. der gemeinsame Ordner aller Folgen einer Serie. */
function pathOf(ratingKey: number): string | null {
  const files = db.prepare('SELECT file FROM media_files WHERE item_key = ? AND file IS NOT NULL').all(ratingKey).map((r) => String(r.file))
  if (!files.length) return null
  if (files.length === 1) return files[0]!
  const separator = files[0]!.includes('\\') ? '\\' : '/'
  let common = files[0]!.split(/[\\/]/).slice(0, -1)
  for (const file of files) {
    const parts = file.split(/[\\/]/).slice(0, -1)
    let same = 0
    while (same < common.length && same < parts.length && common[same] === parts[same]) same++
    common = common.slice(0, same)
  }
  return common.join(separator) || null
}

/** Was Plex zu einem Titel als Inhalt führt; dient als deutscher Text, wenn TMDB nur einen englischen hat. */
async function plexSummary(ratingKey: number): Promise<string | null> {
  const m = (await pms(`/library/metadata/${ratingKey}`).catch(() => ({}))).Metadata?.[0]
  return m?.summary ? String(m.summary) : null
}

export async function titleDetail(ref: TitleRef): Promise<TitleDetail | null> {
  const item = libraryItem(ref)
  const type = (item?.type as string | undefined) ?? ref.type
  const tmdbId = (item?.tmdb_id as number | null | undefined) ?? ref.tmdb ?? null
  if (!type || (!item && tmdbId == null)) return null
  const key = (item?.rating_key as number | undefined) ?? null

  const names = new Map<number, string>()
  for (const u of db.prepare('SELECT id, name FROM users').all()) names.set(u.id as number, u.name as string)
  const people = new Map<number, DetailPerson>()
  const person = (id: number): DetailPerson => {
    let p = people.get(id)
    if (!p) {
      p = { user_id: id, name: names.get(id) ?? `Konto ${id}`, seen_at: null, watched: null, rating: null, marked: 0, requested: false, on_watchlist: false }
      people.set(id, p)
    }
    return p
  }

  const mine = type === 'movie' ? "h.type = 'movie' AND h.rating_key = ?" : "h.type = 'episode' AND h.show_key = ?"
  let plays: TitleDetail['plays'] = []
  let playsTotal = 0
  if (key != null) {
    for (const s of db
      .prepare(`SELECT h.user_id, MAX(h.viewed_at) AS seen_at, COUNT(DISTINCT h.season * 10000 + h.episode) AS watched FROM history h WHERE ${mine} GROUP BY h.user_id`)
      .all(key)) {
      const p = person(s.user_id as number)
      p.seen_at = s.seen_at as number
      p.watched = type === 'show' ? (s.watched as number) : null
    }
    for (const r of db.prepare('SELECT user_id, rating FROM ratings WHERE rating_key = ?').all(key)) person(r.user_id as number).rating = r.rating as number
    // In Plex als gesehen markiert, ohne dass es im Verlauf steht
    for (const w of db.prepare('SELECT user_id, count, viewed_at FROM plex_watched WHERE rating_key = ?').all(key)) {
      const p = person(w.user_id as number)
      if (type === 'show') {
        const played = p.watched ?? 0
        if ((w.count as number) <= played) continue
        p.marked = (w.count as number) - played
        p.watched = w.count as number
      } else {
        if (p.seen_at != null) continue
        p.marked = 1
      }
      p.seen_at = Math.max(p.seen_at ?? 0, w.viewed_at as number)
    }
    plays = db
      .prepare(
        `SELECT COALESCE(u.name, 'Konto ' || h.user_id) AS user_name, h.viewed_at, h.season, h.episode, h.title
         FROM history h LEFT JOIN users u ON u.id = h.user_id WHERE ${mine} ORDER BY h.viewed_at DESC LIMIT 60`,
      )
      .all(key) as unknown as TitleDetail['plays']
    playsTotal = Number(db.prepare(`SELECT COUNT(*) AS n FROM history h WHERE ${mine}`).get(key)?.n ?? 0)
  }

  let wished: Record<string, unknown> | undefined
  if (tmdbId != null) {
    for (const w of db
      .prepare('SELECT w.user_id, w.title, w.year, w.poster FROM watchlist w JOIN users u ON u.id = w.user_id AND u.active = 1 WHERE w.type = ? AND w.tmdb_id = ?')
      .all(type, tmdbId)) {
      person(w.user_id as number).on_watchlist = true
      wished ??= w
    }
    for (const r of db.prepare('SELECT user_id FROM requests WHERE type = ? AND tmdb_id = ? AND user_id IS NOT NULL AND status <> 3').all(type, tmdbId)) {
      if (names.has(r.user_id as number)) person(r.user_id as number).requested = true
    }
  }
  if (!item && !wished && !people.size) return null

  const file = key != null ? fileList().find((f) => f.rating_key === key) : undefined
  const groups = type === 'show' ? await releaseGroups(file) : new Map<number, Map<string, number>>()
  const seasons =
    key != null && type === 'show'
      ? db
          .prepare('SELECT season, COUNT(*) AS episodes, SUM(size) AS size FROM media_files WHERE item_key = ? AND rating_key <> item_key GROUP BY season ORDER BY season')
          .all(key)
          .map((s): DetailSeason => ({
            season: (s.season as number | null) ?? 0,
            episodes: s.episodes as number,
            size: (s.size as number | null) ?? 0,
            groups: [...(groups.get((s.season as number | null) ?? 0) ?? [])].map(([name, episodes]) => ({ name, episodes })).sort((a, b) => b.episodes - a.episodes),
          }))
      : []

  const slugOf = db.prepare('SELECT slug, tmdb_id FROM arr_titles WHERE instance = ? AND id = ?')
  return {
    rating_key: key,
    type,
    tmdb_id: tmdbId,
    title: (item?.title as string | undefined) ?? (wished?.title as string | undefined) ?? '',
    year: (item?.year as number | null | undefined) ?? (wished?.year as number | null | undefined) ?? null,
    thumb: (item?.thumb as string | null | undefined) ?? null,
    summary: key != null ? await plexSummary(key) : null,
    poster: (wished?.poster as string | null | undefined) ?? null,
    section: (item?.section as string | null | undefined) ?? null,
    added_at: (item?.added_at as number | null | undefined) ?? null,
    leaf_count: (item?.leaf_count as number | undefined) ?? 0,
    path: key != null ? pathOf(key) : null,
    file: file
      ? {
          size: file.size,
          files: file.files,
          converted: file.converted,
          video_codec: file.video_codec,
          audio_codec: file.audio_codec,
          resolution: file.resolution,
          bitrate: file.bitrate,
          container: file.container,
          file: file.file,
        }
      : null,
    arr: (file?.arr ?? []).map((a) => {
      const row = slugOf.get(a.instance, a.id)
      return { name: a.name, monitored: a.monitored, status: a.status, url: arrLink(arrInstance(a.instance)!, { tmdbId: row?.tmdb_id as number | null, slug: row?.slug as string | null }) }
    }),
    airing: (key != null && airingShows().get(key)) || null,
    seasons,
    request: tmdbId != null ? (requestStates().get(`${type}:${tmdbId}`)?.label ?? null) : null,
    people: [...people.values()].sort((a, b) => (b.seen_at ?? 0) - (a.seen_at ?? 0) || a.name.localeCompare(b.name, 'de')),
    plays,
    plays_total: playsTotal,
  }
}

