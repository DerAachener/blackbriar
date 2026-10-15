import { ARR_INSTANCES, arrLink, configuredArrInstances, getCalendar, type CalendarEntry } from './arr.ts'
import { tmdbConfigured } from './config.ts'
import { db, getSetting, getSettings, now, setSetting } from './db.ts'
import { requestStates } from './media.ts'
import { getProviders, getReleases, type Provider, type Release } from './tmdb.ts'

// Die Neustarts ändern sich langsam und kosten einige hundert Anfragen an TMDB,
// deshalb werden sie zwischengespeichert und nur zweimal am Tag neu geholt.
const MAX_AGE = 12 * 3600
const DAYS_BACK = 7
// Streaming-Filme reichen weiter zurück, weil TMDB ihren Anbieter erst nach dem Start kennt
const MOVIE_DAYS_BACK = 30
const DAYS_AHEAD = 35

// Wächst mit, wenn die gespeicherten Einträge ein neues Feld bekommen; ein älterer Stand wird dann neu geholt
const CACHE_VERSION = 2

interface Cache {
  version?: number
  fetchedAt: number
  region: string
  language: string
  providers: Provider[]
  releases: Release[]
}

let cache: Cache | undefined
try {
  cache = JSON.parse(getSetting('upcoming_cache') ?? 'null') ?? undefined
} catch {
  cache = undefined
}
let loading = false
let error = ''

/** Lokales Datum als JJJJ-MM-TT, um Tage ab heute verschoben. */
const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toLocaleDateString('sv-SE')

/** Holt die Neustarts im Hintergrund neu, wenn sie veraltet sind oder Land bzw. Sprache gewechselt haben. */
export function refreshUpcoming(force = false): void {
  if (loading || !tmdbConfigured()) return
  const { upcomingRegion: region, language } = getSettings()
  const fresh = cache && cache.version === CACHE_VERSION && cache.region === region && cache.language === language && now() - cache.fetchedAt < MAX_AGE
  if (fresh && !force) return
  loading = true
  error = ''
  void Promise.all([getProviders(region), getReleases(region, day(-DAYS_BACK), day(DAYS_AHEAD), day(-MOVIE_DAYS_BACK))])
    .then(([providers, releases]) => {
      cache = { version: CACHE_VERSION, fetchedAt: now(), region, language, providers, releases }
      setSetting('upcoming_cache', JSON.stringify(cache))
    })
    .catch((err: Error) => {
      error = err.message
    })
    .finally(() => {
      loading = false
    })
}

// Der Kalender aus Radarr und Sonarr ist schnell geholt, soll aber nicht bei jedem Seitenaufruf neu abgefragt werden
let calendar: { at: number; entries: CalendarEntry[]; error: string } | undefined

async function serverCalendar(): Promise<{ entries: CalendarEntry[]; error: string }> {
  if (calendar && now() - calendar.at < 900) return calendar
  const entries: CalendarEntry[] = []
  const failed: string[] = []
  for (const instance of configuredArrInstances()) {
    try {
      entries.push(...(await getCalendar(instance, day(-1), day(DAYS_AHEAD))))
    } catch (err) {
      failed.push((err as Error).message)
    }
  }
  calendar = { at: now(), entries: entries.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title, 'de')), error: failed.join(' · ') }
  return calendar
}

/** Die Anbieterliste des Landes für die Auswahl in den Einstellungen. */
export async function providerCatalog(): Promise<Provider[]> {
  const region = getSettings().upcomingRegion
  if (cache?.region === region) return cache.providers
  return getProviders(region)
}

// Titel, die der Besitzer unter „Was kommt“ nicht mehr sehen will. Sie bleiben in allen Bereichen und Themen weg,
// bis er sie wieder einblendet.
db.exec(`CREATE TABLE IF NOT EXISTS hidden_titles (
  type      TEXT NOT NULL,
  tmdb_id   INTEGER NOT NULL,
  title     TEXT NOT NULL,
  year      INTEGER,
  hidden_at INTEGER NOT NULL,
  PRIMARY KEY (type, tmdb_id)
)`)

export interface HiddenTitle {
  type: 'movie' | 'show'
  tmdb_id: number
  title: string
  year: number | null
  hidden_at: number
}

export function hideTitle(type: string, tmdbId: number, title: string, year: number | null): void {
  db.prepare('INSERT OR REPLACE INTO hidden_titles (type, tmdb_id, title, year, hidden_at) VALUES (?, ?, ?, ?, ?)').run(type, tmdbId, title.slice(0, 200), year, now())
}

export function unhideTitle(type: string, tmdbId: number): void {
  db.prepare('DELETE FROM hidden_titles WHERE type = ? AND tmdb_id = ?').run(type, tmdbId)
}

export const hiddenTitles = (): HiddenTitle[] =>
  db.prepare('SELECT type, tmdb_id, title, year, hidden_at FROM hidden_titles ORDER BY hidden_at DESC').all() as unknown as HiddenTitle[]

/** Lässt weg, was ausgeblendet ist. Einträge ohne TMDB-Nummer lassen sich nicht ausblenden und bleiben. */
export function visible<T extends { type: string; tmdb_id: number | null }>(list: T[]): T[] {
  const hidden = new Set(hiddenTitles().map((h) => `${h.type}:${h.tmdb_id}`))
  return hidden.size ? list.filter((x) => x.tmdb_id == null || !hidden.has(`${x.type}:${x.tmdb_id}`)) : list
}

/** Hängt an jeden Titel, was Blackbriar dazu weiß: schon auf dem Server, in Radarr/Sonarr, auf einer Merkliste, angefragt. */
export function annotate(list: Release[]) {
  const library = new Set(db.prepare('SELECT type, tmdb_id FROM library_items WHERE tmdb_id IS NOT NULL').all().map((l) => `${l.type}:${l.tmdb_id}`))
  const wished = new Map<string, string[]>()
  for (const w of db.prepare('SELECT w.type, w.tmdb_id, u.name FROM watchlist w JOIN users u ON u.id = w.user_id').all()) {
    const key = `${w.type}:${w.tmdb_id}`
    wished.set(key, [...(wished.get(key) ?? []), w.name as string])
  }
  // Was Radarr oder Sonarr beobachten, kommt von selbst und braucht keine Anfrage
  const managed = new Map<string, { name: string; url: string }[]>()
  for (const a of db.prepare('SELECT instance, tmdb_id, slug FROM arr_titles WHERE tmdb_id IS NOT NULL AND monitored = 1').all()) {
    const instance = ARR_INSTANCES.find((i) => i.id === a.instance)
    if (!instance) continue
    const key = `${instance.app === 'radarr' ? 'movie' : 'show'}:${a.tmdb_id}`
    const url = arrLink(instance, { tmdbId: a.tmdb_id as number, slug: a.slug as string | null })
    managed.set(key, [...(managed.get(key) ?? []), { name: instance.name, url }])
  }
  const requests = requestStates()
  return list.map((r) => {
    const key = `${r.type}:${r.tmdb_id}`
    return {
      ...r,
      in_library: library.has(key),
      arr: managed.get(key) ?? [],
      watchlist: wished.get(key) ?? [],
      request: requests.get(key)?.label ?? null,
    }
  })
}

export async function upcoming() {
  refreshUpcoming()
  const settings = getSettings()
  const releases = visible(annotate(cache?.releases ?? []))
  const server = await serverCalendar()
  return {
    configured: tmdbConfigured(),
    loading,
    error,
    fetchedAt: cache?.fetchedAt ?? null,
    region: settings.upcomingRegion,
    today: day(0),
    // Nur die Anbieter, die in den Einstellungen gewählt sind, in der Reihenfolge von TMDB
    providers: (cache?.providers ?? []).filter((p) => settings.upcomingProviders.includes(p.name)),
    cinema: releases.filter((r) => r.kind === 'cinema'),
    streaming: releases.filter((r) => r.kind === 'streaming'),
    server: visible(server.entries),
    // Wie viele Titel ausgeblendet sind; die Ansicht bietet an, sie wieder einzublenden
    hidden: hiddenTitles().length,
    serverError: server.error,
    arrConfigured: configuredArrInstances().length > 0,
  }
}
