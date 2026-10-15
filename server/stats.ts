import { db, getSettings, now, recordingSince } from './db.ts'

// Sehr kurze Wiedergaben (angespielt, falscher Titel) verfälschen die Zählung
const MIN_SECONDS = 60

/**
 * Auswertung der Wiedergaben. Seit dem Start der eigenen Aufzeichnung zählt, was Blackbriar selbst
 * mitgeschrieben hat. Für die Zeit davor zählt der Import aus Tautulli, ersatzweise der Plex-Verlauf,
 * der nur Zählungen ohne Dauer und Gerät kennt.
 */
export function stats(days: number, userId?: number) {
  const has = (table: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n) > 0
  const tautulli = has('plays')
  const tracearr = has('tracearr_plays')
  // Haben beide Quellen Daten, entscheidet die Einstellung; sonst die, die etwas hat
  const table = tracearr && (getSettings().pastSource === 'tracearr' || !tautulli) ? 'tracearr_plays' : 'plays'
  const imported = tautulli || tracearr
  const own = `SELECT user_id, started AS at, duration, type, COALESCE(show_title, title) AS item, platform, decision
               FROM own_plays WHERE duration >= ${MIN_SECONDS}`
  const past = imported
    ? `SELECT user_id, started AS at, duration, type, COALESCE(show_title, title) AS item, platform, decision
       FROM ${table} WHERE started < ${recordingSince}`
    : `SELECT user_id, viewed_at AS at, 0 AS duration, type, COALESCE(show_title, title) AS item, NULL AS platform, NULL AS decision
       FROM history WHERE viewed_at < ${recordingSince}`
  const since = days > 0 ? now() - days * 86400 : 0
  const cte = `WITH p AS (SELECT * FROM (${own} UNION ALL ${past}) WHERE at >= ? AND (? IS NULL OR user_id = ?))`
  const params = [since, userId ?? null, userId ?? null]
  const all = (sql: string) => db.prepare(`${cte} ${sql}`).all(...params)
  const local = (format: string) => `strftime('${format}', at, 'unixepoch', 'localtime')`

  return {
    /** Ob im gewählten Zeitraum durchgehend Dauer und Gerät bekannt sind */
    timed: imported || since >= recordingSince,
    recordingSince,
    totals: db.prepare(`${cte} SELECT COUNT(*) AS plays, COALESCE(SUM(duration), 0) AS seconds, COUNT(DISTINCT user_id) AS users FROM p`).get(...params),
    perUser: all(
      `SELECT COALESCE(u.name, 'Konto ' || p.user_id) AS name, COUNT(*) AS plays, SUM(p.duration) AS seconds
       FROM p LEFT JOIN users u ON u.id = p.user_id GROUP BY p.user_id ORDER BY seconds DESC, plays DESC`,
    ),
    perWeekday: all(`SELECT CAST(${local('%w')} AS INTEGER) AS day, COUNT(*) AS plays, SUM(duration) AS seconds FROM p GROUP BY day`),
    perHour: all(`SELECT CAST(${local('%H')} AS INTEGER) AS hour, COUNT(*) AS plays, SUM(duration) AS seconds FROM p GROUP BY hour`),
    perMonth: all(
      `SELECT ${local('%Y-%m')} AS month, COUNT(*) AS plays, SUM(duration) AS seconds FROM p GROUP BY month ORDER BY month DESC LIMIT 12`,
    ).reverse(),
    topMovies: all(
      `SELECT item AS title, COUNT(*) AS plays, COUNT(DISTINCT user_id) AS users FROM p WHERE type = 'movie'
       GROUP BY item ORDER BY users DESC, plays DESC LIMIT 10`,
    ),
    topShows: all(
      `SELECT item AS title, COUNT(*) AS plays, COUNT(DISTINCT user_id) AS users FROM p WHERE type = 'episode'
       GROUP BY item ORDER BY plays DESC LIMIT 10`,
    ),
    platforms: all(`SELECT platform AS name, COUNT(*) AS plays FROM p WHERE platform IS NOT NULL GROUP BY platform ORDER BY plays DESC LIMIT 8`),
    decisions: all(`SELECT decision AS name, COUNT(*) AS plays FROM p WHERE decision IS NOT NULL GROUP BY decision ORDER BY plays DESC`),
  }
}
