import { mailConfigured, tmdbConfigured } from './config.ts'
import { accessFilter, db, getSetting, now, setSetting } from './db.ts'
import { t } from './i18n.ts'
import { greeting, isTransient, MAIL_COLORS, mailLayout, mailReason, plexWhere, sendMail, tone, userEmail, type Attachment, type Mail } from './mail.ts'
import { effectivePrefs, logMail, titleUrl, unsubscribeUrl } from './mailprefs.ts'
import { poster, summary } from './newsletter.ts'
import { escapeHtml } from './telegram.ts'
import { getSeasonPlan } from './tmdb.ts'

// Sofort Bescheid geben, wenn ein Titel ankommt, den jemand auf der Merkliste hatte oder in Seerr angefragt hat.
// Der Newsletter nennt ihn später auch, aber auf den wartet man im Zweifel eine Woche.
//
// Filme werden gemeldet, sobald sie da sind. Bei Serien geht es staffelweise: einmal, sobald die erste Folge einer
// Staffel da ist, und einmal, wenn die Staffel komplett ist. Ist sie beim ersten Hinsehen schon komplett, bleibt es bei einer Mail.
// Gemeldet wird erst, wenn bei der Serie seit 15 Minuten nichts mehr angekommen ist, damit ein Import eine Mail ergibt.

db.exec(`CREATE TABLE IF NOT EXISTS mail_wishes (
  user_id    INTEGER NOT NULL,
  rating_key INTEGER NOT NULL,
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, rating_key)
)`)
// Pro Staffel, was schon gemeldet wurde: 'start' für den Beginn, 'complete' für die vollständige Staffel
db.exec(`CREATE TABLE IF NOT EXISTS mail_wish_seasons (
  user_id    INTEGER NOT NULL,
  rating_key INTEGER NOT NULL,
  season     INTEGER NOT NULL,
  stage      TEXT NOT NULL,
  sent_at    INTEGER NOT NULL,
  PRIMARY KEY (user_id, rating_key, season, stage)
)`)

// Nur was ab jetzt ankommt: Sonst gäbe es beim ersten Lauf eine Mail für jeden alten Titel auf einer Merkliste
function since(): number {
  let value = Number(getSetting('wish_since'))
  if (!value) {
    value = now()
    setSetting('wish_since', String(value))
  }
  return value
}

/**
 * Staffeln, die beim ersten Lauf schon auf dem Server liegen, gelten als begonnen. Sonst bekäme jeder beim
 * nächsten Eintreffen einer Folge die Nachricht, eine längst laufende Staffel sei „angelaufen“.
 */
function baseline(): void {
  if (getSetting('wish_seasons_baseline')) return
  db.prepare(
    `INSERT OR IGNORE INTO mail_wish_seasons (user_id, rating_key, season, stage, sent_at)
     SELECT u.id, f.item_key, f.season, 'start', ?
     FROM users u, media_files f
     WHERE f.rating_key <> f.item_key AND f.season IS NOT NULL
     GROUP BY u.id, f.item_key, f.season`,
  ).run(now())
  setSetting('wish_seasons_baseline', String(now()))
}

export interface Arrival {
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  /** Bei Serien: was von welcher Staffel da ist, z. B. „Staffel 1 · Komplett“ */
  detail: string
  /** Bei Serien die gemeldeten Staffeln mit ihrer Stufe, zum Vermerken nach dem Versand */
  seasons: { season: number; stage: 'start' | 'complete' }[]
  /** Die Staffel war schon als begonnen gemeldet und ist jetzt vollständig */
  followUp: boolean
}

const WANTED = '(SELECT type, tmdb_id FROM watchlist WHERE user_id = ?1 UNION SELECT type, tmdb_id FROM requests WHERE user_id = ?1)'

// Sammelzeit bei Serien: Solange noch Folgen eintreffen, etwa beim Import mehrerer Staffeln, wird gewartet.
// So gibt es eine Mail für alles, statt je Staffel eine für den Start und eine für „komplett“.
const QUIET = 15 * 60

/** Frisch angekommene Filme, die dieser Benutzer wollte und über die er noch keine Mail bekommen hat. */
function movieArrivals(userId: number, from: number): Arrival[] {
  return db
    .prepare(
      `SELECT DISTINCT l.rating_key, l.type, l.title, l.year, l.thumb
       FROM library_items l JOIN ${WANTED} w ON w.type = l.type AND w.tmdb_id = l.tmdb_id
       WHERE l.type = 'movie' AND l.added_at > ?2 AND ${accessFilter('?1')}
         AND NOT EXISTS (SELECT 1 FROM mail_wishes m WHERE m.user_id = ?1 AND m.rating_key = l.rating_key)
         -- Kommt derselbe Film später in einer zweiten Mediathek an (z. B. in 4K), gibt es keine zweite Mail
         AND NOT EXISTS (SELECT 1 FROM mail_wishes m JOIN library_items x ON x.rating_key = m.rating_key
                         WHERE m.user_id = ?1 AND x.type = l.type AND x.tmdb_id = l.tmdb_id)`,
    )
    .all(userId, from)
    .map((m) => ({ ...(m as unknown as Arrival), detail: '', seasons: [], followUp: false }))
}

/** Staffeln gewünschter Serien, die angelaufen oder komplett geworden sind und noch nicht gemeldet wurden. */
async function showArrivals(userId: number, from: number): Promise<Arrival[]> {
  const rows = db
    .prepare(
      `SELECT l.rating_key, l.title, l.year, l.thumb, l.tmdb_id, f.season,
         COUNT(*) AS episodes, MAX(f.episode) AS last_episode,
         (SELECT MAX(x.added_at) FROM media_files x WHERE x.item_key = l.rating_key) AS show_last
       FROM library_items l
       JOIN ${WANTED} w ON w.type = l.type AND w.tmdb_id = l.tmdb_id
       JOIN media_files f ON f.item_key = l.rating_key AND f.rating_key <> f.item_key AND f.season > 0
       WHERE l.type = 'show' AND ${accessFilter('?1')}
       GROUP BY l.rating_key, f.season
       HAVING MAX(f.added_at) > ?2
       ORDER BY l.title, f.season`,
    )
    .all(userId, from)
  const sent = new Set(
    db.prepare('SELECT rating_key, season, stage FROM mail_wish_seasons WHERE user_id = ?').all(userId).map((s) => `${s.rating_key}:${s.season}:${s.stage}`),
  )
  const shows = new Map<number, Arrival & { lines: string[] }>()
  for (const r of rows) {
    const key = r.rating_key as number
    // Kam bei der Serie gerade noch eine Folge an, beim nächsten Durchlauf wieder hinsehen
    if (now() - Number(r.show_last ?? 0) < QUIET) continue
    const season = Number(r.season)
    let complete = false
    if (tmdbConfigured() && r.tmdb_id != null) {
      const plan = await getSeasonPlan(r.tmdb_id as number).catch(() => null)
      const total = plan?.episodes.get(season) ?? 0
      complete = Boolean(plan) && total > 0 && Number(r.last_episode) >= total && plan!.airing !== season
    }
    const started = sent.has(`${key}:${season}:start`)
    const stage = complete && !sent.has(`${key}:${season}:complete`) ? 'complete' : !started ? 'start' : null
    if (!stage) continue
    const show = shows.get(key) ?? {
      rating_key: key,
      type: 'show',
      title: r.title as string,
      year: r.year as number | null,
      thumb: r.thumb as string | null,
      detail: '',
      seasons: [],
      followUp: true,
      lines: [],
    }
    show.seasons.push({ season, stage })
    // Nur wenn jede gemeldete Staffel schon einmal als begonnen gemeldet war, ist es eine reine Nachmeldung
    show.followUp &&= stage === 'complete' && started
    const count = Number(r.episodes)
    show.lines.push(`${t('Staffel {n}', { n: season })} · ${stage === 'complete' ? t('Komplett') : t(count === 1 ? '{n} Folge' : '{n} Folgen', { n: count })}`)
    shows.set(key, show)
  }
  return [...shows.values()].map(({ lines, ...show }) => ({ ...show, detail: lines.join(', ') }))
}

/** Alles, worüber dieser Benutzer jetzt eine Mail bekäme. */
export async function arrivals(userId: number): Promise<Arrival[]> {
  // Älter als drei Tage wird nicht mehr gemeldet, etwa nach einem längeren Ausfall
  const from = Math.max(since(), now() - 3 * 86400)
  // Für Staffeln zählt zusätzlich nur, was nach der ersten Bestandsaufnahme ankam: Was da schon lag, ist keine Neuigkeit
  const seasonsFrom = Math.max(from, Number(getSetting('wish_seasons_baseline')) || 0)
  return [...movieArrivals(userId, from), ...(await showArrivals(userId, seasonsFrom))]
}

/** Vermerkt, was gemeldet wurde. */
export function markArrivals(userId: number, items: Arrival[]): void {
  const movie = db.prepare('INSERT OR IGNORE INTO mail_wishes (user_id, rating_key, sent_at) VALUES (?, ?, ?)')
  const season = db.prepare('INSERT OR IGNORE INTO mail_wish_seasons (user_id, rating_key, season, stage, sent_at) VALUES (?, ?, ?, ?, ?)')
  const stamp = now()
  for (const item of items) {
    if (item.type !== 'show') movie.run(userId, item.rating_key, stamp)
    for (const s of item.seasons) {
      // Eine komplette Staffel ist damit auch begonnen; sonst käme später noch die Meldung zum Start
      season.run(userId, item.rating_key, s.season, 'start', stamp)
      if (s.stage === 'complete') season.run(userId, item.rating_key, s.season, 'complete', stamp)
    }
  }
}

async function render(userId: number, items: Arrival[]): Promise<Mail> {
  const c = MAIL_COLORS
  const attachments: Attachment[] = []
  const hello = greeting(userId)
  const followUp = items.every((i) => i.followUp)
  const where = await plexWhere()
  const intro = followUp
    ? tone('eine Staffel von deiner Merkliste ist jetzt vollständig auf {where}:', 'ein Auftrag liegt jetzt vollständig auf {where} und ist bereit zum Anschauen:', { where })
    : items.length === 1
      ? tone('ein Titel von deiner Merkliste ist jetzt auf {where}:', 'dein Auftrag ist auf {where} eingetroffen und bereit zum Anschauen:', { where })
      : tone('{n} Titel von deiner Merkliste sind jetzt auf {where}:', '{n} Aufträge sind auf {where} eingetroffen und bereit zum Anschauen:', { n: items.length, where })
  let body = `<p style="margin:0 0 6px">${escapeHtml(hello)}</p><p style="margin:0 0 14px;color:${c.muted}">${escapeHtml(intro)}</p>`
  const text = [hello, intro, '']
  for (const item of items) {
    const cid = `w${item.rating_key}`
    const src = await poster(item.thumb, cid, attachments, item.rating_key)
    const img = src
      ? `<img src="${src}" width="72" alt="" style="display:block;width:72px;height:auto;border:0;border-radius:4px">`
      : `<div style="width:72px;height:108px;background:${c.band};border-radius:4px"></div>`
    const about = await summary(item.rating_key)
    const url = titleUrl(item.rating_key)
    const kind = [item.type === 'show' ? t('Serie') : t('Film'), item.year].filter(Boolean).join(' · ')
    body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.card};border-radius:6px;margin:0 0 10px"><tr>
<td width="72" style="padding:10px;vertical-align:top">${img}</td>
<td style="padding:10px 12px 10px 2px;vertical-align:top">
<div style="font-size:16px;font-weight:bold;color:${c.text}">${escapeHtml(item.title)}</div>
<div style="font-size:13px;color:${c.muted}">${escapeHtml(kind)}</div>
${item.detail ? `<div style="font-size:13px;color:${c.accent}">${escapeHtml(item.detail)}</div>` : ''}
${about ? `<div style="font-size:13px;line-height:1.5;color:${c.text};margin-top:6px">${escapeHtml(about)}</div>` : ''}
${url ? `<a href="${url}" style="display:inline-block;margin-top:10px;background:${c.accent};color:${c.onAccent};font-size:13px;font-weight:bold;padding:7px 14px;border-radius:4px;text-decoration:none">${escapeHtml(t('Mehr dazu'))}</a>` : ''}
</td></tr></table>`
    text.push(`- ${item.title}${kind ? ` (${kind})` : ''}${item.detail ? `: ${item.detail}` : ''}`)
  }
  const reason = await mailReason()
  const leave = unsubscribeUrl(userId, 'newsletter')
  const footer = escapeHtml(reason) + (leave ? `<br><a href="${leave}" style="color:${c.muted}">${escapeHtml(t('Newsletter abbestellen'))}</a>` : '')
  const subject =
    items.length > 1
      ? tone('Jetzt auf Plex: {n} Titel von deiner Merkliste', '{n} Aufträge bereit auf Plex', { n: items.length })
      : followUp
        ? tone('Jetzt komplett auf Plex: {title}', 'Auftrag vollständig auf Plex: {title}', { title: items[0]!.title })
        : tone('Jetzt auf Plex: {title}', 'Auftrag bereit auf Plex: {title}', { title: items[0]!.title })
  const layout = mailLayout({ title: subject, body, footer })
  return {
    to: userEmail(userId),
    subject,
    html: layout.html,
    text: [...text, '', reason, ...(leave ? [`${t('Newsletter abbestellen')}: ${leave}`] : [])].join('\n'),
    attachments: [...layout.attachments, ...attachments],
    headers: leave ? { 'List-Unsubscribe': `<${leave}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
  }
}

let sending = false

// Zweiter und dritter Versuch, wenn nur die Verbindung zum Mailserver fehlte; nach einem Neustart sind sie verloren
const RETRIES = [5 * 60_000, 15 * 60_000]

function deliver(userId: number, mail: Mail, attempt = 0): void {
  sendMail(mail)
    .then(() => logMail(userId, 'newsletter', mail.subject))
    .catch((err: Error) => {
      const wait = RETRIES[attempt]
      if (isTransient(err) && wait) {
        setTimeout(() => deliver(userId, mail, attempt + 1), wait)
        return
      }
      logMail(userId, 'newsletter', mail.subject, err.message)
    })
}

/** Läuft jede Minute: meldet frisch angekommene Wunschtitel, pro Benutzer in einer Mail. */
export async function maybeSendWishMails(): Promise<void> {
  if (sending || !mailConfigured()) return
  sending = true
  try {
    since()
    baseline()
    for (const u of db.prepare('SELECT id, newsletter_unsub FROM users WHERE active = 1').all()) {
      const id = u.id as number
      if (u.newsletter_unsub || !effectivePrefs(id).instant || !userEmail(id)) continue
      const items = await arrivals(id)
      if (!items.length) continue
      // Vor dem Versand vermerken: Lieber fällt eine Mail aus, als dass sie nach einem Fehler jede Minute neu rausgeht
      markArrivals(id, items)
      deliver(id, await render(id, items))
    }
  } finally {
    sending = false
  }
}

/** Für Tests: die Vorbereitung, die sonst beim ersten Lauf geschieht. */
export const prepareWishes = (): void => {
  since()
  baseline()
}
