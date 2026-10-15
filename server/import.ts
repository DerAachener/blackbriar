import { tautulliConfigured, tracearrConfigured } from './config.ts'
import { db, getSetting, now, recordingSince, setSetting, tx } from './db.ts'
import { t } from './i18n.ts'
import { getTautulliHistory } from './tautulli.ts'
import { getTracearrHistory } from './tracearr.ts'

// Tautulli und Tracearr dienen nur dazu, einmalig die Wiedergaben aus der Zeit zu holen, bevor Blackbriar
// selbst mitgeschrieben hat. Der Import wird von Hand angestoßen und lässt sich gefahrlos wiederholen.

export type ImportSource = 'tautulli' | 'tracearr'

interface Progress {
  running: boolean
  /** Bisher gelesene und insgesamt vorhandene Einträge der Quelle */
  read: number
  total: number
  error: string
}

const progress: Record<ImportSource, Progress> = {
  tautulli: { running: false, read: 0, total: 0, error: '' },
  tracearr: { running: false, read: 0, total: 0, error: '' },
}
const TABLE: Record<ImportSource, string> = { tautulli: 'plays', tracearr: 'tracearr_plays' }

export function importStatus() {
  const one = (source: ImportSource, configured: boolean) => ({
    configured,
    ...progress[source],
    /** Wiedergaben dieser Quelle in der Datenbank */
    count: Number(db.prepare(`SELECT COUNT(*) AS n FROM ${TABLE[source]}`).get()?.n ?? 0),
    lastImport: Number(getSetting(`import_${source}_at`) ?? 0) || null,
  })
  return { tautulli: one('tautulli', tautulliConfigured()), tracearr: one('tracearr', tracearrConfigured()), recordingSince }
}

async function importTautulli(state: Progress): Promise<void> {
  // Tautulli nennt die plex.tv-ID; der Besitzer hat auf dem Server aber die 1
  const byPlexId = new Map<number, number>()
  for (const u of db.prepare('SELECT id, plex_id FROM users WHERE plex_id IS NOT NULL').all()) byPlexId.set(u.plex_id as number, u.id as number)
  const insert = db.prepare(
    `INSERT OR IGNORE INTO plays (id, user_id, rating_key, show_key, type, title, show_title, started, duration, platform, player, decision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (let start = 0; ; ) {
    const page = await getTautulliHistory(start, 1000)
    tx(() => {
      for (const p of page.plays) {
        if (!p.id || !p.started || p.started >= recordingSince) continue
        insert.run(
          p.id,
          byPlexId.get(p.plexUserId) ?? p.plexUserId,
          p.ratingKey,
          p.type === 'episode' ? p.showKey : null,
          p.type,
          p.title,
          p.showTitle,
          p.started,
          p.duration,
          p.platform,
          p.player,
          p.decision,
        )
      }
    })
    start += page.plays.length
    state.read = start
    state.total = page.total
    if (page.plays.length === 0 || start >= page.total) return
  }
}

/** Tracearr kennt zu jeder Wiedergabe auch die Codecs; Transkodierungen landen deshalb zusätzlich in der Liste für die Bibliothek. */
async function importTracearr(state: Progress): Promise<void> {
  const names = new Map<string, number>()
  // Tracearr kennt die Benutzer unter ihrem Plex-Namen, nicht unter dem hier vergebenen
  for (const u of db.prepare('SELECT id, COALESCE(plex_name, name) AS name FROM users').all()) names.set(String(u.name).toLowerCase(), u.id as number)
  // Tracearr nennt bei Folgen mal den Schlüssel der Serie, mal den der Staffel. Verlässlicher ist der Titel:
  // Liegt er noch in der Bibliothek, zählt deren Schlüssel.
  const library = new Map<string, number>()
  for (const l of db.prepare('SELECT rating_key, type, title FROM library_items').all()) {
    library.set(`${l.type}:${String(l.title).toLowerCase()}`, l.rating_key as number)
  }
  const insert = db.prepare(
    `INSERT OR IGNORE INTO tracearr_plays (id, user_id, rating_key, show_key, type, title, show_title, started, duration, platform, player, decision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const insertTranscode = db.prepare(
    `INSERT OR IGNORE INTO transcodes (key, at, user_id, user_name, item_key, rating_key, title, player, platform,
       video_decision, audio_decision, src_video, src_audio, dst_video, dst_audio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (let page = 1; ; page++) {
    const result = await getTracearrHistory(page)
    tx(() => {
      for (const p of result.plays) {
        if (!p.id || !p.started || p.started >= recordingSince) continue
        // Tracearr nennt nur den Namen; Konten, die Blackbriar nicht kennt, landen unter der 0
        const userId = names.get(p.username.toLowerCase()) ?? 0
        const episode = p.type === 'episode'
        const itemKey = library.get(`${episode ? 'show' : 'movie'}:${(episode ? (p.showTitle ?? '') : p.title).toLowerCase()}`) ?? p.itemKey
        insert.run(
          p.id,
          userId,
          episode ? null : itemKey,
          episode ? itemKey : null,
          p.type,
          p.title,
          p.showTitle,
          p.started,
          p.duration,
          p.platform,
          p.player,
          p.decision,
        )
        if (p.decision === 'transcode' && itemKey) {
          insertTranscode.run(
            `tracearr:${p.id}`,
            p.started,
            userId,
            p.username,
            itemKey,
            itemKey,
            p.showTitle ? `${p.showTitle} – ${p.title}` : p.title,
            p.player,
            p.platform,
            p.videoDecision,
            p.audioDecision,
            p.srcVideo,
            p.srcAudio,
            p.dstVideo,
            p.dstAudio,
          )
        }
      }
    })
    state.read = Math.min(page * 100, result.total)
    state.total = result.total
    if (result.plays.length === 0 || page * 100 >= result.total) return
  }
}

/** Stößt den Import an und kehrt sofort zurück; den Fortschritt liefert `importStatus`. */
export function startImport(source: ImportSource): void {
  const state = progress[source]
  if (state.running) return
  if (!(source === 'tautulli' ? tautulliConfigured() : tracearrConfigured())) {
    throw new Error(t('Erst Adresse und Schlüssel eintragen und speichern.'))
  }
  Object.assign(state, { running: true, read: 0, total: 0, error: '' })
  void (source === 'tautulli' ? importTautulli(state) : importTracearr(state))
    .then(() => setSetting(`import_${source}_at`, String(now())))
    .catch((err: Error) => {
      state.error = err.message
    })
    .finally(() => {
      state.running = false
    })
}
