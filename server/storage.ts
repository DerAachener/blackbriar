import { configuredArrInstances, getArrDisks } from './arr.ts'
import { db, getSetting, now, setSetting } from './db.ts'

// Wie voll die Platten mit den Medien sind. Plex verrät das nicht; Radarr und Sonarr kennen aber den freien
// Platz ihrer Stammordner. Ein täglicher Messwert zeigt mit der Zeit, wie schnell der Platz schwindet.

db.exec(`CREATE TABLE IF NOT EXISTS disk_history (
  day   TEXT NOT NULL,
  disk  TEXT NOT NULL,
  free  INTEGER NOT NULL,
  total INTEGER,
  PRIMARY KEY (day, disk)
)`)

export interface Disk {
  /** Die Stammordner, die auf dieser Platte liegen */
  folders: string[]
  free: number
  /** Gesamtgröße; null, wenn keine Instanz sie nennt */
  total: number | null
}

const sameSize = (a: number, b: number) => Math.abs(a - b) <= Math.max(a, b) * 0.001

/** Fragt alle verbundenen Instanzen und fasst zusammen, was dieselbe Platte ist. */
export async function refreshStorage(): Promise<void> {
  const disks: Disk[] = []
  for (const instance of configuredArrInstances()) {
    const info = await getArrDisks(instance).catch(() => null)
    if (!info) continue
    for (const root of info.roots) {
      // Die Platte eines Stammordners ist die mit dem längsten passenden Pfad; „/“ zählt nur, wenn sonst nichts passt
      const mount = info.disks
        .filter((d) => d.path && (root.path === d.path || root.path.startsWith(d.path.replace(/[\\/]$/, '') + '/') || root.path.startsWith(d.path.replace(/[\\/]$/, '') + '\\')))
        .sort((a, b) => b.path.length - a.path.length)[0]
      const total = mount && sameSize(mount.free, root.free) ? mount.total : null
      // Dieselbe Platte erscheint in mehreren Instanzen und Ordnern; erkennbar am gleichen freien Platz
      const known = disks.find((d) => sameSize(d.free, root.free))
      if (known) {
        if (!known.folders.includes(root.path)) known.folders.push(root.path)
        known.total ??= total
      } else disks.push({ folders: [root.path], free: root.free, total })
    }
  }
  if (!disks.length) return
  setSetting('storage', JSON.stringify({ at: now(), disks }))
  const day = new Date().toLocaleDateString('sv-SE')
  const upsert = db.prepare(
    'INSERT INTO disk_history (day, disk, free, total) VALUES (?, ?, ?, ?) ON CONFLICT(day, disk) DO UPDATE SET free = excluded.free, total = excluded.total',
  )
  // Der erste Ordner dient als Name der Platte; er bleibt gleich, solange die Ordner gleich bleiben
  for (const d of disks) upsert.run(day, [...d.folders].sort()[0]!, d.free, d.total)
}

export interface Storage {
  at: number | null
  disks: (Disk & {
    /** Verbrauch pro Tag laut den Messwerten; null, solange es dafür zu wenige gibt */
    perDay: number | null
    /** Über wie viele Tage gemessen wurde */
    measuredDays: number
  })[]
  /** Größe aller Dateien, die Plex kennt */
  library: number
  /** Was in den letzten 30 Tagen dazugekommen ist, ohne Abzug von Gelöschtem */
  added30: number
}

// Unter einer Woche schwanken die Messwerte zu stark für eine Aussage
const MIN_DAYS = 7

export function storage(): Storage {
  let saved: { at: number; disks: Disk[] } | null = null
  try {
    saved = JSON.parse(getSetting('storage') ?? 'null')
  } catch {
    // unlesbarer Stand: wie ohne Messung
  }
  const first = db.prepare('SELECT day, free FROM disk_history WHERE disk = ? ORDER BY day LIMIT 1')
  const disks = (saved?.disks ?? []).map((d) => {
    const start = first.get([...d.folders].sort()[0]!)
    const days = start ? Math.round((Date.now() - Date.parse(`${start.day}T12:00:00`)) / 86400_000) : 0
    return { ...d, measuredDays: days, perDay: start && days >= MIN_DAYS ? (Number(start.free) - d.free) / days : null }
  })
  return {
    at: saved?.at ?? null,
    disks,
    library: Number(db.prepare('SELECT COALESCE(SUM(size), 0) AS s FROM media_files').get()?.s ?? 0),
    added30: Number(db.prepare('SELECT COALESCE(SUM(size), 0) AS s FROM media_files WHERE added_at > ?').get(now() - 30 * 86400)?.s ?? 0),
  }
}
