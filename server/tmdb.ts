import { config } from './config.ts'
import { getSettings } from './db.ts'
import { t } from './i18n.ts'
import { reach } from './net.ts'

// TMDB führt Starttermine pro Land und, über JustWatch, die Anbieter pro Land.
// Beides zusammen ergibt die Neustarts für „Was kommt“.

/** TMDB kennt zwei Arten von Schlüsseln: den kurzen API-Schlüssel und das lange Lesetoken. */
async function tmdb(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const key = config.tmdbApiKey
  const token = key.startsWith('eyJ')
  const query = new URLSearchParams({ language: getSettings().language === 'en' ? 'en-US' : 'de-DE' })
  for (const [k, v] of Object.entries(params)) query.set(k, String(v))
  if (!token) query.set('api_key', key)
  const res = await reach('TMDB', `https://api.themoviedb.org/3${path}?${query}`, {
    headers: token ? { Authorization: `Bearer ${key}` } : {},
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(t('{name} antwortet mit {status}', { name: 'TMDB', status: res.status }))
  return res.json()
}

/** Führt die Aufgaben mit begrenzter Gleichzeitigkeit aus, damit TMDB nicht mit hunderten Anfragen auf einmal belastet wird. */
async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await task(items[index]!)
      }
    }),
  )
  return results
}

/** Alle Seiten einer Suche bis zur Obergrenze. */
async function discover(kind: 'movie' | 'tv', params: Record<string, string | number>, maxPages: number): Promise<any[]> {
  const results: any[] = []
  for (let page = 1; page <= maxPages; page++) {
    const data = await tmdb(`/discover/${kind}`, { ...params, page, sort_by: 'popularity.desc' })
    results.push(...(data.results ?? []))
    if (page >= (data.total_pages ?? 1)) break
  }
  return results
}

export interface Provider {
  id: number
  name: string
  logo: string | null
}

/** Die Streaminganbieter eines Landes, die wichtigsten zuerst. */
export async function getProviders(region: string): Promise<Provider[]> {
  const [movies, shows] = await Promise.all([
    tmdb('/watch/providers/movie', { watch_region: region }),
    tmdb('/watch/providers/tv', { watch_region: region }),
  ])
  const byId = new Map<number, { provider: Provider; priority: number }>()
  for (const p of [...(movies.results ?? []), ...(shows.results ?? [])]) {
    const priority = p.display_priorities?.[region] ?? 999
    const known = byId.get(p.provider_id)
    if (!known || priority < known.priority) {
      byId.set(p.provider_id, { provider: { id: p.provider_id, name: p.provider_name, logo: p.logo_path ?? null }, priority })
    }
  }
  return [...byId.values()].sort((a, b) => a.priority - b.priority).map((x) => x.provider)
}

export interface Release {
  /** 'cinema' für Kinostarts, 'streaming' für Starts bei Anbietern */
  kind: 'cinema' | 'streaming' | 'topic'
  type: 'movie' | 'show'
  tmdb_id: number
  title: string
  year: number | null
  /** Starttermin im gewählten Land, JJJJ-MM-TT */
  date: string
  poster: string | null
  /** Bei Serien die Staffel, die startet */
  season: number | null
  /** Namen der Anbieter, bei denen der Titel im gewählten Land in der Flatrate läuft; vor dem Start oft noch leer */
  providers: string[]
  /** Bekanntheit laut TMDB; innerhalb eines Tages stehen die bekanntesten Titel vorn */
  popularity: number
  /** TMDB führt den Titel im Genre Dokumentation */
  documentary: boolean
}

// Das Genre „Dokumentation“ hat bei TMDB für Filme und Serien dieselbe Nummer
const isDocumentary = (d: any): boolean => (d.genres ?? []).some((g: any) => g.id === 99)

// Sender, deren Eigenproduktionen bei einem Streaminganbieter starten; darüber ist der Anbieter schon vor dem Start bekannt
const NETWORKS: Record<number, string> = {
  213: 'Netflix',
  1024: 'Amazon Prime Video',
  2739: 'Disney Plus',
  2552: 'Apple TV',
  4330: 'Paramount Plus',
  3186: 'HBO Max',
}

/** „Netflix Standard with Ads“ und Kanäle innerhalb anderer Dienste zählen zum Hauptangebot bzw. gar nicht. */
function providerNames(flatrate: any[] | undefined): string[] {
  const names = new Set<string>()
  for (const p of flatrate ?? []) {
    const name = String(p.provider_name)
    if (/channel/i.test(name)) continue
    names.add(name.replace(/ (Standard )?with Ads$/i, ''))
  }
  return [...names]
}

/**
 * Neustarts im Kino und bei den Streaminganbietern eines Landes zwischen zwei Tagen (JJJJ-MM-TT).
 * `moviesFrom` reicht für Streaming-Filme weiter zurück: Ihren Anbieter nennt TMDB meist erst, wenn sie schon laufen,
 * im Voraus sind sie deshalb kaum zu finden.
 */
export async function getReleases(region: string, from: string, to: string, moviesFrom = from): Promise<Release[]> {
  const inRange = (date: string | undefined) => Boolean(date && date >= from && date <= to)

  // Filme: Die Suche findet Titel mit einem Termin der gewünschten Art im Land; den genauen Tag nennen erst die Details
  const movieReleases = async (kind: Release['kind'], types: number[], pages: number): Promise<Release[]> => {
    const found = await discover(
      'movie',
      { region, with_release_type: types.join('|'), 'release_date.gte': from, 'release_date.lte': to },
      pages,
    )
    const details = await mapLimit(found, 8, (m) => tmdb(`/movie/${m.id}`, { append_to_response: 'release_dates,watch/providers' }).catch(() => null))
    const releases: Release[] = []
    for (const d of details) {
      if (!d) continue
      const local = d.release_dates?.results?.find((r: any) => r.iso_3166_1 === region)?.release_dates ?? []
      const date = local
        .filter((r: any) => types.includes(r.type))
        .map((r: any) => String(r.release_date).slice(0, 10))
        .filter(inRange)
        .sort()[0]
      if (!date) continue
      releases.push({
        kind,
        type: 'movie',
        tmdb_id: d.id,
        title: d.title,
        year: Number(String(d.release_date ?? '').slice(0, 4)) || null,
        date,
        poster: d.poster_path ?? null,
        season: null,
        providers: providerNames(d['watch/providers']?.results?.[region]?.flatrate),
        popularity: Number(d.popularity ?? 0),
        documentary: isDocumentary(d),
      })
    }
    return releases
  }

  // Filme, die bei einem Anbieter im Abo laufen und im Zeitraum Premiere hatten: vor allem die Eigenproduktionen der Anbieter
  const flatrateMovies = async (): Promise<Release[]> => {
    const found = await discover(
      'movie',
      { watch_region: region, with_watch_monetization_types: 'flatrate', 'primary_release_date.gte': moviesFrom, 'primary_release_date.lte': to },
      5,
    )
    const details = await mapLimit(found, 8, (m) => tmdb(`/movie/${m.id}`, { append_to_response: 'watch/providers' }).catch(() => null))
    const releases: Release[] = []
    for (const d of details) {
      const date = String(d?.release_date ?? '')
      if (!d || date < moviesFrom || date > to) continue
      const providers = providerNames(d['watch/providers']?.results?.[region]?.flatrate)
      if (!providers.length) continue
      releases.push({
        kind: 'streaming',
        type: 'movie',
        tmdb_id: d.id,
        title: d.title,
        year: Number(date.slice(0, 4)) || null,
        date,
        poster: d.poster_path ?? null,
        season: null,
        providers,
        popularity: Number(d.popularity ?? 0),
        documentary: isDocumentary(d),
      })
    }
    return releases
  }

  // Serien: Kandidaten sind Serien mit Folgen im Zeitraum; ein Neustart ist es nur, wenn eine Staffel beginnt
  const showReleases = async (): Promise<Release[]> => {
    const range = { 'air_date.gte': from, 'air_date.lte': to, timezone: 'Europe/Berlin' }
    const [originals, available] = await Promise.all([
      discover('tv', { ...range, with_networks: Object.keys(NETWORKS).join('|') }, 5),
      discover('tv', { ...range, watch_region: region, with_watch_monetization_types: 'flatrate' }, 5),
    ])
    const ids = [...new Set([...originals, ...available].map((s) => s.id as number))]
    const details = await mapLimit(ids, 8, (id) => tmdb(`/tv/${id}`, { append_to_response: 'watch/providers' }).catch(() => null))
    const releases: Release[] = []
    for (const d of details) {
      if (!d) continue
      const providers = new Set(providerNames(d['watch/providers']?.results?.[region]?.flatrate))
      for (const n of d.networks ?? []) if (NETWORKS[n.id]) providers.add(NETWORKS[n.id]!)
      // Ohne Anbieter läuft die Serie im gewählten Land nirgends im Abo
      if (!providers.size) continue
      for (const s of d.seasons ?? []) {
        if (!s.season_number || !inRange(s.air_date)) continue
        releases.push({
          kind: 'streaming',
          type: 'show',
          tmdb_id: d.id,
          title: d.name,
          year: Number(String(d.first_air_date ?? '').slice(0, 4)) || null,
          date: s.air_date,
          poster: s.poster_path ?? d.poster_path ?? null,
          season: s.season_number,
          providers: [...providers],
          popularity: Number(d.popularity ?? 0),
          documentary: isDocumentary(d),
        })
      }
    }
    return releases
  }

  const [cinema, digital, shows, flatrate] = await Promise.all([
    movieReleases('cinema', [3], 5),
    movieReleases('streaming', [4], 3),
    showReleases(),
    flatrateMovies(),
  ])
  // Derselbe Film aus beiden Streaming-Abfragen steht einmal da, und zwar mit Anbieter
  const known = new Set(flatrate.map((r) => r.tmdb_id))
  return [...cinema, ...digital.filter((r) => !known.has(r.tmdb_id)), ...flatrate, ...shows].sort(
    (a, b) => a.date.localeCompare(b.date) || b.popularity - a.popularity,
  )
}

export interface TitleDetails {
  type: 'movie' | 'show'
  tmdb_id: number
  title: string
  /** Originaltitel, wenn er sich vom angezeigten unterscheidet */
  original_title: string | null
  tagline: string | null
  overview: string | null
  year: number | null
  genres: string[]
  /** Laufzeit in Minuten; bei Serien die übliche Länge einer Folge */
  runtime: number | null
  seasons: number | null
  episodes: number | null
  /** Bei Serien: läuft noch, beendet, abgesetzt */
  status: string | null
  /** Altersfreigabe im gewählten Land, z. B. „12“ */
  certification: string | null
  /** Bewertung bei TMDB von 0 bis 10 */
  vote: number | null
  votes: number
  /** Regie bei Filmen, Erfinder bei Serien */
  creators: string[]
  cast: string[]
  /** Die Inhaltsangabe gibt es nicht in der eingestellten Sprache; `overview` ist dann die englische */
  overviewFallback: boolean
  /** Schlüssel des Trailers bei YouTube, nur in der eingestellten Sprache */
  trailer: string | null
  /** Englischer Trailer, wenn es keinen in der eingestellten Sprache gibt */
  trailerOther: string | null
  poster: string | null
  backdrop: string | null
}

const detailCache = new Map<string, { at: number; details: TitleDetails }>()

/** Kurzinfo zu einem Film oder einer Serie; fehlt der Text auf Deutsch, kommt der englische. */
export async function getDetails(type: 'movie' | 'show', id: number, region: string): Promise<TitleDetails> {
  const key = `${type}:${id}:${region}:${getSettings().language}`
  const cached = detailCache.get(key)
  if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.details

  const path = type === 'movie' ? `/movie/${id}` : `/tv/${id}`
  const extra = type === 'movie' ? 'credits,videos,release_dates' : 'aggregate_credits,videos,content_ratings'
  const d = await tmdb(path, { append_to_response: extra, include_video_language: 'de,en,null' })
  let overview: string = d.overview ?? ''
  let tagline: string = d.tagline ?? ''
  let overviewFallback = false
  if (!overview && getSettings().language !== 'en') {
    const en = await tmdb(path, { language: 'en-US' }).catch(() => null)
    overview = en?.overview ?? ''
    overviewFallback = Boolean(overview)
    tagline ||= en?.tagline ?? ''
  }

  const videos: any[] = d.videos?.results ?? []
  // Nur richtige Trailer, keine Teaser, und nur in der eingestellten Sprache. Fehlt der, bleibt der englische als Ausweichmöglichkeit.
  const wanted = getSettings().language === 'en' ? 'en' : 'de'
  const trailers = videos.filter((v) => v.site === 'YouTube' && v.type === 'Trailer')
  const trailer = trailers.find((v) => v.iso_639_1 === wanted)
  const trailerOther = trailer || wanted === 'en' ? undefined : trailers.find((v) => v.iso_639_1 === 'en')
  const certification =
    type === 'movie'
      ? ((d.release_dates?.results?.find((r: any) => r.iso_3166_1 === region)?.release_dates ?? []) as any[]).map((r) => r.certification).find(Boolean)
      : d.content_ratings?.results?.find((r: any) => r.iso_3166_1 === region)?.rating
  const statuses: Record<string, string> = {
    'Returning Series': t('läuft weiter'),
    Ended: t('beendet'),
    Canceled: t('abgesetzt'),
    'In Production': t('in Produktion'),
    Planned: t('geplant'),
  }
  const castList: any[] = (type === 'movie' ? d.credits?.cast : d.aggregate_credits?.cast) ?? []
  const title: string = (type === 'movie' ? d.title : d.name) ?? ''
  const original: string = (type === 'movie' ? d.original_title : d.original_name) ?? ''
  const date: string = (type === 'movie' ? d.release_date : d.first_air_date) ?? ''

  const details: TitleDetails = {
    type,
    tmdb_id: id,
    title,
    original_title: original && original !== title ? original : null,
    tagline: tagline || null,
    overview: overview || null,
    year: Number(date.slice(0, 4)) || null,
    genres: (d.genres ?? []).map((g: any) => String(g.name)),
    runtime: (type === 'movie' ? d.runtime : (d.episode_run_time?.[0] ?? d.last_episode_to_air?.runtime)) || null,
    seasons: type === 'show' ? (d.number_of_seasons ?? null) : null,
    episodes: type === 'show' ? (d.number_of_episodes ?? null) : null,
    status: type === 'show' ? (statuses[d.status] ?? d.status ?? null) : null,
    certification: certification || null,
    vote: d.vote_count ? Math.round(d.vote_average * 10) / 10 : null,
    votes: d.vote_count ?? 0,
    creators:
      type === 'movie'
        ? (d.credits?.crew ?? []).filter((c: any) => c.job === 'Director').map((c: any) => String(c.name))
        : (d.created_by ?? []).map((c: any) => String(c.name)),
    cast: castList.slice(0, 8).map((c) => String(c.name)),
    overviewFallback,
    trailer: trailer?.key ?? null,
    trailerOther: trailerOther?.key ?? null,
    poster: d.poster_path ?? null,
    backdrop: d.backdrop_path ?? null,
  }
  detailCache.set(key, { at: Date.now(), details })
  return details
}

export interface SeasonPlan {
  /** Zahl der Folgen je Staffel laut TMDB */
  episodes: Map<number, number>
  /** Staffel, in der noch eine Folge aussteht; null, wenn gerade nichts angekündigt ist */
  airing: number | null
}

const seasonCache = new Map<number, { at: number; plan: SeasonPlan }>()

/** Wie viele Folgen jede Staffel einer Serie hat und ob noch welche kommen; daran lässt sich erkennen, ob eine Staffel vollständig ist. */
export async function getSeasonPlan(tmdbId: number): Promise<SeasonPlan> {
  const cached = seasonCache.get(tmdbId)
  if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.plan
  const d = await tmdb(`/tv/${tmdbId}`)
  const plan: SeasonPlan = {
    episodes: new Map((d.seasons ?? []).map((s: any) => [Number(s.season_number), Number(s.episode_count ?? 0)])),
    airing: d.next_episode_to_air?.season_number ?? null,
  }
  seasonCache.set(tmdbId, { at: Date.now(), plan })
  return plan
}

export interface Keyword {
  id: number
  name: string
}

/** Schlagwörter, mit denen TMDB Titel einem Thema zuordnet; sie sind englisch. */
export async function searchKeywords(query: string): Promise<Keyword[]> {
  const data = await tmdb('/search/keyword', { query })
  return (data.results ?? []).slice(0, 12).map((k: any) => ({ id: Number(k.id), name: String(k.name) }))
}

/**
 * Alles, was TMDB zu einem Thema kennt: Filme und Serien, die eines der Schlagwörter tragen, die bekanntesten zuerst.
 * Anders als die Neustarts ist das kein Zeitraum, sondern der ganze Katalog. `date` ist der Tag der Erstausstrahlung.
 */
export async function getTopicTitles(keywords: number[], docsOnly: boolean, region: string): Promise<Release[]> {
  if (!keywords.length) return []
  const base = { with_keywords: keywords.join('|') }
  // Bei Serien zählt auch „Reality“: Dort stehen viele Begleit-Dokus über Notaufnahmen, Polizei oder Zoll
  const [shows, movies] = await Promise.all([
    discover('tv', { ...base, ...(docsOnly ? { with_genres: '99|10764' } : {}) }, 5),
    discover('movie', { ...base, ...(docsOnly ? { with_genres: '99' } : {}) }, 3),
  ])
  const items = [...shows.map((s) => ({ type: 'show' as const, id: s.id as number })), ...movies.map((m) => ({ type: 'movie' as const, id: m.id as number }))]
  const details = await mapLimit(items, 8, (i) =>
    tmdb(`/${i.type === 'show' ? 'tv' : 'movie'}/${i.id}`, { append_to_response: 'watch/providers' })
      .then((d) => ({ ...i, d }))
      .catch(() => null),
  )
  const titles: Release[] = []
  for (const x of details) {
    if (!x) continue
    const d = x.d
    const date = String((x.type === 'show' ? d.first_air_date : d.release_date) ?? '')
    titles.push({
      kind: 'topic',
      type: x.type,
      tmdb_id: d.id,
      title: x.type === 'show' ? d.name : d.title,
      year: Number(date.slice(0, 4)) || null,
      date,
      poster: d.poster_path ?? null,
      season: null,
      providers: providerNames(d['watch/providers']?.results?.[region]?.flatrate),
      popularity: Number(d.popularity ?? 0),
      documentary: isDocumentary(d),
    })
  }
  return titles.sort((a, b) => b.popularity - a.popularity)
}

/** Prüft den Schlüssel. */
export async function testTmdb(): Promise<void> {
  await tmdb('/configuration')
}
