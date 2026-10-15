import { ARR_INSTANCES } from './arr.ts'
import { db, getSetting, setSetting } from './db.ts'
import { t } from './i18n.ts'

// Plex ordnet Filme und Serien über den Namen einer TMDB-Nummer zu. Greift es daneben, etwa bei
// mehreren Filmen gleichen Namens, findet Seerr den Titel nicht und fragt ihn über die Merkliste
// immer wieder neu an. Erkennbar ist das daran, dass ein gewünschter Titel nicht in der Bibliothek
// liegt, dort aber einer mit gleichem Namen und Jahr unter einer anderen Nummer steht.

export interface Mismatch {
  /** Bleibt gleich, solange es um dieselbe Datei und dieselbe gewünschte Nummer geht */
  key: string
  type: 'movie' | 'show'
  title: string
  year: number | null
  rating_key: number
  thumb: string | null
  /** Nummer, unter der Plex den Titel führt */
  plex_tmdb: number
  /** Nummer, die auf der Merkliste bzw. in Radarr/Sonarr steht */
  wanted_tmdb: number
  /** Wer oder was den Titel unter der gewünschten Nummer führt, z. B. „Merkliste von anna“ oder „Radarr“ */
  sources: string[]
}

/** Klein, ohne Satzzeichen und ohne angehängtes Jahr wie „Tracker (2024)“. */
const normalize = (title: string) =>
  title
    .toLowerCase()
    .replace(/\s*\(\d{4}\)\s*$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')

const IGNORED = 'mismatch_ignored'
const NOTIFIED = 'mismatch_notified'

function readList(key: string): string[] {
  try {
    const list = JSON.parse(getSetting(key) ?? '[]')
    return Array.isArray(list) ? list.map(String) : []
  } catch {
    return []
  }
}

/** Alle vermutlich falschen Zuordnungen; mit `all` auch die ausgeblendeten. */
export function plexMismatches(all = false): Mismatch[] {
  const library = db.prepare('SELECT rating_key, type, title, year, thumb, tmdb_id FROM library_items WHERE tmdb_id IS NOT NULL').all() as {
    rating_key: number
    type: 'movie' | 'show'
    title: string
    year: number | null
    thumb: string | null
    tmdb_id: number
  }[]
  const inLibrary = new Set(library.map((l) => `${l.type}:${l.tmdb_id}`))
  const byTitle = new Map<string, typeof library>()
  for (const l of library) {
    const key = `${l.type}:${normalize(l.title)}`
    byTitle.set(key, [...(byTitle.get(key) ?? []), l])
  }

  const wanted: { type: 'movie' | 'show'; tmdb_id: number; title: string; year: number | null; source: string }[] = []
  for (const w of db
    .prepare('SELECT w.type, w.tmdb_id, w.title, w.year, u.name FROM watchlist w JOIN users u ON u.id = w.user_id AND u.active = 1')
    .all()) {
    wanted.push({
      type: w.type as 'movie' | 'show',
      tmdb_id: w.tmdb_id as number,
      title: w.title as string,
      year: w.year as number | null,
      source: t('Merkliste von {name}', { name: w.name as string }),
    })
  }
  for (const a of db.prepare('SELECT instance, tmdb_id, title, year FROM arr_titles WHERE tmdb_id IS NOT NULL').all()) {
    const instance = ARR_INSTANCES.find((i) => i.id === a.instance)
    if (!instance) continue
    wanted.push({
      type: instance.app === 'radarr' ? 'movie' : 'show',
      tmdb_id: a.tmdb_id as number,
      title: a.title as string,
      year: a.year as number | null,
      source: instance.name,
    })
  }

  const ignored = new Set(all ? [] : readList(IGNORED))
  const found = new Map<string, Mismatch>()
  for (const w of wanted) {
    if (inLibrary.has(`${w.type}:${w.tmdb_id}`)) continue
    for (const l of byTitle.get(`${w.type}:${normalize(w.title)}`) ?? []) {
      // Das Jahr muss passen; ein Jahr Abstand ist erlaubt, weil Kinostart und Erstausstrahlung je Land abweichen
      if (w.year == null || l.year == null || Math.abs(w.year - l.year) > 1) continue
      const key = `${w.type}:${w.tmdb_id}:${l.rating_key}`
      if (ignored.has(key)) continue
      const entry = found.get(key) ?? {
        key,
        type: w.type,
        title: l.title,
        year: l.year,
        rating_key: l.rating_key,
        thumb: l.thumb,
        plex_tmdb: l.tmdb_id,
        wanted_tmdb: w.tmdb_id,
        sources: [],
      }
      if (!entry.sources.includes(w.source)) entry.sources.push(w.source)
      found.set(key, entry)
    }
  }
  return [...found.values()].sort((a, b) => a.title.localeCompare(b.title, 'de'))
}

/** Blendet einen Hinweis aus, etwa wenn es wirklich zwei verschiedene Titel gleichen Namens sind. */
export function ignoreMismatch(key: string): void {
  const list = readList(IGNORED)
  if (!list.includes(key)) setSetting(IGNORED, JSON.stringify([...list, key]))
}

/** Hinweise, zu denen noch keine Nachricht verschickt wurde; `mark` merkt sie als verschickt. */
export function unnotifiedMismatches(): { items: Mismatch[]; mark: (key: string) => void } {
  const sent = readList(NOTIFIED)
  const current = plexMismatches()
  // Behobene Fälle fallen aus der Liste, damit ein erneuter Fehler wieder gemeldet wird
  const keep = sent.filter((key) => current.some((m) => m.key === key))
  if (keep.length !== sent.length) setSetting(NOTIFIED, JSON.stringify(keep))
  return {
    items: current.filter((m) => !keep.includes(m.key)),
    mark: (key) => {
      keep.push(key)
      setSetting(NOTIFIED, JSON.stringify(keep))
    },
  }
}
