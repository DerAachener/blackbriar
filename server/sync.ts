import { configuredArrInstances, getArrItems } from './arr.ts'
import { plexConfigured, seerrConfigured, telegramConfigured } from './config.ts'
import { getDetails, getRequests, getSeerrUsers, getWatchlist, searchPoster } from './seerr.ts'
import { db, tx, now, getSetting, setSetting, getSettings, openItems, installedAt, type OpenItem } from './db.ts'
import { pms, pmsPaged, getPlexUsers, resetPlexCache, type PlexUser } from './plex.ts'
import { sendTelegram, escapeHtml } from './telegram.ts'
import { locale, t } from './i18n.ts'
import { unnotifiedMismatches, type Mismatch } from './mismatch.ts'
import { checkSeasons } from './notices.ts'
import { refreshStorage } from './storage.ts'
import { logEvent } from './events.ts'

const SECTION_TYPE: Record<string, number> = { movie: 1, show: 2 }
// Benutzerliste und Bibliothek ändern sich selten und werden nur stündlich geholt
const SLOW_INTERVAL = 3600

export const syncStatus = { running: false, lastRun: 0, lastSuccess: 0, lastError: '' }

let users: PlexUser[] = []
let slowSyncedAt = 0
// Merklisten laufen über Seerr und von dort zu plex.tv, deshalb seltener als der Rest
const WATCHLIST_INTERVAL = 900
let watchlistSyncedAt = 0
let fullRequested = false

const keyFromPath = (path?: string): number | null => {
  const m = /\/library\/metadata\/(\d+)/.exec(path ?? '')
  return m ? Number(m[1]) : null
}

async function syncUsers(): Promise<void> {
  users = await getPlexUsers()
  tx(() => {
    db.prepare('UPDATE users SET active = 0').run()
    const upsert = db.prepare(
      `INSERT INTO users (id, name, plex_name, is_owner, active, plex_id, email) VALUES (?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET name = COALESCE(users.display_name, excluded.plex_name), plex_name = excluded.plex_name, is_owner = excluded.is_owner, active = 1, plex_id = excluded.plex_id,
         email = COALESCE(excluded.email, users.email)`,
    )
    for (const u of users) upsert.run(u.id, u.name, u.name, u.isOwner ? 1 : 0, u.plexId || null, u.email || null)
  })

  // Namen für Konten, die nur noch im Verlauf vorkommen (z. B. entfernte Freunde)
  try {
    const insert = db.prepare('INSERT OR IGNORE INTO users (id, name, plex_name, is_owner, active) VALUES (?, ?, ?, 0, 0)')
    for (const a of (await pms('/accounts')).Account ?? []) {
      if (a.id > 0 && a.name) insert.run(a.id, a.name, a.name)
    }
  } catch {
    // Ohne Namen zeigt die Oberfläche die Konto-ID
  }
}

async function syncLibrary(): Promise<void> {
  const stamp = now()
  const upsert = db.prepare(
    `INSERT INTO library_items (rating_key, type, title, year, thumb, leaf_count, section, tmdb_id, tvdb_id, synced_at, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(rating_key) DO UPDATE SET type = excluded.type, title = excluded.title, year = excluded.year,
       thumb = excluded.thumb, leaf_count = excluded.leaf_count, section = excluded.section, tmdb_id = excluded.tmdb_id,
       tvdb_id = excluded.tvdb_id, synced_at = excluded.synced_at, added_at = excluded.added_at`,
  )
  const upsertFile = db.prepare(
    `INSERT INTO media_files (rating_key, item_key, size, video_codec, audio_codec, resolution, bitrate, container, file, synced_at,
       season, episode, title, owner_watched, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(rating_key) DO UPDATE SET item_key = excluded.item_key, size = excluded.size, video_codec = excluded.video_codec,
       audio_codec = excluded.audio_codec, resolution = excluded.resolution, bitrate = excluded.bitrate,
       container = excluded.container, file = excluded.file, synced_at = excluded.synced_at,
       season = excluded.season, episode = excluded.episode, title = excluded.title, owner_watched = excluded.owner_watched,
       added_at = excluded.added_at`,
  )
  // Größe über alle Versionen und Teile; Codec und Co. von der ersten Version
  const saveFile = (m: any, itemKey: number) => {
    const first = m.Media?.[0]
    if (!first) return
    const parts = (m.Media as any[]).flatMap((x) => x.Part ?? [])
    upsertFile.run(
      Number(m.ratingKey),
      itemKey,
      parts.reduce((sum, p) => sum + Number(p.size ?? 0), 0),
      first.videoCodec ?? null,
      first.audioCodec ?? null,
      first.videoResolution ?? null,
      first.bitrate ?? null,
      first.container ?? null,
      parts[0]?.file ?? null,
      stamp,
      m.parentIndex ?? null,
      m.index ?? null,
      m.title ?? null,
      // Die Bibliothek wird mit dem Token des Besitzers gelesen, viewCount ist also dessen Stand
      Number(m.viewCount ?? 0) > 0 ? 1 : 0,
      m.addedAt ?? null,
    )
  }

  const plexSections = ((await pms('/library/sections')).Directory ?? []) as any[]
  // Alle Mediatheken mit Namen und Art merken, auch leere: Die Einstellungen zeigen sie zum Einsortieren an
  setSetting('plex_sections', JSON.stringify(plexSections.filter((s) => SECTION_TYPE[s.type]).map((s) => ({ name: String(s.title), type: s.type === 'show' ? 'show' : 'movie' }))))
  for (const sec of plexSections) {
    const type = SECTION_TYPE[sec.type]
    if (!type) continue
    // Die TMDB-ID verbindet die Bibliothek mit Merkliste und Radarr, die TVDB-ID mit Sonarr
    const items = await pmsPaged(`/library/sections/${sec.key}/all?type=${type}&includeGuids=1`)
    tx(() => {
      for (const m of items) {
        const guid = (prefix: string) => {
          const hit = (m.Guid ?? []).find((g: any) => String(g.id).startsWith(prefix))
          return hit ? Number(String(hit.id).slice(prefix.length)) || null : null
        }
        upsert.run(
          Number(m.ratingKey),
          m.type,
          m.title,
          m.year ?? null,
          m.thumb ?? null,
          m.leafCount ?? 0,
          sec.title,
          guid('tmdb://'),
          guid('tvdb://'),
          stamp,
          m.addedAt ?? null,
        )
        if (m.type === 'movie') saveFile(m, Number(m.ratingKey))
      }
    })
    if (sec.type === 'show') {
      const episodes = await pmsPaged(`/library/sections/${sec.key}/all?type=4`, undefined, 500)
      tx(() => {
        for (const e of episodes) saveFile(e, Number(e.grandparentRatingKey))
      })
    }
  }
  db.prepare('DELETE FROM library_items WHERE synced_at < ?').run(stamp)
  db.prepare('DELETE FROM media_files WHERE synced_at < ?').run(stamp)
}

async function syncHistory(): Promise<void> {
  // Beim ersten Mal den ganzen Verlauf holen, danach nur von oben, bis nichts Neues mehr kommt
  const complete = getSetting('history_complete') === '1'
  const pageSize = complete ? 100 : 500
  const insert = db.prepare(
    `INSERT OR IGNORE INTO history (id, user_id, rating_key, type, title, show_title, show_key, season, episode, thumb, viewed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (let start = 0; ; ) {
    const mc = await pms(
      `/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`,
    )
    const items = mc.Metadata ?? []
    const added = tx(() => {
      let count = 0
      for (const m of items) {
        const id = Number(/(\d+)$/.exec(m.historyKey ?? '')?.[1])
        if (!id || !m.viewedAt) continue
        const result = insert.run(
          id,
          Number(m.accountID),
          m.ratingKey ? Number(m.ratingKey) : keyFromPath(m.key),
          m.type ?? 'unknown',
          m.title ?? '',
          m.grandparentTitle ?? null,
          keyFromPath(m.grandparentKey),
          m.parentIndex ?? null,
          m.index ?? null,
          m.grandparentThumb ?? m.parentThumb ?? m.thumb ?? null,
          Number(m.viewedAt),
        )
        count += Number(result.changes)
      }
      return count
    })
    start += items.length
    const atEnd = items.length === 0 || start >= (mc.totalSize ?? start)
    if (atEnd) {
      setSetting('history_complete', '1')
      return
    }
    if (complete && added === 0) return
  }
}

/**
 * Was Radarr und Sonarr noch verwalten. Fällt eine Instanz aus, bleibt ihr letzter Stand stehen
 * und die übrigen werden trotzdem abgeglichen.
 */
async function syncArr(): Promise<void> {
  const failed: string[] = []
  const configured = configuredArrInstances()
  // Bestand entfernter Verbindungen wegräumen
  const keep = configured.map((i) => i.id)
  for (const row of db.prepare('SELECT DISTINCT instance FROM arr_titles').all()) {
    if (!keep.includes(row.instance as (typeof keep)[number])) db.prepare('DELETE FROM arr_titles WHERE instance = ?').run(row.instance)
  }
  const insert = db.prepare(
    `INSERT INTO arr_titles (instance, id, tmdb_id, tvdb_id, title, monitored, status, next_airing, file, year, poster, files, total, size, slug)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  for (const instance of configured) {
    try {
      const items = await getArrItems(instance)
      tx(() => {
        db.prepare('DELETE FROM arr_titles WHERE instance = ?').run(instance.id)
        for (const i of items) insert.run(i.instance, i.id, i.tmdbId, i.tvdbId, i.title, i.monitored ? 1 : 0, i.status, i.nextAiring, i.file, i.year, i.poster, i.files, i.total, i.size, i.slug)
      })
    } catch (err) {
      failed.push((err as Error).message)
    }
  }
  if (failed.length) throw new Error(failed.join(' · '))
}

/** Merklisten und Anfragen aus Seerr. */
async function syncSeerr(): Promise<void> {
  const stamp = now()
  const upsert = db.prepare(
    `INSERT INTO watchlist (user_id, type, tmdb_id, title, first_seen_at, synced_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, type, tmdb_id) DO UPDATE SET synced_at = excluded.synced_at`,
  )
  const seerrToUser = new Map<number, number>()
  for (const su of await getSeerrUsers()) {
    // Zuordnung über die plex.tv-ID, ersatzweise über den Plex-Namen
    const user =
      users.find((u) => su.plexId && u.plexId === su.plexId) ??
      users.find((u) => su.name && u.name.toLowerCase() === su.name.toLowerCase())
    if (!user) continue
    seerrToUser.set(su.id, user.id)
    const entries = await getWatchlist(su.id)
    tx(() => {
      for (const e of entries) upsert.run(user.id, e.type, e.tmdbId, e.title, stamp, stamp)
    })
  }
  // Was in diesem Lauf nicht mehr kam, wurde von der Merkliste genommen
  db.prepare('DELETE FROM watchlist WHERE synced_at < ?').run(stamp)

  const requests = await getRequests()
  tx(() => {
    db.prepare('DELETE FROM requests').run()
    const insert = db.prepare(
      `INSERT OR REPLACE INTO requests (id, user_id, type, tmdb_id, status, media_status, progress, created_at, synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    for (const r of requests) {
      insert.run(r.id, seerrToUser.get(r.seerrUserId) ?? null, r.type, r.tmdbId, r.status, r.mediaStatus, r.progress, r.createdAt, stamp)
    }
  })

  // Deutschen Titel, Poster und Jahr nachtragen; pro Lauf begrenzt, damit der erste Abgleich nicht ewig dauert
  const missing = db.prepare('SELECT DISTINCT type, tmdb_id FROM watchlist WHERE poster IS NULL LIMIT 100').all()
  const fill = db.prepare('UPDATE watchlist SET title = COALESCE(?, title), poster = ?, year = ? WHERE type = ? AND tmdb_id = ?')
  for (const m of missing) {
    const details = await getDetails(m.type as 'movie' | 'show', m.tmdb_id as number).catch(() => ({ title: null, poster: '', year: null }))
    fill.run(details.title, details.poster, details.year, m.type, m.tmdb_id)
  }
}

// Pro Lauf begrenzt, damit die erste Runde Seerr nicht mit hunderten Suchen auf einmal belastet
const POSTERS_PER_RUN = 150

/**
 * Für gelöschte Titel hat Plex kein Bild mehr. Damit der Verlauf trotzdem Cover zeigt,
 * werden die Poster nach Titel über Seerr gesucht und gemerkt.
 */
// Titel aus dem Verlauf, die nicht (mehr) in der Bibliothek liegen, bekommen ihr Poster über die Suche in Seerr.
// Das Bild aus Plex taugt für sie nicht: Mit dem Titel ist auch sein Poster dort verschwunden.
async function syncPosters(): Promise<void> {
  const missing = db
    .prepare(
      `SELECT DISTINCT CASE h.type WHEN 'episode' THEN 'show' ELSE 'movie' END AS type, COALESCE(h.show_title, h.title) AS title
       FROM history h
       WHERE h.type IN ('movie', 'episode') AND COALESCE(h.show_title, h.title) <> ''
         AND NOT EXISTS (SELECT 1 FROM posters p
                         WHERE p.type = CASE h.type WHEN 'episode' THEN 'show' ELSE 'movie' END AND p.title = COALESCE(h.show_title, h.title))
         AND NOT EXISTS (SELECT 1 FROM library_items l
                         WHERE l.type = CASE h.type WHEN 'episode' THEN 'show' ELSE 'movie' END AND l.title = COALESCE(h.show_title, h.title))
       LIMIT ?`,
    )
    .all(POSTERS_PER_RUN)
  const save = db.prepare('INSERT OR REPLACE INTO posters (type, title, poster) VALUES (?, ?, ?)')
  for (const m of missing) {
    // Scheitert die Suche für einen Titel, bleibt er ohne Bild; die übrigen dürfen daran nicht hängen bleiben
    save.run(m.type, m.title, await searchPoster(m.type as 'movie' | 'show', m.title as string).catch(() => ''))
  }
}

async function syncUserRatings(user: PlexUser): Promise<void> {
  // Mit dem Token des Benutzers abgefragt, liefert Plex dessen eigene Bewertungen
  const sections = (await pms('/library/sections', user.token)).Directory ?? []
  const items: any[] = []
  for (const sec of sections) {
    const type = SECTION_TYPE[sec.type]
    if (!type) continue
    items.push(...(await pmsPaged(`/library/sections/${sec.key}/all?type=${type}&userRating%3E%3E=0`, user.token)))
  }

  const state = db.prepare('SELECT ratings_synced_at FROM users WHERE id = ?').get(user.id)
  // Was beim ersten Abgleich schon da ist, gilt als bekannt und löst keine Nachricht aus
  const initial = !state?.ratings_synced_at

  // Fehlt eine bekannte Bewertung in der Antwort, hat der Benutzer sie zurückgenommen oder der Titel wurde gelöscht.
  // Im zweiten Fall bleibt sie: Der Verlauf zeigt auch, was nicht mehr auf dem Server liegt.
  const listed = new Set(items.map((m) => Number(m.ratingKey)))
  const keep = new Set<number>()
  for (const r of db.prepare('SELECT rating_key FROM ratings WHERE user_id = ?').all(user.id)) {
    const key = r.rating_key as number
    if (listed.has(key)) continue
    const exists = await pms(`/library/metadata/${key}`).then(
      (c) => Number(c.size ?? 0) > 0,
      () => false,
    )
    if (!exists) keep.add(key)
  }

  tx(() => {
    const existing = new Map<number, number>()
    for (const r of db.prepare('SELECT rating_key, rating FROM ratings WHERE user_id = ?').all(user.id)) {
      existing.set(r.rating_key as number, r.rating as number)
    }
    const upsert = db.prepare(
      `INSERT INTO ratings (user_id, rating_key, type, title, year, thumb, rating, rated_at, notified)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, rating_key) DO UPDATE SET type = excluded.type, title = excluded.title, year = excluded.year,
         thumb = excluded.thumb, rating = excluded.rating, rated_at = excluded.rated_at, notified = excluded.notified`,
    )
    for (const m of items) {
      if (m.userRating == null) continue
      const key = Number(m.ratingKey)
      const rating = Number(m.userRating)
      const known = existing.get(key)
      existing.delete(key)
      if (known === rating) continue
      upsert.run(user.id, key, m.type, m.title, m.year ?? null, m.thumb ?? null, rating, m.lastRatedAt ?? null, initial ? 1 : 0)
    }
    // Übrig bleibt, was der Benutzer nicht mehr bewertet hat
    const remove = db.prepare('DELETE FROM ratings WHERE user_id = ? AND rating_key = ?')
    for (const key of existing.keys()) if (!keep.has(key)) remove.run(user.id, key)
    db.prepare('UPDATE users SET ratings_synced_at = ? WHERE id = ?').run(now(), user.id)
  })
}

/** Liest, was der Benutzer in Plex als gesehen führt; das schließt „Als gesehen markieren“ ein, das im Verlauf fehlt. */
async function syncUserWatched(user: PlexUser): Promise<void> {
  const sections = (await pms('/library/sections', user.token)).Directory ?? []
  const seen = new Map<number, { count: number; viewed_at: number }>()
  for (const sec of sections) {
    if (sec.type === 'movie') {
      for (const m of await pmsPaged(`/library/sections/${sec.key}/all?type=1&viewCount%3E%3E=0`, user.token)) {
        seen.set(Number(m.ratingKey), { count: 1, viewed_at: Number(m.lastViewedAt ?? 0) || now() })
      }
    } else if (sec.type === 'show') {
      for (const s of await pmsPaged(`/library/sections/${sec.key}/all?type=2`, user.token)) {
        const count = Number(s.viewedLeafCount ?? 0)
        if (count > 0) seen.set(Number(s.ratingKey), { count, viewed_at: Number(s.lastViewedAt ?? 0) || now() })
      }
    }
  }

  // Was beim ersten Auslesen schon markiert ist, gilt als bekannt: Es zählt, löst aber keine Erinnerung aus
  const initial = !db.prepare('SELECT watched_synced_at FROM users WHERE id = ?').get(user.id)?.watched_synced_at
  tx(() => {
    // Mit dem Token des Benutzers liefert Plex nur die Mediatheken, die für ihn freigegeben sind
    db.prepare('DELETE FROM user_sections WHERE user_id = ?').run(user.id)
    const allow = db.prepare('INSERT OR IGNORE INTO user_sections (user_id, section) VALUES (?, ?)')
    for (const sec of sections) if (SECTION_TYPE[sec.type]) allow.run(user.id, sec.title)

    const gone = new Set(db.prepare('SELECT rating_key FROM plex_watched WHERE user_id = ?').all(user.id).map((r) => r.rating_key as number))
    const upsert = db.prepare(
      `INSERT INTO plex_watched (user_id, rating_key, count, viewed_at, baseline) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, rating_key) DO UPDATE SET viewed_at = excluded.viewed_at,
         baseline = CASE WHEN excluded.count > plex_watched.count THEN 0 ELSE plex_watched.baseline END, count = excluded.count`,
    )
    for (const [key, s] of seen) {
      gone.delete(key)
      upsert.run(user.id, key, s.count, s.viewed_at, initial ? 1 : 0)
    }
    const remove = db.prepare('DELETE FROM plex_watched WHERE user_id = ? AND rating_key = ?')
    for (const key of gone) remove.run(user.id, key)
    db.prepare('UPDATE users SET watched_synced_at = ? WHERE id = ?').run(now(), user.id)
  })
}

/** Läuft bei jedem Abgleich mit, damit eine gesetzte oder zurückgenommene Markierung nach wenigen Minuten ankommt. */
async function syncWatched(): Promise<void> {
  const failed: string[] = []
  for (const user of users) {
    try {
      await syncUserWatched(user)
    } catch (err) {
      failed.push(`${user.name} (${(err as Error).message})`)
    }
  }
  if (failed.length) throw new Error(t('Gesehen-Stand nicht lesbar für: {names}', { names: failed.join(', ') }))
}

async function syncRatings(): Promise<void> {
  const failed: string[] = []
  for (const user of users) {
    try {
      await syncUserRatings(user)
    } catch (err) {
      failed.push(`${user.name} (${(err as Error).message})`)
    }
  }
  if (failed.length) {
    // Vermutlich ein abgelaufenes Token: beim nächsten Lauf die Benutzerliste neu holen
    slowSyncedAt = 0
    throw new Error(t('Bewertungen nicht lesbar für: {names}', { names: failed.join(', ') }))
  }
}

export const formatDate = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' })

const typeLabel = (type: string) => (type === 'show' ? t('Serie') : t('Film'))

function titleLine(item: { title: string; year: number | null; type: string }): string {
  const year = item.year ? ` (${item.year})` : ''
  return `<b>${escapeHtml(item.title)}</b>${year} · ${typeLabel(item.type)}`
}

/** Plex speichert 0 bis 10, angezeigt werden halbe Sterne von 0,5 bis 5. */
export function stars(rating: number): string {
  const text = '★'.repeat(Math.floor(rating / 2)) + (rating % 2 >= 1 ? '½' : '')
  return `${text} ${(rating / 2).toLocaleString(locale(), { minimumFractionDigits: 1 })}`
}

interface PendingRating {
  user_id: number
  user_name: string
  is_owner: number
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  rating: number
  seen_at: number | null
  on_watchlist: number
}

function ratingMessage(r: PendingRating): string {
  const lines = [t('⭐ <b>{name}</b> hat bewertet', { name: escapeHtml(r.user_name) }), titleLine(r), stars(r.rating)]
  if (r.seen_at) lines.push(t('Gesehen am {date}', { date: formatDate(r.seen_at) }))
  if (r.on_watchlist) lines.push(t('📌 Steht noch auf der Merkliste'))
  return lines.join('\n')
}

function reminderMessage(o: OpenItem): string {
  const days = Math.floor((now() - o.seen_at) / 86400)
  return [
    t('⏰ <b>{name}</b> hat noch nicht bewertet', { name: escapeHtml(o.user_name) }),
    titleLine(o),
    t(days === 1 ? 'Gesehen am {date} (vor {n} Tag)' : 'Gesehen am {date} (vor {n} Tagen)', { date: formatDate(o.seen_at), n: days }),
  ].join('\n')
}

function mismatchMessage(m: Mismatch): string {
  const link = (id: number) => `<a href="https://www.themoviedb.org/${m.type === 'show' ? 'tv' : 'movie'}/${id}">TMDB ${id}</a>`
  return [
    t('⚠️ <b>Plex hat „{title}“ vermutlich falsch zugeordnet</b>', { title: escapeHtml(m.year ? `${m.title} (${m.year})` : m.title) }),
    t('Gewünscht: {id} ({who})', { id: link(m.wanted_tmdb), who: escapeHtml(m.sources.join(', ')) }),
    t('In Plex: {id}', { id: link(m.plex_tmdb) }),
    t('Solange das so ist, hält Seerr den Titel für fehlend und fragt ihn erneut an. Abhilfe in Plex: beim Titel ⋯ → Übereinstimmung korrigieren.'),
  ].join('\n')
}

// Eigene Bewertungen des Besitzers lösen keine Nachricht aus. Schlägt das Senden fehl,
// bleibt der Eintrag offen und wird beim nächsten Lauf erneut versucht.
async function notify(): Promise<void> {
  const settings = getSettings()
  const canSend = telegramConfigured()

  const pending = db
    .prepare(
      `SELECT r.*, u.name AS user_name, u.is_owner,
         (SELECT MAX(h.viewed_at) FROM history h
          WHERE h.user_id = r.user_id AND (h.rating_key = r.rating_key OR h.show_key = r.rating_key)) AS seen_at,
         EXISTS (SELECT 1 FROM watchlist w JOIN library_items l ON l.tmdb_id = w.tmdb_id AND l.type = w.type
                 WHERE w.user_id = r.user_id AND l.rating_key = r.rating_key) AS on_watchlist
       FROM ratings r JOIN users u ON u.id = r.user_id
       WHERE r.notified = 0`,
    )
    .all() as unknown as PendingRating[]
  const markNotified = db.prepare('UPDATE ratings SET notified = 1 WHERE user_id = ? AND rating_key = ?')
  for (const r of pending) {
    if (canSend && settings.notifyRatings && !r.is_owner) await sendTelegram(ratingMessage(r), r.thumb)
    markNotified.run(r.user_id, r.rating_key)
  }

  const cutoff = now() - settings.reminderDays * 86400
  const reminded = db.prepare('SELECT 1 FROM reminders WHERE user_id = ? AND rating_key = ?')
  const markReminded = db.prepare('INSERT OR IGNORE INTO reminders (user_id, rating_key, sent_at) VALUES (?, ?, ?)')
  for (const o of openItems()) {
    if (o.seen_at < installedAt || o.seen_at > cutoff || reminded.get(o.user_id, o.rating_key)) continue
    // Was schon markiert war, bevor Blackbriar Markierungen las, gilt als erledigt
    if (o.quiet) {
      markReminded.run(o.user_id, o.rating_key, now())
      continue
    }
    if (canSend && settings.notifyReminders && !o.is_owner) await sendTelegram(reminderMessage(o), o.thumb)
    markReminded.run(o.user_id, o.rating_key, now())
  }

  // Ist die Nachricht abgeschaltet, gelten die Fälle trotzdem als gemeldet, damit beim Einschalten keine alten nachkommen
  const mismatches = unnotifiedMismatches()
  for (const m of mismatches.items) {
    if (canSend && settings.notifyMismatches) await sendTelegram(mismatchMessage(m), m.thumb)
    mismatches.mark(m.key)
  }
}

// Der Abgleich läuft alle paar Minuten. Ins Protokoll kommt nur, was sich ändert: ein neuer Fehler, das Ende
// einer Störung und ein von Hand gestarteter Lauf.
let loggedError = ''
function noteSync(error: string, manual: boolean): void {
  if (error) {
    if (error !== loggedError) logEvent('sync', t('Abgleich mit Fehler: {error}', { error }), 'error')
  } else if (loggedError) logEvent('sync', t('Abgleich läuft wieder ohne Fehler'))
  else if (manual) logEvent('sync', t('Vollständiger Abgleich fertig'))
  loggedError = error
}

/** Ein kompletter Abgleich. `full` erzwingt auch Benutzerliste und Bibliothek. */
export async function runCycle(full = false): Promise<void> {
  if (!plexConfigured()) return
  if (syncStatus.running) {
    // Ein vollständiger Abgleich darf nicht verloren gehen, nur weil gerade einer läuft
    fullRequested ||= full
    return
  }
  syncStatus.running = true
  syncStatus.lastRun = now()
  // Ein Ausfall von Seerr, Tautulli, Radarr oder Sonarr darf den Abgleich mit Plex nicht aufhalten
  const problems: string[] = []
  const optional = async (step: () => Promise<void>) => {
    try {
      await step()
    } catch (err) {
      problems.push((err as Error).message)
    }
  }
  try {
    const slow = full || now() - slowSyncedAt > SLOW_INTERVAL
    if (slow) {
      await syncUsers()
      await syncLibrary()
      slowSyncedAt = now()
    }
    await syncHistory()
    await syncRatings()
    await optional(syncWatched)
    await notify()
    if (slow) await optional(syncArr)
    if (slow) await optional(checkSeasons)
    if (slow) await optional(refreshStorage)
    if (seerrConfigured() && (full || now() - watchlistSyncedAt > WATCHLIST_INTERVAL)) {
      await optional(syncSeerr)
      await optional(syncPosters)
      watchlistSyncedAt = now()
    }
    syncStatus.lastSuccess = now()
    syncStatus.lastError = problems.join(' · ')
    noteSync(syncStatus.lastError, full)
  } catch (err) {
    syncStatus.lastError = (err as Error).message
    noteSync(syncStatus.lastError, full)
    console.error(t('Abgleich fehlgeschlagen:'), syncStatus.lastError)
  } finally {
    release()
  }
}

function release(): void {
  syncStatus.running = false
  if (fullRequested) {
    fullRequested = false
    void runCycle(true)
  }
}

/** Fragt Verlauf und Bewertungen eines einzelnen Benutzers sofort neu ab. */
export async function refreshUser(userId: number): Promise<void> {
  // Nie parallel zu einem Abgleich, sonst gingen Nachrichten doppelt raus
  while (syncStatus.running) await new Promise((resolve) => setTimeout(resolve, 200))
  const user = users.find((u) => u.id === userId)
  if (!user) throw new Error(t('Dieser Benutzer hat keinen Zugriff mehr auf den Server.'))
  syncStatus.running = true
  try {
    await syncHistory()
    await syncUserRatings(user)
    await syncUserWatched(user)
    await notify()
  } finally {
    release()
  }
}

/** Nach geänderten Verbindungen: alles Zwischengespeicherte verwerfen und komplett neu abgleichen. */
export function resyncAll(): void {
  users = []
  slowSyncedAt = 0
  watchlistSyncedAt = 0
  resetPlexCache()
  void runCycle(true)
}

/** Nach einer neuen Anfrage: Merklisten und Anfragen beim nächsten Abgleich gleich mitlesen. */
export function refreshSeerrSoon(): void {
  watchlistSyncedAt = 0
  syncSoon()
}

let soon: NodeJS.Timeout | undefined

// Ein Webhook hat einen neuen Titel gemeldet: Der nächste Abgleich liest auch die Bibliothek
let libraryPending = false

/**
 * Abgleich in wenigen Sekunden, z. B. nach einem Plex-Webhook. Mehrere Auslöser werden zusammengefasst.
 * Mit `library` liest er auch die Bibliothek neu. Dann wartet er etwas länger: Plex meldet jede Folge einzeln
 * und braucht einen Moment, bis ein neuer Titel vollständig erfasst ist.
 */
let arrTimer: ReturnType<typeof setTimeout> | undefined
let arrRunning = false

/**
 * Radarr oder Sonarr melden über ihren Webhook eine Änderung: kurz darauf deren Daten, die Hinweise zu Serien und den
 * Speicherplatz neu lesen. Mehrere Meldungen kurz hintereinander, etwa beim Import einer Staffel, ergeben eine Abfrage.
 */
export function arrSoon(): void {
  clearTimeout(arrTimer)
  arrTimer = setTimeout(() => {
    // Läuft gerade ein Abgleich oder die vorige Abfrage, ginge der Auslöser verloren
    if (syncStatus.running || arrRunning) return arrSoon()
    arrRunning = true
    void (async () => {
      for (const step of [syncArr, checkSeasons, refreshStorage]) {
        await step().catch((err) => console.error(t('Abgleich fehlgeschlagen:'), (err as Error).message))
      }
    })().finally(() => {
      arrRunning = false
    })
  }, 15_000)
}

export function syncSoon(library = false): void {
  libraryPending ||= library
  clearTimeout(soon)
  soon = setTimeout(
    () => {
      // Läuft gerade ein Abgleich, ginge der Auslöser verloren
      if (syncStatus.running) return syncSoon()
      if (libraryPending) {
        libraryPending = false
        slowSyncedAt = 0
      }
      void runCycle()
    },
    libraryPending ? 20_000 : 3000,
  )
}
