import { useCallback, useEffect, useState } from 'react'
import { CHANGED } from './titleinfo'

export interface Session {
  id: string
  userId: number
  user: string
  type: string
  title: string
  showTitle: string | null
  season: number | null
  episode: number | null
  year: number | null
  thumb: string | null
  durationMs: number
  offsetMs: number
  state: string
  player: string
  platform: string
  location: string
  decision: string
  resolution: string | null
  bandwidthKbps: number | null
}

export interface User {
  id: number
  name: string
  is_owner: number
  active: number
  plays: number
  last_seen: number | null
  ratings: number
  open: number
  /** Adresse für Newsletter und Erinnerungen; aus Plex oder vom Besitzer eingetragen */
  email: string | null
  email_custom: number
  /** Vom Besitzer vergebener Name; null, wenn der Plex-Name gilt */
  display_name: string | null
  /** Name des Plex-Kontos */
  plex_name: string
  /** Bewertet nie: Ansehen zählt als fertig, keine Erinnerungen */
  never_rates: number
  /** Mediatheken, auf die der Benutzer in Plex Zugriff hat */
  sections: string[]
}

export interface Rating {
  user_id: number
  user_name: string | null
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  rating: number
  rated_at: number | null
  seen_at: number | null
  size: number | null
}

export interface HistoryItem {
  /** Schlüssel in Plex; bei Serien der einer Folge. Fehlt bei alten, importierten Einträgen. */
  rating_key: number | null
  id: number
  user_id: number
  user_name: string | null
  type: string
  title: string
  show_title: string | null
  season: number | null
  episode: number | null
  thumb: string | null
  /** Poster-Pfad bei TMDB für Titel, die nicht mehr in der Bibliothek liegen */
  poster: string | null
  /** Zeitpunkt der letzten Folge der Gruppe */
  viewed_at: number
  /** Zahl der Folgen, die dieser Benutzer an diesem Tag von der Serie gesehen hat; bei Filmen 1 */
  count: number
  /** Erste und letzte Folge der Gruppe als Staffel * 10000 + Folge */
  first_code: number | null
  last_code: number | null
}

export interface OpenItem {
  user_id: number
  user_name: string
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  /** Mediathek auf dem Server; leer, wenn es von dieser Art nur eine gibt */
  section: string | null
  seen_at: number
  /** In Plex nur als gesehen markiert, nicht (vollständig) abgespielt */
  marked: boolean
  size: number | null
  /** Namen der Benutzer, die den Titel noch auf der Merkliste haben */
  watchlist: string[]
  /** Zahl der Dateien und die Radarr- bzw. Sonarr-Instanzen des Titels, für den Lösch-Dialog */
  files: number
  arr: string[]
  airing: Airing
}

export interface TitlePerson {
  user_id: number
  name: string
  seen_at: number | null
  watched: number | null
  rating: number | null
  /** Davon nur in Plex als gesehen markiert, ohne Wiedergabe: Zahl der Folgen, bei Filmen 1 */
  marked?: number
}

export interface TitleSummary {
  /** null bei Titeln, die nicht mehr auf dem Server liegen */
  rating_key: number | null
  gone: boolean
  /** Poster-Pfad bei TMDB für gelöschte Titel */
  poster: string | null
  type: string
  title: string
  year: number | null
  thumb: string | null
  /** Mediathek auf dem Server; leer, wenn es von dieser Art nur eine gibt */
  section: string | null
  leaf_count: number
  last_activity: number
  size: number | null
  people: TitlePerson[]
}

export interface MailPrefs {
  newsletter: boolean
  rhythm: 'weekly' | 'biweekly' | 'monthly'
  /** 0 = Sonntag … 6 = Samstag */
  day: number
  hour: number
  sections: { added: boolean; watchlist: boolean; ratings: boolean }
  /** Sofort eine Mail, wenn ein Titel von der eigenen Merkliste ankommt */
  instant: boolean
  reminder: boolean
  reminderDays: number
  reminderMax: number
  reminderHour: number
  reminderRated: boolean
  reminderWatchlist: boolean
}

export interface MailPrefsData {
  defaults: MailPrefs
  users: {
    id: number
    name: string
    email: string | null
    /** Die Einstellungen, die für diesen Benutzer gelten */
    prefs: MailPrefs
    /** Für welche Teile der Benutzer eigene Einstellungen hat statt des Standards */
    own: { newsletter: boolean; reminder: boolean }
    /** Titel, die bei ihm offen sind, und wie viele davon jetzt angemahnt würden */
    reminders: { open: number; due: number }
    newsletter_unsub: number | null
    reminder_unsub: number | null
    newsletter_sent_at: number | null
    /** Nächster Termin des Newsletters; null, wenn er aus ist */
    next: number | null
  }[]
  log: Record<'newsletter' | 'reminder', { at: number; kind: string; subject: string; ok: number; error: string | null; user_name: string | null }[]>
}

export interface NoticeVersion {
  media_id: number
  file: string
  size: number
  video_codec: string | null
  audio_codec: string | null
  audio_channels: number | null
  resolution: string | null
  /** Trägt das Kennzeichen für umgewandelte Dateien */
  converted: boolean
  folder: string
}

export interface Notice {
  id: number
  kind: 'complete' | 'groups' | 'versions' | 'merged'
  rating_key: number
  season: number
  title: string
  detail: string
  created_at: number
  thumb: string | null
  url: string | null
  versions?: NoticeVersion[]
  canDelete?: boolean
}

export interface Mismatch {
  key: string
  type: 'movie' | 'show'
  title: string
  year: number | null
  rating_key: number
  thumb: string | null
  /** Nummer, unter der Plex den Titel führt */
  plex_tmdb: number
  /** Nummer, die auf der Merkliste bzw. in Radarr/Sonarr steht */
  wanted_tmdb: number
  sources: string[]
}

export interface WatchlistTitle {
  type: string
  tmdb_id: number
  title: string
  year: number | null
  poster: string | null
  rating_key: number | null
  thumb: string | null
  /** Mediathek auf dem Server; leer, wenn es von dieser Art nur eine gibt */
  section: string | null
  leaf_count: number
  size: number | null
  /** Stand der Anfrage in Seerr; null, wenn es keine gibt */
  request: { label: string; progress: number | null } | null
  people: TitlePerson[]
}

export interface FileItem {
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  section: string | null
  size: number
  files: number
  converted: number
  video_codec: string | null
  audio_codec: string | null
  resolution: string | null
  bitrate: number | null
  container: string | null
  file: string | null
  transcodes: number
  /** Einträge in Radarr bzw. Sonarr, in denen der Titel noch verwaltet wird; leer, wenn in keiner Instanz */
  arr: { instance: string; name: string; status: string | null; monitored: boolean; next_airing: number | null }[]
  last_transcode: {
    at: number
    user_name: string
    player: string | null
    platform: string | null
    video_decision: string | null
    audio_decision: string | null
    src_video: string | null
    src_audio: string | null
    dst_video: string | null
    dst_audio: string | null
  } | null
}

export interface Dashboard {
  open: number
  cleanup: { titles: number; size: number; episodes: number; episodeSize: number }
  /** Angefragt und freigegeben, aber noch nicht auf dem Server */
  /** null, wenn Seerr nicht verbunden ist */
  pending: number | null
  added: { rating_key: number; type: 'movie' | 'show'; title: string; year: number | null; thumb: string | null; section: string | null; added_at: number; detail: string }[]
  warnings: string[]
  /** Plex ist verbunden, der Abgleich läuft */
  ready: boolean
  /** Benutzer, die Newsletter oder Erinnerung selbst abbestellt haben */
  unsubscribed: number
  next: { newsletter: number | null; recipients: number; weekly: number | null }
}

export interface Storage {
  at: number | null
  disks: {
    /** Die Stammordner von Radarr und Sonarr, die auf dieser Platte liegen */
    folders: string[]
    free: number
    total: number | null
    /** Verbrauch pro Tag laut den täglichen Messwerten; null, solange es zu wenige gibt */
    perDay: number | null
    measuredDays: number
  }[]
  /** Größe aller Dateien, die Plex kennt */
  library: number
  /** Was in den letzten 30 Tagen dazugekommen ist, ohne Abzug von Gelöschtem */
  added30: number
}

export interface NotInPlexItem {
  type: 'movie' | 'show'
  title: string
  year: number | null
  poster: string | null
  status: string | null
  next_airing: number | null
  files: number
  total: number
  size: number
  monitored: boolean
  instances: { instance: string; name: string; monitored: boolean; files: number }[]
}

export interface CleanupPerson extends TitlePerson {
  /** Film gesehen oder alle vorhandenen Folgen gesehen */
  seen: boolean
  requested: boolean
  on_watchlist: boolean
  done: boolean
}

/** Die Serie läuft laut Sonarr noch; `next` ist der Termin der nächsten Folge, falls bekannt. */
export type Airing = { next: number | null } | null

/** Eine Mediathek aus Plex */
export interface SectionInfo {
  name: string
  type: string
  titles: number
  size: number
  /** Zählt bei „Kann weg“, offenen Bewertungen, Erinnerungen und im Newsletter mit */
  included: boolean
}

export interface DetailPerson extends TitlePerson {
  marked: number
  requested: boolean
  on_watchlist: boolean
}

/** Alles, was Blackbriar zu einem Titel weiß */
export interface TitleDetail {
  rating_key: number | null
  /** Inhaltsangabe aus Plex, falls der Titel auf dem Server liegt */
  summary: string | null
  type: 'movie' | 'show'
  tmdb_id: number | null
  title: string
  year: number | null
  thumb: string | null
  poster: string | null
  section: string | null
  added_at: number | null
  leaf_count: number
  /** Pfad der Datei bzw. gemeinsamer Ordner der Folgen, aus Sicht von Plex */
  path: string | null
  file: {
    size: number
    files: number
    converted: number
    video_codec: string | null
    audio_codec: string | null
    resolution: string | null
    bitrate: number | null
    container: string | null
    file: string | null
  } | null
  arr: { name: string; monitored: boolean; status: string | null; url: string }[]
  airing: Airing
  seasons: { season: number; episodes: number; size: number; groups: { name: string; episodes: number }[] }[]
  request: string | null
  people: DetailPerson[]
  plays: { user_name: string; viewed_at: number; season: number | null; episode: number | null; title: string }[]
  plays_total: number
}

export interface CleanupItem {
  rating_key: number
  type: string
  title: string
  year: number | null
  thumb: string | null
  /** Mediathek auf dem Server; leer, wenn es von dieser Art nur eine gibt */
  section: string | null
  size: number
  files: number
  reason: 'requesters' | 'owner' | 'unrated'
  people: CleanupPerson[]
  /** Namen der Radarr- bzw. Sonarr-Instanzen, in denen der Titel noch steht */
  arr: string[]
  airing: Airing
}

export interface EpisodeCleanupItem {
  rating_key: number
  title: string
  year: number | null
  thumb: string | null
  /** Mediathek auf dem Server; leer, wenn es von dieser Art nur eine gibt */
  section: string | null
  /** Vom Besitzer gesehene Folgen, die noch auf der Platte liegen */
  episodes: number
  size: number
  seasons: { season: number; watched: number; total: number; size: number; keys: number[] }[]
  arr: string[]
  /** Wer die Serie noch auf der Merkliste hat */
  watchlist: string[]
  airing: Airing
}

export interface Deletion {
  at: number
  user: string
  type: string
  title: string
  detail: string
  files: number
  size: number
}

export interface CleanupData {
  titles: CleanupItem[]
  episodes: EpisodeCleanupItem[]
  deletions: Deletion[]
}

export interface DeleteResult {
  deleted: boolean
  steps: { label: string; ok: boolean; error?: string }[]
}

export interface Stats {
  /** Ob im gewählten Zeitraum durchgehend Dauer und Gerät bekannt sind */
  timed: boolean
  /** Seit wann Blackbriar Wiedergaben selbst mitschreibt */
  recordingSince: number
  totals: { plays: number; seconds: number; users: number }
  perUser: { name: string; plays: number; seconds: number }[]
  perWeekday: { day: number; plays: number; seconds: number }[]
  perHour: { hour: number; plays: number; seconds: number }[]
  perMonth: { month: string; plays: number; seconds: number }[]
  topMovies: { title: string; plays: number; users: number }[]
  topShows: { title: string; plays: number; users: number }[]
  platforms: { name: string; plays: number }[]
  decisions: { name: string; plays: number }[]
}

export interface Release {
  /** 'topic' für Titel aus „Meine Themen“: kein Neustart, sondern ein Treffer im Katalog */
  kind: 'cinema' | 'streaming' | 'topic'
  type: 'movie' | 'show'
  tmdb_id: number
  title: string
  year: number | null
  /** Starttermin im gewählten Land, JJJJ-MM-TT */
  date: string
  poster: string | null
  season: number | null
  /** Namen der Anbieter; vor dem Start oft noch leer */
  providers: string[]
  /** Dokumentation laut TMDB; fehlt bei Daten, die vor dieser Angabe geholt wurden */
  documentary?: boolean
  in_library: boolean
  /** Radarr- bzw. Sonarr-Instanzen, die den Titel beobachten, mit der Adresse des Titels dort */
  arr: { name: string; url: string }[]
  /** Namen der Benutzer, die den Titel auf der Merkliste haben */
  watchlist: string[]
  /** Stand der Anfrage in Seerr, falls es eine gibt */
  request: string | null
}

export interface Keyword {
  id: number
  name: string
}

/** Ein Thema aus „Meine Themen“: Schlagwörter aus TMDB, zu denen Blackbriar den Katalog zeigt */
export interface Topic {
  id: string
  name: string
  keywords: Keyword[]
  docsOnly: boolean
}

export interface TopicTitles {
  topic: Topic
  fetchedAt: number
  titles: Release[]
}

export interface CalendarEntry {
  instance: string
  type: 'movie' | 'show'
  title: string
  date: string
  season: number | null
  episodes: number[]
  episode_title: string | null
  release: 'digital' | 'physical' | 'cinema' | null
  poster: string | null
  has_file: boolean
  tmdb_id: number | null
  /** Inhalt laut Radarr bzw. Sonarr, falls TMDB nicht verbunden ist */
  overview: string | null
  /** Adresse des Titels in Radarr bzw. Sonarr */
  url: string
}

export interface TitleDetails {
  type: 'movie' | 'show'
  tmdb_id: number
  title: string
  original_title: string | null
  tagline: string | null
  overview: string | null
  year: number | null
  genres: string[]
  runtime: number | null
  seasons: number | null
  episodes: number | null
  status: string | null
  certification: string | null
  vote: number | null
  votes: number
  creators: string[]
  cast: string[]
  overviewFallback: boolean
  trailer: string | null
  trailerOther: string | null
  poster: string | null
  backdrop: string | null
}

export interface Provider {
  id: number
  name: string
  logo: string | null
}

/** Ein unter „Was kommt“ ausgeblendeter Titel */
export interface HiddenTitle {
  type: 'movie' | 'show'
  tmdb_id: number
  title: string
  year: number | null
  hidden_at: number
}

export interface Upcoming {
  /** Zahl der ausgeblendeten Titel */
  hidden: number
  configured: boolean
  loading: boolean
  error: string
  fetchedAt: number | null
  region: string
  /** Heutiges Datum aus Sicht des Servers, JJJJ-MM-TT */
  today: string
  providers: Provider[]
  cinema: Release[]
  streaming: Release[]
  server: CalendarEntry[]
  serverError: string
  arrConfigured: boolean
}

export interface ImportSourceStatus {
  configured: boolean
  running: boolean
  /** Bisher gelesene und insgesamt vorhandene Einträge der Quelle */
  read: number
  total: number
  error: string
  /** Wiedergaben dieser Quelle in der Datenbank */
  count: number
  lastImport: number | null
}

export interface ImportStatus {
  tautulli: ImportSourceStatus
  tracearr: ImportSourceStatus
  recordingSince: number
}

export interface Status {
  plexConfigured: boolean
  telegramConfigured: boolean
  seerrConfigured: boolean
  tautulliConfigured: boolean
  tracearrConfigured: boolean
  tmdbConfigured: boolean
  /** Seit wann Blackbriar Wiedergaben selbst mitschreibt */
  recordingSince: number
  /** Mindestens eine Radarr- oder Sonarr-Instanz ist verbunden */
  arrConfigured: boolean
  syncIntervalSec: number
  /** Schlüssel für die Webhook-Adresse; null, wenn die Anmeldung abgeschaltet ist */
  webhookKey: string | null
  sync: { running: boolean; lastRun: number; lastSuccess: number; lastError: string }
  /** Tägliche Sicherungen der Datenbank: Anzahl, Datum der neuesten (JJJJ-MM-TT) und deren Größe */
  backup: { count: number; latest: string | null; size: number }
  /** Versionsnummer wie bb.0.9.0 und Kurzcode des Builds, falls bekannt */
  version: string
  commit: string | null
  counts: { history: number; ratings: number; library: number; plays: number; ownPlays: number; tracearrPlays: number }
}

export interface Settings {
  reminderDays: number
  notifyRatings: boolean
  notifyReminders: boolean
  notifyMismatches: boolean
  notifySeasons: boolean
  cleanupWaitDays: number
  weeklyEnabled: boolean
  weeklyDay: number
  weeklyHour: number
  convertedMarker: string
  allowDelete: boolean
  language: 'de' | 'en'
  pastSource: 'tautulli' | 'tracearr'
  upcomingRegion: string
  upcomingProviders: string[]
}

export type ConnectionKey =
  | 'plexUrl'
  | 'plexToken'
  | 'seerrUrl'
  | 'seerrApiKey'
  | 'tmdbApiKey'
  | 'tautulliUrl'
  | 'tautulliApiKey'
  | 'tracearrUrl'
  | 'tracearrApiKey'
  | 'radarrUrl'
  | 'radarrApiKey'
  | 'sonarrUrl'
  | 'sonarrApiKey'
  | 'radarr4kUrl'
  | 'radarr4kApiKey'
  | 'sonarr4kUrl'
  | 'sonarr4kApiKey'
  | 'telegramBotToken'
  | 'telegramChatId'
  | 'mailHost'
  | 'mailPort'
  | 'mailUser'
  | 'mailPassword'
  | 'mailFrom'
  | 'mailFromName'
  | 'publicUrl'

/** `value` bleibt bei geheimen Feldern leer; `source` sagt, ob und wo etwas gesetzt ist. */
export type Connections = Record<ConnectionKey, { value: string; source: 'app' | 'env' | 'none' }>

export interface Page<T> {
  total: number
  items: T[]
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    // Abgelaufene Sitzung: Die Anmeldeseite übernimmt
    if (res.status === 401 && !path.startsWith('/auth/')) dispatchEvent(new Event('blackbriar-unauthorized'))
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  return (res.status === 204 ? undefined : await res.json()) as T
}

/** Lädt einen Endpunkt, auf Wunsch wiederholt alle `refreshMs` Millisekunden. */
export function useApi<T>(path: string, refreshMs = 0) {
  const [data, setData] = useState<T>()
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let active = true
    const load = () =>
      api<T>(path)
        .then((d) => {
          if (!active) return
          setData(d)
          setError('')
        })
        .catch((e: Error) => active && setError(e.message))
    void load()
    const timer = refreshMs ? setInterval(load, refreshMs) : undefined
    // Nach dem Löschen aus dem Info-Fenster heraus laden alle Ansichten neu
    addEventListener(CHANGED, load)
    return () => {
      active = false
      clearInterval(timer)
      removeEventListener(CHANGED, load)
    }
  }, [path, refreshMs, tick])

  return { data, error, reload: useCallback(() => setTick((t) => t + 1), []) }
}

/** Lädt eine Liste seitenweise; `more` hängt die nächste Seite an. */
export function usePaged<T>(path: string, pageSize = 50) {
  const [state, setState] = useState<{ path: string; items: T[]; total: number }>({ path, items: [], total: 0 })
  const [error, setError] = useState('')

  const load = useCallback(
    (offset: number) => {
      const sep = path.includes('?') ? '&' : '?'
      api<Page<T>>(`${path}${sep}limit=${pageSize}&offset=${offset}`)
        .then((page) => {
          setError('')
          setState((s) => ({
            path,
            total: page.total,
            items: offset === 0 || s.path !== path ? page.items : [...s.items, ...page.items],
          }))
        })
        .catch((e: Error) => setError(e.message))
    },
    [path, pageSize],
  )

  useEffect(() => {
    load(0)
    const reload = () => load(0)
    addEventListener(CHANGED, reload)
    return () => removeEventListener(CHANGED, reload)
  }, [load])

  const current = state.path === path ? state : { items: [] as T[], total: 0 }
  return { items: current.items, total: current.total, error, more: () => load(current.items.length) }
}
