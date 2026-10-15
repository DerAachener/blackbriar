import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { config } from './config.ts'
import { db, getSetting, now, setSetting } from './db.ts'
import { t } from './i18n.ts'
import { notifyOwner } from './mail.ts'
import { logEvent } from './events.ts'

// Einstellungen für die Mails an die Benutzer: ein Standard für alle und, getrennt für Newsletter und
// Erinnerung, eigene Einstellungen pro Benutzer. Dazu die unterschriebenen Links, die in den Mails stehen.

export interface MailPrefs {
  newsletter: boolean
  rhythm: 'weekly' | 'biweekly' | 'monthly'
  /** 0 = Sonntag … 6 = Samstag; bei „monatlich“ der erste solche Tag im Monat */
  day: number
  hour: number
  sections: {
    /** Neue Filme, Serien und Folgen */
    added: boolean
    /** Was der Empfänger selbst auf der Merkliste hatte oder in Seerr angefragt hat, hervorgehoben */
    watchlist: boolean
    /** Wie die Runde zuletzt bewertet hat, ohne Namen */
    ratings: boolean
  }
  /** Sofort eine Mail, wenn ein Titel von der eigenen Merkliste auf dem Server ankommt */
  instant: boolean
  reminder: boolean
  /** So viele Tage nach dem Schauen kommt die erste Erinnerung */
  reminderDays: number
  /** Wie oft ein Titel höchstens angemahnt wird */
  reminderMax: number
  /** Uhrzeit, zu der Erinnerungen rausgehen */
  reminderHour: number
  /** Erinnern, wenn gesehen, aber nicht bewertet */
  reminderRated: boolean
  /** Erinnern, wenn gesehen, aber noch auf der Merkliste */
  reminderWatchlist: boolean
}

export type MailKind = 'newsletter' | 'reminder'

const FALLBACK: MailPrefs = {
  newsletter: false,
  rhythm: 'weekly',
  day: 5,
  hour: 18,
  sections: { added: true, watchlist: true, ratings: true },
  instant: false,
  reminder: false,
  reminderDays: 3,
  reminderMax: 2,
  reminderHour: 18,
  reminderRated: true,
  reminderWatchlist: true,
}

// Welche Felder zu welchem Teil gehören; danach richtet sich, was „eigene Einstellungen“ eines Benutzers überschreiben
const PART_KEYS: Record<MailKind, (keyof MailPrefs)[]> = {
  newsletter: ['newsletter', 'rhythm', 'day', 'hour', 'sections', 'instant'],
  reminder: ['reminder', 'reminderDays', 'reminderMax', 'reminderHour', 'reminderRated', 'reminderWatchlist'],
}

const int = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Number(value)
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback
}

/** Macht aus beliebiger Eingabe gültige Einstellungen; Fehlendes kommt aus `base`. */
export function cleanPrefs(input: unknown, base: MailPrefs = FALLBACK): MailPrefs {
  const p = (input ?? {}) as Record<string, any>
  const s = (p.sections ?? {}) as Record<string, unknown>
  const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback)
  return {
    newsletter: bool(p.newsletter, base.newsletter),
    rhythm: p.rhythm === 'biweekly' || p.rhythm === 'monthly' || p.rhythm === 'weekly' ? p.rhythm : base.rhythm,
    day: int(p.day, 0, 6, base.day),
    hour: int(p.hour, 0, 23, base.hour),
    sections: {
      added: bool(s.added, base.sections.added),
      watchlist: bool(s.watchlist, base.sections.watchlist),
      ratings: bool(s.ratings, base.sections.ratings),
    },
    instant: bool(p.instant, base.instant),
    reminder: bool(p.reminder, base.reminder),
    reminderDays: int(p.reminderDays, 0, 365, base.reminderDays),
    reminderMax: int(p.reminderMax, 1, 10, base.reminderMax),
    reminderHour: int(p.reminderHour, 0, 23, base.reminderHour),
    reminderRated: bool(p.reminderRated, base.reminderRated),
    reminderWatchlist: bool(p.reminderWatchlist, base.reminderWatchlist),
  }
}

function parse(json: string | null | undefined): unknown {
  try {
    return json ? JSON.parse(json) : null
  } catch {
    return null
  }
}

export const mailDefaults = (): MailPrefs => cleanPrefs(parse(getSetting('mail_defaults')))
export const saveMailDefaults = (prefs: unknown): void => setSetting('mail_defaults', JSON.stringify(cleanPrefs(prefs)))

/** Was ein Benutzer abweichend vom Standard hat, je Teil; fehlt ein Teil, gilt dafür der Standard. */
type Own = Partial<Record<MailKind, Record<string, unknown>>>

function ownPrefs(userId: number): Own {
  const stored = parse(db.prepare('SELECT mail_prefs FROM users WHERE id = ?').get(userId)?.mail_prefs as string | null) as Record<string, any> | null
  if (!stored) return {}
  // Frühere Fassung: ein einziger Satz Einstellungen, der nur den Newsletter betraf
  if ('rhythm' in stored) return { newsletter: stored }
  return { newsletter: stored.newsletter ?? undefined, reminder: stored.reminder ?? undefined }
}

/** Für welche Teile ein Benutzer eigene Einstellungen hat. */
export function ownParts(userId: number): Record<MailKind, boolean> {
  const own = ownPrefs(userId)
  return { newsletter: Boolean(own.newsletter), reminder: Boolean(own.reminder) }
}

/** Die Einstellungen, die für einen Benutzer gelten: der Standard, überschrieben von seinen eigenen Teilen. */
export function effectivePrefs(userId: number): MailPrefs {
  const own = ownPrefs(userId)
  return cleanPrefs({ ...mailDefaults(), ...own.newsletter, ...own.reminder }, mailDefaults())
}

/** Setzt die eigenen Einstellungen eines Teils; `null` heißt, dass dafür wieder der Standard gilt. */
export function saveUserPrefs(userId: number, part: MailKind, prefs: unknown | null): void {
  const own = ownPrefs(userId)
  if (prefs == null) delete own[part]
  else {
    const clean = cleanPrefs(prefs, mailDefaults())
    own[part] = Object.fromEntries(PART_KEYS[part].map((key) => [key, clean[key]]))
  }
  db.prepare('UPDATE users SET mail_prefs = ? WHERE id = ?').run(own.newsletter || own.reminder ? JSON.stringify(own) : null, userId)
}

// ---------------------------------------------------------------------------
// Unterschriebene Links: Niemand soll fremde Benutzer abmelden oder beliebige Titel abrufen können

function secret(): string {
  let value = getSetting('mail_secret')
  if (!value) {
    value = randomBytes(32).toString('hex')
    setSetting('mail_secret', value)
  }
  return value
}

const hmac = (text: string, length: number) => createHmac('sha256', secret()).update(text).digest('hex').slice(0, length)
const same = (expected: string, given: string) => {
  const a = Buffer.from(expected)
  const b = Buffer.from(given)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function unsubscribeUrl(userId: number, kind: MailKind): string | null {
  if (!config.publicUrl) return null
  return `${config.publicUrl}/api/public/unsubscribe?u=${userId}&k=${kind}&t=${hmac(`${userId}:${kind}`, 40)}`
}

export function validUnsubscribe(userId: number, kind: string, token: string): kind is MailKind {
  return (kind === 'newsletter' || kind === 'reminder') && same(hmac(`${userId}:${kind}`, 40), token)
}

/** Adresse der Infoseite zu einem Titel; ohne Anmeldung erreichbar, aber nur mit der passenden Unterschrift. */
export function titleUrl(ratingKey: number): string | null {
  if (!config.publicUrl) return null
  return `${config.publicUrl}/api/public/title?k=${ratingKey}&t=${hmac(`title:${ratingKey}`, 24)}`
}

/** Adresse, unter der ein Mailprogramm das Poster eines Titels laden kann; trägt dieselbe Unterschrift wie die Infoseite. */
export function posterUrl(ratingKey: number): string | null {
  if (!config.publicUrl) return null
  return `${config.publicUrl}/api/public/poster?k=${ratingKey}&t=${hmac(`title:${ratingKey}`, 24)}`
}

export const validTitle = (ratingKey: number, token: string): boolean => same(hmac(`title:${ratingKey}`, 24), token)

const unsubColumn = (kind: MailKind) => (kind === 'newsletter' ? 'newsletter_unsub' : 'reminder_unsub')

export function unsubscribe(userId: number, kind: MailKind): void {
  db.prepare(`UPDATE users SET ${unsubColumn(kind)} = ? WHERE id = ?`).run(now(), userId)
  const name = String(db.prepare('SELECT name FROM users WHERE id = ?').get(userId)?.name ?? userId)
  logEvent('mail', t(kind === 'newsletter' ? '{name} hat den Newsletter abbestellt' : '{name} hat die Erinnerungen abbestellt', { name }), 'warn')
  notifyOwner(
    t(kind === 'newsletter' ? '{name} hat den Newsletter abbestellt' : '{name} hat die Erinnerungen abbestellt', { name }),
    t('Das kam über den Link in der Mail. In den Einstellungen kannst du {name} wieder anmelden.', { name }),
  )
}

export function resubscribe(userId: number, kind: MailKind): void {
  db.prepare(`UPDATE users SET ${unsubColumn(kind)} = NULL WHERE id = ?`).run(userId)
}

// ---------------------------------------------------------------------------
// Zeitplan

export const PERIOD: Record<MailPrefs['rhythm'], number> = { weekly: 7 * 86400, biweekly: 14 * 86400, monthly: 31 * 86400 }

/** Der letzte geplante Termin, der nicht in der Zukunft liegt, als Unix-Zeit. */
export function lastSlot(prefs: MailPrefs, at = new Date()): number {
  const slot = new Date(at.getFullYear(), at.getMonth(), at.getDate(), prefs.hour, 0, 0)
  if (prefs.rhythm === 'monthly') {
    // Der erste passende Wochentag des Monats; liegt er noch vor uns, der des Vormonats
    const first = (year: number, month: number) => {
      const d = new Date(year, month, 1, prefs.hour, 0, 0)
      d.setDate(1 + ((prefs.day - d.getDay() + 7) % 7))
      return d
    }
    const current = first(at.getFullYear(), at.getMonth())
    return Math.floor((current <= at ? current : first(at.getFullYear(), at.getMonth() - 1)).getTime() / 1000)
  }
  slot.setDate(slot.getDate() - ((slot.getDay() - prefs.day + 7) % 7))
  if (slot > at) slot.setDate(slot.getDate() - 7)
  return Math.floor(slot.getTime() / 1000)
}

// ---------------------------------------------------------------------------

/** Hält fest, was verschickt wurde oder woran es scheiterte. */
export function logMail(userId: number, kind: MailKind, subject: string, error?: string): void {
  db.prepare('INSERT INTO mail_log (at, user_id, kind, subject, ok, error) VALUES (?, ?, ?, ?, ?, ?)').run(now(), userId, kind, subject, error ? 0 : 1, error ?? null)
  const recipient = String(db.prepare('SELECT name FROM users WHERE id = ?').get(userId)?.name ?? userId)
  if (error) logEvent('mail', t('Mail an {name} nicht verschickt: {subject} ({error})', { name: recipient, subject, error }), 'error')
  else logEvent('mail', t('Mail an {name}: {subject}', { name: recipient, subject }))
  if (error) {
    const name = recipient
    notifyOwner(t('Mail an {name} nicht verschickt', { name }), `${subject}

${error}`)
  }
}

export function mailLog(kind: MailKind): Record<string, unknown>[] {
  return db
    .prepare(
      'SELECT l.at, l.kind, l.subject, l.ok, l.error, u.name AS user_name FROM mail_log l LEFT JOIN users u ON u.id = l.user_id WHERE l.kind = ? ORDER BY l.id DESC LIMIT 40',
    )
    .all(kind)
}
