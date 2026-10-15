import type { FastifyInstance } from 'fastify'
import { config, mailConfigured, tmdbConfigured } from './config.ts'
import { db, getSettings } from './db.ts'
import { locale, t } from './i18n.ts'
import { briefingTone, inlineImages, MAIL_COLORS, mailHeadImage, sendMail, senderName, setBriefingTone, userEmail, userTestMail } from './mail.ts'
import { pms } from './plex.ts'
import { posterImage, remotePosters, setRemotePosters } from './poster.ts'
import { getDetails } from './tmdb.ts'
import {
  effectivePrefs,
  mailDefaults,
  mailLog,
  ownParts,
  resubscribe,
  saveMailDefaults,
  saveUserPrefs,
  unsubscribe,
  validTitle,
  validUnsubscribe,
  type MailKind,
} from './mailprefs.ts'
import { nextSlot } from './dashboard.ts'
import { logEvent } from './events.ts'
import { previewNewsletter, sendNewsletter, sendNewsletterSample } from './newsletter.ts'
import { previewReminder, reminderCounts, sendReminder } from './reminder.ts'
import { escapeHtml } from './telegram.ts'

/** Eine schlichte Seite im Stil der Mails, für alles, was hinter einem Link aus einer Mail liegt. */
function page(title: string, body: string): string {
  const c = MAIL_COLORS
  return `<!doctype html>
<html lang="${locale().slice(0, 2)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:${c.page};color:${c.text};font-family:Arial,Helvetica,sans-serif">
<div style="max-width:440px;margin:12vh auto 0;padding:28px 24px;background:${c.band};border-top:3px solid ${c.accent}">
<div style="font-size:12px;letter-spacing:3px;color:${c.accent};text-transform:uppercase">${escapeHtml(senderName())}</div>
<h1 style="font-size:20px;margin:8px 0 14px">${escapeHtml(title)}</h1>
<div style="font-size:15px;line-height:1.6;color:${c.muted}">${body}</div>
</div>
</body>
</html>`
}

// Grobe Probe, ob ein Ersatztext aus Plex selbst englisch ist: Dann bleibt der Hinweis stehen.
const EN_WORDS = [' the ', ' and ', ' of ', ' his ', ' her ', ' with ', ' to ']
const DE_WORDS = [' der ', ' die ', ' das ', ' und ', ' ist ', ' mit ', ' ein ', ' eine ']
function looksEnglish(text: string): boolean {
  const s = ` ${text.toLowerCase()} `
  return EN_WORDS.filter((w) => s.includes(w)).length > DE_WORDS.filter((w) => s.includes(w)).length
}
interface TitleInfo {
  title: string
  original: string | null
  facts: string
  genres: string
  tagline: string | null
  overview: string | null
  /** Hinweis über der Inhaltsangabe, wenn es sie nur auf Englisch gibt */
  overviewNote: string | null
  onServer: string
  people: string[]
  trailer: string | null
  /** Englischer Trailer, wenn es keinen in der eingestellten Sprache gibt */
  trailerOther: string | null
  /** TMDB wurde gefragt und hat keinen Trailer in der eingestellten Sprache */
  trailerMissing: boolean
  poster: string | null
  backdrop: string | null
}

/** Was die Infoseite über einen Titel zeigt: von TMDB, wenn verbunden, sonst das, was Plex weiß. */
async function titleInfo(ratingKey: number, token: string): Promise<TitleInfo | null> {
  const item = db.prepare('SELECT type, title, year, tmdb_id, thumb FROM library_items WHERE rating_key = ?').get(ratingKey)
  if (!item) return null
  const type = item.type === 'show' ? 'show' : 'movie'
  const typeLabel = type === 'show' ? t('Serie') : t('Film')
  const minutes = (n: number | null | undefined) => (n ? t(type === 'show' ? 'je Folge {n} Min.' : '{n} Min.', { n }) : '')
  const facts = (...parts: (string | number | null | undefined | false)[]) => parts.filter(Boolean).join(' · ')

  let onServer = ''
  if (type === 'show') {
    const seasons = db
      .prepare('SELECT season, COUNT(*) AS n FROM media_files WHERE item_key = ? AND rating_key <> item_key AND season > 0 GROUP BY season ORDER BY season')
      .all(ratingKey)
    onServer = seasons.map((s) => `${t('Staffel {n}', { n: s.season as number })} (${t(s.n === 1 ? '{n} Folge' : '{n} Folgen', { n: s.n as number })})`).join(', ')
  }
  // Ohne TMDB kommt das Poster über eine eigene, ebenfalls unterschriebene Adresse vom Plex-Server
  const plexPoster = item.thumb ? `/api/public/poster?k=${ratingKey}&t=${token}` : null

  if (tmdbConfigured() && item.tmdb_id) {
    try {
      const d = await getDetails(type, item.tmdb_id as number, getSettings().upcomingRegion)
      // Hat TMDB den Text nur auf Englisch, geht der aus Plex vor
      const summary = d.overviewFallback ? (await pms(`/library/metadata/${ratingKey}`).catch(() => ({}))).Metadata?.[0]?.summary : null
      // Plex führt oft denselben englischen Text wie TMDB; der zählt dann nicht als eigener
      const plexText = summary && String(summary).trim() !== (d.overview ?? '').trim() ? String(summary) : null
      return {
        title: item.title as string,
        original: d.original_title && d.original_title !== item.title ? d.original_title : null,
        facts: facts(
          typeLabel,
          d.year,
          type === 'show' && d.seasons ? t(d.seasons === 1 ? '{n} Staffel' : '{n} Staffeln', { n: d.seasons }) : '',
          minutes(d.runtime),
          d.status,
          d.certification && t('FSK {n}', { n: d.certification }),
        ),
        genres: d.genres.join(', '),
        tagline: d.tagline,
        overview: plexText ?? d.overview,
        overviewNote: d.overviewFallback && (!plexText || looksEnglish(plexText)) ? t('Inhaltsangabe nur auf Englisch verfügbar') : null,
        onServer,
        people: [
          d.creators.length ? t(type === 'movie' ? 'Regie: {names}' : 'Erfunden von: {names}', { names: d.creators.join(', ') }) : '',
          d.cast.length ? t('Mit: {names}', { names: d.cast.join(', ') }) : '',
        ].filter(Boolean),
        trailer: d.trailer,
        trailerOther: d.trailerOther,
        trailerMissing: !d.trailer,
        poster: d.poster ? `https://image.tmdb.org/t/p/w342${d.poster}` : plexPoster,
        backdrop: d.backdrop ? `https://image.tmdb.org/t/p/w1280${d.backdrop}` : null,
      }
    } catch {
      // TMDB gerade nicht erreichbar: weiter mit dem, was Plex weiß
    }
  }

  const m = (await pms(`/library/metadata/${ratingKey}`).catch(() => ({}))).Metadata?.[0] ?? {}
  const names = (list: any[] | undefined) => (list ?? []).slice(0, 8).map((x) => String(x.tag))
  const cast = names(m.Role)
  const directors = names(m.Director)
  return {
    title: item.title as string,
    original: m.originalTitle && m.originalTitle !== item.title ? String(m.originalTitle) : null,
    facts: facts(typeLabel, item.year as number | null, minutes(m.duration ? Math.round(m.duration / 60000) : null), m.contentRating),
    genres: names(m.Genre).join(', '),
    tagline: m.tagline ? String(m.tagline) : null,
    overview: m.summary ? String(m.summary) : null,
    onServer,
    people: [directors.length ? t('Regie: {names}', { names: directors.join(', ') }) : '', cast.length ? t('Mit: {names}', { names: cast.join(', ') }) : ''].filter(Boolean),
    overviewNote: null,
    trailer: null,
    trailerOther: null,
    trailerMissing: false,
    poster: plexPoster,
    backdrop: null,
  }
}

function titlePage(info: TitleInfo): string {
  const c = MAIL_COLORS
  const e = escapeHtml
  return `<!doctype html>
<html lang="${locale().slice(0, 2)}">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="dark"><title>${e(info.title)}</title></head>
<body style="margin:0;background:${c.page};color:${c.text};font-family:Arial,Helvetica,sans-serif">
<div style="max-width:640px;margin:0 auto;background:${c.band};min-height:100vh">
${info.backdrop ? `<img src="${e(info.backdrop)}" alt="" style="display:block;width:100%;height:auto">` : ''}
<div style="padding:20px 20px 32px;border-top:3px solid ${c.accent}">
<div style="font-size:12px;letter-spacing:3px;color:${c.accent};text-transform:uppercase">${e(senderName())}</div>
<div style="display:flex;gap:16px;margin-top:14px">
${info.poster ? `<img src="${e(info.poster)}" alt="" style="width:110px;height:165px;object-fit:cover;border-radius:6px;flex-shrink:0;background:${c.card}">` : ''}
<div style="min-width:0">
<h1 style="font-size:24px;line-height:1.2;margin:0 0 6px">${e(info.title)}</h1>
${info.original ? `<div style="font-size:13px;color:${c.muted}">${e(t('Originaltitel: {title}', { title: info.original }))}</div>` : ''}
<div style="font-size:14px;color:${c.muted};margin-top:4px">${e(info.facts)}</div>
${info.genres ? `<div style="font-size:14px;color:${c.muted}">${e(info.genres)}</div>` : ''}
</div>
</div>
${info.onServer ? `<div style="margin-top:16px;padding:10px 12px;background:${c.card};border-radius:6px;font-size:14px"><span style="color:${c.accent}">${e(t('Auf dem Server:'))}</span> ${e(info.onServer)}</div>` : ''}
${info.tagline ? `<p style="font-style:italic;font-size:16px;margin:18px 0 0">${e(info.tagline)}</p>` : ''}
${info.overviewNote ? `<p style="font-size:13px;color:${c.muted};margin:14px 0 -8px">${e(info.overviewNote)}</p>` : ''}
<p style="font-size:16px;line-height:1.6;margin:14px 0 0;white-space:pre-line">${e(info.overview ?? t('Zu diesem Titel gibt es noch keine Beschreibung.'))}</p>
${info.people.map((line) => `<p style="font-size:14px;line-height:1.5;color:${c.muted};margin:10px 0 0">${e(line)}</p>`).join('')}
${info.trailer ? `<a href="https://www.youtube.com/watch?v=${e(info.trailer)}" style="display:inline-block;margin-top:20px;background:${c.accent};color:${c.onAccent};font-size:15px;font-weight:bold;padding:11px 20px;border-radius:4px;text-decoration:none">&#9654; ${e(t('Trailer ansehen'))}</a>` : ''}
${info.trailerMissing ? `<p style="font-size:14px;color:${c.muted};margin:20px 0 0">${e(t('Kein Trailer in deiner Sprache verfügbar.'))}${info.trailerOther ? ` <a href="https://www.youtube.com/watch?v=${e(info.trailerOther)}" style="color:${c.accent}">${e(t('Englischen ansehen'))}</a>` : ''}</p>` : ''}
</div>
</div>
</body>
</html>`
}

// Aufrufe der öffentlichen Seiten pro Adresse und Minute
const PUBLIC_LIMIT = 90
// Poster zählen eigens und großzügiger: Lädt ein Mailprogramm die Bilder über einen Dienst wie den von Gmail,
// kommen die Aufrufe vieler Empfänger von wenigen Adressen
const POSTER_LIMIT = 900

// Schon gelieferte Poster, damit nicht jeder Aufruf Plex bemüht
const POSTER_CACHE_MS = 6 * 3600_000
const posterCache = new Map<number, { at: number; data: Buffer; type: string }>()

export function registerMailRoutes(app: FastifyInstance): void {
  // Die Seiten hinter den Links in den Mails sind ohne Anmeldung erreichbar. Ihre Schlüssel sind zu lang zum Erraten,
  // massenhaftes Durchprobieren wird trotzdem gebremst: pro Adresse nur eine begrenzte Zahl von Aufrufen je Minute.
  const hits = new Map<string, { count: number; reset: number }>()
  app.addHook('onRequest', (req, reply, done) => {
    if (!req.url.startsWith('/api/public/')) return done()
    const forwarded = req.headers['cf-connecting-ip'] ?? String(req.headers['x-forwarded-for'] ?? '').split(',')[0]
    const ip = String(forwarded || req.ip).trim()
    const stamp = Date.now()
    if (hits.size > 5000) for (const [key, hit] of hits) if (hit.reset < stamp) hits.delete(key)
    const isPoster = req.url.startsWith('/api/public/poster') || req.url.startsWith('/api/public/head/')
    const bucket = isPoster ? `poster:${ip}` : ip
    const hit = hits.get(bucket)
    if (!hit || hit.reset < stamp) hits.set(bucket, { count: 1, reset: stamp + 60_000 })
    else if (++hit.count > (isPoster ? POSTER_LIMIT : PUBLIC_LIMIT)) {
      void reply.code(429).header('retry-after', '60').send({ error: t('Zu viele Aufrufe. Bitte in einer Minute noch einmal versuchen.') })
      return
    }
    done()
  })

  // Formulare und der Ein-Klick-Abruf der Mailprogramme schicken ihre Angaben in dieser Form; ausgewertet wird nur die Adresse
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, body))

  // Ob die Mails sachlich oder wie ein Agenten-Briefing klingen
  // `canRemote`: Poster lassen sich nur laden, wenn Blackbriar von außen erreichbar ist
  const look = () => ({ briefing: briefingTone(), remotePosters: remotePosters(), canRemote: Boolean(config.publicUrl) })
  app.get('/api/mail/tone', () => look())
  app.put<{ Body: { briefing?: boolean; remotePosters?: boolean } }>('/api/mail/tone', (req) => {
    if (typeof req.body?.briefing === 'boolean') {
      setBriefingTone(req.body.briefing)
      logEvent('settings', t(briefingTone() ? 'Briefing-Ton der Mails eingeschaltet' : 'Briefing-Ton der Mails ausgeschaltet'))
    }
    if (typeof req.body?.remotePosters === 'boolean') {
      setRemotePosters(req.body.remotePosters)
      logEvent('settings', t(req.body.remotePosters ? 'Poster in den Mails werden von Blackbriar geladen' : 'Poster in den Mails werden angehängt'))
    }
    return look()
  })

  const kindOf = (value: unknown): MailKind => (value === 'reminder' ? 'reminder' : 'newsletter')

  app.get('/api/mail/prefs', () => {
    const users = db
      .prepare(
        `SELECT id, name, COALESCE(NULLIF(email_override, ''), email) AS email, newsletter_unsub, reminder_unsub, newsletter_sent_at
         FROM users WHERE active = 1 ORDER BY is_owner DESC, name COLLATE NOCASE`,
      )
      .all()
      .map((u) => {
        const id = u.id as number
        const prefs = effectivePrefs(id)
        return { ...u, prefs, own: ownParts(id), next: prefs.newsletter ? nextSlot(prefs) : null, reminders: reminderCounts(id) }
      })
    return { defaults: mailDefaults(), users, log: { newsletter: mailLog('newsletter'), reminder: mailLog('reminder') } }
  })

  app.put('/api/mail/defaults', (req) => {
    saveMailDefaults(req.body)
    logEvent('settings', t('Standard für Newsletter und Erinnerung geändert'))
    return mailDefaults()
  })

  // Eigene Einstellungen eines Benutzers für Newsletter oder Erinnerung; `prefs: null` heißt, dass dafür wieder der Standard gilt
  app.put<{ Params: { id: string }; Body: { part?: string; prefs?: unknown } }>('/api/mail/users/:id', (req, reply) => {
    const id = Number(req.params.id)
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(id)) return reply.code(404).send({ error: t('Nicht gefunden') })
    saveUserPrefs(id, kindOf(req.body?.part), req.body?.prefs ?? null)
    const who = String(db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name ?? id)
    const part = kindOf(req.body?.part) === 'reminder' ? t('Erinnerung') : t('Newsletter')
    logEvent('settings', req.body?.prefs == null ? t('{name}: {part} wieder nach Standard', { name: who, part }) : t('{name}: eigene Einstellungen für {part} geändert', { name: who, part }))
    return { prefs: effectivePrefs(id), own: ownParts(id) }
  })

  app.post<{ Params: { id: string }; Body: { kind?: string } }>('/api/mail/users/:id/resubscribe', (req) => {
    resubscribe(Number(req.params.id), kindOf(req.body?.kind))
    logEvent('mail', t('{name} wieder angemeldet', { name: String(db.prepare('SELECT name FROM users WHERE id = ?').get(Number(req.params.id))?.name ?? req.params.id) }))
    return { ok: true }
  })

  app.post<{ Params: { id: string }; Body: { kind?: string; sample?: boolean } }>('/api/mail/users/:id/send', async (req, reply) => {
    const id = Number(req.params.id)
    try {
      if (kindOf(req.body?.kind) === 'reminder') {
        const result = await sendReminder(id, true)
        return { sent: result.sent, message: result.sent ? t('Erinnerung verschickt.') : result.reason }
      }
      if (req.body?.sample) {
        const result = await sendNewsletterSample(id)
        return { sent: result.sent, message: result.sent ? t('Probe verschickt. Sie zählt nicht als Newsletter; der nächste echte kommt wie gewohnt.') : result.reason }
      }
      const result = await sendNewsletter(id)
      return { sent: result.sent, message: result.sent ? t('Newsletter verschickt.') : result.reason }
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  // Testnachricht an einen Benutzer, um seine Adresse zu prüfen
  app.post<{ Params: { id: string } }>('/api/mail/users/:id/test', async (req, reply) => {
    const id = Number(req.params.id)
    const name = String(db.prepare('SELECT name FROM users WHERE id = ?').get(id)?.name ?? '')
    if (!name) return reply.code(404).send({ error: t('Nicht gefunden') })
    if (!mailConfigured()) return reply.code(400).send({ error: t('Erst das Postfach eintragen und speichern.') })
    if (!userEmail(id)) return reply.code(400).send({ error: t('Für diesen Benutzer ist keine Adresse bekannt.') })
    try {
      await sendMail(await userTestMail(id))
    } catch (err) {
      logEvent('mail', t('Testnachricht an {name} nicht verschickt: {error}', { name, error: (err as Error).message }), 'error')
      return reply.code(502).send({ error: (err as Error).message })
    }
    logEvent('mail', t('Testnachricht an {name} verschickt', { name }))
    return { message: t('Testnachricht an {name} verschickt. Ob sie ankommt, zeigt sich im Postfach des Empfängers, auch im Spam-Ordner.', { name }) }
  })

  app.get<{ Params: { id: string }; Querystring: { kind?: string } }>('/api/mail/users/:id/preview', async (req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8')
    const id = Number(req.params.id)
    try {
      if (kindOf(req.query.kind) === 'reminder') {
        const mail = await previewReminder(id)
        if (!mail) return page(t('Keine Erinnerung'), escapeHtml(t('Bei diesem Benutzer ist gerade nichts fällig.')))
        return inlineImages(mail.html, mail.attachments ?? [])
      }
      const mail = await previewNewsletter(id)
      if (!mail) return page(t('Kein Newsletter'), escapeHtml(t('Seit dem letzten Newsletter ist nichts Neues dazugekommen.')))
      return inlineImages(mail.html, mail.attachments ?? [])
    } catch (err) {
      return page(t('Vorschau nicht möglich'), escapeHtml((err as Error).message))
    }
  })

  // Infoseite zu einem Titel aus dem Newsletter: ohne Anmeldung, aber nur für genau diesen Titel
  app.get<{ Querystring: Record<string, string> }>('/api/public/title', async (req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8')
    const key = Number(req.query.k)
    if (!Number.isInteger(key) || !validTitle(key, String(req.query.t ?? ''))) {
      return reply.code(400).send(page(t('Link ungültig'), escapeHtml(t('Dieser Link ist nicht gültig.'))))
    }
    const info = await titleInfo(key, String(req.query.t))
    if (!info) return reply.code(404).send(page(t('Nicht mehr da'), escapeHtml(t('Dieser Titel liegt nicht mehr auf dem Server.'))))
    return titlePage(info)
  })

  // Logo und Kalenderwochen-Kästchen aus dem Kopf der Mails, wenn die Bilder geladen statt angehängt werden.
  // Beide stehen ohnehin in jeder Mail; eine Unterschrift brauchen sie deshalb nicht.
  app.get<{ Params: { file: string } }>('/api/public/head/:file', (req, reply) => {
    const img = mailHeadImage(req.params.file)
    if (!img) return reply.code(404).send()
    return reply.header('content-type', img.type).header('cache-control', 'public, max-age=86400').send(img.data)
  })

  app.get<{ Querystring: Record<string, string> }>('/api/public/poster', async (req, reply) => {
    const key = Number(req.query.k)
    const item = Number.isInteger(key) && validTitle(key, String(req.query.t ?? '')) ? db.prepare('SELECT thumb FROM library_items WHERE rating_key = ?').get(key) : null
    if (!item) return reply.code(404).send()
    const cached = posterCache.get(key)
    if (cached && Date.now() - cached.at < POSTER_CACHE_MS) return reply.header('content-type', cached.type).header('cache-control', 'public, max-age=86400').send(cached.data)
    // Hat Plex kein Poster, kommt es von TMDB; das Bild dient der Infoseite und, je nach Einstellung, den Mails
    const img = await posterImage((item.thumb as string | null) ?? null, key, 342, 513)
    if (!img) return reply.code(404).send()
    if (posterCache.size > 400) posterCache.clear()
    posterCache.set(key, { at: Date.now(), ...img })
    return reply.header('content-type', img.type).header('cache-control', 'public, max-age=86400').send(img.data)
  })

  // Hinter dem Link in der Mail. Der Aufruf allein meldet nicht ab, weil Mailprogramme Links zur Prüfung vorab öffnen;
  // erst der Knopf (oder der Ein-Klick-Abruf des Mailprogramms) schickt die Abmeldung ab.
  const target = (query: Record<string, string | undefined>) => {
    const userId = Number(query.u)
    const kind = String(query.k ?? '')
    return Number.isInteger(userId) && validUnsubscribe(userId, kind, String(query.t ?? '')) ? { userId, kind } : null
  }
  const invalid = () => page(t('Link ungültig'), escapeHtml(t('Dieser Link ist nicht mehr gültig. Antworte einfach auf die Mail, dann wirst du von Hand ausgetragen.')))

  app.get<{ Querystring: Record<string, string> }>('/api/public/unsubscribe', (req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8')
    const hit = target(req.query)
    if (!hit) return reply.code(400).send(invalid())
    const c = MAIL_COLORS
    const what = hit.kind === 'newsletter' ? t('den Newsletter') : t('die Erinnerungen')
    return page(
      t('Wirklich abbestellen?'),
      `<p style="margin:0 0 18px">${escapeHtml(t('Du bekommst dann {what} nicht mehr.', { what }))}</p>
<form method="post" action="${escapeHtml(req.url)}">
<button type="submit" style="background:${c.accent};color:${c.onAccent};border:0;font-size:15px;font-weight:bold;padding:10px 18px;border-radius:4px;cursor:pointer">${escapeHtml(t('Ja, abbestellen'))}</button>
</form>`,
    )
  })

  app.post<{ Querystring: Record<string, string> }>('/api/public/unsubscribe', (req, reply) => {
    reply.header('content-type', 'text/html; charset=utf-8')
    const hit = target(req.query)
    if (!hit) return reply.code(400).send(invalid())
    unsubscribe(hit.userId, hit.kind)
    return page(t('Abbestellt'), escapeHtml(t('Erledigt. Falls du es dir anders überlegst, sag einfach Bescheid.')))
  })
}
