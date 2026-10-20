import { backupStatus } from './backup.ts'
import { mailConfigured, plexConfigured, seerrConfigured, telegramConfigured } from './config.ts'
import { db, getSettings, installedAt, now, openItems, sectionLabel } from './db.ts'
import { t } from './i18n.ts'
import { effectivePrefs, lastSlot, type MailPrefs } from './mailprefs.ts'
import { cleanupCandidates, episodeCleanup } from './media.ts'
import { syncStatus } from './sync.ts'

// Was die Startseite über das hinaus braucht, was die einzelnen Ansichten schon liefern:
// die Zahlen für die Kacheln, was zuletzt dazugekommen ist und was Aufmerksamkeit braucht.

export interface AddedItem {
  rating_key: number
  type: 'movie' | 'show'
  title: string
  year: number | null
  thumb: string | null
  /** Mediathek für die Anzeige, siehe sectionLabel */
  section: string | null
  added_at: number
  /** Bei Serien, was dazukam, z. B. „Staffel 2 · 3 neue Folgen“ */
  detail: string
}

const WEEK = 7 * 86400

/** Filme und Serien, zu denen in den letzten sieben Tagen etwas dazugekommen ist, das Neueste zuerst. */
function recentlyAdded(): AddedItem[] {
  const from = now() - WEEK
  const label = sectionLabel()
  const movies = db
    .prepare("SELECT rating_key, title, year, thumb, section, added_at FROM library_items WHERE type = 'movie' AND added_at > ?")
    .all(from)
    .map((m) => ({ ...(m as unknown as AddedItem), section: label(m.section, 'movie'), type: 'movie' as const, detail: '' }))
  const shows = new Map<number, AddedItem & { parts: string[] }>()
  for (const r of db
    .prepare(
      `SELECT l.rating_key, l.title, l.year, l.thumb, l.section, f.season, COUNT(*) AS episodes, MAX(f.added_at) AS added_at
       FROM media_files f JOIN library_items l ON l.rating_key = f.item_key AND l.type = 'show'
       WHERE f.rating_key <> f.item_key AND f.added_at > ?
       GROUP BY l.rating_key, f.season ORDER BY f.season`,
    )
    .all(from)) {
    const key = r.rating_key as number
    const show = shows.get(key) ?? {
      rating_key: key,
      type: 'show' as const,
      title: r.title as string,
      year: r.year as number | null,
      thumb: r.thumb as string | null,
      section: label(r.section, 'show'),
      added_at: 0,
      detail: '',
      parts: [],
    }
    show.added_at = Math.max(show.added_at, Number(r.added_at))
    const n = Number(r.episodes)
    show.parts.push(`${t('Staffel {n}', { n: Number(r.season ?? 0) })} · ${t(n === 1 ? '{n} neue Folge' : '{n} neue Folgen', { n })}`)
    shows.set(key, show)
  }
  return [...movies, ...[...shows.values()].map(({ parts, ...show }) => ({ ...show, detail: parts.join(', ') }))]
    .sort((a, b) => b.added_at - a.added_at)
    .slice(0, 24)
}

/** Der nächste Termin nach dem letzten, für Newsletter mit festem Wochentag. */
export function nextSlot(prefs: MailPrefs): number {
  const d = new Date(lastSlot(prefs) * 1000)
  if (prefs.rhythm !== 'monthly') {
    // Über das Datum gerechnet, damit die Uhrzeit auch über die Zeitumstellung hinweg stimmt
    d.setDate(d.getDate() + 7)
    return Math.floor(d.getTime() / 1000)
  }
  // Erster passender Wochentag des Folgemonats
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1, prefs.hour, 0, 0)
  next.setDate(1 + ((prefs.day - next.getDay() + 7) % 7))
  return Math.floor(next.getTime() / 1000)
}

/** Wann der Wochenrückblick per Telegram das nächste Mal fällig ist. */
function nextWeekly(): number | null {
  const settings = getSettings()
  if (!settings.weeklyEnabled || !telegramConfigured()) return null
  const at = new Date()
  const next = new Date(at.getFullYear(), at.getMonth(), at.getDate(), settings.weeklyHour, 0, 0)
  next.setDate(next.getDate() + ((settings.weeklyDay - next.getDay() + 7) % 7))
  if (next <= at) next.setDate(next.getDate() + 7)
  return Math.floor(next.getTime() / 1000)
}

export function dashboard() {
  const candidates = cleanupCandidates()
  const episodes = episodeCleanup()

  // Angefragt und freigegeben, aber noch nicht auf dem Server
  const pending = Number(
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM (
           SELECT DISTINCT r.type, r.tmdb_id FROM requests r
           WHERE r.status IN (1, 2) AND COALESCE(r.media_status, 0) NOT IN (4, 5)
             AND NOT EXISTS (SELECT 1 FROM library_items l WHERE l.type = r.type AND l.tmdb_id = r.tmdb_id)
         )`,
      )
      .get()?.n ?? 0,
  )

  // Frühester Newsletter-Termin über alle, die ihn bekommen
  let newsletter: number | null = null
  let recipients = 0
  if (mailConfigured()) {
    for (const u of db.prepare('SELECT id FROM users WHERE active = 1 AND newsletter_unsub IS NULL').all()) {
      const prefs = effectivePrefs(u.id as number)
      if (!prefs.newsletter) continue
      recipients++
      const slot = nextSlot(prefs)
      if (newsletter == null || slot < newsletter) newsletter = slot
    }
  }

  const warnings: string[] = []
  if (syncStatus.lastError) warnings.push(t('Letzter Abgleich mit Fehler: {error}', { error: syncStatus.lastError }))
  const mailErrors = Number(db.prepare('SELECT COUNT(*) AS n FROM mail_log WHERE ok = 0 AND at > ?').get(now() - WEEK)?.n ?? 0)
  if (mailErrors) warnings.push(t(mailErrors === 1 ? '{n} Mail in den letzten sieben Tagen nicht verschickt' : '{n} Mails in den letzten sieben Tagen nicht verschickt', { n: mailErrors }))
  const backup = backupStatus()
  // Die Sicherung läuft täglich; fehlt sie zwei Tage, stimmt etwas nicht
  const backupAge = backup.latest ? (Date.now() - Date.parse(`${backup.latest}T12:00:00`)) / 86400_000 : Infinity
  const firstDay = !backup.latest && installedAt > now() - 86400
  if (backupAge > 2 && !firstDay) warnings.push(backup.latest ? t('Die letzte Sicherung der Datenbank ist vom {date}', { date: backup.latest }) : t('Es gibt noch keine Sicherung der Datenbank'))
  const unsubscribed = Number(db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1 AND (newsletter_unsub IS NOT NULL OR reminder_unsub IS NOT NULL)').get()?.n ?? 0)

  return {
    open: openItems().length,
    cleanup: {
      titles: candidates.length,
      size: candidates.reduce((sum, c) => sum + c.size, 0),
      episodes: episodes.reduce((sum, e) => sum + e.episodes, 0),
      episodeSize: episodes.reduce((sum, e) => sum + e.size, 0),
    },
    // Ohne Seerr gibt es keine Wünsche; die Kachel entfällt dann
    pending: seerrConfigured() ? pending : null,
    added: recentlyAdded(),
    warnings,
    // Ohne Plex läuft noch kein Abgleich; dann gibt es auch kein „alles läuft“
    ready: plexConfigured(),
    unsubscribed,
    next: { newsletter, recipients, weekly: nextWeekly() },
  }
}
