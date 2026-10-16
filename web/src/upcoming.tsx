import { useEffect, useState, type ReactNode } from 'react'
import { ExternalLink, EyeOff, Play, Plus, RefreshCw, X } from 'lucide-react'
import { api, useApi, type CalendarEntry, type HiddenTitle, type Release, type TitleDetails, type Upcoming } from './api'
import { locale, t } from './i18n'
import { ago, Badge, Card, Empty, episodeCode, ErrorNote, meta, num, Poster, typeLabel, Chips, readFlag, writeFlag } from './ui'
import { CHANGED } from './titleinfo'
import { TopicsSection } from './topics'
import { Heading, TileGrid } from './views'

type Section = 'streaming' | 'cinema' | 'server' | 'topics'
type Period = 'ahead' | 'recent'

/** „Heute“, „Morgen“ oder der Wochentag mit Datum. */
function dayLabel(date: string, today: string): string {
  const days = Math.round((Date.parse(date) - Date.parse(today)) / 86400_000)
  const text = new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', day: '2-digit', month: '2-digit' })
  if (days === 0) return `${t('Heute')} · ${text}`
  if (days === 1) return `${t('Morgen')} · ${text}`
  if (days === -1) return `${t('Gestern')} · ${text}`
  return text
}

/** Gruppiert nach Tag, in der Reihenfolge der Liste. */
function byDay<T extends { date: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const item of items) groups.set(item.date, [...(groups.get(item.date) ?? []), item])
  return [...groups]
}

/** Was für die Kurzinfo nötig ist; ohne TMDB-ID zeigt sie nur, was Radarr bzw. Sonarr wissen. */
export interface InfoTarget {
  type: 'movie' | 'show'
  tmdb_id: number | null
  title: string
  year?: number | null
  /** Bild aus Plex, falls der Titel auf dem Server liegt */
  thumb?: string | null
  poster?: string | null
  url?: string | null
  overview?: string | null
  /** Zeilen aus der Liste, z. B. Anbieter oder Merkliste */
  context: ReactNode
  /** Die Zeilen stehen unter der Beschreibung statt darüber, wenn sie länger sind */
  contextBelow?: boolean
}

/** Blendet einen Titel in allen Bereichen von „Was kommt“ aus; die Ansichten laden danach neu. */
function hideTitle(x: { type: 'movie' | 'show'; tmdb_id: number | null; title: string; year?: number | null }): void {
  if (x.tmdb_id == null) return
  void api('/upcoming/hide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: x.type, tmdbId: x.tmdb_id, title: x.title, year: x.year ?? null }),
  }).then(() => dispatchEvent(new Event(CHANGED)))
}

/** Eine Kachel wie bei den Merklisten; ein Klick auf Bild oder Titel öffnet die Kurzinfo. */
function Row({ poster, url, title, info, onOpen, onHide, right, children }: {
  poster?: string | null
  url?: string | null
  title: string
  info: string
  onOpen: () => void
  /** Mit dieser Angabe bekommt die Kachel den Knopf zum Ausblenden */
  onHide?: () => void
  right?: ReactNode
  children?: ReactNode
}) {
  return (
    <Card className="flex gap-4 p-3">
      <button onClick={onOpen} title={t('Kurzinfo zu {title}', { title })} className="shrink-0 self-start rounded-md transition hover:opacity-80">
        <Poster thumb={null} tmdbPoster={poster} url={url} className="w-20" />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <button onClick={onOpen} title={title} className="min-w-0 flex-1 truncate text-left font-medium hover:text-amber-300">
            {title}
          </button>
          {right && <div className="shrink-0 text-right">{right}</div>}
        </div>
        <p className="truncate text-sm text-zinc-500">{info}</p>
        {children}
        {onHide && (
          <button
            onClick={onHide}
            title={t('Interessiert mich nicht: unter „Was kommt“ nicht mehr zeigen')}
            className="mt-1 inline-flex items-center gap-1 text-xs text-zinc-600 transition hover:text-zinc-300"
          >
            <EyeOff size={12} /> {t('Ausblenden')}
          </button>
        )}
      </div>
    </Card>
  )
}

/** „in Sonarr“ als Link, der den Titel dort öffnet. */
export function ArrLink({ name, url }: { name: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={t('In {name} öffnen', { name })}
      className="inline-flex items-center gap-1 rounded-md bg-sky-400/10 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-sky-300 transition hover:bg-sky-400/20"
    >
      {t('in {where}', { where: name })} <ExternalLink size={11} />
    </a>
  )
}

function ReleaseContext({ r, date }: { r: Release; date?: string }) {
  return (
    <>
      {date && <p className="text-sm text-zinc-300">{date}</p>}
      <p className="text-sm text-zinc-400">
        {r.kind === 'cinema'
          ? t('Kinostart')
          : r.providers.join(', ') || (r.kind === 'topic' ? t('bei keinem Anbieter im Abo') : t('Digitalstart, Anbieter noch offen'))}
      </p>
      {r.watchlist.length > 0 && <p className="text-xs text-amber-300/80">{t('Merkliste: {names}', { names: r.watchlist.join(', ') })}</p>}
    </>
  )
}

function ReleaseRow({ r, day, canRequest, onOpen }: { r: Release; day: string; canRequest: boolean; onOpen: (target: InfoTarget) => void }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const [error, setError] = useState('')
  const request = () => {
    setState('busy')
    setError('')
    api('/request', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: r.type, tmdbId: r.tmdb_id, season: r.season }),
    })
      .then(() => setState('done'))
      .catch((e: Error) => {
        setError(e.message)
        setState('idle')
      })
  }
  const label = r.in_library
    ? t('auf dem Server')
    : state === 'done'
      ? t('angefragt')
      : r.request
  const info = meta(typeLabel(r.type), r.season && t('Staffel {n}', { n: r.season }), r.year)
  // Ein Treffer aus „Meine Themen“ hat keinen Starttermin, der hier etwas sagt
  const start = r.kind === 'topic' ? '' : meta(r.season ? t('Staffel {n} startet', { n: r.season }) : r.kind === 'cinema' ? t('Kinostart') : t('Erscheint'), day)
  return (
    <Row
      poster={r.poster}
      title={r.title}
      info={info}
      onHide={() => hideTitle(r)}
      onOpen={() => onOpen({ type: r.type, tmdb_id: r.tmdb_id, title: r.title, year: r.year, poster: r.poster, context: <ReleaseContext r={r} date={start} /> })}
      right={
        label ? (
          <span className="flex flex-col items-end gap-1">
            <Badge tone={r.in_library ? 'green' : 'amber'}>{label}</Badge>
            {/* Auch ein angefragter Titel steht meist schon in Radarr oder Sonarr */}
            {!r.in_library && r.arr.map((a) => <ArrLink key={a.name} {...a} />)}
          </span>
        ) : r.arr.length > 0 ? (
          // Was Radarr oder Sonarr beobachten, kommt von selbst; der Link führt direkt zum Titel dort
          <span className="flex flex-col items-end gap-1">
            {r.arr.map((a) => (
              <ArrLink key={a.name} {...a} />
            ))}
          </span>
        ) : (
          canRequest && (
            <button
              onClick={request}
              disabled={state === 'busy'}
              title={t('In Seerr anfragen')}
              className="inline-flex items-center gap-1 rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-50"
            >
              <Plus size={13} /> {t('Wünschen')}
            </button>
          )
        )
      }
    >
      <ReleaseContext r={r} />
      {error && <p className="text-xs text-red-300">{error}</p>}
    </Row>
  )
}

function CalendarRow({ c, day, onOpen }: { c: CalendarEntry; day: string; onOpen: (target: InfoTarget) => void }) {
  const releases: Record<string, string> = { digital: t('Digital'), physical: t('Disc'), cinema: t('Kinostart') }
  const detail =
    c.type === 'show'
      ? c.episodes.length === 1
        ? meta(episodeCode(c.season, c.episodes[0]!), c.episode_title)
        : t('Staffel {n}', { n: c.season ?? 0 }) + ` · ${t(c.episodes.length === 1 ? '{n} Folge' : '{n} Folgen', { n: c.episodes.length })}`
      : (releases[c.release ?? ''] ?? '')
  const where = <p className="text-xs text-sky-300/80">{t('in {where}', { where: c.instance })}</p>
  return (
    <Row
      url={c.poster}
      title={c.title}
      info={meta(typeLabel(c.type), detail)}
      onHide={c.tmdb_id != null ? () => hideTitle(c) : undefined}
      onOpen={() =>
        onOpen({
          type: c.type,
          tmdb_id: c.tmdb_id,
          title: c.title,
          url: c.poster,
          overview: c.overview,
          context: (
            <>
              <p className="text-sm text-zinc-300">{meta(detail, day)}</p>
              {where}
            </>
          ),
        })
      }
      right={
        <span className="flex flex-col items-end gap-1">
          {c.has_file && <Badge tone="green">{t('schon da')}</Badge>}
          <ArrLink name={c.instance} url={c.url} />
        </span>
      }
    />
  )
}

// Grobe Probe, ob ein Ersatztext aus Plex selbst englisch ist: Dann bleibt der Hinweis stehen.
const EN_WORDS = [' the ', ' and ', ' of ', ' his ', ' her ', ' with ', ' to ']
const DE_WORDS = [' der ', ' die ', ' das ', ' und ', ' ist ', ' mit ', ' ein ', ' eine ']
function looksEnglish(text: string): boolean {
  const s = ` ${text.toLowerCase()} `
  return EN_WORDS.filter((w) => s.includes(w)).length > DE_WORDS.filter((w) => s.includes(w)).length
}
// Ab dieser Länge wird der Inhaltstext zunächst gekürzt gezeigt
const LONG_OVERVIEW = 420

/** Inhaltsangabe; lange Texte stehen zunächst gekürzt da und lassen sich aufklappen. */
function Overview({ text }: { text?: string | null }) {
  const [open, setOpen] = useState(false)
  if (!text) return <p className="leading-relaxed text-zinc-200">{t('Zu diesem Titel gibt es noch keine Beschreibung.')}</p>
  const long = text.length > LONG_OVERVIEW
  return (
    <div>
      <p className={`leading-relaxed whitespace-pre-line text-zinc-200 ${long && !open ? 'line-clamp-4' : ''}`}>{text}</p>
      {long && (
        <button onClick={() => setOpen(!open)} className="mt-1 text-sm text-amber-300 hover:underline">
          {open ? t('weniger anzeigen') : t('mehr anzeigen')}
        </button>
      )}
    </div>
  )
}

/** Kurzinfo zu Film oder Serie: Inhalt, Genres, Laufzeit, Besetzung und Trailer. */
export function InfoDialog({ target, tmdb, onClose }: { target: InfoTarget; tmdb: boolean; onClose: () => void }) {
  const [details, setDetails] = useState<TitleDetails>()
  const [error, setError] = useState('')
  const canLoad = tmdb && target.tmdb_id != null

  useEffect(() => {
    if (!canLoad) return
    let active = true
    api<TitleDetails>(`/tmdb/details?type=${target.type}&id=${target.tmdb_id}`)
      .then((d) => active && setDetails(d))
      .catch((e: Error) => active && setError(e.message))
    return () => {
      active = false
    }
  }, [canLoad, target.type, target.tmdb_id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])

  const d = details
  // Hat TMDB den Text nur auf Englisch, geht der aus der Liste oder aus Plex vor; sonst steht ein Hinweis dabei
  // Plex führt oft denselben englischen Text wie TMDB; der zählt dann nicht als eigener
  const ownText = d?.overviewFallback && target.overview?.trim() !== d.overview?.trim() ? target.overview : undefined
  const overview = ownText || (d?.overview ?? target.overview)
  const englishOnly = Boolean(d?.overviewFallback && (!ownText || looksEnglish(ownText)))
  const length =
    d &&
    (d.type === 'movie'
      ? d.runtime && t('{n} Min.', { n: d.runtime })
      : meta(d.seasons && t(d.seasons === 1 ? '{n} Staffel' : '{n} Staffeln', { n: d.seasons }), d.runtime && t('je Folge {n} Min.', { n: d.runtime })))
  const facts = d ? meta(typeLabel(d.type), d.year, length, d.status, d.certification && t('FSK {n}', { n: d.certification })) : meta(typeLabel(target.type), target.year)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={target.title} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        {d?.backdrop && (
          <div className="relative h-36 sm:h-52">
            <img src={`https://image.tmdb.org/t/p/w1280${d.backdrop}`} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-zinc-900 to-transparent" />
          </div>
        )}
        <button
          onClick={onClose}
          aria-label={t('Schließen')}
          className="absolute top-3 right-3 rounded-full bg-zinc-950/70 p-2 text-zinc-300 transition hover:bg-zinc-800 hover:text-white"
        >
          <X size={18} />
        </button>

        <div className={`space-y-4 p-5 ${d?.backdrop ? '-mt-16 sm:-mt-20' : ''} relative`}>
          <div className="flex gap-4">
            <Poster thumb={target.thumb ?? null} tmdbPoster={d?.poster ?? target.poster} url={d?.poster ? null : target.url} className="w-24 sm:w-32" />
            <div className="min-w-0 flex-1 space-y-1 self-end">
              <p className="text-xl font-semibold sm:text-2xl">{d?.title ?? target.title}</p>
              {d?.original_title && <p className="text-sm text-zinc-500">{t('Originaltitel: {title}', { title: d.original_title })}</p>}
              <p className="text-sm text-zinc-400">{facts}</p>
              {d && d.genres.length > 0 && <p className="text-sm text-zinc-500">{d.genres.join(', ')}</p>}
            </div>
          </div>

          {!target.contextBelow && <div className="space-y-0.5 rounded-lg bg-zinc-800/50 px-3 py-2">{target.context}</div>}

          {canLoad && !d && !error && <p className="text-sm text-zinc-500">{t('Lade Kurzinfo …')}</p>}
          <ErrorNote message={error} />
          {d?.tagline && <p className="text-zinc-300 italic">{d.tagline}</p>}
          {(d || !canLoad || error) && (
            <div className="space-y-1">
              {englishOnly && <p className="text-xs text-zinc-500">{t('Inhaltsangabe nur auf Englisch verfügbar')}</p>}
              <Overview key={overview ?? ''} text={overview} />
            </div>
          )}

          {d && (
            <div className="space-y-1 text-sm text-zinc-400">
              {d.vote != null && <p>{t('{vote} bei TMDB ({n} Stimmen)', { vote: d.vote.toLocaleString(locale()), n: num(d.votes) })}</p>}
              {d.creators.length > 0 && (
                <p>{t(d.type === 'movie' ? 'Regie: {names}' : 'Erfunden von: {names}', { names: d.creators.join(', ') })}</p>
              )}
              {d.cast.length > 0 && <p>{t('Mit: {names}', { names: d.cast.join(', ') })}</p>}
            </div>
          )}

          {target.contextBelow && <div className="space-y-0.5 rounded-lg bg-zinc-800/50 px-3 py-2">{target.context}</div>}

          {d && !d.trailer && (
            <p className="text-sm text-zinc-500">
              {t('Kein Trailer in deiner Sprache verfügbar.')}{' '}
              {d.trailerOther && (
                <a href={`https://www.youtube.com/watch?v=${d.trailerOther}`} target="_blank" rel="noreferrer" className="text-amber-300 hover:underline">
                  {t('Englischen ansehen')}
                </a>
              )}
            </p>
          )}
          {target.tmdb_id != null && (
            <div className="flex flex-wrap gap-2">
              {d?.trailer && (
                <a
                  href={`https://www.youtube.com/watch?v=${d.trailer}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-3 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-amber-300"
                >
                  <Play size={15} /> {t('Trailer ansehen')}
                </a>
              )}
              <a
                href={`https://www.themoviedb.org/${target.type === 'show' ? 'tv' : 'movie'}/${target.tmdb_id}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 transition hover:bg-zinc-700"
              >
                <ExternalLink size={15} /> {t('Bei TMDB öffnen')}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** Was ausgeblendet ist, mit der Möglichkeit, es wieder einzublenden. */
function HiddenList({ onClose }: { onClose: () => void }) {
  const { data, reload } = useApi<HiddenTitle[]>('/upcoming/hidden')
  const show = (h: HiddenTitle) =>
    void api('/upcoming/unhide', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: h.type, tmdbId: h.tmdb_id }) }).then(() => {
      reload()
      dispatchEvent(new Event(CHANGED))
    })
  return (
    <Card className="space-y-2 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-medium">{t('Ausgeblendete Titel')}</p>
        <button onClick={onClose} aria-label={t('Schließen')} className="rounded-md p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200">
          <X size={16} />
        </button>
      </div>
      {data && data.length === 0 && <p className="text-sm text-zinc-500">{t('Im Moment ist nichts ausgeblendet.')}</p>}
      <ul className="divide-y divide-zinc-800/70">
        {(data ?? []).map((h) => (
          <li key={`${h.type}-${h.tmdb_id}`} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className="min-w-0 truncate">
              {h.title} <span className="text-zinc-500">· {meta(typeLabel(h.type), h.year)}</span>
            </span>
            <button onClick={() => show(h)} className="shrink-0 rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700">
              {t('Wieder einblenden')}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

export function UpcomingView({ seerrConfigured }: { seerrConfigured: boolean }) {
  const { data, error, reload } = useApi<Upcoming>('/upcoming', 30_000)
  const [section, setSection] = useState<Section>('streaming')
  const [period, setPeriod] = useState<Period>('ahead')
  const [provider, setProvider] = useState('')
  // Filme und Serien, nur Filme oder nur Serien; unter „Kino“ stehen ohnehin nur Filme
  const [kind, setKind] = useState<'' | 'movie' | 'show'>('')
  // Nur Dokumentationen; die Angabe kommt von TMDB und fehlt im Kalender von Radarr und Sonarr
  const [docs, setDocs] = useState(false)
  // Titel, die schon auf dem Server liegen, ausblenden; bleibt im Browser gespeichert
  const [missingOnly, setMissingOnly] = useState(() => readFlag('upcoming-missing-only'))
  const [showHidden, setShowHidden] = useState(false)
  const [info, setInfo] = useState<InfoTarget | null>(null)

  if (!data) return <ErrorNote message={error} />

  const inPeriod = <T extends { date: string }>(items: T[]) =>
    period === 'ahead' ? items.filter((i) => i.date >= data.today) : items.filter((i) => i.date < data.today).reverse()
  const ofKind = <T extends { type: 'movie' | 'show' }>(items: T[]) => (kind ? items.filter((i) => i.type === kind) : items)
  const onlyDocs = <T extends { documentary?: boolean; in_library: boolean }>(items: T[]) =>
    (docs ? items.filter((i) => i.documentary) : items).filter((i) => !missingOnly || !i.in_library)
  const selected = data.providers.map((p) => p.name)
  // Filme, deren Anbieter vor dem Start noch nicht feststeht, gehören nur unter „Alle Anbieter“
  const streaming = onlyDocs(ofKind(inPeriod(data.streaming))).filter((r) =>
    provider ? r.providers.includes(provider) : r.providers.length === 0 || r.providers.some((p) => selected.includes(p)),
  )
  const cinema = onlyDocs(inPeriod(data.cinema))
  const server = ofKind(inPeriod(data.server))
  const sections: Record<Section, string> = {
    streaming: `${t('Streaming')} (${streaming.length})`,
    cinema: `${t('Kino')} (${cinema.length})`,
    server: `${t('Auf deinem Server')} (${server.length})`,
    topics: t('Meine Themen'),
  }
  const refresh = () => void api('/upcoming/refresh', { method: 'POST' }).then(reload)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips value={section} options={sections} onChange={setSection} />
        <span className="flex flex-wrap items-center gap-2">
          {section !== 'server' && section !== 'topics' && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
              <input type="checkbox" checked={docs} onChange={(e) => setDocs(e.target.checked)} className="h-4 w-4 accent-amber-400" />
              {t('Nur Dokus')}
            </label>
          )}
          {section !== 'server' && section !== 'topics' && (
            <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
              <input
                type="checkbox"
                checked={missingOnly}
                onChange={(e) => {
                  setMissingOnly(e.target.checked)
                  writeFlag('upcoming-missing-only', e.target.checked)
                }}
                className="h-4 w-4 accent-amber-400"
              />
              {t('Schon auf dem Server ausblenden')}
            </label>
          )}
          {section !== 'cinema' && (
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as '' | 'movie' | 'show')}
              className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-zinc-600"
              aria-label={t('Art')}
            >
              <option value="">{t('Filme und Serien')}</option>
              <option value="movie">{t('Nur Filme')}</option>
              <option value="show">{t('Nur Serien')}</option>
            </select>
          )}
          {section !== 'topics' && (
            <Chips value={period} options={{ ahead: t('Ab heute'), recent: section === 'streaming' ? t('Zuletzt gestartet') : t('Letzte 7 Tage') }} onChange={setPeriod} />
          )}
        </span>
      </div>

      {section !== 'server' && !data.configured && (
        <Empty>{t('Für die Neustarts fehlt der TMDB-Schlüssel. Du kannst ihn unter Einstellungen → TMDB eintragen.')}</Empty>
      )}
      {data.hidden > 0 && !showHidden && (
        <button onClick={() => setShowHidden(true)} className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300">
          <EyeOff size={12} /> {t('{n} Titel ausgeblendet', { n: data.hidden })}
        </button>
      )}
      {showHidden && <HiddenList onClose={() => setShowHidden(false)} />}

      {section !== 'server' && section !== 'topics' && data.configured && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
          {data.loading
            ? t('Neustarts werden geholt, das dauert etwa eine halbe Minute …')
            : data.fetchedAt
              ? t('Stand: {when} · Land: {region}', { when: ago(data.fetchedAt), region: data.region })
              : ''}
          {!data.loading && (
            <button onClick={refresh} className="inline-flex items-center gap-1 hover:text-zinc-300">
              <RefreshCw size={12} /> {t('Neu holen')}
            </button>
          )}
        </p>
      )}
      <ErrorNote message={error || (section === 'server' ? data.serverError : section === 'topics' ? '' : data.error)} />

      {section === 'streaming' && data.configured && period === 'recent' && (
        <p className="text-xs text-zinc-500">
          {t('Serien der letzten 7 Tage, Filme der letzten 30 Tage. Bei Filmen nennt TMDB den Anbieter meist erst nach dem Start, deshalb stehen die meisten hier und nicht unter „Ab heute“.')}
        </p>
      )}
      {section === 'streaming' && data.configured && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setProvider('')}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${provider === '' ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
          >
            {t('Alle Anbieter')}
          </button>
          {data.providers.map((p) => (
            <button
              key={p.id}
              onClick={() => setProvider(p.name)}
              className={`inline-flex items-center gap-2 rounded-lg py-1 pr-3 pl-1 text-sm font-medium ${
                provider === p.name ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              {p.logo && <img src={`https://image.tmdb.org/t/p/w92${p.logo}`} alt="" className="h-6 w-6 rounded-md" />}
              {p.name}
            </button>
          ))}
        </div>
      )}

      {section === 'topics' && data.configured && (
        <TopicsSection
          kind={kind}
          providers={selected}
          row={(r) => <ReleaseRow key={`${r.type}-${r.tmdb_id}`} r={r} day="" canRequest={seerrConfigured} onOpen={setInfo} />}
        />
      )}

      {section === 'server' && !data.arrConfigured && (
        <Empty>{t('Dafür fehlt die Verbindung zu Radarr oder Sonarr. Du kannst sie unter Einstellungen eintragen.')}</Empty>
      )}

      {section === 'server'
        ? byDay(server).map(([date, entries]) => (
            <section key={date}>
              <Heading>{dayLabel(date, data.today)}</Heading>
              <TileGrid>
                {entries.map((c) => (
                  <CalendarRow
                    key={`${c.instance}-${c.title}-${c.season}-${c.episodes.join()}-${c.release}`}
                    c={c}
                    day={dayLabel(date, data.today)}
                    onOpen={setInfo}
                  />
                ))}
              </TileGrid>
            </section>
          ))
        : data.configured &&
          section !== 'topics' &&
          byDay(section === 'streaming' ? streaming : cinema).map(([date, releases]) => (
            <section key={date}>
              <Heading>{dayLabel(date, data.today)}</Heading>
              <TileGrid>
                {releases.map((r) => (
                  <ReleaseRow
                    key={`${r.kind}-${r.type}-${r.tmdb_id}-${r.season}`}
                    r={r}
                    day={dayLabel(date, data.today)}
                    canRequest={seerrConfigured}
                    onOpen={setInfo}
                  />
                ))}
              </TileGrid>
            </section>
          ))}

      {((section === 'streaming' && data.configured && !data.loading && streaming.length === 0) ||
        (section === 'cinema' && data.configured && !data.loading && cinema.length === 0) ||
        (section === 'server' && data.arrConfigured && server.length === 0)) && <Empty>{t('Nichts in diesem Zeitraum.')}</Empty>}

      {info && <InfoDialog target={info} tmdb={data.configured} onClose={() => setInfo(null)} />}
    </div>
  )
}
