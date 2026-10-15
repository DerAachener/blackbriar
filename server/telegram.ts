import { config } from './config.ts'
import { plexImage } from './plex.ts'
import { logEvent } from './events.ts'
import { t } from './i18n.ts'

export const escapeHtml = (s: string) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** Prüft das Bot-Token, ohne eine Nachricht zu schicken; liefert den Namen des Bots. */
export async function testTelegram(): Promise<string> {
  const res = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getMe`, { signal: AbortSignal.timeout(30_000) })
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: { username?: string } }
  if (!body.ok) throw new Error(t('{name} antwortet mit {status}: {detail}', { name: 'Telegram', status: res.status, detail: body.description ?? t('unbekannter Fehler') }))
  return body.result?.username ?? 'unbekannt'
}

/** Schickt eine Nachricht, wenn möglich mit Poster, und hält im Protokoll fest, ob es geklappt hat. */
export async function sendTelegram(html: string, thumb?: string | null): Promise<void> {
  // Fürs Protokoll reicht die erste Zeile ohne Formatierung
  const summary = (html.split('\n')[0] ?? '').replace(/<[^>]+>/g, '').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
  try {
    await deliver(html, thumb)
    logEvent('telegram', summary)
  } catch (err) {
    logEvent('telegram', t('Nicht verschickt: {summary} ({error})', { summary, error: (err as Error).message }), 'error')
    throw err
  }
}

async function deliver(html: string, thumb?: string | null): Promise<void> {
  const base = `https://api.telegram.org/bot${config.telegramBotToken}`

  if (thumb) {
    try {
      const img = await plexImage(thumb, 400, 600)
      const form = new FormData()
      form.set('chat_id', config.telegramChatId)
      form.set('caption', html)
      form.set('parse_mode', 'HTML')
      form.set('photo', new Blob([img.data], { type: img.type }), 'poster.jpg')
      const res = await fetch(`${base}/sendPhoto`, { method: 'POST', body: form, signal: AbortSignal.timeout(30_000) })
      if (res.ok) return
    } catch {
      // Ohne Poster weiter unten als Text
    }
  }

  const res = await fetch(`${base}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: config.telegramChatId, text: html, parse_mode: 'HTML' }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { description?: string }
    throw new Error(t('{name} antwortet mit {status}: {detail}', { name: 'Telegram', status: res.status, detail: body.description ?? t('unbekannter Fehler') }))
  }
}
