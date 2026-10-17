import { DatabaseSync } from 'node:sqlite'
import { accessSync, constants, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { config, CONNECTION_KEYS, setConnection, type ConnectionKey } from './config.ts'

const dbFile = join(config.dataDir, 'blackbriar.db')

// Läuft der Container mit „user:“, muss der Datenordner diesem Benutzer gehören. Sonst scheitert erst viel später
// irgendein Schreibzugriff mit einer Meldung, mit der niemand etwas anfangen kann. Die Sprache steht hier noch
// nicht fest, deshalb zweisprachig.
try {
  mkdirSync(config.dataDir, { recursive: true })
  for (const path of [config.dataDir, dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
    if (existsSync(path)) accessSync(path, constants.R_OK | constants.W_OK)
  }
} catch {
  const who = typeof process.getuid === 'function' ? `${process.getuid()}:${process.getgid?.()}` : '?'
  console.error(
    [
      '',
      `Blackbriar kann nicht in seinen Datenordner schreiben: ${config.dataDir}`,
      `Der Container läuft als Benutzer ${who}, der Ordner oder die Datenbank darin gehört jemand anderem.`,
      `Abhilfe auf dem Host: chown -R ${who} <Ordner, der auf ${config.dataDir} zeigt>`,
      '',
      `Blackbriar cannot write to its data folder: ${config.dataDir}`,
      `The container runs as user ${who}, the folder or the database in it belongs to someone else.`,
      `Fix on the host: chown -R ${who} <folder mounted at ${config.dataDir}>`,
      '',
    ].join('\n'),
  )
  process.exit(1)
}

export const db = new DatabaseSync(dbFile)

db.exec(`
  PRAGMA journal_mode = WAL;

  CREATE TABLE IF NOT EXISTS users (
    id                INTEGER PRIMARY KEY,
    name              TEXT NOT NULL,
    is_owner          INTEGER NOT NULL DEFAULT 0,
    active            INTEGER NOT NULL DEFAULT 1,
    ratings_synced_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS library_items (
    rating_key INTEGER PRIMARY KEY,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    year       INTEGER,
    thumb      TEXT,
    leaf_count INTEGER NOT NULL DEFAULT 0,
    section    TEXT,
    synced_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS history (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    rating_key INTEGER,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    show_title TEXT,
    show_key   INTEGER,
    season     INTEGER,
    episode    INTEGER,
    thumb      TEXT,
    viewed_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS history_user ON history (user_id, viewed_at);
  CREATE INDEX IF NOT EXISTS history_item ON history (rating_key);
  CREATE INDEX IF NOT EXISTS history_show ON history (show_key);

  CREATE TABLE IF NOT EXISTS ratings (
    user_id    INTEGER NOT NULL,
    rating_key INTEGER NOT NULL,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    year       INTEGER,
    thumb      TEXT,
    rating     REAL NOT NULL,
    rated_at   INTEGER,
    notified   INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, rating_key)
  );

  CREATE TABLE IF NOT EXISTS reminders (
    user_id    INTEGER NOT NULL,
    rating_key INTEGER NOT NULL,
    sent_at    INTEGER NOT NULL,
    PRIMARY KEY (user_id, rating_key)
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    user_id       INTEGER NOT NULL,
    type          TEXT NOT NULL,
    tmdb_id       INTEGER NOT NULL,
    title         TEXT NOT NULL,
    year          INTEGER,
    poster        TEXT,
    first_seen_at INTEGER NOT NULL,
    synced_at     INTEGER NOT NULL,
    PRIMARY KEY (user_id, type, tmdb_id)
  );

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Eine Zeile pro Film bzw. Folge; item_key ist der Film selbst oder die Serie
  CREATE TABLE IF NOT EXISTS media_files (
    rating_key  INTEGER PRIMARY KEY,
    item_key    INTEGER NOT NULL,
    size        INTEGER NOT NULL DEFAULT 0,
    video_codec TEXT,
    audio_codec TEXT,
    resolution  TEXT,
    bitrate     INTEGER,
    container   TEXT,
    file        TEXT,
    synced_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS media_item ON media_files (item_key);

  -- Wiedergaben, bei denen Plex umrechnen musste, aus der Live-Abfrage
  CREATE TABLE IF NOT EXISTS transcodes (
    key            TEXT PRIMARY KEY,
    at             INTEGER NOT NULL,
    user_id        INTEGER NOT NULL,
    user_name      TEXT NOT NULL,
    item_key       INTEGER NOT NULL,
    rating_key     INTEGER NOT NULL,
    title          TEXT NOT NULL,
    player         TEXT,
    platform       TEXT,
    video_decision TEXT,
    audio_decision TEXT,
    src_video      TEXT,
    src_audio      TEXT,
    dst_video      TEXT,
    dst_audio      TEXT
  );
  CREATE INDEX IF NOT EXISTS transcodes_item ON transcodes (item_key);

  -- Anfragen aus Seerr: wer hat sich was gewünscht
  CREATE TABLE IF NOT EXISTS requests (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER,
    type         TEXT NOT NULL,
    tmdb_id      INTEGER NOT NULL,
    status       INTEGER NOT NULL,
    media_status INTEGER,
    progress     REAL,
    created_at   INTEGER,
    synced_at    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS requests_title ON requests (type, tmdb_id);

  -- Wiedergaben aus Tautulli, mit Dauer und Gerät für die Statistik
  CREATE TABLE IF NOT EXISTS plays (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    rating_key INTEGER,
    show_key   INTEGER,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    show_title TEXT,
    started    INTEGER NOT NULL,
    duration   INTEGER NOT NULL DEFAULT 0,
    platform   TEXT,
    player     TEXT,
    decision   TEXT
  );
  CREATE INDEX IF NOT EXISTS plays_started ON plays (started);

  -- Wiedergaben aus Tracearr; eigene Tabelle, weil die Kennungen dort keine Zahlen sind
  CREATE TABLE IF NOT EXISTS tracearr_plays (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    rating_key INTEGER,
    show_key   INTEGER,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    show_title TEXT,
    started    INTEGER NOT NULL,
    duration   INTEGER NOT NULL DEFAULT 0,
    platform   TEXT,
    player     TEXT,
    decision   TEXT
  );
  CREATE INDEX IF NOT EXISTS tracearr_plays_started ON tracearr_plays (started);

  -- Wiedergaben, die Blackbriar selbst aus der Live-Abfrage mitschreibt
  CREATE TABLE IF NOT EXISTS own_plays (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session    TEXT NOT NULL UNIQUE,
    user_id    INTEGER NOT NULL,
    rating_key INTEGER,
    show_key   INTEGER,
    type       TEXT NOT NULL,
    title      TEXT NOT NULL,
    show_title TEXT,
    started    INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    duration   INTEGER NOT NULL DEFAULT 0,
    platform   TEXT,
    player     TEXT,
    decision   TEXT
  );
  CREATE INDEX IF NOT EXISTS own_plays_started ON own_plays (started);

  -- Was über Blackbriar gelöscht wurde
  CREATE TABLE IF NOT EXISTS deletions (
    id      INTEGER PRIMARY KEY AUTOINCREMENT,
    at      INTEGER NOT NULL,
    user    TEXT NOT NULL,
    type    TEXT NOT NULL,
    title   TEXT NOT NULL,
    detail  TEXT NOT NULL,
    files   INTEGER NOT NULL,
    size    INTEGER NOT NULL
  );

  -- Angemeldete Browser; id ist der Hash des Cookies
  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    plex_id    INTEGER NOT NULL,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Poster von TMDB für Titel, die im Verlauf stehen, aber nicht mehr in der Bibliothek liegen.
  -- Ein leerer Eintrag heißt: gesucht, nichts gefunden.
  CREATE TABLE IF NOT EXISTS posters (
    type   TEXT NOT NULL,
    title  TEXT NOT NULL,
    poster TEXT NOT NULL,
    PRIMARY KEY (type, title)
  );

  -- Was Radarr und Sonarr noch verwalten
  DROP TABLE IF EXISTS arr_items;
  CREATE TABLE IF NOT EXISTS arr_titles (
    instance    TEXT NOT NULL,
    id          INTEGER NOT NULL,
    tmdb_id     INTEGER,
    tvdb_id     INTEGER,
    title       TEXT NOT NULL,
    monitored   INTEGER NOT NULL DEFAULT 0,
    status      TEXT,
    next_airing INTEGER,
    PRIMARY KEY (instance, id)
  );
`)

// Spalten, die nach der ersten Version dazugekommen sind
function addColumn(table: string, column: string, type: string): void {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}
addColumn('library_items', 'tmdb_id', 'INTEGER')
addColumn('users', 'plex_id', 'INTEGER')
// Adresse des Plex-Kontos und, falls gesetzt, die vom Besitzer eingetragene; für Newsletter und Erinnerungen
addColumn('users', 'email', 'TEXT')
addColumn('users', 'email_override', 'TEXT')
// Der Besitzer kann jedem Benutzer einen eigenen Namen geben, z. B. den Vornamen. `name` ist der Name, der überall
// angezeigt wird: der eigene, sonst der aus Plex. `plex_name` bleibt der Name des Plex-Kontos, über den zugeordnet wird.
addColumn('users', 'display_name', 'TEXT')
addColumn('users', 'plex_name', 'TEXT')
db.exec('UPDATE users SET plex_name = name WHERE plex_name IS NULL')
db.exec("UPDATE users SET name = display_name WHERE display_name IS NOT NULL AND display_name <> '' AND name <> display_name")
// Wann Plex den Titel aufgenommen hat; bei Serien, wann zuletzt etwas dazukam
addColumn('library_items', 'added_at', 'INTEGER')
// Einstellungen für Newsletter und Erinnerung als JSON; leer heißt: es gilt der Standard
addColumn('users', 'mail_prefs', 'TEXT')
// Wann jemand über den Link in der Mail abbestellt hat
addColumn('users', 'newsletter_unsub', 'INTEGER')
addColumn('users', 'reminder_unsub', 'INTEGER')
// Bis wann der Newsletter schon abgearbeitet ist; was danach dazukam, steht im nächsten
addColumn('users', 'newsletter_sent_at', 'INTEGER')
db.exec(`CREATE TABLE IF NOT EXISTS mail_log (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  at      INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  kind    TEXT NOT NULL,
  subject TEXT NOT NULL,
  ok      INTEGER NOT NULL,
  error   TEXT
)`)
addColumn('media_files', 'added_at', 'INTEGER')
addColumn('library_items', 'tvdb_id', 'INTEGER')
addColumn('arr_titles', 'file', 'TEXT')
addColumn('arr_titles', 'slug', 'TEXT')
// Wer nie bewertet: Ansehen zählt bei ihm als fertig, Erinnerungen bleiben aus
addColumn('users', 'never_rates', 'INTEGER')

// Was ein Benutzer in Plex als gesehen führt, auch ohne Wiedergabe: „Als gesehen markieren“ steht nicht im Verlauf.
// Pro Titel die Zahl der gesehenen Folgen (bei Filmen 1). `baseline` kennzeichnet, was beim ersten Auslesen schon da war.
db.exec(`CREATE TABLE IF NOT EXISTS plex_watched (
  user_id    INTEGER NOT NULL,
  rating_key INTEGER NOT NULL,
  count      INTEGER NOT NULL,
  viewed_at  INTEGER NOT NULL,
  baseline   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, rating_key)
)`)
addColumn('users', 'watched_synced_at', 'INTEGER')

// Auf welche Mediatheken ein Benutzer in Plex Zugriff hat. Mails zeigen ihm nur, was er auch öffnen kann.
db.exec(`CREATE TABLE IF NOT EXISTS user_sections (
  user_id INTEGER NOT NULL,
  section TEXT NOT NULL,
  PRIMARY KEY (user_id, section)
)`)
for (const [column, type] of [['season', 'INTEGER'], ['episode', 'INTEGER'], ['title', 'TEXT'], ['owner_watched', 'INTEGER']]) {
  addColumn('media_files', column!, type!)
}
for (const [column, type] of [['year', 'INTEGER'], ['poster', 'TEXT'], ['files', 'INTEGER'], ['total', 'INTEGER'], ['size', 'INTEGER']]) {
  addColumn('arr_titles', column!, type!)
}
db.exec('CREATE INDEX IF NOT EXISTS library_tmdb ON library_items (tmdb_id)')

export const now = () => Math.floor(Date.now() / 1000)

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key)
  return row?.value as string | undefined
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}

// Erinnerungen gibt es nur für das, was nach der Installation gesehen wurde,
// sonst würde der importierte Altbestand hunderte Nachrichten auslösen.
if (!getSetting('installed_at')) setSetting('installed_at', String(now()))
export const installedAt = Number(getSetting('installed_at'))

// Ab diesem Zeitpunkt schreibt Blackbriar Wiedergaben selbst mit; Importe zählen nur für die Zeit davor
if (!getSetting('recording_since')) setSetting('recording_since', String(now()))
export const recordingSince = Number(getSetting('recording_since'))

// In der Oberfläche gespeicherte Verbindungen haben Vorrang vor den Umgebungsvariablen
for (const key of CONNECTION_KEYS) setConnection(key, getSetting(`conn.${key}`) ?? null)

/** Speichert eine Verbindung; `null` entfernt sie, dann gilt wieder die Umgebungsvariable. */
export function saveConnection(key: ConnectionKey, value: string | null): void {
  if (value?.trim()) setSetting(`conn.${key}`, value.trim())
  else db.prepare('DELETE FROM settings WHERE key = ?').run(`conn.${key}`)
  setConnection(key, value)
}

// Die großen Abo-Dienste, so wie TMDB sie nennt; in den Einstellungen änderbar.
// Überall vorgewählt sind die weltweiten; im deutschsprachigen Raum kommen die dort üblichen dazu.
const WORLD_PROVIDERS = ['Netflix', 'Amazon Prime Video', 'Disney Plus', 'Apple TV', 'Paramount Plus', 'HBO Max']
const GERMAN_PROVIDERS = ['WOW', 'RTL+', 'Joyn Plus', 'Discovery+']
const defaultProviders = (region: string) => (['DE', 'AT', 'CH'].includes(region) ? [...WORLD_PROVIDERS, ...GERMAN_PROVIDERS] : WORLD_PROVIDERS)

// Für Sprachen ohne Landesangabe im Browser, z. B. nur „fr“
const LANGUAGE_REGION: Record<string, string> = { de: 'DE', en: 'US', fr: 'FR', es: 'ES', it: 'IT', nl: 'NL', pt: 'PT', sv: 'SE', da: 'DK', nb: 'NO', no: 'NO', fi: 'FI', pl: 'PL' }

/** Land für „Was kommt“ aus der Sprachangabe des Browsers, z. B. „en-GB,en;q=0.9“ → GB. */
export function regionFromBrowser(acceptLanguage: string): string {
  const [language = '', region = ''] = (acceptLanguage.split(',')[0] ?? '').trim().split(';')[0]!.split('-')
  if (/^[A-Za-z]{2}$/.test(region)) return region.toUpperCase()
  return LANGUAGE_REGION[language.toLowerCase()] ?? 'US'
}

function parseList(value: string | undefined): string[] | undefined {
  try {
    const list = JSON.parse(value ?? 'null')
    return Array.isArray(list) ? list.map(String) : undefined
  } catch {
    return undefined
  }
}

export interface Settings {
  reminderDays: number
  notifyRatings: boolean
  notifyReminders: boolean
  /** Nachricht, wenn Plex einen gewünschten Titel vermutlich falsch zugeordnet hat */
  notifyMismatches: boolean
  /** Nachricht, wenn eine Staffel komplett ist oder eine Folge von einer anderen Release-Gruppe stammt */
  notifySeasons: boolean
  /** Wochenrückblick per Telegram */
  weeklyEnabled: boolean
  /** 0 = Sonntag … 6 = Samstag */
  weeklyDay: number
  weeklyHour: number
  /** Text im Dateipfad, an dem umgewandelte Dateien zu erkennen sind */
  convertedMarker: string
  /** Nach so vielen Tagen ohne Bewertung erscheint ein fertig gesehener Titel trotzdem unter „Kann weg“ */
  cleanupWaitDays: number
  /** Erlaubt das Löschen von Titeln und Folgen aus Blackbriar heraus */
  allowDelete: boolean
  /** Sprache der Oberfläche und der Telegram-Nachrichten */
  language: 'de' | 'en'
  /** Woher die Wiedergaben vor dem Start der eigenen Aufzeichnung kommen, wenn beide Quellen Daten haben */
  pastSource: 'tautulli' | 'tracearr'
  /** Land, dessen Neustarts „Was kommt“ zeigt, als zweistelliges Kürzel */
  upcomingRegion: string
  /** Namen der Streaminganbieter, die „Was kommt“ berücksichtigt */
  upcomingProviders: string[]
}

export function getSettings(): Settings {
  return {
    reminderDays: Number(getSetting('reminder_days') ?? 3),
    notifyRatings: (getSetting('notify_ratings') ?? '1') === '1',
    notifyReminders: (getSetting('notify_reminders') ?? '1') === '1',
    notifyMismatches: (getSetting('notify_mismatches') ?? '1') === '1',
    notifySeasons: (getSetting('notify_seasons') ?? '1') === '1',
    weeklyEnabled: (getSetting('weekly_enabled') ?? '1') === '1',
    weeklyDay: Number(getSetting('weekly_day') ?? 5),
    weeklyHour: Number(getSetting('weekly_hour') ?? 18),
    convertedMarker: getSetting('converted_marker') ?? '',
    cleanupWaitDays: Number(getSetting('cleanup_wait_days') ?? 14),
    allowDelete: getSetting('allow_delete') === '1',
    // Solange noch keine Sprache gewählt ist (frische Installation vor dem ersten Aufruf), gilt Englisch
    language: getSetting('language') === 'de' ? 'de' : 'en',
    pastSource: getSetting('past_source') === 'tracearr' ? 'tracearr' : 'tautulli',
    upcomingRegion: getSetting('upcoming_region') ?? 'DE',
    upcomingProviders: parseList(getSetting('upcoming_providers')) ?? defaultProviders(getSetting('upcoming_region') ?? 'DE'),
  }
}

export function saveSettings(s: Settings): void {
  setSetting('reminder_days', String(s.reminderDays))
  setSetting('notify_ratings', s.notifyRatings ? '1' : '0')
  setSetting('notify_reminders', s.notifyReminders ? '1' : '0')
  setSetting('notify_mismatches', s.notifyMismatches ? '1' : '0')
  setSetting('notify_seasons', s.notifySeasons ? '1' : '0')
  setSetting('weekly_enabled', s.weeklyEnabled ? '1' : '0')
  setSetting('weekly_day', String(s.weeklyDay))
  setSetting('weekly_hour', String(s.weeklyHour))
  setSetting('converted_marker', s.convertedMarker)
  setSetting('cleanup_wait_days', String(s.cleanupWaitDays))
  setSetting('allow_delete', s.allowDelete ? '1' : '0')
  setSetting('language', s.language)
  setSetting('past_source', s.pastSource)
  setSetting('upcoming_region', s.upcomingRegion)
  setSetting('upcoming_providers', JSON.stringify(s.upcomingProviders))
}

export interface TitlePerson {
  user_id: number
  name: string
  seen_at: number | null
  /** Bei Serien die Zahl der gesehenen Folgen, bei Filmen null */
  watched: number | null
  rating: number | null
  /** Davon nur in Plex als gesehen markiert, ohne Wiedergabe im Verlauf: Zahl der Folgen, bei Filmen 1 */
  marked?: number
  /** Die Markierung war schon da, als Blackbriar sie zum ersten Mal las; daran wird nicht erinnert */
  quiet?: boolean
}

/** Rechnet ein, was jemand in Plex nur als gesehen markiert hat. */
function applyMark(p: TitlePerson, type: string, mark: { count: number; viewed_at: number; baseline: number } | undefined): void {
  if (!mark) return
  if (type === 'show') {
    const played = p.watched ?? 0
    if (mark.count <= played) return
    p.marked = mark.count - played
    p.watched = mark.count
  } else {
    if (p.seen_at != null) return
    p.marked = 1
  }
  p.seen_at = Math.max(p.seen_at ?? 0, mark.viewed_at)
  p.quiet = Boolean(mark.baseline)
}

export interface TitleSummary {
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  leaf_count: number
  last_activity: number
  /** Letzte echte Wiedergabe; Bewertungen und „als gesehen markiert“ zählen hier nicht */
  last_played: number
  people: TitlePerson[]
}

/** Pro Titel, wer ihn gesehen und wer ihn bewertet hat; neueste Aktivität zuerst. */
export function titleSummaries(): TitleSummary[] {
  const names = new Map<number, string>()
  for (const u of db.prepare('SELECT id, name FROM users').all()) names.set(u.id as number, u.name as string)

  const titles = new Map<number, TitleSummary>()
  const items = new Map<number, Record<string, unknown>>()
  for (const i of db.prepare('SELECT rating_key, type, title, year, thumb, leaf_count FROM library_items').all()) {
    items.set(i.rating_key as number, i)
  }
  // Titel, die es in der Bibliothek nicht mehr gibt, fallen weg
  const person = (key: number, userId: number, activity: number | null): TitlePerson | undefined => {
    const item = items.get(key)
    if (!item) return undefined
    let entry = titles.get(key)
    if (!entry) {
      entry = { ...(item as unknown as Omit<TitleSummary, 'last_activity' | 'last_played' | 'people'>), last_activity: 0, last_played: 0, people: [] }
      titles.set(key, entry)
    }
    entry.last_activity = Math.max(entry.last_activity, activity ?? 0)
    let p = entry.people.find((x) => x.user_id === userId)
    if (!p) {
      p = { user_id: userId, name: names.get(userId) ?? `Konto ${userId}`, seen_at: null, watched: null, rating: null }
      entry.people.push(p)
    }
    return p
  }

  const seen = db
    .prepare(
      `SELECT rating_key AS key, user_id, MAX(viewed_at) AS seen_at, NULL AS watched
       FROM history WHERE type = 'movie' AND rating_key IS NOT NULL
       GROUP BY rating_key, user_id
       UNION ALL
       SELECT show_key AS key, user_id, MAX(viewed_at) AS seen_at, COUNT(DISTINCT season * 10000 + episode) AS watched
       FROM history WHERE type = 'episode' AND show_key IS NOT NULL
       GROUP BY show_key, user_id`,
    )
    .all()
  for (const s of seen) {
    const p = person(s.key as number, s.user_id as number, s.seen_at as number)
    if (!p) continue
    p.seen_at = s.seen_at as number
    p.watched = s.watched as number | null
    const entry = titles.get(s.key as number)!
    entry.last_played = Math.max(entry.last_played, s.seen_at as number)
  }
  // Was gerade läuft oder abgebrochen wurde, steht noch nicht im Plex-Verlauf, wohl aber in der eigenen Aufzeichnung
  for (const o of db
    .prepare('SELECT COALESCE(show_key, rating_key) AS key, MAX(last_seen) AS at FROM own_plays WHERE COALESCE(duration, last_seen - started) >= 60 GROUP BY 1')
    .all()) {
    const entry = o.key == null ? undefined : titles.get(o.key as number)
    if (entry) entry.last_played = Math.max(entry.last_played, (o.at as number | null) ?? 0)
  }
  for (const r of db.prepare('SELECT rating_key, user_id, rating, rated_at FROM ratings').all()) {
    const p = person(r.rating_key as number, r.user_id as number, r.rated_at as number | null)
    if (p) p.rating = r.rating as number
  }
  for (const w of db.prepare('SELECT user_id, rating_key, count, viewed_at, baseline FROM plex_watched').all()) {
    const item = items.get(w.rating_key as number)
    if (!item) continue
    const p = person(w.rating_key as number, w.user_id as number, null)!
    applyMark(p, item.type as string, w as unknown as { count: number; viewed_at: number; baseline: number })
    if (p.marked) titles.get(w.rating_key as number)!.last_activity = Math.max(titles.get(w.rating_key as number)!.last_activity, p.seen_at ?? 0)
  }

  const list = [...titles.values()]
  for (const t of list) t.people.sort((a, b) => (b.seen_at ?? 0) - (a.seen_at ?? 0))
  return list.sort((a, b) => b.last_activity - a.last_activity)
}

export interface HistoryTitle extends Omit<TitleSummary, 'rating_key'> {
  /** null bei Titeln, die nicht mehr auf dem Server liegen */
  rating_key: number | null
  /** Der Titel wurde gelöscht; geblieben ist, wer ihn gesehen und bewertet hat */
  gone: boolean
  /** Poster-Pfad bei TMDB für gelöschte Titel, deren Bild Plex nicht mehr liefert */
  poster: string | null
}

/**
 * Wie titleSummaries, aber mit den Titeln, die inzwischen gelöscht sind: Der Verlauf soll zeigen, was gesehen wurde,
 * auch wenn es nicht mehr auf dem Server liegt. Ein gelöschter Titel hat keinen Schlüssel mehr und wird am Namen erkannt.
 * Liegt ein Titel gleichen Namens (wieder) in der Bibliothek, etwa nach dem Umwandeln der Datei, gibt es keinen zweiten Eintrag.
 */
export function historyTitles(): HistoryTitle[] {
  const present: HistoryTitle[] = titleSummaries().map((t) => ({ ...t, gone: false, poster: null }))
  const names = new Map<number, string>()
  for (const u of db.prepare('SELECT id, name FROM users').all()) names.set(u.id as number, u.name as string)
  const inLibrary = new Set(
    db.prepare('SELECT type, title FROM library_items').all().map((l) => `${l.type}:${String(l.title).toLowerCase()}`),
  )
  const posterOf = db.prepare('SELECT poster FROM posters WHERE type = ? AND title = ?')

  const gone = new Map<string, HistoryTitle>()
  const person = (type: string, title: string, year: number | null, userId: number, activity: number): TitlePerson | undefined => {
    const id = `${type}:${title.toLowerCase()}`
    if (inLibrary.has(id)) return undefined
    let entry = gone.get(id)
    if (!entry) {
      const poster = (posterOf.get(type, title)?.poster as string | undefined) || null
      entry = { rating_key: null, type, title, year, thumb: null, leaf_count: 0, last_activity: 0, last_played: 0, people: [], gone: true, poster }
      gone.set(id, entry)
    }
    entry.year ??= year
    entry.last_activity = Math.max(entry.last_activity, activity)
    let p = entry.people.find((x) => x.user_id === userId)
    if (!p) {
      p = { user_id: userId, name: names.get(userId) ?? `Konto ${userId}`, seen_at: null, watched: null, rating: null }
      entry.people.push(p)
    }
    return p
  }

  const missing = (key: string) => `(h.${key} IS NULL OR NOT EXISTS (SELECT 1 FROM library_items l WHERE l.rating_key = h.${key}))`
  for (const s of db
    .prepare(
      `SELECT 'movie' AS type, h.title, h.user_id, MAX(h.viewed_at) AS seen_at, NULL AS watched
       FROM history h WHERE h.type = 'movie' AND ${missing('rating_key')} GROUP BY lower(h.title), h.user_id
       UNION ALL
       SELECT 'show' AS type, h.show_title AS title, h.user_id, MAX(h.viewed_at) AS seen_at, COUNT(DISTINCT h.season * 10000 + h.episode) AS watched
       FROM history h WHERE h.type = 'episode' AND h.show_title IS NOT NULL AND ${missing('show_key')} GROUP BY lower(h.show_title), h.user_id`,
    )
    .all()) {
    const p = person(s.type as string, s.title as string, null, s.user_id as number, s.seen_at as number)
    if (!p) continue
    p.seen_at = s.seen_at as number
    p.watched = s.watched as number | null
    const entry = gone.get(`${s.type}:${String(s.title).toLowerCase()}`)!
    entry.last_played = Math.max(entry.last_played, s.seen_at as number)
  }
  for (const r of db
    .prepare('SELECT r.type, r.title, r.year, r.user_id, r.rating, r.rated_at FROM ratings r WHERE NOT EXISTS (SELECT 1 FROM library_items l WHERE l.rating_key = r.rating_key)')
    .all()) {
    if (r.type !== 'movie' && r.type !== 'show') continue
    const p = person(r.type, r.title as string, r.year as number | null, r.user_id as number, (r.rated_at as number | null) ?? 0)
    if (p) p.rating = r.rating as number
  }
  for (const t of gone.values()) t.people.sort((a, b) => (b.seen_at ?? 0) - (a.seen_at ?? 0))
  // Oben steht, was zuletzt wirklich lief. Eine Bewertung oder ein „als gesehen markiert“ schiebt einen Titel nicht nach oben;
  // Titel ohne Wiedergabe folgen am Ende, zuerst die markierten, dann die nur bewerteten.
  const lastSeen = (t: HistoryTitle) => Math.max(0, ...t.people.map((p) => p.seen_at ?? 0))
  return [...present, ...gone.values()].sort((a, b) => b.last_played - a.last_played || lastSeen(b) - lastSeen(a) || b.last_activity - a.last_activity)
}

export interface WatchlistTitle {
  type: string
  tmdb_id: number
  title: string
  year: number | null
  /** Poster-Pfad bei TMDB, falls der Titel nicht auf dem Server liegt */
  poster: string | null
  /** null, solange der Titel nicht in der Bibliothek ist */
  rating_key: number | null
  thumb: string | null
  leaf_count: number
  people: TitlePerson[]
}

/** Pro Titel, wer ihn auf der Merkliste hat und wie weit derjenige damit ist. */
export function watchlistTitles(): WatchlistTitle[] {
  const rows = db
    .prepare(
      // Der Titel aus der Bibliothek hat Vorrang, weil er in der Sprache des Servers ist
      `SELECT w.user_id, u.name, w.type, w.tmdb_id, COALESCE(l.title, w.title) AS title, COALESCE(l.year, w.year) AS year,
         w.poster, l.rating_key, l.thumb, l.leaf_count
       FROM watchlist w
       JOIN users u ON u.id = w.user_id AND u.active = 1
       LEFT JOIN library_items l ON l.type = w.type
         AND (l.tmdb_id = w.tmdb_id OR (l.tmdb_id IS NULL AND l.year = w.year AND lower(l.title) = lower(w.title)))`,
    )
    .all()
  const movieSeen = db.prepare("SELECT MAX(viewed_at) AS seen_at FROM history WHERE user_id = ? AND rating_key = ? AND type = 'movie'")
  const showSeen = db.prepare(
    `SELECT MAX(viewed_at) AS seen_at, COUNT(DISTINCT season * 10000 + episode) AS watched
     FROM history WHERE user_id = ? AND show_key = ? AND type = 'episode'`,
  )
  const rated = db.prepare('SELECT rating FROM ratings WHERE user_id = ? AND rating_key = ?')
  const marked = db.prepare('SELECT count, viewed_at, baseline FROM plex_watched WHERE user_id = ? AND rating_key = ?')

  const titles = new Map<string, WatchlistTitle>()
  for (const r of rows) {
    const id = `${r.type}:${r.tmdb_id}`
    let entry = titles.get(id)
    if (!entry) {
      entry = {
        type: r.type as string,
        tmdb_id: r.tmdb_id as number,
        title: r.title as string,
        year: r.year as number | null,
        poster: r.poster as string | null,
        rating_key: r.rating_key as number | null,
        thumb: r.thumb as string | null,
        leaf_count: (r.leaf_count as number | null) ?? 0,
        people: [],
      }
      titles.set(id, entry)
    }
    const userId = r.user_id as number
    let p = entry.people.find((x) => x.user_id === userId)
    if (!p) {
      p = { user_id: userId, name: r.name as string, seen_at: null, watched: null, rating: null }
      entry.people.push(p)
    }
    if (r.rating_key == null) continue
    // Liegt ein Titel doppelt in der Bibliothek (z. B. HD und 4K), zählt der weiter fortgeschrittene Stand
    const seen = (r.type === 'show' ? showSeen : movieSeen).get(userId, r.rating_key)
    if (seen?.seen_at && (seen.seen_at as number) > (p.seen_at ?? 0)) p.seen_at = seen.seen_at as number
    if (r.type === 'show') p.watched = Math.max(p.watched ?? 0, (seen?.watched as number | undefined) ?? 0)
    applyMark(p, r.type as string, marked.get(userId, r.rating_key) as { count: number; viewed_at: number; baseline: number } | undefined)
    p.rating ??= (rated.get(userId, r.rating_key)?.rating as number | undefined) ?? null
  }

  const finished = (t: WatchlistTitle) =>
    t.people.some((p) => (t.type === 'show' ? t.leaf_count > 0 && (p.watched ?? 0) >= t.leaf_count : p.seen_at != null))
  // Oben steht, was jemand fertig gesehen hat und von der Merkliste nehmen sollte
  return [...titles.values()].sort(
    (a, b) =>
      Number(finished(b)) - Number(finished(a)) || b.people.length - a.people.length || a.title.localeCompare(b.title, 'de'),
  )
}

export interface OpenItem {
  user_id: number
  user_name: string
  is_owner: number
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  seen_at: number
  /** In Plex nur als gesehen markiert, nicht (vollständig) abgespielt */
  marked: boolean
  /** Die Markierung war beim ersten Auslesen schon da; daran wird nicht erinnert */
  quiet: boolean
}

// Gesehen, aber nicht bewertet. Ein Film gilt als gesehen, sobald er im Verlauf steht oder in Plex als gesehen markiert ist;
// eine Serie erst, wenn alle vorhandenen Folgen gesehen wurden. Folgen zählen über
// Staffel/Folge statt ratingKey, damit ersetzte Dateien nicht doppelt zählen.
/** Namen der Plex-Mediatheken, die bei „Kann weg“, offenen Bewertungen, Erinnerungen und im Newsletter außen vor bleiben. */
export function excludedSections(): Set<string> {
  return new Set(parseList(getSetting('excluded_sections')) ?? [])
}

/**
 * Eigene Reihenfolge der Mediatheken (Einstellungen → Plex). Gespeichert sind alle Namen, die je einsortiert wurden,
 * auch entfernte: Kommt eine Mediathek wieder, steht sie an ihrem alten Platz.
 */
export function sectionOrder(): string[] {
  return parseList(getSetting('section_order')) ?? []
}

/** Alle Mediatheken, die Plex beim letzten Abgleich gemeldet hat, auch leere. */
export function plexSections(): { name: string; type: string }[] {
  try {
    const list = JSON.parse(getSetting('plex_sections') ?? '[]')
    return Array.isArray(list) ? list.filter((s) => s && typeof s.name === 'string').map((s) => ({ name: s.name, type: s.type === 'show' ? 'show' : 'movie' })) : []
  } catch {
    return []
  }
}

/** Sortiert nach der eigenen Reihenfolge; was dort nicht steht, kommt alphabetisch dahinter. */
export function sortBySection<T>(items: T[], nameOf: (item: T) => string): T[] {
  const order = sectionOrder()
  const rank = (name: string) => {
    const i = order.indexOf(name)
    return i === -1 ? order.length : i
  }
  return [...items].sort((a, b) => rank(nameOf(a)) - rank(nameOf(b)) || nameOf(a).localeCompare(nameOf(b), 'de'))
}

/**
 * Verschiebt eine Mediathek um einen Platz unter den vorhandenen (`current`). Entfernte bleiben in der gespeicherten
 * Liste stehen, werden beim Verschieben aber übersprungen.
 */
export function moveSection(name: string, direction: 'up' | 'down', current: string[]): void {
  // Neue Mediatheken an ihrer bisherigen Stelle (hinten, alphabetisch) in die Liste aufnehmen
  const order = [...sectionOrder()]
  for (const n of sortBySection(current, (x) => x)) if (!order.includes(n)) order.push(n)
  const visible = order.filter((n) => current.includes(n))
  const at = visible.indexOf(name)
  const neighbour = visible[direction === 'up' ? at - 1 : at + 1]
  if (at === -1 || !neighbour) return
  const i = order.indexOf(name)
  const j = order.indexOf(neighbour)
  ;[order[i], order[j]] = [order[j]!, order[i]!]
  setSetting('section_order', JSON.stringify(order))
}

export function setSectionIncluded(name: string, included: boolean): void {
  const excluded = excludedSections()
  if (included) excluded.delete(name)
  else excluded.add(name)
  setSetting('excluded_sections', JSON.stringify([...excluded]))
}

/**
 * SQL-Bedingung, die nur Titel aus Mediatheken durchlässt, auf die der Benutzer Zugriff hat. `user` ist der Platzhalter
 * mit seiner ID, z. B. „?2“. Solange die Freigaben eines Benutzers noch nicht gelesen sind, gilt alles als zugänglich.
 */
export const accessFilter = (user: string, alias = 'l') =>
  `(${alias}.section IS NULL OR NOT EXISTS (SELECT 1 FROM user_sections s WHERE s.user_id = ${user})
    OR ${alias}.section IN (SELECT s.section FROM user_sections s WHERE s.user_id = ${user}))`

/** SQL-Bedingung, die Titel aus ausgenommenen Mediatheken weglässt; `alias` ist der Name von library_items in der Abfrage. */
export const sectionFilter = (alias = 'l') =>
  `(${alias}.section IS NULL OR ${alias}.section NOT IN (SELECT value FROM json_each((SELECT value FROM settings WHERE key = 'excluded_sections'))))`

export function openItems(userId?: number): OpenItem[] {
  // Wer nie bewertet, taucht hier nicht auf; ausgenommene Mediatheken auch nicht
  const users = new Map<number, { name: string; owner: number }>()
  for (const u of db.prepare('SELECT id, name, is_owner FROM users WHERE active = 1 AND COALESCE(never_rates, 0) = 0').all()) {
    users.set(u.id as number, { name: u.name as string, owner: u.is_owner as number })
  }
  const included = new Set(db.prepare(`SELECT rating_key FROM library_items l WHERE ${sectionFilter()}`).all().map((l) => l.rating_key as number))
  const items: OpenItem[] = []
  for (const title of titleSummaries()) {
    if (!included.has(title.rating_key)) continue
    for (const p of title.people) {
      const user = users.get(p.user_id)
      if (!user || p.rating != null || p.seen_at == null || (userId && p.user_id !== userId)) continue
      if (title.type === 'show' && !(title.leaf_count > 0 && (p.watched ?? 0) >= title.leaf_count)) continue
      items.push({
        user_id: p.user_id,
        user_name: user.name,
        is_owner: user.owner,
        rating_key: title.rating_key,
        type: title.type,
        title: title.title,
        year: title.year,
        thumb: title.thumb,
        seen_at: p.seen_at,
        marked: Boolean(p.marked),
        quiet: Boolean(p.marked && p.quiet),
      })
    }
  }
  return items.sort((a, b) => b.seen_at - a.seen_at)
}
