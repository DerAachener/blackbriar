import { useState } from 'react'
import { Check, RefreshCw, Trash2, X } from 'lucide-react'
import {
  api,
  useApi,
  usePaged,
  type Airing,
  type CleanupData,
  type CleanupItem,
  type CleanupPerson,
  type DeleteResult,
  type EpisodeCleanupItem,
  type FileItem,
  type NotInPlexItem,
  type OpenItem,
  type SectionInfo,
  type Settings,
  type Status,
  type Storage,
} from './api'
import { locale, t } from './i18n'
import { ago, Badge, Button, Card, Chips, Empty, episodes, ErrorNote, fileResolution, fileValues, fmtDate, fmtDateTime, fmtSize, meta, num, Poster, typeLabel } from './ui'
import { useTitleInfo } from './titleinfo'
import { Heading, List, LIST_WIDTH, MoreButton, PersonLine, queryString, SearchBox, seenLabel, Tile, TileGrid, userQuery } from './views'

const mixed = fileValues
const resolution = fileResolution
const bitrate = (kbps: number | null) => (kbps ? `${(kbps / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} Mbit/s` : '')
const change = (from: string | null, to: string | null) => (from && to && from !== to ? `${from} → ${to}` : from || to || '')
const list = (names: string[]) => names.join(t(' und '))

function transcodeNote(f: FileItem): string {
  const count = t('{n}× transkodiert', { n: f.transcodes })
  const last = f.last_transcode
  if (!last) return count
  const what = [
    last.video_decision === 'transcode' && t('Bild {change}', { change: change(last.src_video, last.dst_video) }),
    last.audio_decision === 'transcode' && t('Ton {change}', { change: change(last.src_audio, last.dst_audio) }),
  ].filter(Boolean)
  return meta(count, t('zuletzt {date} bei {name}', { date: fmtDate(last.at), name: last.user_name }), last.player ?? last.platform, what.join(', '))
}

type Filter = 'all' | 'unconverted' | 'converted' | 'transcoded' | 'inarr' | 'done'
type TypeFilter = '' | 'movie' | 'show'
type Sort = 'size' | 'bitrate' | 'transcodes' | 'title'

/** „unbeobachtet“ heißt: Der Eintrag steht noch dort, es wird aber nichts mehr gesucht oder geladen. */
const instanceNames = (instances: { name: string; monitored: boolean }[]) =>
  list(instances.map((a) => (a.monitored ? a.name : t('{name} (unbeobachtet)', { name: a.name }))))

/** Wo der Titel noch verwaltet wird und, bei Serien, ob noch Folgen kommen. */
function arrLabel(arr: FileItem['arr'], type: string): string {
  const where = t('in {where}', { where: instanceNames(arr) })
  if (type !== 'show') return where
  if (arr.every((a) => a.status === 'ended')) return meta(where, t('beendet'))
  const next = Math.min(...arr.map((a) => a.next_airing ?? Infinity))
  return meta(where, Number.isFinite(next) ? t('nächste Folge {date}', { date: fmtDate(next) }) : t('läuft weiter'))
}

const selectClass = 'rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-zinc-600'

function TypeSelect({ value, onChange }: { value: TypeFilter; onChange: (v: TypeFilter) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as TypeFilter)} className={selectClass} aria-label={t('Art')}>
      <option value="">{t('Filme und Serien')}</option>
      <option value="movie">{t('Nur Filme')}</option>
      <option value="show">{t('Nur Serien')}</option>
    </select>
  )
}

/** „etwa 3 Monate“: grob genug, um nicht genauer zu wirken, als die Schätzung ist. */
function roughDuration(days: number): string {
  if (days >= 730) return t('{n} Jahre', { n: Math.round(days / 365) })
  if (days >= 60) return t('{n} Monate', { n: Math.round(days / 30) })
  return t('{n} Tage', { n: Math.max(1, Math.round(days)) })
}

/** Freier Platz auf den Platten mit den Medien, dazu eine Schätzung, wie lange er reicht. */
function StorageCard() {
  const { data } = useApi<Storage>('/storage', 300_000)
  if (!data?.disks.length) return null
  return (
    <Card className="space-y-4 p-4">
      {data.disks.map((d) => {
        const used = d.total ? Math.min(1, Math.max(0, 1 - d.free / d.total)) : null
        // Gemessen ist genauer; bis dahin dient der Zuwachs der letzten 30 Tage, der Gelöschtes nicht abzieht
        const estimate =
          d.perDay != null
            ? d.perDay > 0
              ? t('Beim Verbrauch der letzten {n} Tage reicht der Platz noch etwa {duration}.', { n: d.measuredDays, duration: roughDuration(d.free / d.perDay) })
              : t('In den letzten {n} Tagen ist der freie Platz nicht geschrumpft.', { n: d.measuredDays })
            : data.disks.length === 1 && data.added30 > 0
              ? t('Kommt weiter so viel dazu und wird nichts gelöscht, reicht der Platz noch etwa {duration}. Genauer wird die Schätzung nach einer Woche täglicher Messung.', {
                  duration: roughDuration(d.free / (data.added30 / 30)),
                })
              : ''
        return (
          <div key={d.folders[0]} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <p className="font-medium">
                {d.total ? t('{free} frei von {total}', { free: fmtSize(d.free), total: fmtSize(d.total) }) : t('{free} frei', { free: fmtSize(d.free) })}
              </p>
              <p className="text-xs text-zinc-500" title={d.folders.join(', ')}>
                {d.folders.length > 3 ? t('{n} Ordner von Radarr und Sonarr', { n: d.folders.length }) : d.folders.join(' · ')}
              </p>
            </div>
            {used != null && (
              <div className="h-2 overflow-hidden rounded-full bg-zinc-800" role="img" aria-label={t('{n} % belegt', { n: Math.round(used * 100) })}>
                <div className={`h-full rounded-full ${used > 0.9 ? 'bg-red-400' : used > 0.75 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${used * 100}%` }} />
              </div>
            )}
            {estimate && <p className="text-sm text-zinc-400">{estimate}</p>}
          </div>
        )
      })}
      <p className="text-xs text-zinc-500">
        {meta(t('Bibliothek: {size}', { size: fmtSize(data.library) }), t('in den letzten 30 Tagen dazugekommen: {size}', { size: fmtSize(data.added30) || '0' }))}
      </p>
    </Card>
  )
}

export function FilesView() {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const status = useApi<Status>('/status')
  const [sort, setSort] = useState<Sort>('size')
  const [type, setType] = useState<TypeFilter>('')
  // Mediathek aus Plex, auf die die Liste eingeschränkt ist; leer heißt alle
  const [section, setSection] = useState('')
  const sections = useApi<SectionInfo[]>('/sections')
  const showInfo = useTitleInfo()
  const query = queryString([`filter=${filter}`, `sort=${sort}`, type && `type=${type}`, section && `section=${encodeURIComponent(section)}`, search && `q=${encodeURIComponent(search)}`])
  const { items, total, error, more } = usePaged<FileItem>(`/files${query}`, 40)
  // Gesamtgröße der gefilterten Liste, unabhängig davon, wie viel schon geladen ist
  const summary = useApi<{ total: number; totalSize: number }>(`/files${query}&limit=1`)

  const filters: Partial<Record<Filter, string>> = {
    all: t('Alle'),
    unconverted: t('Nicht umgewandelt'),
    converted: t('Umgewandelt'),
    transcoded: t('Wurde transkodiert'),
    // Nur sichtbar, wenn Radarr oder Sonarr verbunden ist
    ...(status.data?.arrConfigured ? { inarr: t('Noch in Radarr/Sonarr'), done: t('Umgewandelt, noch in Radarr/Sonarr') } : {}),
  }
  const sorts: Record<Sort, string> = {
    size: t('Sortiert nach Größe'),
    bitrate: t('Sortiert nach Bitrate'),
    transcodes: t('Sortiert nach Transkodierungen'),
    title: t('Sortiert nach Titel'),
  }

  return (
    <div className={`space-y-4 ${LIST_WIDTH}`}>
      <StorageCard />
      <SearchBox
        onSearch={setSearch}
        info={summary.data ? meta(t('{n} Titel', { n: num(summary.data.total) }), fmtSize(summary.data.totalSize)) : ''}
      />
      {sections.data && sections.data.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {[{ name: '', titles: sections.data.reduce((n, s) => n + s.titles, 0), size: sections.data.reduce((n, s) => n + s.size, 0) }, ...sections.data].map((s) => (
            <button
              key={s.name || 'all'}
              onClick={() => setSection(s.name)}
              className={`rounded-lg px-3 py-1.5 text-left text-sm transition ${section === s.name ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
            >
              <span className="font-medium">{s.name || t('Alle Mediatheken')}</span>
              <span className={`block text-xs ${section === s.name ? 'text-zinc-800' : 'text-zinc-500'}`}>{meta(num(s.titles), fmtSize(s.size))}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips<Filter> value={filter} options={filters} onChange={setFilter} />
        <span className="flex flex-wrap gap-2">
          <TypeSelect value={type} onChange={setType} />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={selectClass} aria-label={t('Sortierung')}>
            {(Object.keys(sorts) as Sort[]).map((id) => (
              <option key={id} value={id}>
                {sorts[id]}
              </option>
            ))}
          </select>
        </span>
      </div>
      <ErrorNote message={error} />
      {items.length ? (
        <List>
          {items.map((f) => (
            <li key={f.rating_key} className="flex items-center gap-4 px-4 py-3">
              <button
                onClick={() => showInfo({ rating_key: f.rating_key, type: f.type, title: f.title, year: f.year, thumb: f.thumb })}
                className="flex min-w-0 flex-1 items-center gap-4 text-left transition hover:opacity-80"
              >
              <Poster thumb={f.thumb} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{f.title}</p>
                <p className="truncate text-sm text-zinc-500">
                  {meta(
                    !section && f.section,
                    typeLabel(f.type),
                    f.year,
                    f.type === 'show' && episodes(f.files),
                    mixed(f.video_codec),
                    resolution(f.resolution),
                    bitrate(f.bitrate),
                    mixed(f.container),
                  )}
                </p>
                {f.file && <p className="truncate text-xs text-zinc-600">{f.file}</p>}
                {f.arr.length > 0 && <p className="truncate text-xs text-sky-300/80">{arrLabel(f.arr, f.type)}</p>}
                {f.transcodes > 0 && <p className="truncate text-xs text-amber-300/80">{transcodeNote(f)}</p>}
              </div>
              </button>
              <div className="shrink-0 text-right">
                <p className="font-medium tabular-nums">{fmtSize(f.size) || '–'}</p>
                {f.files > 0 &&
                  (f.converted === f.files ? (
                    <Badge tone="green">{t('umgewandelt')}</Badge>
                  ) : f.converted > 0 ? (
                    <Badge tone="amber">{t('{done}/{total} umgewandelt', { done: f.converted, total: f.files })}</Badge>
                  ) : (
                    <Badge>{t('nicht umgewandelt')}</Badge>
                  ))}
              </div>
            </li>
          ))}
        </List>
      ) : (
        <Empty>{t('Keine Titel gefunden.')}</Empty>
      )}
      <MoreButton shown={items.length} total={total} onClick={more} />
    </div>
  )
}

// ---------------------------------------------------------------------------

/** „läuft noch · nächste Folge 07.10.2026“ für Serien, zu denen noch Folgen kommen; sonst nichts. */
const airingNote = (airing: Airing): string | undefined =>
  airing ? meta(t('läuft noch'), airing.next ? t('nächste Folge {date}', { date: fmtDate(airing.next) }) : '') : undefined

/** Was gelöscht werden soll; daraus baut der Dialog seine Rückfrage. */
export interface DeleteTarget {
  ratingKey: number
  title: string
  /** z. B. „ganzer Titel“ oder „Staffel 2, 5 Folgen“ */
  what: string
  files: number
  size: number
  /** ratingKeys einzelner Folgen; fehlt die Angabe, geht es um den ganzen Titel */
  episodes?: number[]
  /** Namen der Radarr- bzw. Sonarr-Instanzen, in denen der Titel steht */
  arr: string[]
  /** Was vor dem Löschen zu bedenken ist, etwa dass der Titel noch auf einer Merkliste steht */
  note?: string
  /** Die Serie läuft noch: Der Dialog warnt und bietet an, sie in Sonarr zu behalten */
  airing?: Airing
}

export function DeleteDialog({ target, seerr, onClose, onDone }: { target: DeleteTarget; seerr: boolean; onClose: () => void; onDone: () => void }) {
  const whole = !target.episodes
  const [removeFromArr, setRemoveFromArr] = useState(true)
  // Bei einzelnen Folgen: nur nicht mehr beobachten, die Serie ganz austragen oder Sonarr in Ruhe lassen
  const [episodeMode, setEpisodeMode] = useState<'unmonitor' | 'remove' | 'none'>('unmonitor')
  // Ganze Serie, die noch läuft: in Sonarr behalten (Vorauswahl), ganz austragen oder Sonarr in Ruhe lassen
  const airing = whole && target.airing && target.arr.length > 0 ? target.airing : null
  const [seriesMode, setSeriesMode] = useState<'keep' | 'remove' | 'none'>('keep')
  // Bleibt die Serie in Sonarr, gilt sie in Seerr weiter als angefragt; Zurücksetzen passt dann nicht
  const [resetSeerr, setResetSeerr] = useState(!airing)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DeleteResult>()
  const [error, setError] = useState('')

  const run = () => {
    setBusy(true)
    setError('')
    api<DeleteResult>('/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ratingKey: target.ratingKey,
        episodes: target.episodes,
        removeFromArr: airing ? seriesMode !== 'none' : whole ? removeFromArr : episodeMode !== 'none',
        removeSeries: !whole && episodeMode === 'remove',
        keepSeries: Boolean(airing) && seriesMode === 'keep',
        resetSeerr,
      }),
    })
      .then((r) => {
        setResult(r)
        onDone()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" role="dialog" aria-modal="true">
      {/* Nie höher als der Bildschirm: Sonst liegt „Schließen“ außerhalb und der Dialog lässt sich nicht verlassen */}
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-md space-y-4 overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-900 p-5">
        <div>
          <p className="text-lg font-semibold">{t('„{title}“ löschen?', { title: target.title })}</p>
          <p className="text-sm text-zinc-400">{target.what}</p>
        </div>
        {target.note && !result && <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-200">{target.note}</p>}

        {result ? (
          <>
            <ul className="space-y-1.5 text-sm">
              {result.steps.map((step) => (
                <li key={step.label} className="flex items-start gap-2">
                  {step.ok ? <Check size={16} className="mt-0.5 shrink-0 text-emerald-400" /> : <X size={16} className="mt-0.5 shrink-0 text-red-400" />}
                  <span>
                    {step.label}
                    {step.error && <span className="block text-red-300">{step.error}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <p className={`text-sm ${result.deleted ? 'text-emerald-300' : 'text-red-300'}`}>
              {result.deleted ? t('Gelöscht.') : t('Nicht vollständig gelöscht. Siehe oben, welcher Schritt gescheitert ist.')}
            </p>
            <div className="flex justify-end">
              <Button onClick={onClose}>{t('Schließen')}</Button>
            </div>
          </>
        ) : (
          <>
            <p className="rounded-lg bg-red-400/10 px-3 py-2 text-sm text-red-200">
              {t(target.files === 1 ? 'Plex löscht {n} Datei ({size}) endgültig von der Platte.' : 'Plex löscht {n} Dateien ({size}) endgültig von der Platte.', {
                n: target.files,
                size: fmtSize(target.size) || '0 MB',
              })}{' '}
              {t('Das lässt sich nicht rückgängig machen.')}
            </p>
            {airing && (
              <>
                <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                  {airing.next
                    ? t('Achtung: Die Serie läuft noch. Die nächste Folge kommt am {date}.', { date: fmtDate(airing.next) })
                    : t('Achtung: Die Serie läuft noch, es kommen neue Folgen.')}
                </p>
                <fieldset className="space-y-2 text-sm">
                  {(
                    [
                      ['keep', t('In {where} behalten: Neue Folgen kommen weiter, die gelöschten werden nicht neu geladen', { where: list(target.arr) })],
                      ['remove', t('Ganz aus {where} löschen: Es kommen keine neuen Folgen mehr', { where: list(target.arr) })],
                      ['none', t('{where} nicht anfassen', { where: list(target.arr) })],
                    ] as const
                  ).map(([mode, label]) => (
                    <label key={mode} className="flex cursor-pointer items-start gap-2">
                      <input type="radio" name="series-mode" checked={seriesMode === mode} onChange={() => setSeriesMode(mode)} className="mt-0.5 h-4 w-4 accent-amber-400" />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              </>
            )}
            {whole && !airing && target.arr.length > 0 && (
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" checked={removeFromArr} onChange={(e) => setRemoveFromArr(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-400" />
                <span>
                  {t('Aus {where} löschen', { where: list(target.arr) })}
                  <span className="block text-xs text-zinc-500">{t('Sonst wird der Titel neu geladen.')}</span>
                </span>
              </label>
            )}
            {!whole && target.arr.length > 0 && (
              <fieldset className="space-y-2 text-sm">
                {(
                  [
                    ['unmonitor', t('Die Folgen in {where} auf „nicht beobachtet“ stellen, damit sie nicht neu geladen werden', { where: list(target.arr) })],
                    ['remove', t('Die Serie ganz aus {where} löschen (nicht gelöschte Folgen bleiben in Plex)', { where: list(target.arr) })],
                    ['none', t('{where} nicht anfassen', { where: list(target.arr) })],
                  ] as const
                ).map(([mode, label]) => (
                  <label key={mode} className="flex cursor-pointer items-start gap-2">
                    <input type="radio" name="episode-mode" checked={episodeMode === mode} onChange={() => setEpisodeMode(mode)} className="mt-0.5 h-4 w-4 accent-amber-400" />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            )}
            {whole && seerr && (
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input type="checkbox" checked={resetSeerr} onChange={(e) => setResetSeerr(e.target.checked)} className="mt-0.5 h-4 w-4 accent-amber-400" />
                <span>{t('In Seerr zurücksetzen, damit der Titel erneut gewünscht werden kann')}</span>
              </label>
            )}
            <ErrorNote message={error} />
            <div className="flex justify-end gap-2">
              <Button onClick={onClose} disabled={busy}>
                {t('Abbrechen')}
              </Button>
              <Button danger onClick={run} disabled={busy}>
                <Trash2 size={15} /> {busy ? t('Lösche …') : t('Endgültig löschen')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="-mt-1 -mr-1 shrink-0 rounded-md p-2 text-zinc-500 transition hover:bg-red-400/10 hover:text-red-300"
    >
      <Trash2 size={15} />
    </button>
  )
}

function cleanupStatus(p: CleanupPerson, item: CleanupItem): string {
  const role = p.requested ? t('angefragt') : p.on_watchlist ? t('Merkliste') : ''
  // Zu Ende gesehen, aber ohne Bewertung: das Datum zeigt, wie lange die Bewertung schon aussteht
  if (p.seen && p.rating == null) return meta(role, seenLabel(p), t('nicht bewertet'))
  const seen =
    item.type === 'show'
      ? p.watched
        ? meta(t(p.watched === 1 ? '{n} Folge gesehen' : '{n} Folgen gesehen', { n: p.watched }), p.marked ? t('{n} davon nur markiert', { n: p.marked }) : '')
        : t('nicht gesehen')
      : p.seen_at
        ? seenLabel(p)
        : t('nicht gesehen')
  return meta(role, seen)
}

function EpisodeTile({ show, canDelete, onDelete }: { show: EpisodeCleanupItem; canDelete: boolean; onDelete: (target: DeleteTarget) => void }) {
  const target = (what: string, keys: number[], size: number): DeleteTarget => ({
    ratingKey: show.rating_key,
    title: show.title,
    what,
    files: keys.length,
    size,
    episodes: keys,
    arr: show.arr,
    airing: show.airing,
    note: show.watchlist.length ? t('Die Serie steht noch auf der Merkliste von {names}.', { names: list(show.watchlist) }) : undefined,
  })
  return (
    <Tile
      thumb={show.thumb}
      title={show.title}
      open={{ rating_key: show.rating_key, type: 'show', title: show.title, year: show.year, thumb: show.thumb }}
      aside={<span className="shrink-0 font-medium whitespace-nowrap tabular-nums">{fmtSize(show.size)}</span>}
      info={meta(show.year, t(show.episodes === 1 ? '{n} gesehene Folge' : '{n} gesehene Folgen', { n: show.episodes }))}
      note={airingNote(show.airing)}
    >
      {show.seasons.map((s) => (
        <p key={s.season} className="flex items-center gap-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-zinc-400">
            {meta(
              t('Staffel {n}', { n: s.season }),
              s.watched === s.total ? t('komplett gesehen') : t('{done} von {total} gesehen', { done: s.watched, total: s.total }),
              fmtSize(s.size),
            )}
          </span>
          {canDelete && (
            <DeleteButton
              label={t('Gesehene Folgen von Staffel {n} löschen', { n: s.season })}
              onClick={() => onDelete(target(meta(t('Staffel {n}', { n: s.season }), episodes(s.watched)), s.keys, s.size))}
            />
          )}
        </p>
      ))}
      {canDelete && show.seasons.length > 1 && (
        <button
          onClick={() =>
            onDelete(
              target(
                t('alle gesehenen Folgen: {n}', { n: show.episodes }),
                show.seasons.flatMap((s) => s.keys),
                show.size,
              ),
            )
          }
          className="mt-1 text-xs text-zinc-500 hover:text-red-300"
        >
          {t('Alle gesehenen Folgen löschen')}
        </button>
      )}
    </Tile>
  )
}

export function OpenView({ userId, onChange }: { userId: number | null; onChange: () => void }) {
  const seerr = useApi<Status>('/status').data?.seerrConfigured
  const { data, error, reload } = useApi<OpenItem[]>(`/open${userQuery(userId)}`, 60_000)
  const settings = useApi<Settings>('/settings')
  const status = useApi<Status>('/status')
  // Benutzer, dessen Bewertungen gerade neu abgefragt werden
  const [busy, setBusy] = useState<number | null>(null)
  const [refreshError, setRefreshError] = useState('')
  const [target, setTarget] = useState<DeleteTarget>()
  const canDelete = Boolean(settings.data?.allowDelete)
  const [sort, setSort] = useState<'title' | 'seen'>('title')
  const items = [...(data ?? [])].sort((a, b) => (sort === 'title' ? a.title.localeCompare(b.title, locale()) || b.seen_at - a.seen_at : b.seen_at - a.seen_at))

  const refresh = (id: number) => {
    setBusy(id)
    setRefreshError('')
    api(`/users/${id}/refresh`, { method: 'POST' })
      .then(() => {
        reload()
        onChange()
      })
      .catch((e: Error) => setRefreshError(e.message))
      .finally(() => setBusy(null))
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">
        {t('Gesehen, aber noch nicht bewertet. Serien erscheinen hier erst, wenn alle vorhandenen Folgen gesehen wurden. Was jemand in Plex als gesehen markiert hat, zählt mit.')}
      </p>
      {items.length > 1 && <Chips value={sort} options={{ title: t('A–Z'), seen: t('Zuletzt gesehen') }} onChange={setSort} />}
      <ErrorNote message={error || refreshError} />
      {items.length ? (
        <TileGrid>
          {items.map((o) => (
            <Tile
              key={`${o.user_id}-${o.rating_key}`}
              thumb={o.thumb}
              title={o.title}
              open={{ rating_key: o.rating_key, type: o.type, title: o.title, year: o.year, thumb: o.thumb }}
              info={meta(typeLabel(o.type), o.year, fmtSize(o.size))}
              note={airingNote(o.airing)}
              aside={
                <span className="-mt-1 -mr-1 flex shrink-0">
                  <button
                    onClick={() => refresh(o.user_id)}
                    disabled={busy !== null}
                    title={t('Bewertungen von {name} jetzt neu abfragen', { name: o.user_name })}
                    aria-label={t('Bewertungen von {name} jetzt neu abfragen', { name: o.user_name })}
                    className="rounded-md p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:opacity-50"
                  >
                    <RefreshCw size={15} className={busy === o.user_id ? 'animate-spin' : ''} />
                  </button>
                  {canDelete && (
                    <button
                      onClick={() =>
                        setTarget({
                          ratingKey: o.rating_key,
                          title: o.title,
                          what: t('ganzer Titel'),
                          files: o.files,
                          size: o.size ?? 0,
                          arr: o.arr,
                          airing: o.airing,
                          note: [
                            t('{name} hat den Titel gesehen, aber noch nicht bewertet.', { name: o.user_name }),
                            o.watchlist.length > 0 ? t('Er steht noch auf der Merkliste von {names}.', { names: list(o.watchlist) }) : '',
                          ]
                            .filter(Boolean)
                            .join(' '),
                        })
                      }
                      title={t('„{title}“ löschen', { title: o.title })}
                      aria-label={t('„{title}“ löschen', { title: o.title })}
                      className="rounded-md p-2 text-zinc-500 transition hover:bg-red-400/10 hover:text-red-300"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </span>
              }
            >
              <PersonLine name={o.user_name} status={seenLabel(o, ago)} highlight />
              <p className="text-xs text-zinc-500">{fmtDate(o.seen_at)}</p>
              {o.watchlist.length > 0 ? (
                <p className="truncate text-xs text-amber-300/80" title={o.watchlist.join(', ')}>
                  {t('Merkliste: {names}', { names: o.watchlist.join(', ') })}
                </p>
              ) : (
                seerr && <p className="text-xs text-zinc-600">{t('auf keiner Merkliste')}</p>
              )}
            </Tile>
          ))}
        </TileGrid>
      ) : (
        data && <Empty>{t('Alles bewertet. Hier ist nichts offen.')}</Empty>
      )}
      {target && (
        <DeleteDialog
          target={target}
          seerr={Boolean(status.data?.seerrConfigured)}
          onClose={() => setTarget(undefined)}
          onDone={() => {
            reload()
            onChange()
          }}
        />
      )}
    </div>
  )
}

export function CleanupView() {
  const { data, error, reload } = useApi<CleanupData>('/cleanup', 60_000)
  const settings = useApi<Settings>('/settings')
  const status = useApi<Status>('/status')
  const [target, setTarget] = useState<DeleteTarget>()
  const canDelete = Boolean(settings.data?.allowDelete)
  const done = (data?.titles ?? []).filter((c) => c.reason !== 'unrated')
  const unrated = (data?.titles ?? []).filter((c) => c.reason === 'unrated')
  const sum = (items: CleanupItem[]) => items.reduce((n, c) => n + c.size, 0)
  const tile = (c: CleanupItem) => (
<Tile
  key={c.rating_key}
  thumb={c.thumb}
  title={c.title}
  open={{ rating_key: c.rating_key, type: c.type, title: c.title, year: c.year, thumb: c.thumb }}
  aside={
    <>
      <span className="shrink-0 font-medium whitespace-nowrap tabular-nums">{fmtSize(c.size)}</span>
      {canDelete && (
        <DeleteButton
          label={t('„{title}“ löschen', { title: c.title })}
          onClick={() =>
            setTarget({ ratingKey: c.rating_key, title: c.title, what: t('ganzer Titel'), files: c.files, size: c.size, arr: c.arr, airing: c.airing })
          }
        />
      )}
    </>
  }
  info={meta(typeLabel(c.type), c.year, c.reason === 'owner' ? t('von dir gesehen und bewertet') : c.reason === 'unrated' ? t('alle gesehen') : t('alle fertig'))}
  note={airingNote(c.airing)}
>
  {c.people.map((p) => (
    <PersonLine key={p.user_id} name={p.name} rating={p.rating} status={cleanupStatus(p, c)} />
  ))}
</Tile>
  )

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        {status.data && !status.data.seerrConfigured ? (
          <p className="rounded-lg bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
            {t(
              'Seerr ist nicht verbunden, deshalb kennt Blackbriar weder Wünsche noch Merklisten. Hier steht nur, was du und alle anderen, die den Titel angefangen haben, zu Ende gesehen und bewertet habt. Ob ihn noch jemand sehen will, weiß Blackbriar nicht.',
            )}{' '}
            <a href="#settings/seerr" className="font-medium underline hover:text-amber-100">
              {t('Seerr verbinden')}
            </a>
          </p>
        ) : (
          <p className="text-sm text-zinc-500">
            {t(
              'Titel, die vom Server können: Sie stehen bei niemandem mehr auf der Merkliste, und alle, die sie angefragt haben, haben sie gesehen und bewertet. Hat sie sonst niemand angefragt, zählen deine eigene Sichtung und Bewertung. Serien, an denen jemand in den letzten 30 Tagen weitergeschaut hat, fehlen hier.',
            )}
          </p>
        )}
        {settings.data && !canDelete && (
          <p className="text-sm text-zinc-500">
            {t('Löschen aus Blackbriar ist ausgeschaltet. Du kannst es unter Einstellungen → Bibliothek erlauben.')}
          </p>
        )}
        <ErrorNote message={error} />
        {done.length ? (
          <>
            <p className="text-sm">
              <span className="font-semibold">{t('{n} Titel', { n: done.length })}</span>
              <span className="text-zinc-500"> · {t('zusammen {size}', { size: fmtSize(sum(done)) })}</span>
            </p>
            <TileGrid>{done.map(tile)}</TileGrid>
          </>
        ) : (
          data && <Empty>{t('Im Moment gibt es nichts aufzuräumen.')}</Empty>
        )}
      </section>

      {unrated.length > 0 && (
        <section className="space-y-4">
          <div>
            <Heading>{t('Gesehen, aber nicht bewertet')}</Heading>
            <p className="text-sm text-zinc-500">
              {t(
                'Alle, auf die es ankommt, haben den Titel zu Ende gesehen, aber nicht alle haben bewertet. Seit dem Ansehen sind mindestens {n} Tage vergangen, die Erinnerungen hatten also ihre Zeit.',
                { n: settings.data?.cleanupWaitDays ?? 14 },
              )}
            </p>
          </div>
          <p className="text-sm">
            <span className="font-semibold">{t('{n} Titel', { n: unrated.length })}</span>
            <span className="text-zinc-500"> · {t('zusammen {size}', { size: fmtSize(sum(unrated)) })}</span>
          </p>
          <TileGrid>{unrated.map(tile)}</TileGrid>
        </section>
      )}

      {data && data.episodes.length > 0 && (
        <section className="space-y-4">
          <div>
            <Heading>{t('Gesehene Folgen deiner Serien')}</Heading>
            <p className="text-sm text-zinc-500">
              {t(
                'Serien, von denen du Folgen gesehen hast, die noch auf der Platte liegen. Nur solche, die sonst niemand angefragt hat, auf der Merkliste führt oder gerade schaut.',
              )}
            </p>
          </div>
          <TileGrid>
            {data.episodes.map((show) => (
              <EpisodeTile key={show.rating_key} show={show} canDelete={canDelete} onDelete={setTarget} />
            ))}
          </TileGrid>
        </section>
      )}

      {data && data.deletions.length > 0 && (
        <section>
          <Heading>{t('Zuletzt gelöscht')}</Heading>
          <Card className={LIST_WIDTH}>
            <ul className="divide-y divide-zinc-800/70">
              {data.deletions.map((d) => (
                <li key={`${d.at}-${d.title}-${d.detail}`} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-medium">{d.title}</span>
                    <span className="text-zinc-500"> · {meta(d.detail, fmtSize(d.size))}</span>
                  </span>
                  <span className="shrink-0 text-zinc-500 tabular-nums">{fmtDateTime(d.at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}

      {target && (
        <DeleteDialog target={target} seerr={Boolean(status.data?.seerrConfigured)} onClose={() => setTarget(undefined)} onDone={reload} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

type WaitFilter = 'all' | 'unmonitored' | 'monitored' | 'withFiles' | 'noFiles'
const WAIT_TESTS: Record<WaitFilter, (i: NotInPlexItem) => boolean> = {
  all: () => true,
  unmonitored: (i) => !i.monitored,
  monitored: (i) => i.monitored,
  withFiles: (i) => i.files > 0,
  noFiles: (i) => i.files === 0,
}
const WAIT_PAGE = 60

function airingLabel(i: NotInPlexItem): string {
  if (i.type !== 'show') return ''
  if (i.status === 'ended') return t('beendet')
  if (i.status === 'upcoming') return t('noch nicht gestartet')
  return i.next_airing ? t('nächste Folge {date}', { date: fmtDate(i.next_airing) }) : t('läuft weiter')
}

function filesLabel(i: NotInPlexItem): string {
  if (i.type === 'movie') return i.files > 0 ? t('Datei vorhanden') : t('keine Datei')
  const total = i.total || i.files
  return i.files > 0 ? t('{done} von {total} Folgen vorhanden', { done: Math.min(i.files, total), total }) : t('keine Dateien')
}

/** Was in Radarr und Sonarr steht, aber noch nicht in der Plex-Bibliothek liegt. */
export function NotInPlexView() {
  const { data, error } = useApi<NotInPlexItem[]>('/notinplex', 120_000)
  const status = useApi<Status>('/status')
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<WaitFilter>('all')
  const [type, setType] = useState<TypeFilter>('')
  const [shown, setShown] = useState(WAIT_PAGE)

  if (status.data && !status.data.arrConfigured) {
    return <Empty>{t('Dafür fehlt die Verbindung zu Radarr oder Sonarr. Du kannst sie unter Einstellungen eintragen.')}</Empty>
  }

  const term = search.toLowerCase()
  const inScope = (data ?? []).filter((i) => (!type || i.type === type) && (!term || i.title.toLowerCase().includes(term)))
  const items = inScope.filter(WAIT_TESTS[filter])
  const labels: Record<WaitFilter, string> = {
    all: t('Alle'),
    unmonitored: t('Unbeobachtet'),
    monitored: t('Beobachtet'),
    withFiles: t('Mit Dateien'),
    noFiles: t('Ohne Dateien'),
  }
  const options = Object.fromEntries(
    (Object.keys(labels) as WaitFilter[]).map((id) => [id, `${labels[id]} (${inScope.filter(WAIT_TESTS[id]).length})`]),
  ) as Record<WaitFilter, string>

  return (
    <div className="space-y-4">
      <p className="text-sm text-zinc-500">{t('Filme und Serien, die Radarr oder Sonarr verwaltet, die aber nicht in der Plex-Bibliothek liegen.')}</p>
      <SearchBox
        onSearch={setSearch}
        info={meta(t('{n} Titel', { n: num(items.length) }), fmtSize(items.reduce((sum, i) => sum + i.size, 0)) || '0 GB')}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips value={filter} options={options} onChange={setFilter} />
        <TypeSelect value={type} onChange={setType} />
      </div>
      <ErrorNote message={error} />
      {items.length ? (
        <TileGrid>
          {items.slice(0, shown).map((i) => (
            <Tile
              key={`${i.type}-${i.title}-${i.year}`}
              thumb={null}
              url={i.poster}
              title={i.title}
              aside={i.monitored ? <Badge tone="green">{t('beobachtet')}</Badge> : <Badge>{t('unbeobachtet')}</Badge>}
              info={meta(typeLabel(i.type), i.year, airingLabel(i))}
            >
              <p className="truncate text-sm text-zinc-500">{meta(filesLabel(i), fmtSize(i.size))}</p>
              <p className="truncate text-xs text-sky-300/80">{t('in {where}', { where: instanceNames(i.instances) })}</p>
            </Tile>
          ))}
        </TileGrid>
      ) : (
        data && <Empty>{t('Keine Titel gefunden.')}</Empty>
      )}
      <MoreButton shown={Math.min(shown, items.length)} total={items.length} onClick={() => setShown(shown + WAIT_PAGE)} />
    </div>
  )
}
