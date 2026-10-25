import { mailConfigured } from './config.ts'
import { db, now, openItems, watchlistTitles } from './db.ts'
import { locale, t } from './i18n.ts'
import { greeting, MAIL_COLORS, mailHeading, mailLayout, mailReason, plexWhere, sendMail, tone, userEmail, type Attachment, type Mail } from './mail.ts'
import { effectivePrefs, lastSlot, logMail, titleUrl, unsubscribeUrl, type MailPrefs } from './mailprefs.ts'
import { mailPoster } from './poster.ts'
import { escapeHtml } from './telegram.ts'

// Die Erinnerung: gesehen, aber noch nicht bewertet oder noch auf der Merkliste. Jeder Titel wird nur
// begrenzt oft angemahnt, damit die Mails nicht lästig werden.

db.exec(`CREATE TABLE IF NOT EXISTS mail_reminders (
  user_id    INTEGER NOT NULL,
  rating_key INTEGER NOT NULL,
  count      INTEGER NOT NULL,
  last_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, rating_key)
)`)

// Abstand zwischen zwei Erinnerungen an denselben Titel
const REPEAT = 7 * 86400
// Mehr auf einmal liest niemand; der Rest kommt beim nächsten Mal
const MAX_ITEMS = 10

export interface ReminderItem {
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  seen_at: number
  /** Noch nicht bewertet */
  rate: boolean
  /** Steht noch auf der Merkliste */
  watchlist: boolean
}

/** Alles, was bei einem Benutzer offen ist, unabhängig davon, ob schon daran erinnert wurde. */
export function openReminders(userId: number, prefs: MailPrefs): ReminderItem[] {
  const items = new Map<number, ReminderItem>()
  if (prefs.reminderRated) {
    for (const o of openItems(userId)) {
      // Alte Markierungen aus der Zeit vor dem ersten Auslesen lösen keine Mail aus
      if (o.quiet) continue
      items.set(o.rating_key, { rating_key: o.rating_key, type: o.type, title: o.title, year: o.year, thumb: o.thumb, seen_at: o.seen_at, rate: true, watchlist: false })
    }
  }
  if (prefs.reminderWatchlist) {
    for (const w of watchlistTitles()) {
      if (w.rating_key == null) continue
      const person = w.people.find((p) => p.user_id === userId)
      // Fertig heißt: Film gesehen bzw. alle vorhandenen Folgen der Serie
      const done = person && (w.type === 'show' ? w.leaf_count > 0 && (person.watched ?? 0) >= w.leaf_count : person.seen_at != null)
      if (!person || !done || (person.marked && person.quiet)) continue
      const known = items.get(w.rating_key)
      if (known) known.watchlist = true
      else {
        items.set(w.rating_key, {
          rating_key: w.rating_key,
          type: w.type,
          title: w.title,
          year: w.year,
          thumb: w.thumb,
          seen_at: person.seen_at ?? 0,
          rate: false,
          watchlist: true,
        })
      }
    }
  }
  return [...items.values()].sort((a, b) => b.seen_at - a.seen_at)
}

/** Woran jetzt erinnert wird: lange genug her, noch nicht zu oft und nicht erst kürzlich angemahnt. */
export function dueReminders(userId: number, prefs: MailPrefs): ReminderItem[] {
  const stamp = now()
  const sent = new Map(db.prepare('SELECT rating_key, count, last_at FROM mail_reminders WHERE user_id = ?').all(userId).map((r) => [r.rating_key as number, r]))
  return openReminders(userId, prefs)
    .filter((item) => {
      if (item.seen_at > stamp - prefs.reminderDays * 86400) return false
      const before = sent.get(item.rating_key)
      return !before || (Number(before.count) < prefs.reminderMax && Number(before.last_at) <= stamp - REPEAT)
    })
    .slice(0, MAX_ITEMS)
}

/** Vermerkt den Versand. Mit `again` zählt eine schon gezählte Erinnerung nicht noch einmal, nur ihr Datum rückt vor. */
export function markReminded(userId: number, items: ReminderItem[], again = false): void {
  const upsert = db.prepare(
    `INSERT INTO mail_reminders (user_id, rating_key, count, last_at) VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id, rating_key) DO UPDATE SET count = count + ${again ? 0 : 1}, last_at = excluded.last_at`,
  )
  const stamp = now()
  for (const item of items) upsert.run(userId, item.rating_key, stamp)
}

/** Der Abschnitt mit den offenen Titeln, für die eigene Mail und als Anhang an den Newsletter. */
export async function reminderBlock(items: ReminderItem[], attachments: Attachment[]): Promise<{ html: string; text: string[] }> {
  const c = MAIL_COLORS
  const text: string[] = []
  let html = ''
  for (const item of items) {
    const cid = `r${item.rating_key}`
    let img = `<div style="width:60px;height:90px;background:${c.band};border-radius:4px"></div>`
    // Hat Plex kein Poster, kommt es von TMDB; ohne Bild geht es auch
    const src = await mailPoster(item.thumb, item.rating_key, cid, attachments, 180, 270)
    if (src) img = `<img src="${src}" width="60" alt="" style="display:block;width:60px;height:auto;border:0;border-radius:4px">`
    const url = titleUrl(item.rating_key)
    const seen = item.seen_at ? t('gesehen am {date}', { date: new Date(item.seen_at * 1000).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) }) : ''
    const asks = [item.rate ? tone('Bitte in Plex bewerten', 'Einsatz abgeschlossen, Bewertung steht aus') : '', item.watchlist ? t('Noch auf deiner Merkliste. Nimm den Titel herunter, wenn du fertig bist.') : ''].filter(Boolean)
    const title = escapeHtml(item.title) + (item.year ? ` <span style="font-weight:normal;color:${c.muted}">(${item.year})</span>` : '')
    html += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.card};border-radius:6px;margin:0 0 8px"><tr>
<td width="60" style="padding:10px;vertical-align:top">${url ? `<a href="${url}">${img}</a>` : img}</td>
<td style="padding:10px 12px 10px 2px;vertical-align:top">
<div style="font-size:15px;font-weight:bold;color:${c.text}">${title}</div>
<div style="font-size:12px;color:${c.muted}">${escapeHtml(seen)}</div>
${asks.map((ask) => `<div style="font-size:13px;color:${c.accent};margin-top:4px">&bull; ${escapeHtml(ask)}</div>`).join('')}
</td></tr></table>`
    text.push(`- ${item.title}${item.year ? ` (${item.year})` : ''}: ${asks.join(', ')}`)
  }
  const why = t('Erst wenn ein Titel bewertet und von der Merkliste genommen ist, kann er vom Server. Das schafft Platz für Neues.')
  // Die Anleitung nennt nur, was bei diesem Empfänger offen ist
  const how = [
    items.some((i) => i.rate) ? t('Bewerten: den Titel in Plex öffnen und Sterne vergeben.') : '',
    items.some((i) => i.watchlist) ? t('Die Merkliste steht in Plex im Menü.') : '',
  ]
    .filter(Boolean)
    .join(' ')
  // Wer etwas noch einmal sehen will, soll wissen, dass die Merkliste den Titel hält
  const keep = t('Willst du etwas noch einmal sehen? Was auf deiner Merkliste steht, bleibt auf dem Server.')
  html += `<p style="margin:12px 0 0;font-size:13px;line-height:1.5;color:${c.muted}">${escapeHtml(why)}<br>${escapeHtml(how)}</p><p style="margin:8px 0 0;font-size:13px;line-height:1.5;color:${c.muted}">${escapeHtml(keep)}</p>`
  text.push('', why, how, keep)
  return { html, text }
}

/** Überschrift über den offenen Titeln. Von einem Bericht ist nur die Rede, wenn eine Bewertung fehlt. */
export async function reminderHeading(items: ReminderItem[]): Promise<string> {
  const where = await plexWhere()
  if (items.some((i) => i.rate)) return tone('Noch offen auf {where}', 'Einsatzberichte ausstehend', { where })
  return tone('Noch offen auf {where}', items.length === 1 ? 'Einsatz abgeschlossen' : 'Einsätze abgeschlossen', { where })
}

/** Die eigene Erinnerungsmail. */
export async function renderReminder(userId: number, items: ReminderItem[]): Promise<Mail> {
  const c = MAIL_COLORS
  const attachments: Attachment[] = []
  const hello = greeting(userId)
  // Fehlt nirgends eine Bewertung, geht es nur um die Merkliste; dann ist auch nicht von einem Bericht die Rede
  const onlyList = !items.some((i) => i.rate)
  const intro = onlyList
    ? items.length === 1
      ? tone('ein Titel, den du gesehen hast, steht noch auf deiner Merkliste:', 'ein Einsatz ist abgeschlossen, der Titel steht noch auf deiner Merkliste:')
      : tone('{n} Titel, die du gesehen hast, stehen noch auf deiner Merkliste:', '{n} Einsätze sind abgeschlossen, die Titel stehen noch auf deiner Merkliste:', { n: items.length })
    : items.length === 1
      ? tone('bei einem Titel, den du gesehen hast, ist noch etwas offen:', 'ein Einsatz ist abgeschlossen, der Bericht steht noch aus:')
      : tone('bei {n} Titeln, die du gesehen hast, ist noch etwas offen:', '{n} Einsätze sind abgeschlossen, die Berichte stehen noch aus:', { n: items.length })
  const block = await reminderBlock(items, attachments)
  const where = await plexWhere()
  const body = `<p style="margin:0 0 6px">${escapeHtml(hello)}</p><p style="margin:0 0 4px;color:${c.muted}">${escapeHtml(intro)}</p>${mailHeading(await reminderHeading(items))}${block.html}`
  const reason = await mailReason()
  const leave = unsubscribeUrl(userId, 'reminder')
  const footer = leave ? `${escapeHtml(reason)}<br><a href="${leave}" style="color:${c.muted}">${escapeHtml(t('Erinnerungen abbestellen'))}</a>` : escapeHtml(reason)
  const values = { where, title: items[0]!.title, n: items.length }
  const subject =
    items.length === 1
      ? tone('Noch offen auf {where}: {title}', 'Einsatzbericht fehlt: {title}', values)
      : tone('Noch offen auf {where}: {n} Titel', 'Einsatzbericht fehlt: {n} Titel', values)
  const layout = mailLayout({ title: subject, body, footer })
  return {
    to: userEmail(userId),
    subject,
    html: layout.html,
    text: [hello, intro, '', ...block.text, '', reason, ...(leave ? [`${t('Erinnerungen abbestellen')}: ${leave}`] : [])].join('\n'),
    attachments: [...layout.attachments, ...attachments],
    headers: leave ? { 'List-Unsubscribe': `<${leave}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
  }
}

/** Ob ein Benutzer überhaupt Erinnerungen bekommt. */
export function remindable(userId: number, prefs: MailPrefs): boolean {
  if (!prefs.reminder || !userEmail(userId)) return false
  return !db.prepare('SELECT reminder_unsub FROM users WHERE id = ?').get(userId)?.reminder_unsub
}

/** Die Mail, die der Benutzer jetzt bekäme; null, wenn nichts fällig ist. */
export async function previewReminder(userId: number): Promise<Mail | null> {
  const items = dueReminders(userId, effectivePrefs(userId))
  return items.length ? renderReminder(userId, items) : null
}

/**
 * Verschickt die Erinnerung. Von Hand ausgelöst (`manual`) geht alles Offene raus, auch wenn schon daran erinnert wurde:
 * Der Besitzer schickt sie etwa noch einmal, weil die erste Mail nicht ankam oder die Adresse falsch war.
 */
export async function sendReminder(userId: number, manual = false): Promise<{ sent: boolean; reason?: string }> {
  if (!mailConfigured()) return { sent: false, reason: t('Erst das Postfach eintragen und speichern.') }
  if (!userEmail(userId)) return { sent: false, reason: t('Für diesen Benutzer ist keine Adresse bekannt.') }
  const prefs = effectivePrefs(userId)
  const items = manual ? openReminders(userId, prefs).slice(0, MAX_ITEMS) : dueReminders(userId, prefs)
  if (!items.length) return { sent: false, reason: manual ? t('Bei diesem Benutzer ist nichts offen.') : t('Bei diesem Benutzer ist gerade nichts fällig.') }
  const mail = await renderReminder(userId, items)
  try {
    await sendMail(mail)
  } catch (err) {
    logMail(userId, 'reminder', mail.subject, (err as Error).message)
    throw err
  }
  markReminded(userId, items, manual)
  logMail(userId, 'reminder', mail.subject)
  return { sent: true }
}

const today = () => new Date().toLocaleDateString('sv-SE')
// Wer heute schon dran war; nach einem Neustart wird höchstens einmal neu geprüft, doppelt verschickt wird dabei nichts,
// weil verschickte Titel als angemahnt gelten
const checked = new Map<number, string>()
let sending = false

/** Läuft jede Minute: verschickt einmal am Tag zur eingestellten Uhrzeit, was fällig ist. */
export async function maybeSendReminders(): Promise<void> {
  if (sending || !mailConfigured()) return
  sending = true
  try {
    const date = new Date()
    for (const u of db.prepare('SELECT id, newsletter_unsub, newsletter_sent_at FROM users WHERE active = 1').all()) {
      const id = u.id as number
      if (checked.get(id) === today()) continue
      const prefs = effectivePrefs(id)
      if (!remindable(id, prefs) || date.getHours() < prefs.reminderHour) continue
      // Kommt heute noch ein Newsletter, nimmt der die Erinnerung mit: eine Mail statt zwei
      if (prefs.newsletter && !u.newsletter_unsub) {
        const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59)
        const slot = lastSlot(prefs, end)
        const slotToday = new Date(slot * 1000).toLocaleDateString('sv-SE') === today()
        // Bleibt der Newsletter aus (alle zwei Wochen, oder der Versand scheitert), wird nach einer Viertelstunde nicht länger gewartet
        if (slotToday && ((u.newsletter_sent_at as number | null) ?? 0) < slot && now() < slot + 900) continue
      }
      checked.set(id, today())
      try {
        await sendReminder(id)
      } catch (err) {
        console.error(t('Erinnerung nicht verschickt:'), (err as Error).message)
      }
    }
  } finally {
    sending = false
  }
}

/** Wie viele Titel bei einem Benutzer offen und wie viele davon jetzt fällig sind. */
export function reminderCounts(userId: number): { open: number; due: number; unrated: number; listed: number } {
  const prefs = effectivePrefs(userId)
  const open = openReminders(userId, prefs)
  // Ein Titel kann beides sein: noch nicht bewertet und noch auf der Merkliste
  return { open: open.length, due: dueReminders(userId, prefs).length, unrated: open.filter((i) => i.rate).length, listed: open.filter((i) => i.watchlist).length }
}
