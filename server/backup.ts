import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { config } from './config.ts'
import { db } from './db.ts'
import { logEvent } from './events.ts'
import { t } from './i18n.ts'

// Einmal am Tag eine Kopie der Datenbank. Sie enthält den ganzen Verlauf und alle Einstellungen;
// ohne Sicherung wäre nach einem Defekt alles weg.

const DIR = join(config.dataDir, 'backup')
const KEEP = 7
const NAME = /^blackbriar-(\d{4}-\d{2}-\d{2})\.db$/

const today = () => new Date().toLocaleDateString('sv-SE')
const backups = () => (existsSync(DIR) ? readdirSync(DIR).filter((f) => NAME.test(f)).sort() : [])

/** Legt die heutige Sicherung an, falls es noch keine gibt, und räumt alte weg. */
export function maybeBackup(): void {
  const file = join(DIR, `blackbriar-${today()}.db`)
  if (existsSync(file)) return
  try {
    mkdirSync(DIR, { recursive: true })
    // VACUUM INTO schreibt eine in sich stimmige Kopie, auch während die Datenbank benutzt wird
    db.exec(`VACUUM INTO '${file.replaceAll("'", "''")}'`)
    for (const old of backups().slice(0, -KEEP)) rmSync(join(DIR, old), { force: true })
    logEvent('backup', t('Sicherung der Datenbank angelegt'))
  } catch (err) {
    console.error(t('Sicherung der Datenbank gescheitert:'), (err as Error).message)
    logEvent('backup', t('Sicherung der Datenbank gescheitert: {error}', { error: (err as Error).message }), 'error')
    rmSync(file, { force: true })
  }
}

/** Für die Statusseite: wie viele Sicherungen es gibt, von wann die neueste ist und wie groß. */
export function backupStatus(): { count: number; latest: string | null; size: number } {
  const files = backups()
  const latest = files.at(-1)
  return { count: files.length, latest: latest ? NAME.exec(latest)![1]! : null, size: latest ? statSync(join(DIR, latest)).size : 0 }
}
