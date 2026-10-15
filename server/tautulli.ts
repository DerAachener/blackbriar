import { config } from './config.ts'
import { t } from './i18n.ts'
import { reach } from './net.ts'

async function tautulli(cmd: string, params: Record<string, string | number> = {}): Promise<any> {
  const query = new URLSearchParams({ apikey: config.tautulliApiKey, cmd })
  for (const [k, v] of Object.entries(params)) query.set(k, String(v))
  const res = await reach('Tautulli', `${config.tautulliUrl}/api/v2?${query}`, { signal: AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(t('{name} antwortet mit {status} auf {path}', { name: 'Tautulli', status: res.status, path: cmd }))
  const body = ((await res.json()) as any).response
  if (body?.result !== 'success') throw new Error(t('Tautulli meldet bei {cmd}: {detail}', { cmd, detail: body?.message ?? t('unbekannter Fehler') }))
  return body.data
}

export interface TautulliPlay {
  id: number
  /** Konto-ID bei plex.tv */
  plexUserId: number
  ratingKey: number | null
  showKey: number | null
  type: string
  title: string
  showTitle: string | null
  started: number
  /** Tatsächlich gesehene Zeit in Sekunden, ohne Pausen */
  duration: number
  platform: string | null
  player: string | null
  /** direct play, copy (Direct Stream) oder transcode */
  decision: string | null
}

/** Eine Seite des Verlaufs, neueste zuerst. */
export async function getTautulliHistory(start: number, length: number): Promise<{ total: number; plays: TautulliPlay[] }> {
  const data = await tautulli('get_history', { start, length, order_column: 'date', order_dir: 'desc', grouping: 0 })
  const plays = (data.data ?? []).map(
    (r: any): TautulliPlay => ({
      id: Number(r.row_id ?? r.id ?? r.reference_id),
      plexUserId: Number(r.user_id),
      ratingKey: Number(r.rating_key) || null,
      showKey: Number(r.grandparent_rating_key) || null,
      type: r.media_type ?? 'unknown',
      title: r.title ?? r.full_title ?? '',
      showTitle: r.grandparent_title || null,
      started: Number(r.started ?? r.date),
      duration: Number(r.play_duration ?? r.duration ?? 0),
      platform: r.platform || null,
      player: r.player || null,
      decision: r.transcode_decision || null,
    }),
  )
  return { total: Number(data.recordsFiltered ?? data.recordsTotal ?? 0), plays }
}

/** Prüft den Zugang; liefert die Tautulli-Version. */
export async function testTautulli(): Promise<string> {
  return (await tautulli('get_tautulli_info')).tautulli_version ?? 'unbekannt'
}
