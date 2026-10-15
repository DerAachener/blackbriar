import { readFileSync } from 'node:fs'
function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim()
}

// Verbindungen zu anderen Diensten. Jede lässt sich in der Oberfläche setzen;
// die Umgebungsvariable dient als Vorgabe, solange dort nichts eingetragen ist.
export const CONNECTION_KEYS = [
  'plexUrl',
  'plexToken',
  'seerrUrl',
  'seerrApiKey',
  'tmdbApiKey',
  'tautulliUrl',
  'tautulliApiKey',
  'tracearrUrl',
  'tracearrApiKey',
  'radarrUrl',
  'radarrApiKey',
  'radarr4kUrl',
  'radarr4kApiKey',
  'sonarrUrl',
  'sonarrApiKey',
  'sonarr4kUrl',
  'sonarr4kApiKey',
  'telegramBotToken',
  'telegramChatId',
  'mailHost',
  'mailPort',
  'mailUser',
  'mailPassword',
  'mailFrom',
  'mailFromName',
  'publicUrl',
] as const
export type ConnectionKey = (typeof CONNECTION_KEYS)[number]

const ENV_NAME: Record<ConnectionKey, string> = {
  plexUrl: 'PLEX_URL',
  plexToken: 'PLEX_TOKEN',
  seerrUrl: 'SEERR_URL',
  seerrApiKey: 'SEERR_API_KEY',
  tmdbApiKey: 'TMDB_API_KEY',
  tautulliUrl: 'TAUTULLI_URL',
  tautulliApiKey: 'TAUTULLI_API_KEY',
  tracearrUrl: 'TRACEARR_URL',
  tracearrApiKey: 'TRACEARR_API_KEY',
  radarrUrl: 'RADARR_URL',
  radarrApiKey: 'RADARR_API_KEY',
  sonarrUrl: 'SONARR_URL',
  sonarrApiKey: 'SONARR_API_KEY',
  radarr4kUrl: 'RADARR_4K_URL',
  radarr4kApiKey: 'RADARR_4K_API_KEY',
  sonarr4kUrl: 'SONARR_4K_URL',
  sonarr4kApiKey: 'SONARR_4K_API_KEY',
  telegramBotToken: 'TELEGRAM_BOT_TOKEN',
  telegramChatId: 'TELEGRAM_CHAT_ID',
  mailHost: 'MAIL_HOST',
  mailPort: 'MAIL_PORT',
  mailUser: 'MAIL_USER',
  mailPassword: 'MAIL_PASSWORD',
  mailFrom: 'MAIL_FROM',
  mailFromName: 'MAIL_FROM_NAME',
  publicUrl: 'PUBLIC_URL',
}

/** Werte, die die Oberfläche nie zurückgibt. */
export const SECRET_KEYS: ReadonlySet<ConnectionKey> = new Set([
  'plexToken',
  'seerrApiKey',
  'tmdbApiKey',
  'tautulliApiKey',
  'tracearrApiKey',
  'radarrApiKey',
  'sonarrApiKey',
  'radarr4kApiKey',
  'sonarr4kApiKey',
  'telegramBotToken',
  'mailPassword',
])

const overrides = new Map<ConnectionKey, string>()

export function setConnection(key: ConnectionKey, value: string | null): void {
  if (value?.trim()) overrides.set(key, value.trim())
  else overrides.delete(key)
}

export function connectionSource(key: ConnectionKey): 'app' | 'env' | 'none' {
  if (overrides.has(key)) return 'app'
  return env(ENV_NAME[key]) ? 'env' : 'none'
}

function connection(key: ConnectionKey): string {
  const value = overrides.get(key) ?? env(ENV_NAME[key])
  return key.endsWith('Url') ? value.replace(/\/+$/, '') : value
}

export const config = {
  port: Number(env('PORT', '8787')),
  dataDir: env('DATA_DIR', './data'),
  syncIntervalSec: Math.max(30, Number(env('SYNC_INTERVAL_SECONDS', '300')) || 300),
  sessionsIntervalSec: 10,
  get plexUrl() {
    return connection('plexUrl')
  },
  get plexToken() {
    return connection('plexToken')
  },
  get seerrUrl() {
    return connection('seerrUrl')
  },
  get seerrApiKey() {
    return connection('seerrApiKey')
  },
  get tmdbApiKey() {
    return connection('tmdbApiKey')
  },
  get tautulliUrl() {
    return connection('tautulliUrl')
  },
  get tautulliApiKey() {
    return connection('tautulliApiKey')
  },
  get tracearrUrl() {
    return connection('tracearrUrl')
  },
  get tracearrApiKey() {
    return connection('tracearrApiKey')
  },
  get radarrUrl() {
    return connection('radarrUrl')
  },
  get radarrApiKey() {
    return connection('radarrApiKey')
  },
  get sonarrUrl() {
    return connection('sonarrUrl')
  },
  get sonarrApiKey() {
    return connection('sonarrApiKey')
  },
  get radarr4kUrl() {
    return connection('radarr4kUrl')
  },
  get radarr4kApiKey() {
    return connection('radarr4kApiKey')
  },
  get sonarr4kUrl() {
    return connection('sonarr4kUrl')
  },
  get sonarr4kApiKey() {
    return connection('sonarr4kApiKey')
  },
  get telegramBotToken() {
    return connection('telegramBotToken')
  },
  get telegramChatId() {
    return connection('telegramChatId')
  },
  get mailHost() {
    return connection('mailHost')
  },
  /** 465 verschlüsselt von Anfang an, 587 wechselt nach dem Verbinden auf verschlüsselt */
  get mailPort() {
    return Number(connection('mailPort')) || 465
  },
  get mailUser() {
    return connection('mailUser')
  },
  get mailPassword() {
    return connection('mailPassword')
  },
  /** Absenderadresse */
  get mailFrom() {
    return connection('mailFrom')
  },
  get mailFromName() {
    return connection('mailFromName')
  },
  /** Adresse, unter der Blackbriar von außen erreichbar ist; für Links in E-Mails */
  get publicUrl() {
    return connection('publicUrl')
  },
}

/** Versionsnummer in der Form bb.0.9.0, aus package.json. */
export const appVersion = (() => {
  try {
    return `bb.${JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version}`
  } catch {
    return 'bb.?'
  }
})()

/** Kurzcode des Commits, aus dem das Image gebaut wurde; leer bei einem Start aus dem Quelltext. */
export const appCommit = (process.env.APP_COMMIT ?? '').trim().slice(0, 7)

export const plexConfigured = () => Boolean(config.plexUrl && config.plexToken)
export const seerrConfigured = () => Boolean(config.seerrUrl && config.seerrApiKey)
export const tmdbConfigured = () => Boolean(config.tmdbApiKey)
export const tautulliConfigured = () => Boolean(config.tautulliUrl && config.tautulliApiKey)
export const tracearrConfigured = () => Boolean(config.tracearrUrl && config.tracearrApiKey)
export const mailConfigured = () => Boolean(config.mailHost && config.mailUser && config.mailPassword && config.mailFrom)
export const telegramConfigured = () => Boolean(config.telegramBotToken && config.telegramChatId)
