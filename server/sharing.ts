import { db, sortBySection } from './db.ts'
import { logEvent } from './events.ts'
import { t } from './i18n.ts'
import { getMachineId, plexTvRequest, xmlAttrs } from './plex.ts'

// Freigaben der Mediatheken für die Benutzer, über plex.tv – derselbe Weg, den die Plex-Weboberfläche nimmt.
// Geändert werden nur die Mediatheken; Downloads, Altersfilter und alles andere an einer Freigabe bleiben, wie sie sind.

export interface SharingSection {
  /** Kennung der Mediathek bei plex.tv (nicht die Nummer auf dem Server) */
  id: number
  title: string
}

export interface SharingUser {
  userId: number
  name: string
  /** Plex gibt dem Benutzer automatisch alle, auch künftige Mediatheken */
  allLibraries: boolean
  sectionIds: number[]
}

interface Share extends SharingUser {
  /** Kennung der Freigabe bei plex.tv */
  shareId: number
}

async function read(): Promise<{ machineId: string; sections: SharingSection[]; shares: Share[] }> {
  const machineId = await getMachineId()
  const server = await (await plexTvRequest(`https://plex.tv/api/servers/${machineId}`)).text()
  const sections = [...server.matchAll(/<Section\b([^>]*)>/g)].map((m) => {
    const a = xmlAttrs(m[1]!)
    return { id: Number(a.id), title: a.title ?? '' }
  })
  const xml = await (await plexTvRequest(`https://plex.tv/api/servers/${machineId}/shared_servers`)).text()
  const names = new Map(db.prepare('SELECT id, name FROM users').all().map((u) => [u.id as number, u.name as string]))
  const shares: Share[] = []
  for (const m of xml.matchAll(/<SharedServer\b([^>]*)>([\s\S]*?)<\/SharedServer>/g)) {
    const a = xmlAttrs(m[1]!)
    const userId = Number(a.userID)
    if (!userId) continue
    const shared = [...m[2]!.matchAll(/<Section\b([^>]*)\/?>/g)].map((s) => xmlAttrs(s[1]!)).filter((s) => s.shared === '1')
    shares.push({
      shareId: Number(a.id),
      userId,
      name: names.get(userId) ?? a.username ?? a.name ?? `Konto ${userId}`,
      allLibraries: a.allLibraries === '1',
      sectionIds: shared.map((s) => Number(s.id)),
    })
  }
  return { machineId, sections, shares }
}

/** Alle Mediatheken in der eigenen Reihenfolge und alle Benutzer mit ihren freigegebenen Mediatheken. */
export async function sharing(): Promise<{ sections: SharingSection[]; users: SharingUser[] }> {
  const { sections, shares } = await read()
  return {
    sections: sortBySection(sections, (s) => s.title),
    users: shares.map(({ shareId: _, ...u }) => u).sort((a, b) => a.name.localeCompare(b.name, 'de')),
  }
}

export interface SharingChange {
  userId: number
  sectionId: number
  shared: boolean
}

/**
 * Setzt die gewünschten Haken. Vorher wird der Stand frisch bei Plex gelesen, damit nur das Angeklickte sich ändert,
 * auch wenn inzwischen jemand in Plex selbst etwas umgestellt hat. Je Benutzer ein Aufruf mit seiner vollständigen Liste.
 */
export async function applySharing(changes: SharingChange[], who: string): Promise<string[]> {
  const { machineId, sections, shares } = await read()
  const title = new Map(sections.map((s) => [s.id, s.title]))
  const results: string[] = []
  for (const share of shares) {
    const mine = changes.filter((c) => c.userId === share.userId && title.has(c.sectionId))
    if (!mine.length) continue
    const next = new Set(share.sectionIds)
    for (const c of mine) c.shared ? next.add(c.sectionId) : next.delete(c.sectionId)
    const added = [...next].filter((id) => !share.sectionIds.includes(id))
    const removed = share.sectionIds.filter((id) => !next.has(id))
    if (!added.length && !removed.length) continue
    // Ganz ohne Mediathek wäre die Freigabe leer; das Entfernen eines Benutzers bleibt in Plex
    if (!next.size) {
      results.push(t('{name}: Mindestens eine Mediathek muss freigegeben bleiben.', { name: share.name }))
      continue
    }
    const res = await plexTvRequest(`https://plex.tv/api/servers/${machineId}/shared_servers/${share.shareId}`, {
      method: 'PUT',
      body: { server_id: machineId, shared_server: { library_section_ids: [...next] } },
    })
    if (!res.ok) {
      results.push(t('{name}: Plex hat die Änderung abgelehnt ({status}).', { name: share.name, status: res.status }))
      continue
    }
    // Damit Mails und Listen sofort stimmen, nicht erst nach dem nächsten Abgleich
    const add = db.prepare('INSERT OR IGNORE INTO user_sections (user_id, section) VALUES (?, ?)')
    const del = db.prepare('DELETE FROM user_sections WHERE user_id = ? AND section = ?')
    for (const id of added) add.run(share.userId, title.get(id)!)
    for (const id of removed) del.run(share.userId, title.get(id)!)
    const parts = [
      ...added.map((id) => `+ ${title.get(id)}`),
      ...removed.map((id) => `− ${title.get(id)}`),
    ]
    const line = `${share.name}: ${parts.join(', ')}`
    logEvent('settings', t('Freigaben geändert ({user}): {changes}', { user: who, changes: line }))
    results.push(line)
  }
  return results
}

