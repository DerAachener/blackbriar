import { config, type ConnectionKey } from './config.ts'
import { t } from './i18n.ts'
import { reach } from './net.ts'

// Viele betreiben Radarr und Sonarr doppelt: eine Instanz für 1080p, eine für 4K
export const ARR_INSTANCES = [
  { id: 'radarr', app: 'radarr', name: 'Radarr', url: 'radarrUrl', key: 'radarrApiKey' },
  { id: 'radarr4k', app: 'radarr', name: 'Radarr 4K', url: 'radarr4kUrl', key: 'radarr4kApiKey' },
  { id: 'sonarr', app: 'sonarr', name: 'Sonarr', url: 'sonarrUrl', key: 'sonarrApiKey' },
  { id: 'sonarr4k', app: 'sonarr', name: 'Sonarr 4K', url: 'sonarr4kUrl', key: 'sonarr4kApiKey' },
] as const satisfies readonly { id: string; app: 'radarr' | 'sonarr'; name: string; url: ConnectionKey; key: ConnectionKey }[]

export type ArrInstance = (typeof ARR_INSTANCES)[number]
export type ArrInstanceId = ArrInstance['id']

export const arrConfigured = (instance: ArrInstance) => Boolean(config[instance.url] && config[instance.key])
export const configuredArrInstances = () => ARR_INSTANCES.filter(arrConfigured)
export const arrInstance = (id: string) => ARR_INSTANCES.find((i) => i.id === id)

// Radarr und Sonarr teilen sich dieselbe API-Form (v3)
async function arr(instance: ArrInstance, path: string, method = 'GET', body?: unknown): Promise<any> {
  const res = await reach(instance.name, `${config[instance.url]}/api/v3${path}`, {
    method,
    headers: { 'X-Api-Key': config[instance.key], Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(t('{name} antwortet mit {status} auf {path}', { name: instance.name, status: res.status, path: path.split('?')[0]! }))
  return res.status === 204 ? null : res.json().catch(() => null)
}

/** Trägt einen Film bzw. eine Serie aus. Die Dateien bleiben liegen; die löscht Plex. */
export async function removeFromArr(instance: ArrInstance, id: number): Promise<void> {
  const path = instance.app === 'radarr' ? `/movie/${id}?deleteFiles=false&addImportExclusion=false` : `/series/${id}?deleteFiles=false`
  await arr(instance, path, 'DELETE')
}

/** Stellt einzelne Folgen auf „nicht beobachtet“, damit Sonarr sie nach dem Löschen nicht neu lädt. */
export async function unmonitorEpisodes(instance: ArrInstance, seriesId: number, wanted: { season: number; episode: number }[]): Promise<void> {
  const all = (await arr(instance, `/episode?seriesId=${seriesId}`)) as any[]
  const ids = all
    .filter((e) => e.monitored && wanted.some((w) => w.season === e.seasonNumber && w.episode === e.episodeNumber))
    .map((e) => e.id)
  if (ids.length) await arr(instance, '/episode/monitor', 'PUT', { episodeIds: ids, monitored: false })

  // Sonarr führt für jede Staffel einen eigenen Schalter und zeigt ihn in der Übersicht. Wird in einer
  // Staffel keine Folge mehr beobachtet, geht er mit aus; sonst sähe die Staffel weiter beobachtet aus.
  const stillMonitored = new Set(all.filter((e) => e.monitored && !ids.includes(e.id)).map((e) => e.seasonNumber as number))
  const done = new Set(wanted.map((w) => w.season).filter((season) => !stillMonitored.has(season)))
  if (!done.size) return
  const series = await arr(instance, `/series/${seriesId}`)
  let changed = false
  for (const season of series.seasons ?? []) {
    if (season.monitored && done.has(season.seasonNumber)) {
      season.monitored = false
      changed = true
    }
  }
  if (changed) await arr(instance, `/series/${seriesId}`, 'PUT', series)
}

/** Lässt Radarr bzw. Sonarr die Dateien eines Titels neu einlesen, damit Gelöschtes dort nicht weiter als vorhanden gilt. */
export async function rescanArr(instance: ArrInstance, id: number): Promise<void> {
  await arr(instance, '/command', 'POST', instance.app === 'radarr' ? { name: 'RescanMovie', movieId: id } : { name: 'RescanSeries', seriesId: id })
}

export interface SeriesFiles {
  /** Ob Sonarr die Staffel noch beobachtet */
  seasons: Map<number, boolean>
  /** Vorhandene Folgen mit der Release-Gruppe ihrer Datei; leer, wenn Sonarr keine kennt */
  files: { season: number; episode: number; group: string }[]
}

/** Was Sonarr zu den Dateien einer Serie weiß: Release-Gruppe je Folge und ob die Staffeln beobachtet werden. */
export async function getSeriesFiles(instance: ArrInstance, seriesId: number): Promise<SeriesFiles> {
  const [series, episodes, files] = (await Promise.all([
    arr(instance, `/series/${seriesId}`),
    arr(instance, `/episode?seriesId=${seriesId}`),
    arr(instance, `/episodefile?seriesId=${seriesId}`),
  ])) as [any, any[], any[]]
  const groupOf = new Map((files ?? []).map((f) => [f.id as number, String(f.releaseGroup ?? '')]))
  return {
    seasons: new Map((series?.seasons ?? []).map((s: any) => [Number(s.seasonNumber), Boolean(s.monitored)])),
    files: (episodes ?? [])
      .filter((e) => e.episodeFileId)
      .map((e) => ({ season: Number(e.seasonNumber), episode: Number(e.episodeNumber), group: groupOf.get(e.episodeFileId) ?? '' })),
  }
}

/** Stellt eine ganze Staffel auf „nicht beobachtet“: alle ihre Folgen und den Schalter der Staffel. */
export async function unmonitorSeason(instance: ArrInstance, seriesId: number, season: number): Promise<void> {
  const all = (await arr(instance, `/episode?seriesId=${seriesId}`)) as any[]
  const ids = all.filter((e) => e.monitored && e.seasonNumber === season).map((e) => e.id)
  if (ids.length) await arr(instance, '/episode/monitor', 'PUT', { episodeIds: ids, monitored: false })
  const series = await arr(instance, `/series/${seriesId}`)
  const entry = (series.seasons ?? []).find((s: any) => s.seasonNumber === season)
  if (entry?.monitored) {
    entry.monitored = false
    await arr(instance, `/series/${seriesId}`, 'PUT', series)
  }
}

export interface ArrDisks {
  /** Platten, wie die Instanz sie sieht */
  disks: { path: string; free: number; total: number }[]
  /** Ordner, in die die Instanz Filme bzw. Serien legt */
  roots: { path: string; free: number }[]
}

/** Freier und gesamter Platz der Platten, auf die Radarr bzw. Sonarr schreiben. */
export async function getArrDisks(instance: ArrInstance): Promise<ArrDisks> {
  const [disks, roots] = (await Promise.all([arr(instance, '/diskspace'), arr(instance, '/rootfolder')])) as [any[], any[]]
  return {
    disks: (disks ?? []).map((d) => ({ path: String(d.path ?? ''), free: Number(d.freeSpace ?? 0), total: Number(d.totalSpace ?? 0) })),
    roots: (roots ?? []).filter((r) => r.accessible !== false).map((r) => ({ path: String(r.path ?? ''), free: Number(r.freeSpace ?? 0) })),
  }
}

/**
 * Adresse eines Titels in der Oberfläche von Radarr bzw. Sonarr. Radarr findet Filme über die TMDB-ID,
 * Sonarr braucht seinen eigenen Kurznamen; fehlt der, führt der Link auf die Startseite der Instanz.
 */
export function arrLink(instance: ArrInstance, ids: { tmdbId?: number | null; slug?: string | null }): string {
  const base = config[instance.url]
  if (instance.app === 'radarr') return ids.tmdbId ? `${base}/movie/${ids.tmdbId}` : base
  return ids.slug ? `${base}/series/${encodeURIComponent(ids.slug)}` : base
}

export interface ArrItem {
  instance: ArrInstanceId
  id: number
  tmdbId: number | null
  tvdbId: number | null
  title: string
  monitored: boolean
  /** Bei Sonarr 'continuing', 'ended' oder 'upcoming'; bei Radarr der Veröffentlichungsstand */
  status: string | null
  /** Nächste Ausstrahlung einer Folge, nur Sonarr */
  nextAiring: number | null
  /** Dateiname des Films, nur Radarr und nur, wenn dort eine Datei bekannt ist */
  file: string | null
  year: number | null
  /** Kurzname in der Adresse, unter der Radarr bzw. Sonarr den Titel zeigt */
  slug: string | null
  /** Adresse des Posters bei TMDB bzw. TVDB */
  poster: string | null
  /** Vorhandene Dateien: bei Filmen 0 oder 1, bei Serien die Zahl der Folgen mit Datei */
  files: number
  /** Bei Serien die Zahl der bereits ausgestrahlten Folgen, bei Filmen 1 */
  total: number
  /** Bytes auf der Platte */
  size: number
}

/** Alle Filme bzw. Serien, die diese Instanz verwaltet. */
export async function getArrItems(instance: ArrInstance): Promise<ArrItem[]> {
  const list = (await arr(instance, instance.app === 'radarr' ? '/movie' : '/series')) as any[]
  const movies = instance.app === 'radarr'
  return list.map((x) => ({
    year: x.year || null,
    poster: (x.images ?? []).find((i: any) => i.coverType === 'poster')?.remoteUrl ?? null,
    files: movies ? (x.hasFile ? 1 : 0) : (x.statistics?.episodeFileCount ?? 0),
    total: movies ? 1 : (x.statistics?.episodeCount ?? 0),
    size: (movies ? x.sizeOnDisk : x.statistics?.sizeOnDisk) ?? 0,
    instance: instance.id,
    id: x.id,
    tmdbId: x.tmdbId || null,
    tvdbId: x.tvdbId || null,
    title: x.title ?? '',
    monitored: Boolean(x.monitored),
    status: x.status ?? null,
    nextAiring: x.nextAiring ? Math.floor(Date.parse(x.nextAiring) / 1000) || null : null,
    file: x.movieFile?.relativePath ? String(x.movieFile.relativePath).split(/[\\/]/).pop()! : null,
    slug: x.titleSlug ? String(x.titleSlug) : null,
  }))
}

/** Prüft den Zugang; liefert die Version. */
export async function testArr(instance: ArrInstance): Promise<string> {
  return (await arr(instance, '/system/status')).version ?? 'unbekannt'
}

export interface CalendarEntry {
  /** Name der Instanz, z. B. „Sonarr 4K“ */
  instance: string
  type: 'movie' | 'show'
  title: string
  /** Lokales Datum, JJJJ-MM-TT */
  date: string
  season: number | null
  /** Nummern der Folgen, die an diesem Tag kommen; bei Filmen leer */
  episodes: number[]
  /** Titel der Folge, wenn es nur eine ist */
  episode_title: string | null
  /** Bei Filmen die Art des Termins */
  release: 'digital' | 'physical' | 'cinema' | null
  poster: string | null
  has_file: boolean
  /** Für die Kurzinfo bei TMDB; fehlt, wenn Radarr bzw. Sonarr keine kennt */
  tmdb_id: number | null
  /** Inhalt des Films bzw. der Serie laut Radarr oder Sonarr, falls TMDB nicht verbunden ist */
  overview: string | null
  /** Adresse des Titels in Radarr bzw. Sonarr */
  url: string
}

const localDay = (value: string) => new Date(value).toLocaleDateString('sv-SE')
const posterOf = (images: any[] | undefined) => (images ?? []).find((i) => i.coverType === 'poster')?.remoteUrl ?? null

/** Was diese Instanz zwischen zwei Tagen (JJJJ-MM-TT) erwartet. Mehrere Folgen einer Serie am selben Tag ergeben einen Eintrag. */
export async function getCalendar(instance: ArrInstance, from: string, to: string): Promise<CalendarEntry[]> {
  const range = `start=${from}T00:00:00&end=${to}T23:59:59&unmonitored=false`
  if (instance.app === 'radarr') {
    const movies = (await arr(instance, `/calendar?${range}`)) as any[]
    return movies.flatMap((m): CalendarEntry[] => {
      // Ein Film hat bis zu drei Termine; gezeigt wird der, der in den Zeitraum fällt, digital zuerst
      const dates: [CalendarEntry['release'], string | undefined][] = [
        ['digital', m.digitalRelease],
        ['physical', m.physicalRelease],
        ['cinema', m.inCinemas],
      ]
      const hit = dates.map(([release, value]) => ({ release, date: value ? localDay(value) : '' })).find((d) => d.date >= from && d.date <= to)
      if (!hit) return []
      return [
        { instance: instance.name, type: 'movie', title: m.title ?? '', date: hit.date, season: null, episodes: [], episode_title: null, release: hit.release, poster: posterOf(m.images), has_file: Boolean(m.hasFile), tmdb_id: m.tmdbId || null, overview: m.overview || null, url: arrLink(instance, { tmdbId: m.tmdbId }) },
      ]
    })
  }
  const episodes = (await arr(instance, `/calendar?${range}&includeSeries=true`)) as any[]
  const groups = new Map<string, CalendarEntry>()
  for (const e of episodes) {
    if (!e.airDateUtc) continue
    const date = localDay(e.airDateUtc)
    const key = `${e.seriesId}:${e.seasonNumber}:${date}`
    const entry = groups.get(key)
    if (entry) {
      entry.episodes.push(e.episodeNumber)
      entry.episode_title = null
      entry.has_file &&= Boolean(e.hasFile)
    } else {
      groups.set(key, {
        instance: instance.name,
        type: 'show',
        title: e.series?.title ?? '',
        date,
        season: e.seasonNumber ?? null,
        episodes: [e.episodeNumber],
        episode_title: e.title ?? null,
        release: null,
        poster: posterOf(e.series?.images),
        has_file: Boolean(e.hasFile),
        tmdb_id: e.series?.tmdbId || null,
        overview: e.series?.overview || null,
        url: arrLink(instance, { slug: e.series?.titleSlug }),
      })
    }
  }
  return [...groups.values()]
}
