import { config, plexConfigured } from './config.ts'
import { db, now } from './db.ts'
import { pms } from './plex.ts'

export interface Session {
  id: string
  userId: number
  user: string
  type: string
  title: string
  showTitle: string | null
  season: number | null
  episode: number | null
  year: number | null
  thumb: string | null
  durationMs: number
  offsetMs: number
  state: string
  player: string
  platform: string
  location: string
  decision: string
  resolution: string | null
  bandwidthKbps: number | null
}

let sessions: Session[] = []
let error = ''

export const getSessions = () => ({ sessions, error })

const insertTranscode = db.prepare(
  `INSERT OR IGNORE INTO transcodes (key, at, user_id, user_name, item_key, rating_key, title, player, platform,
     video_decision, audio_decision, src_video, src_audio, dst_video, dst_audio)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
)

/** Merkt sich jede Wiedergabe, bei der Plex Bild oder Ton umrechnen muss, einmal pro Sitzung und Titel. */
function recordTranscode(m: any): void {
  const t = m.TranscodeSession
  if (!t || (t.videoDecision !== 'transcode' && t.audioDecision !== 'transcode')) return
  const ratingKey = Number(m.ratingKey)
  if (!ratingKey) return
  insertTranscode.run(
    `${m.Session?.id ?? m.sessionKey}:${ratingKey}`,
    now(),
    Number(m.User?.id ?? 0),
    m.User?.title ?? 'Unbekannt',
    Number(m.grandparentRatingKey ?? ratingKey),
    ratingKey,
    m.grandparentTitle ? `${m.grandparentTitle} – ${m.title}` : (m.title ?? ''),
    m.Player?.title ?? null,
    m.Player?.product ?? m.Player?.platform ?? null,
    t.videoDecision ?? null,
    t.audioDecision ?? null,
    t.sourceVideoCodec ?? null,
    t.sourceAudioCodec ?? null,
    t.videoCodec ?? null,
    t.audioCodec ?? null,
  )
}

const upsertPlay = db.prepare(
  `INSERT INTO own_plays (session, user_id, rating_key, show_key, type, title, show_title, started, last_seen, platform, player, decision)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT(session) DO UPDATE SET
     duration = duration + CASE WHEN ? THEN MIN(excluded.last_seen - last_seen, ?) ELSE 0 END,
     last_seen = excluded.last_seen,
     decision = CASE WHEN excluded.decision = 'transcode' THEN 'transcode' ELSE decision END`,
)

/**
 * Schreibt die Wiedergabe fort: Bei jeder Abfrage wächst die Dauer um die seither vergangene Zeit,
 * aber nur, solange wirklich abgespielt wird. Die Obergrenze fängt Lücken nach einem Neustart ab.
 */
function recordPlay(m: any): void {
  const ratingKey = Number(m.ratingKey)
  if (!ratingKey || !m.User?.id) return
  const t = m.TranscodeSession
  const decision = !t ? 'direct play' : t.videoDecision === 'transcode' || t.audioDecision === 'transcode' ? 'transcode' : 'copy'
  const playing = m.Player?.state === 'playing'
  upsertPlay.run(
    `${m.Session?.id ?? m.sessionKey}:${ratingKey}`,
    Number(m.User.id),
    ratingKey,
    m.grandparentRatingKey ? Number(m.grandparentRatingKey) : null,
    m.type ?? 'unknown',
    m.title ?? '',
    m.grandparentTitle ?? null,
    now(),
    now(),
    m.Player?.platform ?? m.Player?.product ?? null,
    m.Player?.title ?? null,
    decision,
    playing ? 1 : 0,
    config.sessionsIntervalSec * 3,
  )
}

export async function pollSessions(): Promise<void> {
  if (!plexConfigured()) return
  try {
    const mc = await pms('/status/sessions')
    for (const m of mc.Metadata ?? []) {
      recordTranscode(m)
      recordPlay(m)
    }
    const names = new Map(db.prepare('SELECT id, name FROM users').all().map((u) => [u.id as number, u.name as string]))
    sessions = (mc.Metadata ?? []).map((m: any): Session => {
      const video = m.TranscodeSession?.videoDecision
      return {
        id: String(m.sessionKey ?? m.Session?.id ?? m.ratingKey),
        userId: Number(m.User?.id ?? 0),
        user: names.get(Number(m.User?.id ?? 0)) ?? m.User?.title ?? 'Unbekannt',
        type: m.type,
        title: m.title ?? '',
        showTitle: m.grandparentTitle ?? null,
        season: m.parentIndex ?? null,
        episode: m.index ?? null,
        year: m.year ?? null,
        thumb: m.grandparentThumb ?? m.parentThumb ?? m.thumb ?? null,
        durationMs: Number(m.duration ?? 0),
        offsetMs: Number(m.viewOffset ?? 0),
        state: m.Player?.state ?? 'playing',
        player: m.Player?.title ?? '',
        platform: m.Player?.product ?? m.Player?.platform ?? '',
        location: m.Session?.location ?? '',
        decision: !m.TranscodeSession ? 'Direct Play' : video === 'transcode' ? 'Transcode' : 'Direct Stream',
        resolution: m.Media?.[0]?.videoResolution ?? null,
        bandwidthKbps: m.Session?.bandwidth ?? null,
      }
    })
    error = ''
  } catch (err) {
    sessions = []
    error = (err as Error).message
  }
}
