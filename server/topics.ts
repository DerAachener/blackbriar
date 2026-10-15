import { randomBytes } from 'node:crypto'
import { getSetting, getSettings, now, setSetting } from './db.ts'
import { t } from './i18n.ts'
import { getTopicTitles, searchKeywords, type Keyword, type Release } from './tmdb.ts'
import { annotate, visible } from './upcoming.ts'

// „Meine Themen“: Der Besitzer legt Themen an, etwa Krankenhaus und Rettung, und sieht alles, was TMDB dazu kennt.
// Ein Thema ist eine Liste von Schlagwörtern aus TMDB; ein Titel gehört dazu, wenn er eines davon trägt.

export interface Topic {
  id: string
  name: string
  keywords: Keyword[]
  /** Nur Dokumentationen und Reality-Formate, keine Spielfilme und Spielserien */
  docsOnly: boolean
}

/** Vorlagen für den Einstieg; die Schlagwörter werden beim Anlegen bei TMDB nachgeschlagen. */
const PRESETS: { name: string; queries: string[] }[] = [
  { name: 'Krankenhaus und Rettung', queries: ['hospital', 'emergency room', 'emergency medicine', 'paramedic', 'ambulance', 'emergency services'] },
  { name: 'Polizei und Verbrechen', queries: ['police', 'true crime', 'criminal investigation'] },
  { name: 'Natur und Tiere', queries: ['nature', 'wildlife', 'animals'] },
]

export const presetNames = () => PRESETS.map((p) => t(p.name))

export function topics(): Topic[] {
  try {
    const list = JSON.parse(getSetting('topics') ?? '[]')
    return Array.isArray(list) ? list : []
  } catch {
    return []
  }
}

function save(list: Topic[]): void {
  setSetting('topics', JSON.stringify(list))
}

function clean(input: unknown, id: string): Topic | null {
  const t = (input ?? {}) as Record<string, unknown>
  const name = String(t.name ?? '').trim().slice(0, 60)
  const keywords = (Array.isArray(t.keywords) ? t.keywords : [])
    .map((k: any) => ({ id: Number(k?.id), name: String(k?.name ?? '').slice(0, 60) }))
    .filter((k) => Number.isInteger(k.id) && k.id > 0 && k.name)
    .slice(0, 20)
  if (!name || !keywords.length) return null
  return { id, name, keywords, docsOnly: t.docsOnly !== false }
}

/** Legt ein Thema an oder ersetzt es; null, wenn Name oder Schlagwörter fehlen. */
export function saveTopic(input: unknown, id?: string): Topic | null {
  const topic = clean(input, id ?? randomBytes(6).toString('hex'))
  if (!topic) return null
  const list = topics()
  const index = list.findIndex((t) => t.id === topic.id)
  if (index >= 0) list[index] = topic
  else list.push(topic)
  save(list)
  cache.delete(topic.id)
  return topic
}

export function deleteTopic(id: string): void {
  save(topics().filter((t) => t.id !== id))
  cache.delete(id)
}

/** Legt eine der Vorlagen an. Genommen wird je Suchwort das Schlagwort, das genau so heißt. */
export async function addPreset(index: number): Promise<Topic | null> {
  const preset = PRESETS[index]
  if (!preset) return null
  const keywords: Keyword[] = []
  for (const query of preset.queries) {
    const hit = (await searchKeywords(query)).find((k) => k.name.toLowerCase() === query)
    if (hit) keywords.push(hit)
  }
  return saveTopic({ name: t(preset.name), keywords, docsOnly: true })
}

export { searchKeywords }

// Ein Thema kostet bis zu 170 Anfragen an TMDB und ändert sich langsam
const MAX_AGE = 12 * 3600
const cache = new Map<string, { at: number; region: string; titles: Release[] }>()

export async function topicTitles(id: string, force = false) {
  const topic = topics().find((t) => t.id === id)
  if (!topic) return null
  const region = getSettings().upcomingRegion
  let entry = cache.get(id)
  if (force || !entry || entry.region !== region || now() - entry.at > MAX_AGE) {
    entry = { at: now(), region, titles: await getTopicTitles(topic.keywords.map((k) => k.id), topic.docsOnly, region) }
    cache.set(id, entry)
  }
  return { topic, fetchedAt: entry.at, titles: visible(annotate(entry.titles)) }
}
