import type { FastifyInstance } from 'fastify'
import {
  appCommit,
  appVersion,
  config,
  CONNECTION_KEYS,
  connectionSource,
  plexConfigured,
  SECRET_KEYS,
  seerrConfigured,
  tautulliConfigured,
  telegramConfigured,
  tmdbConfigured,
  tracearrConfigured,
  mailConfigured,
} from './config.ts'
import { authEnabled, currentUser, newWebhookKey, webhookKey } from './auth.ts'
import { deleteMedia, recentDeletions } from './delete.ts'
import { testTracearr } from './tracearr.ts'
import { importStatus, startImport } from './import.ts'
import { ARR_INSTANCES, arrConfigured, configuredArrInstances, testArr } from './arr.ts'
import { db, excludedSections, moveSection, plexSections, recordingSince, getSettings, saveConnection, saveSettings, historyTitles, setSectionIncluded, sortBySection, openItems, watchlistTitles } from './db.ts'
import { titleDetail } from './title.ts'
import { addPreset, deleteTopic, presetNames, saveTopic, searchKeywords, topics, topicTitles } from './topics.ts'
import { airingShows, cleanupCandidates, episodeCleanup, fileList, mediaStats, notInPlex, requestStates, type FileItem } from './media.ts'
import { isImagePath, plexImage, testPlex } from './plex.ts'
import { requestMedia, testSeerr } from './seerr.ts'
import { getDetails, testTmdb } from './tmdb.ts'
import { ignoreMismatch, plexMismatches } from './mismatch.ts'
import { dismissNotice, openNotices, unmonitorNotice } from './notices.ts'
import { backupStatus } from './backup.ts'
import { events, logEvent } from './events.ts'
import { dashboard } from './dashboard.ts'
import { storage } from './storage.ts'
import { inlineImages, mailLogo, removeMailLogo, saveMailLogo, sendTestMail, testMail } from './mail.ts'
import { readFileSync } from 'node:fs'
import { hiddenTitles, hideTitle, unhideTitle, providerCatalog, refreshUpcoming, upcoming } from './upcoming.ts'
import { getSessions } from './sessions.ts'
import { stats } from './stats.ts'
import { arrSoon, refreshSeerrSoon, refreshUser, resyncAll, runCycle, syncSoon, syncStatus } from './sync.ts'
import { testTautulli } from './tautulli.ts'
import { sendTelegram, testTelegram } from './telegram.ts'
import { buildWeekly } from './weekly.ts'
import { t } from './i18n.ts'

type Query = Record<string, string | undefined>

const count = (table: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0)

function paging(q: Query): { limit: number; offset: number } {
  return {
    limit: Math.min(200, Math.max(1, Number(q.limit) || 50)),
    offset: Math.max(0, Number(q.offset) || 0),
  }
}

// Grobe Prüfung; ob die Adresse wirklich existiert, zeigt erst der Versand
const EMAIL = /^[^@ ]+@[^@ ]+[.][^@ ]+$/

export function registerRoutes(app: FastifyInstance): void {
  app.get('/api/status', () => ({
    plexConfigured: plexConfigured(),
    telegramConfigured: telegramConfigured(),
    seerrConfigured: seerrConfigured(),
    tautulliConfigured: tautulliConfigured(),
    tracearrConfigured: tracearrConfigured(),
    tmdbConfigured: tmdbConfigured(),
    recordingSince,
    arrConfigured: configuredArrInstances().length > 0,
    syncIntervalSec: config.syncIntervalSec,
    webhookKey: authEnabled() ? webhookKey() : null,
    version: appVersion,
    commit: appCommit || null,
    sync: syncStatus,
    backup: backupStatus(),
    counts: { history: count('history'), ratings: count('ratings'), library: count('library_items'), plays: count('plays'), ownPlays: count('own_plays'), tracearrPlays: count('tracearr_plays') },
  }))

  app.get('/api/sessions', () => getSessions())

  app.get('/api/users', () => {
    const open = new Map<number, number>()
    for (const o of openItems()) open.set(o.user_id, (open.get(o.user_id) ?? 0) + 1)
    const users = db
      .prepare(
        `SELECT u.id, u.name, u.is_owner, u.active, COALESCE(NULLIF(u.email_override, ''), u.email) AS email,
           u.email_override IS NOT NULL AND u.email_override <> '' AS email_custom, u.display_name,
           COALESCE(u.plex_name, u.name) AS plex_name, COALESCE(u.never_rates, 0) AS never_rates,
           (SELECT COUNT(*) FROM history h WHERE h.user_id = u.id) AS plays,
           (SELECT MAX(h.viewed_at) FROM history h WHERE h.user_id = u.id) AS last_seen,
           (SELECT COUNT(*) FROM ratings r WHERE r.user_id = u.id) AS ratings
         FROM users u
         ORDER BY u.active DESC, last_seen DESC`,
      )
      .all()
    // Konten ohne Zugriff bleiben nur sichtbar, solange sie im Verlauf vorkommen
    return users
      .filter((u) => u.active || Number(u.plays) > 0)
      .map((u) => ({
        ...u,
        open: open.get(u.id as number) ?? 0,
        // Mediatheken, die für den Benutzer in Plex freigegeben sind; leer, solange sie noch nicht gelesen wurden
        sections: sortBySection(db.prepare('SELECT section FROM user_sections WHERE user_id = ?').all(u.id as number).map((s) => s.section as string), (s) => s),
      }))
  })

  // Hängt die Dateigröße an Einträge, die einen Bibliothekstitel meinen
  const withSize = <T extends { rating_key: number | null }>(items: T[]): (T & { size: number | null })[] => {
    const stats = mediaStats()
    return items.map((item) => ({ ...item, size: (item.rating_key != null && stats.get(item.rating_key)?.size) || null }))
  }

  app.get('/api/open', (req) => {
    const q = req.query as Query
    // Wer den Titel noch auf der Merkliste hat, und was der Lösch-Dialog braucht: Dateien und Radarr/Sonarr
    const wanted = new Map<number, string[]>()
    for (const w of db
      .prepare(
        `SELECT l.rating_key, u.name FROM watchlist w
         JOIN library_items l ON l.type = w.type AND l.tmdb_id = w.tmdb_id
         JOIN users u ON u.id = w.user_id AND u.active = 1 ORDER BY u.name COLLATE NOCASE`,
      )
      .all()) {
      wanted.set(w.rating_key as number, [...(wanted.get(w.rating_key as number) ?? []), w.name as string])
    }
    const files = new Map(fileList().map((f) => [f.rating_key, f]))
    const airing = airingShows()
    return withSize(openItems(q.user ? Number(q.user) : undefined)).map((o) => ({
      ...o,
      watchlist: wanted.get(o.rating_key) ?? [],
      files: files.get(o.rating_key)?.files ?? 0,
      arr: (files.get(o.rating_key)?.arr ?? []).map((a) => a.name),
      airing: airing.get(o.rating_key) ?? null,
    }))
  })

  app.get('/api/titles', (req) => {
    const q = req.query as Query
    const { limit, offset } = paging(q)
    const search = q.q?.toLowerCase()
    const userId = q.user ? Number(q.user) : undefined
    const minPeople = Number(q.min) || 1
    const all = historyTitles().filter(
      (t) =>
        t.people.length >= minPeople &&
        (q.gone !== '0' || !t.gone) &&
        (!search || t.title.toLowerCase().includes(search)) &&
        (!userId || t.people.some((p) => p.user_id === userId)),
    )
    return { total: all.length, items: withSize(all.slice(offset, offset + limit)) }
  })

  // Titel, die Plex vermutlich falsch zugeordnet hat
  app.get('/api/mismatches', () => plexMismatches())
  app.post<{ Body: { key?: string } }>('/api/mismatches/ignore', (req, reply) => {
    const key = String(req.body?.key ?? '')
    if (!/^(movie|show):\d+:\d+$/.test(key)) return reply.code(400).send({ error: 'key' })
    ignoreMismatch(key)
    return plexMismatches()
  })

  // Hinweise zu Serien: Staffel komplett, gemischte Release-Gruppen
  app.get('/api/notices', () => openNotices())
  app.post<{ Params: { id: string } }>('/api/notices/:id/ignore', (req) => {
    dismissNotice(Number(req.params.id))
    return openNotices()
  })
  app.post<{ Params: { id: string } }>('/api/notices/:id/unmonitor', async (req, reply) => {
    try {
      const message = await unmonitorNotice(Number(req.params.id))
      return { message, items: openNotices() }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.get('/api/watchlist', (req) => {
    const q = req.query as Query
    const userId = q.user ? Number(q.user) : undefined
    const requests = requestStates()
    return withSize(watchlistTitles().filter((t) => !userId || t.people.some((p) => p.user_id === userId))).map((t) => ({
      ...t,
      request: requests.get(`${t.type}:${t.tmdb_id}`) ?? null,
    }))
  })

  app.get('/api/cleanup', () => {
    const airing = airingShows()
    const mark = <T extends { rating_key: number }>(items: T[]) => items.map((i) => ({ ...i, airing: airing.get(i.rating_key) ?? null }))
    return { titles: mark(cleanupCandidates()), episodes: mark(episodeCleanup()), deletions: recentDeletions() }
  })

  app.post('/api/delete', async (req, reply) => {
    if (!getSettings().allowDelete) return reply.code(403).send({ error: t('Das Löschen ist in den Einstellungen nicht erlaubt.') })
    const body = (req.body ?? {}) as Record<string, unknown>
    const ratingKey = Number(body.ratingKey)
    const episodes = Array.isArray(body.episodes) ? body.episodes.map(Number).filter(Number.isInteger) : undefined
    if (!Number.isInteger(ratingKey) || (episodes && episodes.length === 0)) return reply.code(400).send({ error: t('Ungültige Angaben') })
    try {
      return await deleteMedia(
        {
          ratingKey,
          episodes,
          removeFromArr: body.removeFromArr !== false,
          removeSeries: body.removeSeries === true,
          keepSeries: body.keepSeries === true,
          resetSeerr: body.resetSeerr !== false,
        },
        currentUser(req),
      )
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.get('/api/files', (req) => {
    const q = req.query as Query
    const { limit, offset } = paging(q)
    const search = q.q?.toLowerCase()
    const filters: Record<string, (f: FileItem) => boolean> = {
      converted: (f) => f.files > 0 && f.converted === f.files,
      unconverted: (f) => f.files > 0 && f.converted < f.files,
      transcoded: (f) => f.transcodes > 0,
      inarr: (f) => f.arr.length > 0,
      // Umgewandelt und noch verwaltet; Serien nur, wenn keine weiteren Folgen kommen
      done: (f) =>
        f.arr.length > 0 && f.files > 0 && f.converted === f.files && (f.type === 'movie' || f.arr.every((a) => a.status === 'ended')),
    }
    const filter = filters[q.filter ?? ''] ?? (() => true)
    const sorts: Record<string, (a: FileItem, b: FileItem) => number> = {
      size: (a, b) => b.size - a.size,
      bitrate: (a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0),
      transcodes: (a, b) => b.transcodes - a.transcodes || b.size - a.size,
      title: (a, b) => a.title.localeCompare(b.title, 'de'),
    }
    const all = fileList()
      .filter((f) => filter(f) && (!q.type || f.type === q.type) && (!q.section || f.section === q.section) && (!search || f.title.toLowerCase().includes(search)))
      .sort(sorts[q.sort ?? ''] ?? sorts.size)
    return {
      total: all.length,
      totalSize: all.reduce((sum, f) => sum + f.size, 0),
      items: all.slice(offset, offset + limit),
    }
  })

  // Die Mediatheken aus Plex mit Umfang; ausgenommene bleiben bei „Kann weg“, Erinnerungen und Newsletter außen vor
  const sections = () => {
    const excluded = excludedSections()
    const map = new Map<string, { name: string; type: string; titles: number; size: number; included: boolean }>()
    // Auch leere Mediatheken aus Plex, damit sie sich vorab einsortieren lassen; die Bibliothek blendet sie aus
    for (const s of plexSections()) {
      map.set(s.name, { name: s.name, type: s.type, titles: 0, size: 0, included: !excluded.has(s.name) })
    }
    for (const f of fileList()) {
      if (!f.section) continue
      const s = map.get(f.section) ?? { name: f.section, type: f.type, titles: 0, size: 0, included: !excluded.has(f.section) }
      s.titles++
      s.size += f.size
      map.set(f.section, s)
    }
    return sortBySection([...map.values()], (s) => s.name)
  }
  app.get('/api/sections', () => sections())
  app.post<{ Body: { name?: string; direction?: string } }>('/api/sections/move', (req, reply) => {
    const current = sections().map((s) => s.name)
    const name = String(req.body?.name ?? '')
    if (!current.includes(name)) return reply.code(404).send({ error: t('Nicht gefunden') })
    moveSection(name, req.body?.direction === 'up' ? 'up' : 'down', current)
    return sections()
  })
  app.put<{ Body: { name?: string; included?: boolean } }>('/api/sections', (req, reply) => {
    const name = String(req.body?.name ?? '')
    if (!sections().some((s) => s.name === name)) return reply.code(404).send({ error: t('Nicht gefunden') })
    setSectionIncluded(name, req.body?.included !== false)
    return sections()
  })

  // Alles zu einem Titel für das Info-Fenster; `key` darf auch eine einzelne Folge meinen
  app.get<{ Querystring: { key?: string; type?: string; tmdb?: string } }>('/api/title', async (req, reply) => {
    const q = req.query
    const detail = await titleDetail({
      key: q.key ? Number(q.key) : undefined,
      type: q.type === 'movie' || q.type === 'show' ? q.type : undefined,
      tmdb: q.tmdb ? Number(q.tmdb) : undefined,
    })
    return detail ?? reply.code(404).send({ error: t('Nicht gefunden') })
  })

  app.get('/api/notinplex', () => notInPlex())

  app.get('/api/stats', (req) => {
    const q = req.query as Query
    return stats(Number(q.days) || 0, q.user ? Number(q.user) : undefined)
  })

  app.get('/api/ratings', (req) => {
    const q = req.query as Query
    const { limit, offset } = paging(q)
    const where = q.user ? 'WHERE r.user_id = ?' : ''
    const params = q.user ? [Number(q.user)] : []
    const total = db.prepare(`SELECT COUNT(*) AS n FROM ratings r ${where}`).get(...params)?.n
    const items = db
      .prepare(
        `SELECT r.user_id, u.name AS user_name, r.rating_key, r.type, r.title, r.year, r.thumb, r.rating, r.rated_at,
           (SELECT MAX(h.viewed_at) FROM history h
            WHERE h.user_id = r.user_id AND (h.rating_key = r.rating_key OR h.show_key = r.rating_key)) AS seen_at
         FROM ratings r LEFT JOIN users u ON u.id = r.user_id
         ${where}
         ORDER BY r.rated_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset)
    return { total, items: withSize(items as unknown as { rating_key: number }[]) }
  })

  app.get('/api/history', (req) => {
    const q = req.query as Query
    const { limit, offset } = paging(q)
    const conditions: string[] = []
    const params: (string | number)[] = []
    if (q.user) {
      conditions.push('h.user_id = ?')
      params.push(Number(q.user))
    }
    if (q.q) {
      conditions.push('(h.title LIKE ? OR h.show_title LIKE ?)')
      params.push(`%${q.q}%`, `%${q.q}%`)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    // Mehrere Folgen einer Serie, die jemand am selben Tag gesehen hat, werden zu einer Zeile
    const group = `h.user_id, CASE WHEN h.type = 'episode' AND h.show_key IS NOT NULL THEN 's' || h.show_key ELSE 'h' || h.id END,
      date(h.viewed_at, 'unixepoch', 'localtime')`
    const total = db.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM history h ${where} GROUP BY ${group})`).get(...params)?.n
    const items = db
      .prepare(
        `SELECT MIN(h.id) AS id, h.user_id, u.name AS user_name, h.rating_key, h.type, h.title, h.show_title,
           h.season, h.episode, MAX(h.viewed_at) AS viewed_at,
           COALESCE(MAX(h.thumb), (SELECT l.thumb FROM library_items l
                                   WHERE l.type = CASE h.type WHEN 'episode' THEN 'show' ELSE 'movie' END
                                     AND l.title = COALESCE(h.show_title, h.title) LIMIT 1)) AS thumb,
           (SELECT NULLIF(p.poster, '') FROM posters p
            WHERE p.type = CASE h.type WHEN 'episode' THEN 'show' ELSE 'movie' END AND p.title = COALESCE(h.show_title, h.title)) AS poster,
           COUNT(DISTINCT COALESCE(h.season * 10000 + h.episode, h.id)) AS count,
           MIN(h.season * 10000 + h.episode) AS first_code, MAX(h.season * 10000 + h.episode) AS last_code
         FROM history h LEFT JOIN users u ON u.id = h.user_id
         ${where}
         GROUP BY ${group}
         ORDER BY viewed_at DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset)
    return { total, items }
  })

  app.get('/api/settings', () => getSettings())

  app.put('/api/settings', (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const reminderDays = Number(body.reminderDays)
    const weeklyDay = Number(body.weeklyDay)
    const weeklyHour = Number(body.weeklyHour)
    const cleanupWaitDays = body.cleanupWaitDays == null ? getSettings().cleanupWaitDays : Number(body.cleanupWaitDays)
    if (!Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 365 || !Number.isInteger(cleanupWaitDays) || cleanupWaitDays < 0 || cleanupWaitDays > 365) {
      return reply.code(400).send({ error: t('Die Anzahl der Tage muss zwischen 0 und 365 liegen.') })
    }
    if (!Number.isInteger(weeklyDay) || weeklyDay < 0 || weeklyDay > 6 || !Number.isInteger(weeklyHour) || weeklyHour < 0 || weeklyHour > 23) {
      return reply.code(400).send({ error: t('Wochentag oder Uhrzeit des Wochenrückblicks ist ungültig.') })
    }
    saveSettings({
      reminderDays,
      notifyRatings: Boolean(body.notifyRatings),
      notifyReminders: Boolean(body.notifyReminders),
      notifyMismatches: Boolean(body.notifyMismatches),
      notifySeasons: Boolean(body.notifySeasons),
      weeklyEnabled: Boolean(body.weeklyEnabled),
      weeklyDay,
      weeklyHour,
      convertedMarker: String(body.convertedMarker ?? '').trim().slice(0, 100),
      cleanupWaitDays,
      allowDelete: Boolean(body.allowDelete),
      language: body.language === 'en' ? 'en' : 'de',
      pastSource: body.pastSource === 'tracearr' ? 'tracearr' : 'tautulli',
      upcomingRegion: /^[A-Za-z]{2}$/.test(String(body.upcomingRegion ?? '')) ? String(body.upcomingRegion).toUpperCase() : 'DE',
      upcomingProviders: Array.isArray(body.upcomingProviders) ? body.upcomingProviders.map(String).slice(0, 60) : getSettings().upcomingProviders,
    })
    logEvent('settings', t('Einstellungen geändert'))
    return getSettings()
  })

  // Geheime Werte gehen nie an die Oberfläche zurück, nur ob und wo sie gesetzt sind
  const connections = () =>
    Object.fromEntries(
      CONNECTION_KEYS.map((key) => [
        key,
        { value: SECRET_KEYS.has(key) ? '' : config[key], source: connectionSource(key) },
      ]),
    )

  app.get('/api/connections', () => connections())

  // Nur mitgeschickte Felder ändern sich; ein leerer Wert entfernt die Eingabe aus der Oberfläche
  app.put('/api/connections', (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const changes = CONNECTION_KEYS.filter((key) => key in body).map((key) => [key, String(body[key] ?? '').trim()] as const)
    for (const [key, value] of changes) {
      if (value && key.endsWith('Url') && !/^https?:\/\/[^\s/]+/i.test(value)) {
        return reply.code(400).send({ error: t('Adressen müssen mit http:// oder https:// beginnen.') })
      }
      if (value && key === 'mailPort' && !/^[0-9]{2,5}$/.test(value)) return reply.code(400).send({ error: t('Der Port muss eine Zahl sein, üblich sind 465 oder 587.') })
      if (value && key === 'mailFrom' && !EMAIL.test(value)) return reply.code(400).send({ error: t('Die Absenderadresse ist keine gültige E-Mail-Adresse.') })
    }
    for (const [key, value] of changes) saveConnection(key, value || null)
    // Nur welche Felder, nie die Werte: Darunter sind Schlüssel und Passwörter
    if (changes.length) logEvent('settings', t('Verbindung geändert: {keys}', { keys: changes.map(([key]) => key).join(', ') }))
    // Das Postfach hat mit dem Abgleich nichts zu tun
    if (changes.some(([key]) => !key.startsWith('mail') && key !== 'publicUrl')) resyncAll()
    return connections()
  })

  const tests: Record<string, { ready: () => boolean; run: () => Promise<string> }> = {
    plex: { ready: plexConfigured, run: async () => t('Verbunden mit {name} {version}', { name: 'Plex', version: await testPlex() }) },
    seerr: { ready: seerrConfigured, run: async () => t('Bei Seerr angemeldet als {name}', { name: await testSeerr() }) },
    tautulli: { ready: tautulliConfigured, run: async () => t('Verbunden mit {name} {version}', { name: 'Tautulli', version: await testTautulli() }) },
    tmdb: {
      ready: tmdbConfigured,
      run: async () => {
        await testTmdb()
        return t('Verbunden mit {name} {version}', { name: 'TMDB', version: '' }).trim()
      },
    },
    tracearr: { ready: tracearrConfigured, run: async () => t('Verbunden mit {name} {version}', { name: 'Tracearr', version: await testTracearr() }) },
    mail: { ready: mailConfigured, run: async () => t('Testmail an {address} verschickt. Schau auch im Spam-Ordner nach.', { address: await sendTestMail() }) },
    telegram: { ready: () => Boolean(config.telegramBotToken), run: async () => t('Bot erreichbar: @{name}', { name: await testTelegram() }) },
  }
  for (const instance of ARR_INSTANCES) {
    tests[instance.id] = { ready: () => arrConfigured(instance), run: async () => t('Verbunden mit {name} {version}', { name: instance.name, version: await testArr(instance) }) }
  }

  app.post('/api/connections/test/:service', async (req, reply) => {
    const test = tests[(req.params as { service: string }).service]
    if (!test) return reply.code(404).send({ error: t('Unbekannter Dienst') })
    const service = (req.params as { service: string }).service
    if (service === 'plex' && config.plexToken && !config.plexUrl) return reply.code(400).send({ error: t('Es fehlt noch die Adresse. Wähle oben deinen Server oder trag sie ein.') })
    if (!test.ready()) return reply.code(400).send({ error: t('Erst Adresse und Schlüssel eintragen und speichern.') })
    try {
      return { message: await test.run() }
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  // Vorschau der Testmail, so wie sie verschickt würde
  app.get('/api/mail/preview', (_req, reply) => {
    const mail = testMail()
    return reply.header('content-type', 'text/html; charset=utf-8').send(inlineImages(mail.html, mail.attachments ?? []))
  })

  // Logo für den Kopf der E-Mails
  app.get('/api/mail/logo', (_req, reply) => {
    const logo = mailLogo()
    if (!logo) return reply.code(404).send({ error: t('Nicht gefunden') })
    return reply.header('content-type', logo.type).header('cache-control', 'no-store').send(readFileSync(logo.path))
  })
  app.put<{ Body: { data?: string } }>('/api/mail/logo', { bodyLimit: 3 * 1024 * 1024 }, (req, reply) => {
    const data = Buffer.from(String(req.body?.data ?? '').replace(/^data:[^,]*,/, ''), 'base64')
    if (data.length < 100 || data.length > 1024 * 1024) return reply.code(400).send({ error: t('Das Logo darf höchstens 1 MB groß sein.') })
    try {
      saveMailLogo(data)
      logEvent('settings', t('Logo der Mails hochgeladen'))
      return { ok: true }
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })
  app.delete('/api/mail/logo', () => {
    removeMailLogo()
    logEvent('settings', t('Logo der Mails entfernt'))
    return { ok: true }
  })

  // Adresse eines Benutzers überschreiben; leer heißt: wieder die aus Plex
  app.put<{ Params: { id: string }; Body: { email?: string } }>('/api/users/:id/email', (req, reply) => {
    const email = String(req.body?.email ?? '').trim()
    if (email && !EMAIL.test(email)) return reply.code(400).send({ error: t('Das ist keine gültige E-Mail-Adresse.') })
    const result = db.prepare('UPDATE users SET email_override = ? WHERE id = ?').run(email || null, Number(req.params.id))
    if (!result.changes) return reply.code(404).send({ error: t('Nicht gefunden') })
    return { ok: true }
  })

  // Wer nie bewertet: Ansehen zählt bei ihm als fertig, und er taucht nicht mehr unter den offenen Bewertungen auf
  app.put<{ Params: { id: string }; Body: { value?: boolean } }>('/api/users/:id/never-rates', (req, reply) => {
    const result = db.prepare('UPDATE users SET never_rates = ? WHERE id = ?').run(req.body?.value ? 1 : 0, Number(req.params.id))
    if (!result.changes) return reply.code(404).send({ error: t('Nicht gefunden') })
    return { ok: true }
  })

  // Eigener Name eines Benutzers, der überall statt des Plex-Namens erscheint; leer heißt: der Plex-Name
  app.put<{ Params: { id: string }; Body: { name?: string } }>('/api/users/:id/display-name', (req, reply) => {
    const name = String(req.body?.name ?? '').trim().slice(0, 60)
    const result = db
      .prepare('UPDATE users SET display_name = ?1, name = COALESCE(?1, plex_name, name) WHERE id = ?2')
      .run(name || null, Number(req.params.id))
    if (!result.changes) return reply.code(404).send({ error: t('Nicht gefunden') })
    return { ok: true }
  })

  // Mehrere Namen auf einmal, eine Zeile pro Benutzer in der Form „Plex-Name = Name“
  app.post<{ Body: { text?: string } }>('/api/users/display-names', (req) => {
    const byName = new Map(
      db.prepare('SELECT id, COALESCE(plex_name, name) AS name FROM users').all().map((u) => [String(u.name).toLowerCase(), u.id as number]),
    )
    const update = db.prepare('UPDATE users SET display_name = ?1, name = ?1 WHERE id = ?2')
    let matched = 0
    const unknown: string[] = []
    for (const line of String(req.body?.text ?? '').split(/\r?\n/)) {
      const at = line.indexOf('=')
      if (at < 1) continue
      const plexName = line.slice(0, at).trim()
      const display = line.slice(at + 1).trim().slice(0, 60)
      if (!plexName || !display) continue
      const id = byName.get(plexName.toLowerCase())
      if (id == null) unknown.push(plexName)
      else {
        update.run(display, id)
        matched++
      }
    }
    if (matched) logEvent('settings', t('Namen von {n} Benutzern geändert', { n: matched }))
    return { matched, unknown }
  })

  // Zahlen, Neuzugänge und Warnungen für die Startseite
  app.get('/api/dashboard', () => dashboard())

  // Freier Platz auf den Platten mit den Medien und wie schnell er schwindet
  app.get('/api/storage', () => storage())

  app.get('/api/upcoming', () => upcoming())

  // Einzelne Titel unter „Was kommt“ ausblenden und wieder einblenden
  app.get('/api/upcoming/hidden', () => hiddenTitles())
  app.post('/api/upcoming/hide', (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const tmdbId = Number(body.tmdbId)
    if ((body.type !== 'movie' && body.type !== 'show') || !Number.isInteger(tmdbId) || tmdbId <= 0) return reply.code(400).send({ error: t('Ungültige Angaben') })
    hideTitle(body.type, tmdbId, String(body.title ?? ''), Number.isInteger(body.year) ? (body.year as number) : null)
    return { ok: true }
  })
  app.post('/api/upcoming/unhide', (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const tmdbId = Number(body.tmdbId)
    if ((body.type !== 'movie' && body.type !== 'show') || !Number.isInteger(tmdbId)) return reply.code(400).send({ error: t('Ungültige Angaben') })
    unhideTitle(body.type, tmdbId)
    return hiddenTitles()
  })

  app.post('/api/upcoming/refresh', (_req, reply) => {
    refreshUpcoming(true)
    return reply.code(202).send({ started: true })
  })

  // „Meine Themen“: Schlagwörter aus TMDB, zu denen Blackbriar den ganzen Katalog zeigt
  app.get('/api/topics', () => ({ topics: topics(), presets: presetNames() }))
  app.get<{ Querystring: { q?: string } }>('/api/topics/keywords', async (req, reply) => {
    const q = String(req.query.q ?? '').trim()
    if (!tmdbConfigured() || q.length < 2) return []
    try {
      return await searchKeywords(q)
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })
  app.post<{ Body: { preset?: number } }>('/api/topics', async (req, reply) => {
    try {
      const topic = typeof req.body?.preset === 'number' ? await addPreset(req.body.preset) : saveTopic(req.body)
      return topic ?? reply.code(400).send({ error: t('Für ein Thema braucht es einen Namen und mindestens ein Schlagwort.') })
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })
  app.put<{ Params: { id: string } }>('/api/topics/:id', (req, reply) => {
    if (!topics().some((x) => x.id === req.params.id)) return reply.code(404).send({ error: t('Nicht gefunden') })
    return saveTopic(req.body, req.params.id) ?? reply.code(400).send({ error: t('Für ein Thema braucht es einen Namen und mindestens ein Schlagwort.') })
  })
  app.delete<{ Params: { id: string } }>('/api/topics/:id', (req) => {
    deleteTopic(req.params.id)
    return { ok: true }
  })
  app.get<{ Params: { id: string }; Querystring: { fresh?: string } }>('/api/topics/:id/titles', async (req, reply) => {
    try {
      return (await topicTitles(req.params.id, req.query.fresh === '1')) ?? reply.code(404).send({ error: t('Nicht gefunden') })
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  app.get('/api/tmdb/providers', async (_req, reply) => {
    if (!tmdbConfigured()) return []
    try {
      return await providerCatalog()
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  // Kurzinfo zu einem Titel aus „Was kommt“
  app.get<{ Querystring: { type?: string; id?: string } }>('/api/tmdb/details', async (req, reply) => {
    const id = Number(req.query.id)
    const type = req.query.type === 'show' ? 'show' : 'movie'
    if (!tmdbConfigured()) return reply.code(400).send({ error: t('Für die Kurzinfo fehlt der TMDB-Schlüssel.') })
    if (!Number.isInteger(id) || id <= 0) return reply.code(400).send({ error: 'id' })
    try {
      return await getDetails(type, id, getSettings().upcomingRegion)
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  app.post('/api/request', async (req, reply) => {
    if (!seerrConfigured()) return reply.code(400).send({ error: t('Erst Adresse und Schlüssel eintragen und speichern.') })
    const body = (req.body ?? {}) as Record<string, unknown>
    const tmdbId = Number(body.tmdbId)
    if (!Number.isInteger(tmdbId) || (body.type !== 'movie' && body.type !== 'show')) return reply.code(400).send({ error: t('Ungültige Angaben') })
    try {
      await requestMedia(body.type, tmdbId, body.season == null ? null : Number(body.season))
      refreshSeerrSoon()
      return { ok: true }
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  app.get('/api/import', () => importStatus())

  app.post('/api/import/:source', (req, reply) => {
    const source = (req.params as { source: string }).source
    if (source !== 'tautulli' && source !== 'tracearr') return reply.code(404).send({ error: t('Unbekannter Dienst') })
    try {
      startImport(source)
      return reply.code(202).send(importStatus())
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
  })

  app.get('/api/weekly/preview', () => ({ text: buildWeekly() }))

  app.post('/api/weekly/send', async (_req, reply) => {
    if (!telegramConfigured()) return reply.code(400).send({ error: t('Telegram ist nicht eingerichtet.') })
    try {
      await sendTelegram(buildWeekly())
      return { ok: true }
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  // Das Protokoll, neueste Einträge zuerst
  app.get('/api/events', (req) => {
    const q = req.query as Query & { kind?: string; level?: string }
    return events({ kind: q.kind, level: q.level, ...paging(q) })
  })

  app.post('/api/sync', (_req, reply) => {
    logEvent('sync', t('Abgleich von Hand gestartet'))
    void runCycle(true)
    return reply.code(202).send({ started: true })
  })

  app.post('/api/users/:id/refresh', async (req, reply) => {
    try {
      await refreshUser(Number((req.params as { id: string }).id))
      return reply.code(204).send()
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  app.post('/api/telegram/test', async (_req, reply) => {
    if (!telegramConfigured()) return reply.code(400).send({ error: t('Telegram ist nicht eingerichtet.') })
    try {
      await sendTelegram(t('✅ <b>Blackbriar</b> ist mit Telegram verbunden.'))
      return { ok: true }
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })

  // Plex schickt Webhooks als multipart/form-data. Jedes Ereignis (bewertet, zu Ende gesehen, ...) stößt einen
  // Abgleich an; kommt ein neuer Titel dazu, liest dieser auch die Bibliothek neu.
  app.post('/api/webhook/plex', (req, reply) => {
    // Die Adresse ist ohne Anmeldung erreichbar, deshalb trägt sie einen Schlüssel
    if (authEnabled() && (req.query as Query).key !== webhookKey()) return reply.code(403).send({ error: t('Falscher Schlüssel') })
    syncSoon((req.body as { event?: string | null } | null)?.event === 'library.new')
    return reply.code(204).send()
  })

  // Radarr und Sonarr melden hier Änderungen (Settings → Connect → Webhook): importiert, ausgetauscht, hinzugefügt, gelöscht.
  // Der Inhalt wird nicht ausgewertet; jede Meldung heißt nur: Daten neu lesen.
  // Nicht unter /api/webhook/: Das hier braucht die Anmeldung
  app.post('/api/settings/webhook-key', (req) => {
    newWebhookKey()
    logEvent('settings', t('Neuer Schlüssel für die Webhooks erzeugt ({user})', { user: currentUser(req) }))
    return { ok: true }
  })

  app.post('/api/webhook/arr', (req, reply) => {
    if (authEnabled() && (req.query as Query).key !== webhookKey()) return reply.code(403).send({ error: t('Falscher Schlüssel') })
    // Beim Speichern schicken beide eine Testmeldung; die braucht nur eine Antwort
    if ((req.body as { eventType?: string } | null)?.eventType !== 'Test') arrSoon()
    return reply.code(204).send()
  })

  app.get('/api/image', async (req, reply) => {
    const q = req.query as Query
    const path = q.path ?? ''
    if (!plexConfigured() || !isImagePath(path)) return reply.code(400).send({ error: t('Ungültiger Bildpfad') })
    const width = Math.min(800, Math.max(40, Number(q.w) || 200))
    try {
      const img = await plexImage(path, width, Math.round(width * 1.5))
      return reply
        .header('content-type', img.type)
        .header('cache-control', 'public, max-age=604800')
        .send(Buffer.from(img.data))
    } catch {
      return reply.code(404).send({ error: t('Bild nicht gefunden') })
    }
  })
}
