import { existsSync } from 'node:fs'
import { join } from 'node:path'
import Fastify from 'fastify'
import fastifyStatic from '@fastify/static'
import { authEnabled, registerAuth, resetAuthFromEnv, setupCode } from './auth.ts'
import { config, plexConfigured, telegramConfigured } from './config.ts'
import { registerRoutes } from './routes.ts'
import { registerSecurity } from './security.ts'
import { pollSessions } from './sessions.ts'
import { runCycle } from './sync.ts'
import { maybeSendWeekly } from './weekly.ts'
import { registerMailRoutes } from './mailroutes.ts'
import { maybeSendNewsletters } from './newsletter.ts'
import { maybeSendReminders } from './reminder.ts'
import { maybeSendWishMails } from './wish.ts'
import { maybeBackup } from './backup.ts'
import { t } from './i18n.ts'

const app = Fastify({ logger: { level: 'warn' }, bodyLimit: 10 * 1024 * 1024 })

// Plex-Webhooks kommen als multipart/form-data (teils mit Poster). Gebraucht wird nur die Art des Ereignisses;
// sie steht im ersten Teil, deshalb reicht der Anfang der Nachricht.
app.addContentTypeParser('multipart/form-data', (_req, payload, done) => {
  let head = ''
  payload.on('data', (chunk: Buffer) => {
    if (head.length < 65536) head += chunk.toString('latin1')
  })
  payload.on('end', () => done(null, { event: /"event"\s*:\s*"([a-z.]+)"/.exec(head)?.[1] ?? null }))
  payload.on('error', done)
})

// Vor allem anderen, damit keine alte Sitzung mehr gilt
const authReset = resetAuthFromEnv()
registerSecurity(app)
registerAuth(app)
registerRoutes(app)
registerMailRoutes(app)

const webRoot = join(import.meta.dirname, '..', 'web', 'dist')
if (existsSync(webRoot)) {
  await app.register(fastifyStatic, { root: webRoot })
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: t('Nicht gefunden') })
    return reply.sendFile('index.html')
  })
}

await app.listen({ port: config.port, host: '0.0.0.0' })
console.log(t('Blackbriar läuft auf Port {port}', { port: config.port }))
if (!plexConfigured()) console.warn(t('Plex ist nicht eingerichtet: Es werden keine Daten abgerufen. Die Verbindung lässt sich in der Oberfläche eintragen.'))
if (!authEnabled()) console.warn(t('AUTH=off: Die Oberfläche ist ohne Anmeldung erreichbar.'))
// Die Sprache steht beim ersten Start noch nicht fest, deshalb zweisprachig
if (authReset) {
  console.warn(t('AUTH_RESET=1: Das Konto mit Passwort und alle Anmeldungen sind gelöscht. Nimm die Variable wieder heraus, sonst passiert das bei jedem Start.'))
  if (config.plexToken) console.warn(t('Melde dich mit Plex an. Ein neues Passwort legst du unter Einstellungen → Allgemein an.'))
}
const firstCode = setupCode()
if (firstCode) {
  console.log('')
  console.log(`  Einrichtungscode / Setup code:  ${firstCode}`)
  console.log('  Die erste Anmeldung fragt danach. / The first sign-in asks for it.')
  console.log('')
}
if (!telegramConfigured()) console.warn(t('Telegram ist nicht eingerichtet: Es werden keine Nachrichten verschickt.'))

void pollSessions()
setInterval(() => void pollSessions(), config.sessionsIntervalSec * 1000)
void runCycle()
setInterval(() => void runCycle(), config.syncIntervalSec * 1000)
setInterval(() => void maybeSendWeekly(), 60_000)
// Erst die Newsletter, dann die Erinnerungen: Was der Newsletter schon mitgenommen hat, kommt nicht noch einmal
setInterval(() => void maybeSendNewsletters().then(maybeSendReminders), 60_000)
setInterval(() => void maybeSendWishMails(), 60_000)
// Tägliche Sicherung: kurz nach dem Start und danach stündlich prüfen, ob die heutige schon da ist
setTimeout(maybeBackup, 30_000)
setInterval(maybeBackup, 3600_000)
