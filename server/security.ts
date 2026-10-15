import type { FastifyInstance, FastifyRequest } from 'fastify'
import { t } from './i18n.ts'

// Was der Browser laden darf: alles von Blackbriar selbst, dazu Bilder von außen (Poster von TMDB in den Mail-Vorschauen).
// Inline-Stile brauchen die Mails und die Seiten hinter den Mail-Links.
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

const WRITES = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Ob die Anfrage laut Origin-Kopfzeile von derselben Adresse kommt, unter der Blackbriar gerade aufgerufen wird. */
function sameHost(origin: string, req: FastifyRequest): boolean {
  try {
    const host = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '').split(',')[0]!.trim()
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/**
 * Schutz, der für jede Anfrage gilt: Sicherheits-Kopfzeilen, und schreibende Anfragen nur von Blackbriar selbst.
 * Ohne die Prüfung könnte eine fremde Seite, die man in einem anderen Tab öffnet, im Hintergrund etwas an Blackbriar
 * schicken, solange man angemeldet ist, etwa einen Löschauftrag. Das gilt auch für Seiten auf derselben Domain,
 * zum Beispiel eine andere App unter einer Nachbar-Subdomain.
 */
export function registerSecurity(app: FastifyInstance): void {
  app.addHook('onRequest', async (req, reply) => {
    reply.header('Content-Security-Policy', CSP)
    reply.header('X-Frame-Options', 'DENY')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'same-origin')

    // Webhooks kommen von Plex, Radarr und Sonarr, nicht aus einem Browser
    if (!WRITES.has(req.method) || !req.url.startsWith('/api/') || req.url.startsWith('/api/webhook/')) return
    // Moderne Browser sagen selbst, woher eine Anfrage kommt; das lässt sich von einer Webseite aus nicht fälschen
    const site = req.headers['sec-fetch-site']
    if (site === 'same-origin' || site === 'none') return
    if (site == null) {
      // Ältere Browser: Origin vergleichen. Ganz ohne Origin kommt die Anfrage nicht aus einer fremden Seite (curl, Skripte)
      const origin = req.headers.origin
      if (!origin || sameHost(origin, req)) return
    }
    return reply.code(403).send({ error: t('Anfrage von einer fremden Seite abgelehnt.') })
  })
}
