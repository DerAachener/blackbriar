import { telegramConfigured } from './config.ts'
import { db, getSetting, getSettings, now, openItems, setSetting, watchlistTitles } from './db.ts'
import { locale, t } from './i18n.ts'
import { stars } from './sync.ts'
import { escapeHtml, sendTelegram } from './telegram.ts'

const shortDate = (date: Date) => date.toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })

/** Fasst die letzten sieben Tage zusammen: gesehen, bewertet, offen, noch auf der Merkliste. */
export function buildWeekly(): string {
  const since = now() - 7 * 86400
  const sections: string[] = [
    t('📊 <b>Wochenrückblick</b> · {from} – {to}', { from: shortDate(new Date(since * 1000)), to: shortDate(new Date()) }),
  ]

  const seen = db
    .prepare(
      `SELECT COALESCE(u.name, 'Konto ' || h.user_id) AS name,
         SUM(h.type = 'movie') AS movies, SUM(h.type = 'episode') AS episodes
       FROM history h LEFT JOIN users u ON u.id = h.user_id
       WHERE h.viewed_at >= ? GROUP BY h.user_id ORDER BY COUNT(*) DESC`,
    )
    .all(since)
  sections.push(
    `${t('<b>Gesehen</b>')}\n` +
      (seen.length
        ? seen
            .map((s) => {
              const movies = s.movies as number
              const episodes = s.episodes as number
              const parts = []
              if (movies) parts.push(t(movies === 1 ? '{n} Film' : '{n} Filme', { n: movies }))
              if (episodes) parts.push(t(episodes === 1 ? '{n} Folge' : '{n} Folgen', { n: episodes }))
              return `${escapeHtml(s.name as string)}: ${parts.join(', ')}`
            })
            .join('\n')
        : t('Niemand hat etwas gesehen.')),
  )

  const rated = db
    .prepare(
      `SELECT u.name, r.title, r.rating FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE r.rated_at >= ? ORDER BY r.rated_at DESC`,
    )
    .all(since)
  const shown = rated.slice(0, 15).map((r) => `${escapeHtml(r.name as string)}: ${escapeHtml(r.title as string)} ${stars(r.rating as number)}`)
  if (rated.length > shown.length) shown.push(t('… und {n} weitere', { n: rated.length - shown.length }))
  sections.push(`${t('<b>Bewertet</b>')}\n` + (shown.length ? shown.join('\n') : t('Keine neuen Bewertungen.')))

  const open = new Map<string, number>()
  for (const o of openItems()) open.set(o.user_name, (open.get(o.user_name) ?? 0) + 1)
  if (open.size) {
    const list = [...open].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${escapeHtml(name)}: ${n}`)
    sections.push(`${t('<b>Gesehen, aber nicht bewertet</b>')}\n` + list.join('\n'))
  }

  const stale = new Map<string, string[]>()
  for (const item of watchlistTitles()) {
    for (const p of item.people) {
      const finished = item.type === 'show' ? item.leaf_count > 0 && (p.watched ?? 0) >= item.leaf_count : p.seen_at != null
      if (finished) stale.set(p.name, [...(stale.get(p.name) ?? []), item.title])
    }
  }
  if (stale.size) {
    const list = [...stale].map(([name, titles]) => `${escapeHtml(name)}: ${escapeHtml(titles.join(', '))}`)
    sections.push(`${t('<b>Gesehen, aber noch auf der Merkliste</b>')}\n` + list.join('\n'))
  }

  // Telegram nimmt höchstens 4096 Zeichen
  const text = sections.join('\n\n')
  return text.length > 4000 ? `${text.slice(0, text.lastIndexOf('\n', 3990))}\n…` : text
}

let sending = false

/** Wird jede Minute aufgerufen und verschickt den Rückblick einmal am eingestellten Wochentag ab der eingestellten Stunde. */
export async function maybeSendWeekly(): Promise<void> {
  const settings = getSettings()
  if (sending || !settings.weeklyEnabled || !telegramConfigured()) return
  const date = new Date()
  if (date.getDay() !== settings.weeklyDay || date.getHours() < settings.weeklyHour) return
  const today = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
  if (getSetting('weekly_last_sent') === today) return
  sending = true
  try {
    await sendTelegram(buildWeekly())
    setSetting('weekly_last_sent', today)
  } catch (err) {
    console.error(t('Wochenrückblick nicht verschickt:'), (err as Error).message)
  } finally {
    sending = false
  }
}
