import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { config } from './config.ts'
import { db, getSetting, getSettings, now, regionFromBrowser, saveConnection, setSetting } from './db.ts'
import { resyncAll } from './sync.ts'
import { logEvent } from './events.ts'
import { t } from './i18n.ts'
import { reach } from './net.ts'

const SESSION_COOKIE = 'bb_session'
const PIN_COOKIE = 'bb_pin'
const SESSION_SECONDS = 90 * 86400
const PIN_SECONDS = 600

/**
 * Die Anmeldung lässt sich mit AUTH=off abschalten, etwa wenn ein vorgeschalteter Dienst sie übernimmt
 * oder wenn man sich ausgesperrt hat.
 */
export const authEnabled = () => (process.env.AUTH ?? '').trim().toLowerCase() !== 'off'

/** Kennung dieser Installation gegenüber plex.tv; unter ihr erscheint Blackbriar bei den autorisierten Geräten. */
function clientId(): string {
  let id = getSetting('client_id')
  if (!id) {
    id = randomUUID()
    setSetting('client_id', id)
  }
  return id
}

async function plexTv(path: string, options: { method?: string; token?: string } = {}): Promise<any> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Plex-Client-Identifier': clientId(),
    'X-Plex-Product': 'Blackbriar',
  }
  if (options.token) headers['X-Plex-Token'] = options.token
  const res = await reach('plex.tv', `https://plex.tv/api/v2${path}`, { method: options.method ?? 'GET', headers, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(t('{name} antwortet mit {status}', { name: 'plex.tv', status: res.status }))
  return res.json()
}

interface Account {
  id: number
  name: string
}

async function accountOf(token: string): Promise<Account> {
  const user = await plexTv('/user', { token })
  return { id: user.id, name: user.username || user.title || user.email || 'Plex-Benutzer' }
}

// Das Konto hinter dem eingetragenen Plex-Token; nur dieses darf sich anmelden
let owner: { token: string; account: Account } | undefined
async function ownerAccount(): Promise<Account> {
  if (owner?.token !== config.plexToken) owner = { token: config.plexToken, account: await accountOf(config.plexToken) }
  return owner.account
}

/** Die Plex-Server des Kontos mit ihren Adressen im Heimnetz, für die Auswahl bei der Einrichtung. */
async function ownedServers(token: string): Promise<{ name: string; uri: string }[]> {
  const resources = (await plexTv('/resources?includeHttps=1', { token })) as any[]
  return resources
    .filter((r) => r.owned && String(r.provides ?? '').includes('server'))
    .flatMap((r) =>
      (r.connections ?? [])
        .filter((c: any) => c.local && !c.relay)
        .map((c: any) => ({ name: r.name as string, uri: `http://${c.address}:${c.port}` })),
    )
}

// --- Sitzungen -------------------------------------------------------------

// In der Datenbank liegt nur der Hash; wer sie liest, kann damit keine Sitzung übernehmen
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

function cookie(req: FastifyRequest, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return undefined
}

function setCookie(req: FastifyRequest, reply: FastifyReply, name: string, value: string, maxAge: number): void {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''
  reply.header('set-cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`)
}

function sessionOf(req: FastifyRequest): Account | null {
  const token = cookie(req, SESSION_COOKIE)
  if (!token) return null
  const row = db.prepare('SELECT plex_id, name FROM sessions WHERE id = ? AND expires_at > ?').get(hash(token), now())
  return row ? { id: row.plex_id as number, name: row.name as string } : null
}

function startSession(req: FastifyRequest, reply: FastifyReply, account: Account): void {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now())
  const token = randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (id, plex_id, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run(
    hash(token),
    account.id,
    account.name,
    now(),
    now() + SESSION_SECONDS,
  )
  setCookie(req, reply, SESSION_COOKIE, token, SESSION_SECONDS)
}

// --- Eigenes Konto ----------------------------------------------------------

// Neben der Plex-Anmeldung gibt es ein Konto mit Benutzername und Passwort. Es gehört dem Besitzer;
// in den Sitzungen steht es mit der Kennung 0, die bei Plex nicht vorkommt.
const ACCOUNT_ID = 0
const MIN_PASSWORD = 10
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, length: number) => Promise<Buffer>

const accountName = () => getSetting('account_name') ?? null

/** Die Installation gehört jemandem, sobald ein Plex-Konto verbunden oder ein eigenes Konto angelegt ist. */
const owned = () => Boolean(config.plexToken || accountName())

async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(16)
  return `scrypt:${salt.toString('hex')}:${(await scryptAsync(password, salt, 64)).toString('hex')}`
}

async function samePassword(password: string, stored: string): Promise<boolean> {
  const [, salt, key] = stored.split(':')
  if (!salt || !key) return false
  const given = await scryptAsync(password, Buffer.from(salt, 'hex'), 64)
  const wanted = Buffer.from(key, 'hex')
  return given.length === wanted.length && timingSafeEqual(given, wanted)
}

/** Prüft Name und Passwort für ein neues Konto; liefert die Fehlermeldung oder null. */
function accountProblem(name: string, password: string): string | null {
  if (!name) return t('Bitte einen Benutzernamen eingeben.')
  if (name.length > 64) return t('Der Benutzername ist zu lang.')
  if (password.length < MIN_PASSWORD) return t('Das Passwort braucht mindestens {n} Zeichen.', { n: MIN_PASSWORD })
  if (password.toLowerCase().includes(name.toLowerCase())) return t('Das Passwort darf den Benutzernamen nicht enthalten.')
  return null
}

async function saveAccount(name: string, password: string): Promise<void> {
  setSetting('account_password', await passwordHash(password))
  setSetting('account_name', name)
}

function readCredentials(req: FastifyRequest): { name: string; password: string } {
  const body = (req.body ?? {}) as { name?: unknown; password?: unknown }
  return { name: String(body.name ?? '').trim(), password: String(body.password ?? '') }
}

/** Beendet alle Sitzungen außer der, mit der die Anfrage kommt; liefert, wie viele es waren. */
function endOtherSessions(req: FastifyRequest): number {
  const token = cookie(req, SESSION_COOKIE)
  return Number(db.prepare('DELETE FROM sessions WHERE id != ?').run(token ? hash(token) : '').changes)
}

/**
 * AUTH_RESET=1 beim Start: Konto mit Passwort und alle Sitzungen löschen, etwa bei vergessenem Passwort.
 * Plex bleibt verbunden; ohne Plex gibt es danach einen neuen Einrichtungscode.
 */
export function resetAuthFromEnv(): boolean {
  if ((process.env.AUTH_RESET ?? '').trim() !== '1') return false
  db.prepare("DELETE FROM settings WHERE key IN ('account_name', 'account_password')").run()
  db.prepare('DELETE FROM sessions').run()
  return true
}

// Falsche Passwörter beim Anmelden; gleiche Grenze wie beim Einrichtungscode
let wrongPasswords: number[] = []

// --- Anmeldung über Plex ----------------------------------------------------

// Laufende Anmeldungen. Der Code bleibt auf dem Server; der Browser bekommt nur ein Cookie,
// das beweist, dass er die Anmeldung selbst begonnen hat.
// setup: Die Anmeldung wurde mit gültigem Einrichtungscode begonnen
// connect: Kein Anmelden, sondern Plex mit einer Installation verbinden, die mit eigenem Konto eingerichtet wurde
const pins = new Map<number, { code: string; nonce: string; expires: number; setup: boolean; connect: boolean }>()

/** Legt bei plex.tv eine Anmeldung an und liefert die Adresse, auf der der Benutzer sie bestätigt. */
async function startPin(req: FastifyRequest, reply: FastifyReply, flags: { setup: boolean; connect: boolean }): Promise<string> {
  const pin = await plexTv('/pins?strong=true', { method: 'POST' })
  const nonce = randomBytes(24).toString('hex')
  for (const [id, p] of pins) if (p.expires < now()) pins.delete(id)
  pins.set(pin.id, { code: pin.code, nonce: hash(nonce), expires: now() + PIN_SECONDS, ...flags })
  setCookie(req, reply, PIN_COOKIE, nonce, PIN_SECONDS)

  // Plex schickt den Browser nach der Bestätigung hierher zurück
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http'
  const params = new URLSearchParams({
    clientID: clientId(),
    code: pin.code,
    forwardUrl: `${proto}://${req.headers.host}/?pin=${pin.id}`,
    'context[device][product]': 'Blackbriar',
  })
  return `https://app.plex.tv/auth#?${params}`
}

// --- Einrichtungscode --------------------------------------------------------

// Ohne leicht verwechselbare Zeichen (0/O, 1/I)
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const CODE_WINDOW = 600
const CODE_TRIES = 10
let wrongCodes: number[] = []

/**
 * Solange die Installation niemandem gehört, braucht die erste Anmeldung diesen Code. Er steht im Protokoll des Containers;
 * so kann nur einrichten, wer an den Server herankommt, und nicht, wer zufällig zuerst die Adresse findet.
 */
export function setupCode(): string | null {
  if (!authEnabled() || owned()) return null
  let code = getSetting('setup_code')
  if (!code) {
    code = [...randomBytes(8)].map((b, i) => CODE_CHARS[b % CODE_CHARS.length] + (i === 3 ? '-' : '')).join('')
    setSetting('setup_code', code)
  }
  return code
}

const plain = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')
function sameCode(given: string, wanted: string): boolean {
  const a = Buffer.from(hash(plain(given)))
  const b = Buffer.from(hash(plain(wanted)))
  return timingSafeEqual(a, b)
}

// `/api/public/` sind die Seiten hinter den Links in den Mails; sie prüfen ihren eigenen, unterschriebenen Schlüssel
const PUBLIC = ['/api/auth/', '/api/webhook/', '/api/public/']

export function registerAuth(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    if (!authEnabled() || !req.url.startsWith('/api/') || PUBLIC.some((p) => req.url.startsWith(p))) return
    if (!sessionOf(req)) return reply.code(401).send({ error: t('Nicht angemeldet') })
  })

  app.get('/api/auth/me', (req) => {
    // Frische Installation: Sprache und Land des ersten Browsers werden übernommen; ändern lässt sich beides in den Einstellungen
    if (getSetting('language') == null) {
      const browser = String(req.headers['accept-language'] ?? '')
      setSetting('language', /^\s*de\b/i.test(browser) ? 'de' : 'en')
      if (getSetting('upcoming_region') == null) setSetting('upcoming_region', regionFromBrowser(browser))
    }
    const user = authEnabled() ? sessionOf(req) : null
    return {
      required: authEnabled(),
      authenticated: !authEnabled() || user != null,
      user: user?.name ?? null,
      // Ohne Plex-Konto und ohne eigenes Konto gehört die Installation noch niemandem: Die erste Anmeldung richtet sie ein
      setup: !owned(),
      // Welche Wege die Anmeldeseite anbietet
      account: accountName() != null,
      plex: Boolean(config.plexToken),
      // Für die Einstellungen; vor der Anmeldung bleibt der Name verborgen
      accountName: user || !authEnabled() ? accountName() : null,
      // Die Anmeldeseite braucht die Sprache, bevor irgendetwas anderes geladen ist
      language: getSettings().language,
    }
  })

  app.post('/api/auth/plex/start', async (req, reply) => {
    // Mit eigenem Konto, aber ohne Plex: Ein Plex-Konto darf sich hier nicht zum Besitzer machen
    if (authEnabled() && owned() && !config.plexToken) return reply.code(403).send({ error: t('Hier ist noch kein Plex-Konto verbunden. Melde dich mit Benutzername und Passwort an.') })
    const wanted = setupCode()
    if (wanted) {
      wrongCodes = wrongCodes.filter((at) => at > now() - CODE_WINDOW)
      if (wrongCodes.length >= CODE_TRIES) return reply.code(429).send({ error: t('Zu viele falsche Versuche. Bitte in zehn Minuten noch einmal.') })
      if (!sameCode(String((req.body as { code?: unknown } | null)?.code ?? ''), wanted)) {
        wrongCodes.push(now())
        return reply.code(403).send({ error: t('Der Einrichtungscode stimmt nicht. Er steht im Protokoll des Containers.') })
      }
    }
    try {
      return { url: await startPin(req, reply, { setup: Boolean(wanted), connect: false }) }
    } catch (err) {
      return reply.code(502).send({ error: t('Anmeldung bei Plex nicht möglich: {detail}', { detail: (err as Error).message }) })
    }
  })

  app.post('/api/auth/plex/check', async (req, reply) => {
    const id = Number((req.body as { id?: unknown } | null)?.id)
    const pending = pins.get(id)
    const nonce = cookie(req, PIN_COOKIE)
    if (!pending || pending.expires < now() || !nonce || hash(nonce) !== pending.nonce) {
      return reply.code(400).send({ error: t('Diese Anmeldung ist abgelaufen. Bitte noch einmal starten.') })
    }
    try {
      const token: string | null = (await plexTv(`/pins/${id}?code=${encodeURIComponent(pending.code)}`)).authToken
      if (!token) return { status: 'pending' }
      pins.delete(id)
      const account = await accountOf(token)

      if (pending.connect) {
        // Verbinden aus den Einstellungen: nur angemeldet und nur, solange noch kein Plex-Konto eingetragen ist
        if (authEnabled() && !sessionOf(req)) return reply.code(401).send({ error: t('Nicht angemeldet') })
        if (config.plexToken) return reply.code(409).send({ error: t('Hier ist schon ein Plex-Konto verbunden.') })
        saveConnection('plexToken', token)
        resyncAll()
        logEvent('auth', t('Plex-Konto {name} verbunden', { name: account.name }))
        return { status: 'ok', user: account.name, setup: true }
      }

      const setup = !owned()
      if (!setup && !config.plexToken) {
        return reply.code(403).send({ error: t('Hier ist noch kein Plex-Konto verbunden. Melde dich mit Benutzername und Passwort an.') })
      }
      if (setup) {
        // Erste Anmeldung auf einer frischen Installation: Dieses Konto wird der Besitzer.
        // Sie zählt nur, wenn sie mit dem Einrichtungscode begonnen wurde.
        if (!pending.setup) return reply.code(403).send({ error: t('Der Einrichtungscode stimmt nicht. Er steht im Protokoll des Containers.') })
        saveConnection('plexToken', token)
        db.prepare("DELETE FROM settings WHERE key = 'setup_code'").run()
        resyncAll()
      } else if (account.id !== (await ownerAccount()).id) {
        logEvent('auth', t('Anmeldung von {name} abgelehnt: nicht der Besitzer des Servers', { name: account.name }), 'warn')
        return reply.code(403).send({ error: t('Nur der Besitzer des Plex-Servers darf sich anmelden, nicht {name}.', { name: account.name }) })
      }
      startSession(req, reply, account)
      logEvent('auth', t('{name} hat sich angemeldet', { name: account.name }))
      return { status: 'ok', user: account.name, setup }
    } catch (err) {
      return reply.code(502).send({ error: t('Anmeldung bei Plex nicht möglich: {detail}', { detail: (err as Error).message }) })
    }
  })

  // Frische Installation: eigenes Konto statt Plex-Anmeldung, ebenfalls nur mit dem Einrichtungscode
  app.post('/api/auth/account/setup', async (req, reply) => {
    if (!authEnabled() || owned()) return reply.code(409).send({ error: t('Diese Installation ist schon eingerichtet.') })
    const wanted = setupCode()!
    wrongCodes = wrongCodes.filter((at) => at > now() - CODE_WINDOW)
    if (wrongCodes.length >= CODE_TRIES) return reply.code(429).send({ error: t('Zu viele falsche Versuche. Bitte in zehn Minuten noch einmal.') })
    if (!sameCode(String((req.body as { code?: unknown } | null)?.code ?? ''), wanted)) {
      wrongCodes.push(now())
      return reply.code(403).send({ error: t('Der Einrichtungscode stimmt nicht. Er steht im Protokoll des Containers.') })
    }
    const { name, password } = readCredentials(req)
    const problem = accountProblem(name, password)
    if (problem) return reply.code(400).send({ error: problem })
    await saveAccount(name, password)
    db.prepare("DELETE FROM settings WHERE key = 'setup_code'").run()
    startSession(req, reply, { id: ACCOUNT_ID, name })
    logEvent('auth', t('Konto {name} angelegt', { name }))
    return { status: 'ok', user: name, setup: true }
  })

  app.post('/api/auth/account/login', async (req, reply) => {
    const stored = getSetting('account_password')
    const wantedName = accountName()
    if (!stored || !wantedName) return reply.code(404).send({ error: t('Es gibt kein Konto mit Passwort. Melde dich mit Plex an.') })
    wrongPasswords = wrongPasswords.filter((at) => at > now() - CODE_WINDOW)
    if (wrongPasswords.length >= CODE_TRIES) return reply.code(429).send({ error: t('Zu viele falsche Versuche. Bitte in zehn Minuten noch einmal.') })
    const { name, password } = readCredentials(req)
    // Das Passwort wird immer geprüft, damit die Antwortzeit nicht verrät, ob der Name stimmt
    const right = (await samePassword(password, stored)) && name.toLowerCase() === wantedName.toLowerCase()
    if (!right) {
      wrongPasswords.push(now())
      logEvent('auth', t('Anmeldung mit falschem Passwort'), 'warn')
      return reply.code(403).send({ error: t('Benutzername oder Passwort stimmt nicht.') })
    }
    startSession(req, reply, { id: ACCOUNT_ID, name: wantedName })
    logEvent('auth', t('{name} hat sich angemeldet', { name: wantedName }))
    return { status: 'ok', user: wantedName }
  })

  app.post('/api/auth/logout', (req, reply) => {
    const token = cookie(req, SESSION_COOKIE)
    if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(hash(token))
    if (token) logEvent('auth', t('Abgemeldet'))
    setCookie(req, reply, SESSION_COOKIE, '', 0)
    return reply.code(204).send()
  })

  // Wer bisher nur über Plex hineinkommt, kann hier ein Konto mit Passwort dazunehmen (liegt hinter der Anmeldung)
  app.post('/api/account', async (req, reply) => {
    if (accountName()) return reply.code(409).send({ error: t('Es gibt schon ein Konto mit Passwort.') })
    const { name, password } = readCredentials(req)
    const problem = accountProblem(name, password)
    if (problem) return reply.code(400).send({ error: problem })
    await saveAccount(name, password)
    logEvent('auth', t('Konto {name} angelegt', { name }))
    return reply.code(204).send()
  })

  // Mit eigenem Konto eingerichtet: Plex nachträglich verbinden. Das Konto, das hier bestätigt, wird der Besitzer.
  app.post('/api/plex/connect', async (req, reply) => {
    if (config.plexToken) return reply.code(409).send({ error: t('Hier ist schon ein Plex-Konto verbunden.') })
    try {
      return { url: await startPin(req, reply, { setup: false, connect: true }) }
    } catch (err) {
      return reply.code(502).send({ error: t('Anmeldung bei Plex nicht möglich: {detail}', { detail: (err as Error).message }) })
    }
  })

  app.post('/api/account/password', async (req, reply) => {
    const stored = getSetting('account_password')
    const name = accountName()
    if (!stored || !name) return reply.code(404).send({ error: t('Es gibt noch kein Konto mit Passwort.') })
    wrongPasswords = wrongPasswords.filter((at) => at > now() - CODE_WINDOW)
    if (wrongPasswords.length >= CODE_TRIES) return reply.code(429).send({ error: t('Zu viele falsche Versuche. Bitte in zehn Minuten noch einmal.') })
    const body = (req.body ?? {}) as { current?: unknown; password?: unknown }
    if (!(await samePassword(String(body.current ?? ''), stored))) {
      wrongPasswords.push(now())
      return reply.code(403).send({ error: t('Das bisherige Passwort stimmt nicht.') })
    }
    const password = String(body.password ?? '')
    const problem = accountProblem(name, password)
    if (problem) return reply.code(400).send({ error: problem })
    await saveAccount(name, password)
    // Wer das alte Passwort kannte, soll mit seiner Sitzung nicht drinbleiben
    endOtherSessions(req)
    logEvent('auth', t('Passwort geändert'))
    return reply.code(204).send()
  })

  app.post('/api/account/logout-others', (req) => {
    const ended = endOtherSessions(req)
    logEvent('auth', t('Auf {n} anderen Geräten abgemeldet', { n: ended }))
    return { ended }
  })

  app.get('/api/plex/servers', async (_req, reply) => {
    if (!config.plexToken) return []
    try {
      return await ownedServers(config.plexToken)
    } catch (err) {
      return reply.code(502).send({ error: (err as Error).message })
    }
  })
}

/** Name des angemeldeten Benutzers, fürs Protokoll. */
export function currentUser(req: FastifyRequest): string {
  return sessionOf(req)?.name ?? 'ohne Anmeldung'
}

/** Schlüssel, der in der Webhook-Adresse stehen muss, damit nicht jeder im Netz Abgleiche auslösen kann. */
export function webhookKey(): string {
  let key = getSetting('webhook_key')
  if (!key) {
    key = randomBytes(16).toString('hex')
    setSetting('webhook_key', key)
  }
  return key
}
