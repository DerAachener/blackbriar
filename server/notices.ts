import { arrInstance, arrLink, getSeriesFiles, unmonitorSeason } from './arr.ts'
import { telegramConfigured, tmdbConfigured } from './config.ts'
import { db, getSetting, getSettings, now, setSetting } from './db.ts'
import { logEvent } from './events.ts'
import { t } from './i18n.ts'
import { fileList } from './media.ts'
import { escapeHtml, sendTelegram } from './telegram.ts'
import { getSeasonPlan } from './tmdb.ts'

// Hinweise für den Besitzer zu Serien, die gerade Folgen bekommen:
//  - Eine Staffel ist komplett und könnte in Sonarr auf „nicht beobachtet“.
//  - Eine neue Folge stammt von einer anderen Release-Gruppe als der Rest der Staffel.
// Jeder Hinweis bleibt offen, bis der Besitzer ihn erledigt oder ausblendet.

db.exec(`CREATE TABLE IF NOT EXISTS notices (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  kind       TEXT NOT NULL,
  rating_key INTEGER NOT NULL,
  season     INTEGER NOT NULL,
  title      TEXT NOT NULL,
  detail     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  state      TEXT NOT NULL DEFAULT 'open'
)`)

// So weit zurück gelten Folgen als „gerade angekommen“
const WINDOW = 7 * 86400

interface Outlier {
  episode: number
  group: string
}

/**
 * Welche Folgen einer Staffel von einer anderen Release-Gruppe stammen als die meisten.
 * Bei Gleichstand gibt es keine Hauptgruppe (`main` ist null); dann stehen alle Folgen mit ihrer Gruppe da,
 * damit man eingreifen kann, bevor weitere Folgen von der falschen Gruppe kommen.
 */
export function groupOutliers(files: { episode: number; group: string }[], ignore: string): { main: string | null; count: number; outliers: Outlier[] } | null {
  // Ohne Gruppe oder mit dem eigenen Kennzeichen für umgewandelte Dateien sagt eine Datei nichts über ihre Herkunft
  const skip = ignore.replace(/^-/, '').toLowerCase()
  const known = files.filter((f) => f.group && f.group.toLowerCase() !== skip)
  if (known.length < 2) return null
  const counts = new Map<string, { name: string; n: number }>()
  for (const f of known) {
    const id = f.group.toLowerCase()
    const c = counts.get(id) ?? { name: f.group, n: 0 }
    c.n++
    counts.set(id, c)
  }
  const [main, second] = [...counts.entries()].sort((a, b) => b[1].n - a[1].n)
  // Ohne klare Mehrheit lässt sich nicht sagen, welche Folge abweicht: Dann werden alle genannt
  if (second && second[1].n === main![1].n) return { main: null, count: 0, outliers: [...known].sort((a, b) => a.episode - b.episode) }
  const outliers = known.filter((f) => f.group.toLowerCase() !== main![0]).sort((a, b) => a.episode - b.episode)
  return { main: main![1].name, count: main![1].n, outliers }
}

const episodeList = (episodes: number[]) => episodes.join(', ')

async function announce(html: string, thumb: string | null, silent: boolean): Promise<void> {
  if (silent || !telegramConfigured() || !getSettings().notifySeasons) return
  await sendTelegram(html, thumb).catch((err) => console.error(t('Hinweis nicht per Telegram verschickt:'), (err as Error).message))
}

/** Prüft die Serien, die zuletzt Folgen bekommen haben, und legt neue Hinweise an. Läuft im Abgleich mit. */
export async function checkSeasons(): Promise<void> {
  // Beim allerersten Lauf entstehen die Hinweise ohne Telegram-Nachricht: Was schon da ist, wäre sonst eine Flut
  const first = !getSetting('notices_started')
  const marker = getSettings().convertedMarker
  const recent = db
    .prepare(
      `SELECT f.item_key AS rating_key, f.season, MAX(f.episode) AS last_episode FROM media_files f
       WHERE f.rating_key <> f.item_key AND f.season > 0 AND f.added_at > ?
       GROUP BY f.item_key, f.season`,
    )
    .all(now() - WINDOW)
  // Offene Hinweise zu Release-Gruppen werden mitgeprüft, damit sie verschwinden, sobald die Folge ersetzt ist
  const pendingGroups = db.prepare("SELECT rating_key, season FROM notices WHERE kind = 'groups' AND state = 'open'").all()
  const seasons = new Map<string, { rating_key: number; season: number; fresh: boolean }>()
  for (const r of recent) seasons.set(`${r.rating_key}:${r.season}`, { rating_key: r.rating_key as number, season: r.season as number, fresh: true })
  for (const r of pendingGroups) {
    const key = `${r.rating_key}:${r.season}`
    if (!seasons.has(key)) seasons.set(key, { rating_key: r.rating_key as number, season: r.season as number, fresh: false })
  }
  if (!seasons.size) {
    if (first) setSetting('notices_started', String(now()))
    return
  }

  const library = new Map(fileList().map((f) => [f.rating_key, f]))
  const tmdbOf = db.prepare('SELECT tmdb_id FROM library_items WHERE rating_key = ?')
  const lastOnServer = db.prepare('SELECT MAX(episode) AS last FROM media_files WHERE item_key = ? AND rating_key <> item_key AND season = ?')
  const exists = db.prepare('SELECT state FROM notices WHERE key = ?')
  const insert = db.prepare('INSERT OR IGNORE INTO notices (key, kind, rating_key, season, title, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
  const sonarrCache = new Map<number, Awaited<ReturnType<typeof getSeriesFiles>> | null>()

  for (const s of seasons.values()) {
    const item = library.get(s.rating_key)
    // Ohne Sonarr gibt es weder Release-Gruppen noch etwas, das sich auf „nicht beobachtet“ stellen ließe
    const entry = item?.arr.find((a) => arrInstance(a.instance)?.app === 'sonarr')
    if (!item || !entry) continue
    if (!sonarrCache.has(s.rating_key)) {
      sonarrCache.set(s.rating_key, await getSeriesFiles(arrInstance(entry.instance)!, entry.id).catch(() => null))
    }
    const sonarr = sonarrCache.get(s.rating_key)
    if (!sonarr) continue
    const seasonName = t('Staffel {n}', { n: s.season })

    // Release-Gruppen
    const mix = groupOutliers(sonarr.files.filter((f) => f.season === s.season), marker)
    const groupKeyPrefix = `groups:${s.rating_key}:${s.season}:`
    if (mix?.outliers.length) {
      // Der Schlüssel enthält die abweichenden Folgen: Kommt eine weitere dazu, ist das ein neuer Hinweis
      const key = groupKeyPrefix + mix.outliers.map((o) => `${o.episode}=${o.group.toLowerCase()}`).join(',')
      if (!exists.get(key)) {
        const byGroup = new Map<string, number[]>()
        for (const o of mix.outliers) byGroup.set(o.group, [...(byGroup.get(o.group) ?? []), o.episode])
        const parts = [...byGroup].map(([group, episodes]) => t(episodes.length === 1 ? 'Folge {episodes} ist von {group}' : 'Folgen {episodes} sind von {group}', { episodes: episodeList(episodes), group }))
        const detail = mix.main ? `${parts.join('; ')}. ${t('Die übrigen {n} sind von {group}.', { n: mix.count, group: mix.main })}` : `${parts.join('; ')}. ${t('Eine Mehrheit gibt es noch nicht.')}`
        // Ältere Fassungen desselben Hinweises ablösen
        db.prepare("UPDATE notices SET state = 'done' WHERE kind = 'groups' AND rating_key = ? AND season = ? AND state = 'open'").run(s.rating_key, s.season)
        insert.run(key, 'groups', s.rating_key, s.season, item.title, detail, now())
        logEvent('sync', `${item.title} · ${seasonName}: ${detail}`, 'warn')
        await announce(`⚠️ <b>${escapeHtml(item.title)}</b> · ${escapeHtml(seasonName)}: ${escapeHtml(t('gemischte Release-Gruppen'))}\n${escapeHtml(detail)}`, item.thumb, first)
      }
    } else {
      db.prepare("UPDATE notices SET state = 'done' WHERE kind = 'groups' AND rating_key = ? AND season = ? AND state = 'open'").run(s.rating_key, s.season)
    }

    // Staffel komplett: nur bei frisch angekommenen Folgen und nur, solange Sonarr die Staffel noch beobachtet
    if (!s.fresh || !tmdbConfigured() || sonarr.seasons.get(s.season) === false) continue
    const tmdbId = tmdbOf.get(s.rating_key)?.tmdb_id as number | null | undefined
    if (!tmdbId) continue
    const plan = await getSeasonPlan(tmdbId).catch(() => null)
    const total = plan?.episodes.get(s.season) ?? 0
    const last = Number(lastOnServer.get(s.rating_key, s.season)?.last ?? 0)
    if (!plan || total === 0 || last < total || plan.airing === s.season) continue
    const key = `complete:${s.rating_key}:${s.season}`
    if (exists.get(key)) continue
    const detail = t('Alle {n} Folgen sind da. Soll die Staffel in Sonarr auf „nicht beobachtet“?', { n: total })
    insert.run(key, 'complete', s.rating_key, s.season, item.title, detail, now())
    logEvent('sync', t('{title} · {season} ist komplett', { title: item.title, season: seasonName }))
    await announce(
      `📦 <b>${escapeHtml(item.title)}</b> · ${escapeHtml(t('{season} ist komplett', { season: seasonName }))}\n${escapeHtml(t('In Blackbriar kannst du sie in Sonarr auf „nicht beobachtet“ setzen.'))}`,
      item.thumb,
      first,
    )
  }
  if (first) setSetting('notices_started', String(now()))
}

export interface Notice {
  id: number
  kind: 'complete' | 'groups'
  rating_key: number
  season: number
  title: string
  detail: string
  created_at: number
  thumb: string | null
  /** Adresse der Serie in Sonarr, falls sie dort steht */
  url: string | null
}

export function openNotices(): Notice[] {
  const library = new Map(fileList().map((f) => [f.rating_key, f]))
  return db
    .prepare("SELECT id, kind, rating_key, season, title, detail, created_at FROM notices WHERE state = 'open' ORDER BY id DESC")
    .all()
    .map((n) => {
      const item = library.get(n.rating_key as number)
      const entry = item?.arr.find((a) => arrInstance(a.instance)?.app === 'sonarr')
      const slug = entry ? (db.prepare('SELECT slug FROM arr_titles WHERE instance = ? AND id = ?').get(entry.instance, entry.id)?.slug as string | null) : null
      return { ...(n as unknown as Notice), thumb: item?.thumb ?? null, url: entry ? arrLink(arrInstance(entry.instance)!, { slug }) : null }
    })
}

/** Blendet einen Hinweis aus, ohne etwas zu ändern. */
export function dismissNotice(id: number): void {
  db.prepare("UPDATE notices SET state = 'ignored' WHERE id = ?").run(id)
}

/** Stellt die Staffel eines Hinweises in allen Sonarr-Instanzen auf „nicht beobachtet“ und erledigt ihn damit. */
export async function unmonitorNotice(id: number): Promise<string> {
  const notice = db.prepare("SELECT kind, rating_key, season, title FROM notices WHERE id = ? AND state = 'open'").get(id)
  if (!notice) throw new Error(t('Diesen Hinweis gibt es nicht mehr.'))
  const item = fileList().find((f) => f.rating_key === notice.rating_key)
  const entries = (item?.arr ?? []).filter((a) => arrInstance(a.instance)?.app === 'sonarr')
  if (!entries.length) throw new Error(t('Die Serie steht nicht mehr in Sonarr.'))
  for (const entry of entries) await unmonitorSeason(arrInstance(entry.instance)!, entry.id, notice.season as number)
  db.prepare("UPDATE notices SET state = 'done' WHERE id = ?").run(id)
  const message = t('{title} · Staffel {n} steht in {where} auf „nicht beobachtet“', { title: notice.title as string, n: notice.season as number, where: entries.map((e) => e.name).join(', ') })
  logEvent('settings', message)
  return message
}
