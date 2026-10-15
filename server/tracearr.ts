import { config } from './config.ts'
import { t } from './i18n.ts'
import { reach } from './net.ts'

async function tracearr(path: string): Promise<any> {
  const res = await reach('Tracearr', `${config.tracearrUrl}/api/v1/public${path}`, {
    headers: { Authorization: `Bearer ${config.tracearrApiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) throw new Error(t('{name} antwortet mit {status}', { name: 'Tracearr', status: res.status }))
  return res.json()
}

export interface TracearrPlay {
  id: string
  username: string
  /** Bei Filmen der ratingKey des Films, bei Folgen der Serie; aus dem Poster-Pfad gelesen */
  itemKey: number | null
  type: string
  title: string
  showTitle: string | null
  started: number
  /** Tatsächlich gesehene Zeit in Sekunden */
  duration: number
  platform: string | null
  player: string | null
  /** direct play, copy (Direct Stream) oder transcode */
  decision: string
  videoDecision: string | null
  audioDecision: string | null
  srcVideo: string | null
  srcAudio: string | null
  dstVideo: string | null
  dstAudio: string | null
}

/** Eine Seite des Verlaufs, neueste zuerst; Tracearr gibt höchstens 100 Einträge pro Seite. */
export async function getTracearrHistory(page: number): Promise<{ total: number; plays: TracearrPlay[] }> {
  const data = await tracearr(`/history?page=${page}&pageSize=100`)
  const plays = ((data.data ?? []) as any[]).map((s): TracearrPlay => {
    const transcode = s.isTranscode || s.videoDecision === 'transcode' || s.audioDecision === 'transcode'
    const copy = s.videoDecision === 'copy' || s.audioDecision === 'copy'
    const key = /\/library\/metadata\/(\d+)/.exec(s.thumbPath ?? '')
    return {
      id: String(s.id),
      username: s.user?.username ?? '',
      itemKey: key ? Number(key[1]) : null,
      type: s.mediaType ?? 'unknown',
      title: s.mediaTitle ?? '',
      showTitle: s.showTitle || null,
      started: Math.floor(Date.parse(s.startedAt) / 1000) || 0,
      duration: Math.round(Number(s.durationMs ?? 0) / 1000),
      platform: s.platform || null,
      player: s.player || s.device || null,
      decision: transcode ? 'transcode' : copy ? 'copy' : 'direct play',
      videoDecision: s.videoDecision ?? null,
      audioDecision: s.audioDecision ?? null,
      srcVideo: s.sourceVideoCodec?.toLowerCase() ?? null,
      srcAudio: s.sourceAudioCodec?.toLowerCase() ?? null,
      dstVideo: s.streamVideoCodec?.toLowerCase() ?? null,
      dstAudio: s.streamAudioCodec?.toLowerCase() ?? null,
    }
  })
  return { total: Number(data.meta?.total ?? 0), plays }
}

/** Prüft den Zugang; liefert die Tracearr-Version. */
export async function testTracearr(): Promise<string> {
  return (await tracearr('/health')).version ?? ''
}
