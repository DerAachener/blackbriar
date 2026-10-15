import { db, now } from './db.ts'

// Das Protokoll: was Blackbriar wann getan hat. Es sammelt an einer Stelle, was sonst über mehrere
// Ansichten verstreut wäre oder gar nicht festgehalten würde.

export type EventKind = 'sync' | 'mail' | 'telegram' | 'delete' | 'backup' | 'auth' | 'settings'
export type EventLevel = 'info' | 'warn' | 'error'

db.exec(`CREATE TABLE IF NOT EXISTS events (
  id    INTEGER PRIMARY KEY AUTOINCREMENT,
  at    INTEGER NOT NULL,
  kind  TEXT NOT NULL,
  level TEXT NOT NULL,
  text  TEXT NOT NULL
)`)
db.exec('CREATE INDEX IF NOT EXISTS events_kind ON events (kind, id)')

// Länger zurück schaut niemand; die Tabelle soll nicht endlos wachsen
const KEEP_DAYS = 90
let lastPurge = 0

/** Hält ein Ereignis fest. Scheitert das, läuft alles andere trotzdem weiter. */
export function logEvent(kind: EventKind, text: string, level: EventLevel = 'info'): void {
  try {
    db.prepare('INSERT INTO events (at, kind, level, text) VALUES (?, ?, ?, ?)').run(now(), kind, level, text.slice(0, 1000))
    if (now() - lastPurge > 86400) {
      lastPurge = now()
      db.prepare('DELETE FROM events WHERE at < ?').run(now() - KEEP_DAYS * 86400)
    }
  } catch (err) {
    console.error('Protokoll nicht geschrieben:', (err as Error).message)
  }
}

export function events(options: { kind?: string; level?: string; limit: number; offset: number }): { total: number; items: Record<string, unknown>[] } {
  const where: string[] = []
  const args: (string | number)[] = []
  if (options.kind) {
    where.push('kind = ?')
    args.push(options.kind)
  }
  if (options.level === 'problems') where.push("level <> 'info'")
  const filter = where.length ? `WHERE ${where.join(' AND ')}` : ''
  return {
    total: Number(db.prepare(`SELECT COUNT(*) AS n FROM events ${filter}`).get(...args)?.n ?? 0),
    items: db.prepare(`SELECT id, at, kind, level, text FROM events ${filter} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, options.limit, options.offset),
  }
}
