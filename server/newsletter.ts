import { mailConfigured, tmdbConfigured } from './config.ts'
import { getSeasonPlan } from './tmdb.ts'
import { accessFilter, db, now, sectionFilter } from './db.ts'
import { locale, t } from './i18n.ts'
import { greeting, isoWeek, MAIL_COLORS, mailHeading, mailLayout, mailReason, sendMail, senderName, tone, userEmail, type Attachment, type Mail } from './mail.ts'
import { effectivePrefs, lastSlot, logMail, PERIOD, titleUrl, unsubscribeUrl, type MailPrefs } from './mailprefs.ts'
import { pms } from './plex.ts'
import { mailPoster } from './poster.ts'
import { dueReminders, markReminded, remindable, reminderBlock, reminderHeading, type ReminderItem } from './reminder.ts'
import { escapeHtml } from './telegram.ts'

// Der Newsletter „Neu auf dem Server“: was seit dem letzten dazugekommen ist, aus Sicht eines Benutzers.

// ---------------------------------------------------------------------------
// Inhalt

interface NewTitle {
  rating_key: number
  title: string
  year: number | null
  thumb: string | null
  /** Der Empfänger hatte den Titel auf der Merkliste oder hat ihn angefragt */
  wanted: boolean
}

interface ShowNews extends NewTitle {
  /** Die Serie selbst ist neu, nicht nur Folgen davon */
  fresh: boolean
  seasons: SeasonNews[]
}

interface SeasonNews {
  season: number
  /** Zahl der neuen Folgen */
  episodes: number
  /** Höchste Folge dieser Staffel, die auf dem Server liegt */
  last: number
  /** Mit den neuen Folgen ist die Staffel bis zur letzten Folge da */
  complete: boolean
}

export interface NewsletterData {
  since: number
  forYou: (NewTitle & { type: 'movie' | 'show'; detail: string })[]
  movies: NewTitle[]
  shows: ShowNews[]
  ratings: RatedTitle[]
}

/** Wie ein Titel zuletzt bewertet wurde, über alle Benutzer gemittelt und ohne Namen. */
interface RatedTitle {
  rating_key: number
  title: string
  year: number | null
  thumb: string | null
  /** Mittel der Bewertungen, 0 bis 10 wie in Plex */
  average: number
  count: number
  /** Liegt noch auf dem Server; nur dann gibt es eine Infoseite */
  available: boolean
}

/** Sterne als Text: fünf Stellen, halbe Sterne als „½“. */
function stars(rating: number): string {
  const value = Math.round(rating) / 2
  const full = Math.floor(value)
  const half = value - full >= 0.5
  return '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(5 - full - (half ? 1 : 0)) + ' ' + value.toLocaleString(locale(), { minimumFractionDigits: 1 })
}

const episodeCount = (n: number) => t(n === 1 ? '{n} neue Folge' : '{n} neue Folgen', { n })
const seasonLine = (s: SeasonNews) => `${t('Staffel {n}', { n: s.season })} · ${s.complete ? t('Komplett') : episodeCount(s.episodes)}`

/** Was seit `since` dazugekommen ist, aus Sicht eines Benutzers. */
export async function newsletterData(userId: number, since: number, prefs: MailPrefs): Promise<NewsletterData> {
  const movies = db
    .prepare(`SELECT rating_key, title, year, thumb, tmdb_id FROM library_items l WHERE type = 'movie' AND added_at > ?1 AND ${sectionFilter()} AND ${accessFilter('?2')} ORDER BY added_at DESC`)
    .all(since, userId)
    // Liegt ein Film in mehreren Mediatheken, etwa in HD und in 4K, steht er nur einmal da
    .filter((m, i, all) => m.tmdb_id == null || all.findIndex((x) => x.tmdb_id === m.tmdb_id) === i)
    .map((m): NewTitle & { tmdb_id: number | null } => ({
      rating_key: m.rating_key as number,
      title: m.title as string,
      year: m.year as number | null,
      thumb: m.thumb as string | null,
      tmdb_id: m.tmdb_id as number | null,
      wanted: false,
    }))

  const shows = new Map<number, ShowNews & { tmdb_id: number | null }>()
  for (const r of db
    .prepare(
      `SELECT l.rating_key, l.title, l.year, l.thumb, l.tmdb_id, f.season, COUNT(*) AS episodes, MIN(f.episode) AS first_episode,
         (SELECT MAX(x.episode) FROM media_files x WHERE x.item_key = l.rating_key AND x.rating_key <> x.item_key AND x.season = f.season) AS last_episode,
         EXISTS (SELECT 1 FROM media_files o WHERE o.item_key = l.rating_key AND o.rating_key <> o.item_key
                 AND (o.added_at IS NULL OR o.added_at <= ?1)) AS has_older
       FROM media_files f JOIN library_items l ON l.rating_key = f.item_key AND l.type = 'show'
       WHERE f.rating_key <> f.item_key AND f.added_at > ?1 AND ${sectionFilter()} AND ${accessFilter('?2')}
       GROUP BY l.rating_key, f.season ORDER BY l.title, f.season`,
    )
    .all(since, userId)) {
    // Dieselbe Serie in einer zweiten Mediathek (z. B. 4K) wird nicht noch einmal aufgeführt
    if (r.tmdb_id != null && [...shows.values()].some((s) => s.tmdb_id === r.tmdb_id && s.rating_key !== r.rating_key)) continue
    const key = r.rating_key as number
    const show = shows.get(key) ?? {
      rating_key: key,
      title: r.title as string,
      year: r.year as number | null,
      thumb: r.thumb as string | null,
      tmdb_id: r.tmdb_id as number | null,
      wanted: false,
      fresh: false,
      seasons: [],
    }
    // Neu ist eine Serie nur, wenn vorher nichts von ihr da war und sie jetzt mit der ersten Folge beginnt.
    // Das Datum der Serie selbst taugt dafür nicht: Plex setzt es neu, wenn alte Staffeln gelöscht werden.
    if (!r.has_older && Number(r.season) === 1 && Number(r.first_episode) === 1) show.fresh = true
    show.seasons.push({ season: Number(r.season ?? 0), episodes: Number(r.episodes), last: Number(r.last_episode ?? 0), complete: false })
    shows.set(key, show)
  }

  // Vollständig ist eine Staffel, wenn ihre letzte Folge laut TMDB auf dem Server liegt und keine weitere angekündigt ist.
  // Ob frühere Folgen schon wieder gelöscht wurden, spielt keine Rolle. Ohne TMDB bleibt es bei der Zahl der neuen Folgen.
  if (tmdbConfigured()) {
    for (const show of shows.values()) {
      if (show.tmdb_id == null) continue
      const plan = await getSeasonPlan(show.tmdb_id).catch(() => null)
      if (!plan) continue
      for (const s of show.seasons) {
        const total = plan.episodes.get(s.season) ?? 0
        s.complete = total > 0 && s.last >= total && plan.airing !== s.season
      }
    }
  }

  // Was der Benutzer selbst wollte. Merkliste und Anfrage in Seerr zählen gleich: Seerr erzeugt die Anfragen aus der
  // Merkliste, für den Empfänger ist es dasselbe.
  const wanted = new Set<string>()
  if (prefs.sections.watchlist) {
    for (const table of ['watchlist', 'requests']) {
      for (const w of db.prepare(`SELECT type, tmdb_id FROM ${table} WHERE user_id = ?`).all(userId)) wanted.add(`${w.type}:${w.tmdb_id}`)
    }
  }
  for (const m of movies) m.wanted = m.tmdb_id != null && wanted.has(`movie:${m.tmdb_id}`)
  for (const s of shows.values()) s.wanted = s.tmdb_id != null && wanted.has(`show:${s.tmdb_id}`)

  const forYou: NewsletterData['forYou'] = [
    ...movies.filter((m) => m.wanted).map((m) => ({ ...m, type: 'movie' as const, detail: m.year ? String(m.year) : '' })),
    ...[...shows.values()].filter((s) => s.wanted).map((s) => ({ ...s, type: 'show' as const, detail: s.seasons.map(seasonLine).join(', ') })),
  ]

  // Bewertungen seit dem letzten Newsletter, pro Titel gemittelt. Wer bewertet hat, steht bewusst nicht dabei.
  // Nur Titel, die noch auf dem Server liegen und die der Empfänger auch öffnen kann: Der Abschnitt soll Lust machen.
  const ratings: RatedTitle[] = prefs.sections.ratings
    ? db
        .prepare(
          `SELECT r.rating_key, r.title, r.year, r.thumb, AVG(r.rating) AS average, COUNT(*) AS count, 1 AS available
           FROM ratings r JOIN library_items l ON l.rating_key = r.rating_key
           WHERE r.rated_at > ?1 AND ${sectionFilter()} AND ${accessFilter('?2')}
           GROUP BY r.rating_key ORDER BY MAX(r.rated_at) DESC LIMIT 12`,
        )
        .all(since, userId)
        .map((r) => ({
          rating_key: r.rating_key as number,
          title: r.title as string,
          year: r.year as number | null,
          thumb: r.thumb as string | null,
          average: Number(r.average),
          count: Number(r.count),
          available: Boolean(r.available),
        }))
    : []

  // Was oben unter „für dich“ steht, wird unten nicht wiederholt
  const general = prefs.sections.added
  return {
    since,
    forYou,
    movies: general ? movies.filter((m) => !m.wanted) : [],
    shows: general ? [...shows.values()].filter((s) => !s.wanted) : [],
    ratings,
  }
}

/** Ohne neue Titel gibt es keinen Newsletter. */
export const hasNews = (data: NewsletterData) => data.forYou.length + data.movies.length + data.shows.length > 0

// Mehr Kacheln machen die Mail zu lang und zu schwer; der Rest steht als Liste mit Links darunter
const MAX_TILES = 10

/** Quelle für das Poster in der Mail (angehängt oder von Blackbriar geladen); mit `ratingKey` springt TMDB ein, wenn Plex kein Bild hat. */
export const poster = (thumb: string | null, cid: string, attachments: Attachment[], ratingKey: number | null = null): Promise<string | null> =>
  mailPoster(thumb, ratingKey, cid, attachments, 300, 450)

/** Die ersten Sätze der Inhaltsangabe aus Plex, gekürzt. */
export async function summary(ratingKey: number): Promise<string> {
  try {
    const text = String((await pms(`/library/metadata/${ratingKey}`)).Metadata?.[0]?.summary ?? '').trim()
    if (text.length <= 220) return text
    const cut = text.slice(0, 220)
    return cut.slice(0, Math.max(cut.lastIndexOf(' '), 120)) + ' …'
  } catch {
    return ''
  }
}

/** Baut die Mail für einen Benutzer aus den gesammelten Neuigkeiten. */
export async function renderNewsletter(userId: number, data: NewsletterData, reminders: ReminderItem[] = []): Promise<Mail> {
  const c = MAIL_COLORS
  const attachments: Attachment[] = []
  // Geschaut wird am Fernseher, dorthin kann eine Mail nicht führen. Der Link öffnet deshalb eine Seite mit Inhalt und Trailer.
  const link = (key: number) => titleUrl(key) ?? ''
  const placeholder = (width: string) => `<div style="width:${width};padding-bottom:150%;background:${c.card};border-radius:4px"></div>`
  const text: string[] = []

  const movieCount = data.movies.length + data.forYou.filter((f) => f.type === 'movie').length
  const showCount = data.shows.length + data.forYou.filter((f) => f.type === 'show').length
  const counts = [
    movieCount ? t(movieCount === 1 ? '{n} Film' : '{n} Filme', { n: movieCount }) : '',
    showCount ? t(showCount === 1 ? '{n} Serie mit neuen Folgen' : '{n} Serien mit neuen Folgen', { n: showCount }) : '',
  ].filter(Boolean)
  const sinceDate = new Date(data.since * 1000).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit' })
  const hello = greeting(userId)
  const intro = tone('seit dem {date} dazugekommen: {counts}.', 'Lagebericht seit dem {date} – neu eingetroffen: {counts}.', { date: sinceDate, counts: counts.join(t(' und ')) })
  let body = `<p style="margin:0 0 6px">${escapeHtml(hello)}</p><p style="margin:0 0 4px;color:${c.muted}">${escapeHtml(intro)}</p>`
  text.push(hello, intro, '')

  if (data.forYou.length) {
    const wantedHeading = tone('Auf deiner Merkliste', 'Dein Auftrag: bereit auf Plex')
    body += mailHeading(wantedHeading)
    text.push(wantedHeading.toUpperCase())
    for (const item of data.forYou) {
      const cid = `f${item.rating_key}`
      const src = await poster(item.thumb, cid, attachments, item.rating_key)
      const img = src
        ? `<img src="${src}" width="72" alt="" style="display:block;width:72px;height:auto;border:0;border-radius:4px">`
        : placeholder('72px')
      const about = await summary(item.rating_key)
      const url = link(item.rating_key)
      body += `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.card};border-radius:6px;margin:0 0 10px"><tr>
<td width="72" style="padding:10px;vertical-align:top">${img}</td>
<td style="padding:10px 12px 10px 2px;vertical-align:top">
<div style="font-size:16px;font-weight:bold;color:${c.text}">${escapeHtml(item.title)}</div>
<div style="font-size:13px;color:${c.muted}">${escapeHtml(item.detail)}</div>
${about ? `<div style="font-size:13px;line-height:1.5;color:${c.text};margin-top:6px">${escapeHtml(about)}</div>` : ''}
${url ? `<a href="${url}" style="display:inline-block;margin-top:10px;background:${c.accent};color:${c.onAccent};font-size:13px;font-weight:bold;padding:7px 14px;border-radius:4px;text-decoration:none">${escapeHtml(t('Mehr dazu'))}</a>` : ''}
</td></tr></table>`
      text.push(`- ${item.title}${item.detail ? `, ${item.detail}` : ''}`)
    }
    text.push('')
  }

  // Kacheln, die von selbst umbrechen: knapp die halbe Zeile breit, aber nie breiter als TILE. So stehen am Handy
  // immer genau zwei nebeneinander, auch wenn das Mailprogramm wenig Platz lässt, und am Tablet und Monitor mehr.
  // Das geht ohne Media Queries, die viele Mailprogramme nicht kennen. Das klassische Outlook für Windows bricht
  // nicht um und stellte die Kacheln untereinander; es bekommt deshalb eine eigene Tabelle mit fester Spaltenzahl.
  const OUTLOOK_COLUMNS = 4
  const TILE = 148
  const tiles = async (items: { key: number | null; cid: string; thumb: string | null; title: string; lines: string[]; note?: string }[]) => {
    let html = ''
    for (const [index, item] of items.entries()) {
      const src = await poster(item.thumb, item.cid, attachments, item.key)
      const img = src
        ? `<img src="${src}" width="${TILE}" alt="" style="display:block;width:100%;max-width:${TILE}px;height:auto;border:0;border-radius:4px">`
        : placeholder('100%')
      const url = item.key == null ? '' : link(item.key)
      // Nur Outlook liest diese Kommentare: neue Tabellenzeile nach jeweils vier Kacheln
      if (index > 0 && index % OUTLOOK_COLUMNS === 0) html += '<!--[if mso]></tr><tr><![endif]-->'
      html += `<!--[if mso]><td width="${TILE + 6}" valign="top" style="padding:0 6px 16px 0"><![endif]--><div style="display:inline-block;width:47%;max-width:${TILE}px;margin:0 2% 16px 0;vertical-align:top;font-size:13px;line-height:1.35">
${url ? `<a href="${url}" style="text-decoration:none">${img}</a>` : img}
<div style="color:${c.text};margin-top:6px">${escapeHtml(item.title)}</div>
${item.note ? `<div style="font-size:12px;color:${c.accent}">${escapeHtml(item.note)}</div>` : ''}
${item.lines.map((line) => `<div style="font-size:12px;color:${c.muted}">${escapeHtml(line)}</div>`).join('')}
</div><!--[if mso]></td><![endif]-->`
    }
    // font-size:0 schließt die Lücken, die Leerzeichen zwischen den Kacheln sonst erzeugen
    return `<div style="font-size:0"><!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0"><tr><![endif]-->${html}<!--[if mso]></tr></table><![endif]--></div>`
  }

  // Was nicht mehr als Kachel passt: eine Zeile je Titel, der Titel führt wie das Poster zur Seite mit Inhalt und Trailer
  const more = (items: { key: number; title: string; detail: string }[]): string => {
    if (!items.length) return ''
    const rows = items
      .map((item) => {
        const url = link(item.key)
        const title = url ? `<a href="${url}" style="color:${c.accent};font-weight:bold;text-decoration:underline">${escapeHtml(item.title)}</a>` : `<b>${escapeHtml(item.title)}</b>`
        return `<div style="margin:0 0 6px">${title}${item.detail ? ` <span style="color:${c.muted}">· ${escapeHtml(item.detail)}</span>` : ''}</div>`
      })
      .join('')
    const label = t(items.length === 1 ? 'Außerdem neu, ohne Bild. Tippe auf den Titel für Inhalt und Trailer:' : 'Außerdem neu, ohne Bild ({n} weitere). Tippe auf einen Titel für Inhalt und Trailer:', { n: items.length })
    return `<div style="margin:0 0 8px;font-size:13px;line-height:1.5"><div style="margin:0 0 8px;color:${c.muted}">${escapeHtml(label)}</div>${rows}</div>`
  }

  if (data.movies.length) {
    const moviesHeading = tone('Neue Filme', 'Neu im Archiv: Filme')
    body += mailHeading(moviesHeading)
    text.push(moviesHeading.toUpperCase())
    body += await tiles(
      data.movies.slice(0, MAX_TILES).map((m) => ({ key: m.rating_key, cid: `m${m.rating_key}`, thumb: m.thumb, title: m.title, lines: m.year ? [String(m.year)] : [] })),
    )
    body += more(data.movies.slice(MAX_TILES).map((m) => ({ key: m.rating_key, title: m.title, detail: m.year ? String(m.year) : '' })))
    for (const m of data.movies) text.push(`- ${m.title}${m.year ? ` (${m.year})` : ''}`)
    text.push('')
  }

  if (data.shows.length) {
    const showsHeading = tone('Neue Staffeln und Folgen', 'Neu im Archiv: Serien')
    body += mailHeading(showsHeading)
    text.push(showsHeading.toUpperCase())
    body += await tiles(
      data.shows.slice(0, MAX_TILES).map((s) => ({
        key: s.rating_key,
        cid: `s${s.rating_key}`,
        thumb: s.thumb,
        title: s.title,
        note: s.fresh ? t('Neue Serie') : undefined,
        lines: s.seasons.map(seasonLine),
      })),
    )
    body += more(data.shows.slice(MAX_TILES).map((s) => ({ key: s.rating_key, title: s.title, detail: s.seasons.map(seasonLine).join(', ') })))
    for (const s of data.shows) text.push(`- ${s.title}: ${(s.fresh ? `${t('Neue Serie')}, ` : '') + s.seasons.map(seasonLine).join(', ')}`)
    text.push('')
  }

  if (data.ratings.length) {
    const heading = tone('So wurde bewertet', 'Einsatzberichte der Agenten')
    body += mailHeading(heading)
    text.push(heading.toUpperCase())
    body += await tiles(
      data.ratings.map((r) => ({
        key: r.available ? r.rating_key : null,
        cid: `b${r.rating_key}`,
        thumb: r.thumb,
        title: r.title,
        note: stars(r.average),
        lines: r.count > 1 ? [t('{n} Bewertungen', { n: r.count })] : [],
      })),
    )
    for (const r of data.ratings) text.push(`- ${r.title}: ${stars(r.average)}${r.count > 1 ? ` (${t('{n} Bewertungen', { n: r.count })})` : ''}`)
    text.push('')
  }

  // Ist am selben Tag auch eine Erinnerung fällig, kommt sie hier mit: eine Mail statt zwei
  if (reminders.length) {
    const block = await reminderBlock(reminders, attachments)
    const openHeading = await reminderHeading(reminders)
    body += mailHeading(openHeading) + block.html
    text.push(openHeading.toUpperCase(), ...block.text, '')
  }

  const reason = await mailReason()
  const leave = unsubscribeUrl(userId, 'newsletter')
  const leaveReminder = reminders.length ? unsubscribeUrl(userId, 'reminder') : null
  const footer =
    escapeHtml(reason) +
    (leave ? `<br><a href="${leave}" style="color:${c.muted}">${escapeHtml(t('Newsletter abbestellen'))}</a>` : '') +
    (leaveReminder ? ` &middot; <a href="${leaveReminder}" style="color:${c.muted}">${escapeHtml(t('Erinnerungen abbestellen'))}</a>` : '')
  text.push(reason, ...(leave ? [`${t('Newsletter abbestellen')}: ${leave}`] : []), ...(leaveReminder ? [`${t('Erinnerungen abbestellen')}: ${leaveReminder}`] : []))

  const subject = tone('{name} · KW {week}: {counts} neu', 'Lagebericht KW {week}: {counts} eingetroffen', { name: senderName(), week: isoWeek(), counts: counts.join(t(' und ')) })
  const layout = mailLayout({ title: subject, body, footer, width: 900 })
  return {
    to: userEmail(userId),
    subject,
    html: layout.html,
    text: text.join('\n'),
    attachments: [...layout.attachments, ...attachments],
    // Mailprogramme zeigen damit selbst einen Knopf zum Abbestellen an
    headers: leave ? { 'List-Unsubscribe': `<${leave}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } : undefined,
  }
}

// ---------------------------------------------------------------------------
// Versand

/** Ab wann der nächste Newsletter eines Benutzers zählt: seit dem letzten, sonst einen Zeitraum zurück. */
function sinceFor(userId: number, prefs: MailPrefs): number {
  const sent = db.prepare('SELECT newsletter_sent_at FROM users WHERE id = ?').get(userId)?.newsletter_sent_at as number | null
  return sent ?? now() - PERIOD[prefs.rhythm]
}

async function build(userId: number): Promise<{ mail: Mail; reminders: ReminderItem[] } | null> {
  const prefs = effectivePrefs(userId)
  const data = await newsletterData(userId, sinceFor(userId, prefs), prefs)
  if (!hasNews(data)) return null
  const reminders = remindable(userId, prefs) ? dueReminders(userId, prefs) : []
  return { mail: await renderNewsletter(userId, data, reminders), reminders }
}

/** Die Mail, die der Benutzer jetzt bekäme; null, wenn es nichts Neues gibt. */
export async function previewNewsletter(userId: number): Promise<Mail | null> {
  return (await build(userId))?.mail ?? null
}

/** Verschickt den Newsletter an einen Benutzer. Liefert, ob etwas rausging. */
export async function sendNewsletter(userId: number): Promise<{ sent: boolean; reason?: string }> {
  if (!mailConfigured()) return { sent: false, reason: t('Erst das Postfach eintragen und speichern.') }
  if (!userEmail(userId)) return { sent: false, reason: t('Für diesen Benutzer ist keine Adresse bekannt.') }
  const stamp = now()
  const built = await build(userId)
  if (!built) {
    // Auch ohne Mail gilt der Zeitraum als erledigt, sonst würde jede Minute neu geprüft
    db.prepare('UPDATE users SET newsletter_sent_at = ? WHERE id = ?').run(stamp, userId)
    return { sent: false, reason: t('Seit dem letzten Newsletter ist nichts Neues dazugekommen.') }
  }
  const { mail, reminders } = built
  try {
    await sendMail(mail)
  } catch (err) {
    logMail(userId, 'newsletter', mail.subject, (err as Error).message)
    throw err
  }
  db.prepare('UPDATE users SET newsletter_sent_at = ? WHERE id = ?').run(stamp, userId)
  markReminded(userId, reminders)
  logMail(userId, 'newsletter', mail.subject)
  return { sent: true }
}

// So weit reicht ein Probe-Newsletter zurück
const SAMPLE_DAYS = 7

/**
 * Probe-Newsletter: alles aus den letzten sieben Tagen, auch wenn es schon einmal verschickt wurde. Er dient zum
 * Ausprobieren, etwa nach einer Änderung am Aussehen, und zählt nicht als verschickt: Der nächste echte Newsletter
 * kommt unverändert, und es gilt auch keine Erinnerung als erledigt.
 */
export async function sendNewsletterSample(userId: number): Promise<{ sent: boolean; reason?: string }> {
  if (!mailConfigured()) return { sent: false, reason: t('Erst das Postfach eintragen und speichern.') }
  if (!userEmail(userId)) return { sent: false, reason: t('Für diesen Benutzer ist keine Adresse bekannt.') }
  const data = await newsletterData(userId, now() - SAMPLE_DAYS * 86400, effectivePrefs(userId))
  if (!hasNews(data)) return { sent: false, reason: t('In den letzten {n} Tagen ist nichts dazugekommen.', { n: SAMPLE_DAYS }) }
  const mail = await renderNewsletter(userId, data)
  mail.subject = `${t('Probe')}: ${mail.subject}`
  try {
    await sendMail(mail)
  } catch (err) {
    logMail(userId, 'newsletter', mail.subject, (err as Error).message)
    throw err
  }
  logMail(userId, 'newsletter', mail.subject)
  return { sent: true }
}

let sending = false
// Termine, deren Versand gescheitert ist: bis zum Neustart nicht jede Minute erneut versuchen
const failed = new Map<number, number>()

/** Läuft jede Minute: verschickt die Newsletter, deren Termin gekommen ist. */
export async function maybeSendNewsletters(): Promise<void> {
  if (sending || !mailConfigured()) return
  sending = true
  try {
    const users = db.prepare('SELECT id, newsletter_sent_at, newsletter_unsub FROM users WHERE active = 1').all()
    for (const u of users) {
      const id = u.id as number
      const prefs = effectivePrefs(id)
      if (!prefs.newsletter || u.newsletter_unsub || !userEmail(id)) continue
      const slot = lastSlot(prefs)
      const sent = (u.newsletter_sent_at as number | null) ?? 0
      // Nur am Tag des Termins: Wer den Newsletter gerade erst einschaltet, bekommt nicht sofort einen nachgereicht
      if (sent >= slot || now() - slot > 86400 || failed.get(id) === slot) continue
      if (prefs.rhythm === 'biweekly' && sent && slot - sent < 13 * 86400) continue
      try {
        await sendNewsletter(id)
      } catch (err) {
        console.error(t('Newsletter nicht verschickt:'), (err as Error).message)
        // Der Zeitraum bleibt offen: „Jetzt senden“ oder der nächste Termin holt ihn nach
        failed.set(id, slot)
      }
    }
  } finally {
    sending = false
  }
}
