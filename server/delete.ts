import { arrInstance, removeFromArr, rescanArr, unmonitorEpisodes } from './arr.ts'
import { seerrConfigured } from './config.ts'
import { db, now, tx } from './db.ts'
import { fileList } from './media.ts'
import { plexDelete } from './plex.ts'
import { resetSeerrMedia } from './seerr.ts'
import { t } from './i18n.ts'
import { logEvent } from './events.ts'

export interface DeleteRequest {
  ratingKey: number
  /** ratingKeys einzelner Folgen; ohne diese Angabe wird der ganze Titel gelöscht */
  episodes?: number[]
  /** Ganzer Titel: aus Radarr/Sonarr austragen. Einzelne Folgen: in Sonarr nicht mehr beobachten. */
  removeFromArr: boolean
  /** Nur bei einzelnen Folgen: die Serie ganz aus Sonarr austragen, statt die Folgen nur nicht mehr zu beobachten */
  removeSeries?: boolean
  /**
   * Nur bei ganzen Serien: in Sonarr behalten und bloß die vorhandenen Folgen nicht mehr beobachten.
   * Für Serien, die noch laufen: Neue Folgen kommen weiter, die gelöschten werden nicht neu geladen.
   */
  keepSeries?: boolean
  /** Den Titel in Seerr zurücksetzen, damit er erneut gewünscht werden kann */
  resetSeerr: boolean
}

export interface DeleteStep {
  label: string
  ok: boolean
  error?: string
}

/**
 * Löscht einen Titel oder einzelne Folgen. Die Reihenfolge ist Absicht: Erst wird in Radarr/Sonarr
 * dafür gesorgt, dass nichts neu geladen wird, dann löscht Plex die Dateien. Scheitert der erste
 * Schritt, bleibt alles, wie es war; scheitert das Löschen in Plex, liegt der Titel nur nicht mehr
 * in Radarr/Sonarr.
 */
export async function deleteMedia(request: DeleteRequest, user: string): Promise<{ deleted: boolean; steps: DeleteStep[] }> {
  const item = fileList().find((f) => f.rating_key === request.ratingKey)
  if (!item) throw new Error(t('Diesen Titel gibt es in der Bibliothek nicht mehr.'))
  const library = db.prepare('SELECT tmdb_id FROM library_items WHERE rating_key = ?').get(item.rating_key)

  const episodes = request.episodes
    ? db
        .prepare(
          `SELECT rating_key, season, episode, size FROM media_files
           WHERE item_key = ? AND rating_key <> item_key AND rating_key IN (${request.episodes.map(() => '?').join(',')})`,
        )
        .all(item.rating_key, ...request.episodes)
    : null
  if (episodes && (episodes.length === 0 || episodes.length !== new Set(request.episodes).size)) {
    throw new Error(t('Mindestens eine der Folgen gehört nicht zu dieser Serie oder ist schon weg.'))
  }

  // Ganze Serie löschen, aber in Sonarr behalten: Dann gelten alle vorhandenen Folgen als die, die nicht mehr beobachtet werden
  const kept =
    !episodes && request.keepSeries && item.type === 'show'
      ? db.prepare('SELECT season, episode FROM media_files WHERE item_key = ? AND rating_key <> item_key').all(item.rating_key)
      : null
  const unmonitor = episodes && !request.removeSeries ? episodes : kept

  const steps: DeleteStep[] = []
  const attempt = async (label: string, action: () => Promise<unknown>): Promise<boolean> => {
    try {
      await action()
      steps.push({ label, ok: true })
      return true
    } catch (err) {
      steps.push({ label, ok: false, error: (err as Error).message })
      return false
    }
  }

  // Fürs Protokoll: was gelöscht werden sollte und welche Schritte geklappt haben
  const note = (deleted: boolean) => {
    const what = episodes ? t(episodes.length === 1 ? '{n} Folge' : '{n} Folgen', { n: episodes.length }) : t('ganzer Titel')
    const done = steps.map((s) => (s.ok ? s.label : `${s.label} (${t('gescheitert')}: ${s.error})`)).join(', ')
    logEvent('delete', `${item.title} · ${what} · ${user}: ${done}`, deleted ? 'info' : 'error')
  }

  if (request.removeFromArr) {
    for (const entry of item.arr) {
      const instance = arrInstance(entry.instance)!
      const done = unmonitor
        ? await attempt(t('In {name}: Folgen nicht mehr beobachten', { name: entry.name }), () =>
            unmonitorEpisodes(instance, entry.id, unmonitor.map((e) => ({ season: e.season as number, episode: e.episode as number }))),
          )
        : await attempt(t('Aus {name} löschen', { name: entry.name }), async () => {
            await removeFromArr(instance, entry.id)
            // Sonst stünde der Titel bis zum nächsten Abgleich weiter als „in Radarr/Sonarr“ da
            db.prepare('DELETE FROM arr_titles WHERE instance = ? AND id = ?').run(entry.instance, entry.id)
          })
      if (!done) {
        note(false)
        return { deleted: false, steps }
      }
    }
  }

  const keys = episodes ? episodes.map((e) => e.rating_key as number) : [item.rating_key]
  const removed: number[] = []
  if (!episodes) {
    if (await attempt(t('In Plex löschen'), () => plexDelete(`/library/metadata/${item.rating_key}`))) removed.push(item.rating_key)
  } else {
    // Eine Zeile für alle Folgen statt einer je Folge; einzeln steht nur die Folge da, an der es scheitert
    let failed: DeleteStep | undefined
    for (const key of keys) {
      try {
        await plexDelete(`/library/metadata/${key}`)
        removed.push(key)
      } catch (err) {
        failed = { label: t('In Plex löschen: Folge {n} von {total}', { n: removed.length + 1, total: keys.length }), ok: false, error: (err as Error).message }
        break
      }
    }
    if (removed.length) steps.push({ label: t(removed.length === 1 ? 'In Plex gelöscht: {n} Folge' : 'In Plex gelöscht: {n} Folgen', { n: removed.length }), ok: true })
    if (failed) steps.push(failed)
  }

  // Auch nach einem Abbruch mittendrin festhalten, was schon weg ist
  if (removed.length) {
    const size = episodes ? episodes.filter((e) => removed.includes(e.rating_key as number)).reduce((n, e) => n + (e.size as number), 0) : item.size
    tx(() => {
      if (episodes) {
        const remove = db.prepare('DELETE FROM media_files WHERE rating_key = ?')
        for (const key of removed) remove.run(key)
        db.prepare('UPDATE library_items SET leaf_count = MAX(0, leaf_count - ?) WHERE rating_key = ?').run(removed.length, item.rating_key)
      } else {
        db.prepare('DELETE FROM media_files WHERE item_key = ?').run(item.rating_key)
        db.prepare('DELETE FROM library_items WHERE rating_key = ?').run(item.rating_key)
      }
      db.prepare('INSERT INTO deletions (at, user, type, title, detail, files, size) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        now(),
        user,
        item.type,
        item.title,
        episodes ? t(removed.length === 1 ? '{n} Folge' : '{n} Folgen', { n: removed.length }) : t('ganzer Titel'),
        episodes ? removed.length : item.files,
        size,
      )
    })
  }
  const deleted = removed.length === keys.length

  // Die Serie steht weiter in Sonarr; ohne neues Einlesen gälten die gelöschten Folgen dort noch als vorhanden
  if (removed.length && unmonitor && request.removeFromArr) {
    for (const entry of item.arr) {
      await attempt(t('In {name}: Dateien neu einlesen', { name: entry.name }), () => rescanArr(arrInstance(entry.instance)!, entry.id))
    }
  }

  if (deleted && !episodes && request.resetSeerr && seerrConfigured() && library?.tmdb_id) {
    await attempt(t('In Seerr zurücksetzen'), () => resetSeerrMedia(item.type === 'show' ? 'show' : 'movie', library.tmdb_id as number))
  }
  note(deleted)
  return { deleted, steps }
}

export function recentDeletions(): Record<string, unknown>[] {
  return db.prepare('SELECT at, user, type, title, detail, files, size FROM deletions ORDER BY at DESC LIMIT 30').all()
}
