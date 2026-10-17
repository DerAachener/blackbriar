import { readFileSync, statSync } from 'node:fs'
import { appVersion } from './config.ts'
import { getSetting, getSettings, installedAt, now, setSetting } from './db.ts'

// „Was ist neu“: liest den Änderungsverlauf, der mit im Image liegt, in der eingestellten Sprache.
// Gesehen ist eine Fassung für die ganze Installation, nicht je Gerät.

export interface ChangelogSection {
  /** z. B. bb.1.3.0 */
  version: string
  date: string
  items: string[]
}

const cache = new Map<string, { mtime: number; sections: ChangelogSection[] }>()

function read(language: 'de' | 'en'): ChangelogSection[] {
  const file = new URL(language === 'de' ? '../CHANGELOG.de.md' : '../CHANGELOG.md', import.meta.url)
  let mtime: number
  try {
    mtime = statSync(file).mtimeMs
  } catch {
    // Fehlt die deutsche Fassung, dann wenigstens die englische
    return language === 'de' ? read('en') : []
  }
  const hit = cache.get(language)
  if (hit?.mtime === mtime) return hit.sections
  const sections: ChangelogSection[] = []
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const head = /^## (bb\.\d+\.\d+\.\d+) – (.+)$/.exec(line)
    if (head) sections.push({ version: head[1]!, date: head[2]!.trim(), items: [] })
    else if (line.startsWith('- ') && sections.length) sections.at(-1)!.items.push(line.slice(2).trim())
  }
  cache.set(language, { mtime, sections })
  return sections
}

/** Vergleicht bb.1.2.3 mit bb.1.10.0; kleiner als 0 heißt: a ist älter. */
const compare = (a: string, b: string) => {
  const pa = a.replace(/^bb\./, '').split('.').map(Number)
  const pb = b.replace(/^bb\./, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

export function changelog(): ChangelogSection[] {
  return read(getSettings().language === 'de' ? 'de' : 'en')
}

/**
 * Was seit der zuletzt gesehenen Fassung dazugekommen ist. Eine frische Installation hat nichts Neues;
 * eine ältere, die das Fenster noch nie hatte, sieht nur die laufende Fassung.
 */
export function changelogNews(): ChangelogSection[] {
  let seen = getSetting('changelog_seen')
  if (!seen) {
    const fresh = now() - installedAt < 3600
    seen = fresh ? appVersion : (changelog()[1]?.version ?? appVersion)
    setSetting('changelog_seen', seen)
  }
  return changelog().filter((s) => compare(s.version, seen) > 0 && compare(s.version, appVersion) <= 0)
}

export function markChangelogSeen(): void {
  setSetting('changelog_seen', appVersion)
}
