import { config } from './config.ts'
import { t } from './i18n.ts'
import { reach } from './net.ts'

const CLIENT_HEADERS = {
  'X-Plex-Client-Identifier': 'blackbriar',
  'X-Plex-Product': 'Blackbriar',
}

async function plexFetch(url: string, token: string, accept?: string): Promise<Response> {
  const headers: Record<string, string> = { ...CLIENT_HEADERS, 'X-Plex-Token': token }
  if (accept) headers.Accept = accept
  const res = await reach('Plex', url, { headers, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(t('{name} antwortet mit {status} auf {path}', { name: 'Plex', status: res.status, path: new URL(url).pathname }))
  return res
}

/** Anfrage an plex.tv mit dem Token des Besitzers. Ohne Methode ein GET, das bei einem Fehler wirft; bei PUT prüft der Aufrufer die Antwort. */
export async function plexTvRequest(url: string, options: { method?: string; body?: unknown } = {}): Promise<Response> {
  if (!options.method) return plexFetch(url, config.plexToken)
  return reach('plex.tv', url, {
    method: options.method,
    headers: { ...CLIENT_HEADERS, 'X-Plex-Token': config.plexToken, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(options.body),
    signal: AbortSignal.timeout(30_000),
  })
}

/** Anfrage an den Plex-Server; liefert den MediaContainer. */
export async function pms(path: string, token = config.plexToken): Promise<any> {
  const res = await plexFetch(config.plexUrl + path, token, 'application/json')
  return ((await res.json()) as any).MediaContainer ?? {}
}

/** Holt alle Einträge einer Liste seitenweise. */
export async function pmsPaged(path: string, token = config.plexToken, pageSize = 300): Promise<any[]> {
  const all: any[] = []
  const sep = path.includes('?') ? '&' : '?'
  for (let start = 0; ; ) {
    const mc = await pms(`${path}${sep}X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`, token)
    const items = mc.Metadata ?? []
    all.push(...items)
    start += items.length
    if (items.length === 0 || start >= (mc.totalSize ?? start)) return all
  }
}

export interface PlexUser {
  /** Konto-ID auf dem Server; der Besitzer hat dort immer die 1 */
  id: number
  /** Konto-ID bei plex.tv; 0, wenn unbekannt */
  plexId: number
  name: string
  isOwner: boolean
  token: string
  /** Adresse des Plex-Kontos; leer, wenn plex.tv keine nennt */
  email: string
}

export function xmlAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of tag.matchAll(/([\w:-]+)="([^"]*)"/g)) {
    attrs[m[1]!] = m[2]!
      .replaceAll('&quot;', '"')
      .replaceAll('&apos;', "'")
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&amp;', '&')
  }
  return attrs
}

let machineId = ''

let serverName = ''

/** Nach einem Wechsel des Servers oder Tokens neu ermitteln. */
export function resetPlexCache(): void {
  machineId = ''
  serverName = ''
}

/** Der Name, den der Besitzer seinem Plex-Server gegeben hat; leer, wenn Plex gerade nicht antwortet. */
export async function getServerName(): Promise<string> {
  if (!serverName) serverName = String((await pms('/').catch(() => ({}))).friendlyName ?? '')
  return serverName
}

/** Kennung des Servers bei Plex; steckt in jedem Link, der einen Titel in Plex öffnet. */
export async function getMachineId(): Promise<string> {
  if (!machineId) machineId = (await pms('/identity')).machineIdentifier
  return machineId
}

/**
 * Der Besitzer plus alle Benutzer, für die der Server freigegeben ist, jeweils mit
 * dem Token, das Plex für genau diesen Server ausstellt. Nur damit lassen sich die
 * Bewertungen der anderen lesen. Tokens bleiben im Speicher und landen nie in der DB.
 */
export async function getPlexUsers(): Promise<PlexUser[]> {
  if (!machineId) machineId = (await pms('/identity')).machineIdentifier

  let ownerName = 'Admin'
  let ownerPlexId = 0
  let ownerEmail = ''
  try {
    const res = await plexFetch('https://plex.tv/api/v2/user', config.plexToken, 'application/json')
    const me = (await res.json()) as { id?: number; username?: string; title?: string; email?: string }
    ownerName = me.username || me.title || ownerName
    ownerPlexId = me.id ?? 0
    ownerEmail = me.email ?? ''
  } catch {
    // Ohne diese Angaben fehlt nur der Name und die Zuordnung der eigenen Merkliste
  }
  const users: PlexUser[] = [{ id: 1, plexId: ownerPlexId, name: ownerName, isOwner: true, token: config.plexToken, email: ownerEmail }]

  const res = await plexFetch(`https://plex.tv/api/servers/${machineId}/shared_servers`, config.plexToken)
  const xml = await res.text()
  for (const m of xml.matchAll(/<SharedServer\b([^>]*)>/g)) {
    const a = xmlAttrs(m[1]!)
    if (!a.userID || !a.accessToken) continue
    users.push({ id: Number(a.userID), plexId: Number(a.userID), name: a.username || a.email || `Konto ${a.userID}`, isOwner: false, token: a.accessToken, email: a.email ?? '' })
  }
  return users
}

/** Löscht einen Eintrag samt Dateien. Plex erlaubt das nur, wenn „Löschen von Medien erlauben“ eingeschaltet ist. */
export async function plexDelete(path: string): Promise<void> {
  const res = await reach('Plex', config.plexUrl + path, {
    method: 'DELETE',
    headers: { ...CLIENT_HEADERS, 'X-Plex-Token': config.plexToken },
    signal: AbortSignal.timeout(60_000),
  })
  if (!res.ok) {
    throw new Error(
      t('Plex hat das Löschen abgelehnt ({status}). Ist in Plex unter Einstellungen → Bibliothek „Löschen von Medien erlauben“ eingeschaltet?', {
        status: res.status,
      }),
    )
  }
}

/** Prüft Server und Token; liefert Version und Kontoname. */
export async function testPlex(): Promise<string> {
  const identity = await pms('/identity')
  const res = await plexFetch('https://plex.tv/api/v2/user', config.plexToken, 'application/json')
  const me = (await res.json()) as { username?: string; title?: string }
  return `${identity.version ?? ''} als ${me.username || me.title || 'unbekannt'}`
}

const IMAGE_PATH =/^\/library\/metadata\/[\w/]+$/
export const isImagePath = (path: string) => IMAGE_PATH.test(path)

export async function plexImage(path: string, width: number, height: number): Promise<{ data: ArrayBuffer; type: string }> {
  if (!isImagePath(path)) throw new Error(t('Ungültiger Bildpfad'))
  const url = `${config.plexUrl}/photo/:/transcode?width=${width}&height=${height}&minSize=1&upscale=1&url=${encodeURIComponent(path)}`
  const res = await plexFetch(url, config.plexToken)
  return { data: await res.arrayBuffer(), type: res.headers.get('content-type') ?? 'image/jpeg' }
}
