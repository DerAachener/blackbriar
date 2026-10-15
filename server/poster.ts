import { config, tmdbConfigured } from './config.ts'
import { db, getSetting, getSettings, setSetting } from './db.ts'
import type { Attachment } from './mail.ts'
import { posterUrl } from './mailprefs.ts'
import { reach } from './net.ts'
import { plexImage } from './plex.ts'
import { getDetails } from './tmdb.ts'

/**
 * Das Poster eines Bibliothekstitels für eine Mail. Zuerst das Bild aus Plex; hat Plex keines, etwa bei einer ganz neuen
 * Serie, kommt es von TMDB. null, wenn beides nichts liefert.
 */
export async function posterImage(thumb: string | null, ratingKey: number | null, width: number, height: number): Promise<{ data: Buffer; type: string } | null> {
  if (thumb) {
    try {
      const img = await plexImage(thumb, width, height)
      return { data: Buffer.from(img.data), type: img.type.split(';')[0]! }
    } catch {
      // weiter mit TMDB
    }
  }
  if (ratingKey == null || !tmdbConfigured()) return null
  try {
    const item = db.prepare('SELECT type, tmdb_id FROM library_items WHERE rating_key = ?').get(ratingKey)
    if (!item?.tmdb_id || (item.type !== 'movie' && item.type !== 'show')) return null
    const path = (await getDetails(item.type, item.tmdb_id as number, getSettings().upcomingRegion)).poster
    if (!path) return null
    const res = await reach('TMDB', `https://image.tmdb.org/t/p/w342${path}`, { signal: AbortSignal.timeout(20_000) })
    if (!res.ok) return null
    return { data: Buffer.from(await res.arrayBuffer()), type: (res.headers.get('content-type') ?? 'image/jpeg').split(';')[0]! }
  } catch {
    return null
  }
}

/**
 * Ob die Poster in den Mails von Blackbriar geladen statt angehängt werden. Angehängt erscheinen sie überall sofort,
 * manche Mailprogramme listen sie dann aber zusätzlich als Anhänge auf, und die Mail wird über ein Megabyte groß.
 * Laden geht nur, wenn Blackbriar von außen erreichbar ist.
 */
export const remotePosters = (): boolean => getSetting('mail_posters') === 'remote' && Boolean(config.publicUrl)

export function setRemotePosters(on: boolean): void {
  setSetting('mail_posters', on ? 'remote' : 'attach')
}

/**
 * Die Quelle für das <img> eines Posters in einer Mail: die Adresse bei Blackbriar oder ein Verweis auf den Anhang,
 * den die Funktion dann selbst anhängt. null, wenn es kein Bild gibt.
 */
export async function mailPoster(thumb: string | null, ratingKey: number | null, cid: string, attachments: Attachment[], width: number, height: number): Promise<string | null> {
  if (ratingKey != null && remotePosters()) {
    const url = posterUrl(ratingKey)
    if (url) return url
  }
  const img = await posterImage(thumb, ratingKey, width, height)
  if (!img) return null
  attachments.push({ cid, filename: `${cid}.jpg`, content: img.data, contentType: img.type })
  return `cid:${cid}`
}
