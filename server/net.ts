import { t } from './i18n.ts'

/**
 * Wie fetch, nennt bei einem Verbindungsfehler aber den Dienst: „fetch failed“ allein sagt im Protokoll nicht,
 * ob Plex, Seerr oder ein anderer gerade nicht antwortet.
 */
export async function reach(name: string, url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (err) {
    throw new Error(t('{name} ist nicht erreichbar', { name }), { cause: err })
  }
}
