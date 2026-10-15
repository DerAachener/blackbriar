import { config } from './config.ts'
import { t } from './i18n.ts'
import { reach } from './net.ts'

// Seerr kennt die Plex-Merklisten aller Benutzer, weil sich dort jeder mit seinem
// Plex-Konto anmeldet. Die Server-Tokens, die Blackbriar selbst hat, reichen dafür nicht.
async function seerr(path: string, method = 'GET', body?: unknown): Promise<any> {
  const res = await reach('Seerr', `${config.seerrUrl}/api/v1${path}`, {
    method,
    headers: { 'X-Api-Key': config.seerrApiKey, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) throw new Error(t('{name} antwortet mit {status} auf {path}', { name: 'Seerr', status: res.status, path: path.split('?')[0]! }))
  return res.status === 204 ? null : res.json().catch(() => null)
}

export interface SeerrUser {
  id: number
  plexId: number | null
  name: string
}

export async function getSeerrUsers(): Promise<SeerrUser[]> {
  const users: SeerrUser[] = []
  for (let skip = 0; ; skip += 100) {
    const page = await seerr(`/user?take=100&skip=${skip}`)
    const results = page.results ?? []
    for (const u of results) {
      users.push({ id: u.id, plexId: u.plexId ?? null, name: u.plexUsername || u.username || u.displayName || '' })
    }
    if (results.length < 100) return users
  }
}

export interface WatchlistEntry {
  type: 'movie' | 'show'
  tmdbId: number
  title: string
}

export async function getWatchlist(seerrUserId: number): Promise<WatchlistEntry[]> {
  const entries: WatchlistEntry[] = []
  for (let page = 1; ; page++) {
    const data = await seerr(`/user/${seerrUserId}/watchlist?page=${page}`)
    for (const item of data.results ?? []) {
      if (!item.tmdbId) continue
      entries.push({ type: item.mediaType === 'tv' ? 'show' : 'movie', tmdbId: Number(item.tmdbId), title: item.title ?? '' })
    }
    // Obergrenze als Schutz, falls Seerr die Seitenzahl falsch meldet
    if (page >= (data.totalPages ?? 1) || page >= 50) return entries
  }
}

export interface SeerrRequest {
  id: number
  seerrUserId: number
  type: 'movie' | 'show'
  tmdbId: number
  /** 1 wartet auf Freigabe, 2 genehmigt, 3 abgelehnt, 4 fehlgeschlagen, 5 abgeschlossen */
  status: number
  /** 2 angefragt, 3 in Arbeit, 4 teilweise verfügbar, 5 verfügbar */
  mediaStatus: number | null
  /** Fortschritt eines laufenden Downloads, 0 bis 1 */
  progress: number | null
  createdAt: number | null
}

export async function getRequests(): Promise<SeerrRequest[]> {
  const requests: SeerrRequest[] = []
  for (let skip = 0; skip < 20_000; skip += 100) {
    const page = await seerr(`/request?take=100&skip=${skip}&filter=all&sort=added`)
    const results = page.results ?? []
    for (const r of results) {
      if (!r.media?.tmdbId) continue
      // Seerr führt für 4K-Anfragen einen eigenen Stand
      const downloads: any[] = (r.is4k ? r.media.downloadStatus4k : r.media.downloadStatus) ?? []
      const size = downloads.reduce((sum, d) => sum + (d.size ?? 0), 0)
      const left = downloads.reduce((sum, d) => sum + (d.sizeLeft ?? 0), 0)
      requests.push({
        id: r.id,
        seerrUserId: r.requestedBy?.id ?? 0,
        type: r.type === 'tv' ? 'show' : 'movie',
        tmdbId: Number(r.media.tmdbId),
        status: r.status,
        mediaStatus: (r.is4k ? r.media.status4k : r.media.status) ?? null,
        progress: size > 0 ? 1 - left / size : null,
        createdAt: r.createdAt ? Math.floor(Date.parse(r.createdAt) / 1000) : null,
      })
    }
    if (results.length < 100) break
  }
  return requests
}

/** Prüft den Zugang; liefert den Namen des Kontos, zu dem der API-Key gehört. */
export async function testSeerr(): Promise<string> {
  const me = await seerr('/auth/me')
  return me.displayName || me.plexUsername || me.email || 'Admin'
}

/** Fragt einen Film bzw. eine Staffel (ohne Angabe: alle Staffeln) in Seerr an. */
export async function requestMedia(type: 'movie' | 'show', tmdbId: number, season?: number | null): Promise<void> {
  await seerr('/request', 'POST', {
    mediaType: type === 'show' ? 'tv' : 'movie',
    mediaId: tmdbId,
    ...(type === 'show' ? { seasons: season ? [season] : 'all' } : {}),
  })
}

/** Entfernt den Titel samt seinen Anfragen aus Seerr, damit er erneut gewünscht werden kann. */
export async function resetSeerrMedia(type: 'movie' | 'show', tmdbId: number): Promise<void> {
  const id = (await seerr(`/${type === 'show' ? 'tv' : 'movie'}/${tmdbId}`))?.mediaInfo?.id
  if (id) await seerr(`/media/${id}`, 'DELETE')
}

/** Sucht einen Titel und liefert den Poster-Pfad des ersten Treffers der passenden Art, sonst einen leeren Text. */
export async function searchPoster(type: 'movie' | 'show', title: string): Promise<string> {
  // Seerr lehnt die Zeichen !'()* unkodiert ab, encodeURIComponent lässt sie aber stehen
  const query = encodeURIComponent(title).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  const data = await seerr(`/search?query=${query}&page=1&language=de`)
  const wanted = type === 'show' ? 'tv' : 'movie'
  const hit = (data.results ?? []).find((r: any) => r.mediaType === wanted && r.posterPath)
  return hit?.posterPath ?? ''
}

/** Deutscher Titel, Poster und Jahr aus den TMDB-Daten, die Seerr zwischenspeichert. */
export async function getDetails(
  type: 'movie' | 'show',
  tmdbId: number,
): Promise<{ title: string | null; poster: string; year: number | null }> {
  const data = await seerr(`/${type === 'show' ? 'tv' : 'movie'}/${tmdbId}?language=de`)
  const date: string = data.releaseDate || data.firstAirDate || ''
  return { title: data.title || data.name || null, poster: data.posterPath ?? '', year: Number(date.slice(0, 4)) || null }
}
