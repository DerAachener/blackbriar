import { useEffect, useState, type ReactNode } from 'react'
import { Pause, Play, RefreshCw, Search } from 'lucide-react'
import {
  api,
  useApi,
  usePaged,
  type HistoryItem,
  type OpenItem,
  type Page,
  type Rating,
  type Session,
  type TitlePerson,
  type TitleSummary,
  type User,
  type WatchlistTitle,
} from './api'
import { locale, t } from './i18n'
import { MismatchNotice } from './mismatch'
import { useTitleInfo, type TitleRef } from './titleinfo'
import {
  ago,
  Badge,
  Button,
  Card,
  Chips,
  Empty,
  episodeCode,
  episodes,
  ErrorNote,
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtSize,
  meta,
  num,
  Poster,
  Stars,
  starValue,
  typeLabel,
  UserTag,
} from './ui'

export const userName = (name: string | null, id: number) => name ?? t('Konto {id}', { id })
export const userQuery = (userId: number | null, prefix: '?' | '&' = '?') => (userId ? `${prefix}user=${userId}` : '')

export function Heading({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-xs font-semibold tracking-wider text-zinc-500 uppercase">{children}</h2>
}

export function List({ children }: { children: ReactNode }) {
  return (
    <Card>
      <ul className="divide-y divide-zinc-800/70">{children}</ul>
    </Card>
  )
}

function Row({
  thumb,
  tmdbPoster,
  title,
  meta,
  user,
  right,
}: {
  thumb: string | null
  tmdbPoster?: string | null
  title: string
  meta: ReactNode
  user: string
  right: ReactNode
}) {
  return (
    <li className="flex items-center gap-4 px-4 py-3">
      <Poster thumb={thumb} tmdbPoster={tmdbPoster} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-sm text-zinc-500">{meta}</p>
        <div className="mt-1.5 sm:hidden">
          <UserTag name={user} />
        </div>
      </div>
      <div className="hidden w-44 sm:block">
        <UserTag name={user} />
      </div>
      <div className="shrink-0 text-right">{right}</div>
    </li>
  )
}

export function MoreButton({ shown, total, onClick }: { shown: number; total: number; onClick: () => void }) {
  if (shown >= total) return null
  return (
    <div className="mt-4 flex justify-center">
      <Button onClick={onClick}>{t('Mehr laden ({shown} von {total})', { shown, total })}</Button>
    </div>
  )
}

/** Mehrere Folgen einer Serie am selben Tag stehen als eine Zeile mit der Spanne der Folgen da. */
export function historyTitle(h: HistoryItem): { title: string; meta: string } {
  if (h.type !== 'episode' || !h.show_title) return { title: h.title, meta: typeLabel(h.type) }
  if (h.count > 1 && h.first_code != null && h.last_code != null) {
    const code = (c: number) => episodeCode(Math.floor(c / 10000), c % 10000)
    return { title: h.show_title, meta: `${episodes(h.count)} · ${code(h.first_code)} – ${code(h.last_code)}` }
  }
  return { title: h.show_title, meta: meta(episodeCode(h.season, h.episode), h.title) }
}

/** „8/11 Folgen“ für den Fortschritt einer Person in einer Serie. */
const progress = (watched: number, total: number) => t('{done}/{total} Folgen', { done: Math.min(watched, total), total })

/** „gesehen 03.10.2026“, oder „als gesehen markiert …“, wenn es dazu keine Wiedergabe gibt. */
export const seenLabel = (p: { seen_at: number | null; marked?: number | boolean }, when: (ts: number) => string = fmtDate) =>
  p.seen_at == null ? t('gesehen') : t(p.marked ? 'als gesehen markiert {when}' : 'gesehen {when}', { when: when(p.seen_at) })

/** Fortschritt in einer Serie; markierte Folgen sind eigens ausgewiesen, damit sichtbar bleibt, was wirklich lief. */
export const showProgress = (p: { watched: number | null; marked?: number }, total: number) =>
  meta(progress(p.watched ?? 0, total), p.marked ? t('{n} davon nur markiert', { n: Math.min(p.marked, total) }) : '')

// ---------------------------------------------------------------------------

export function SessionCard({ s }: { s: Session }) {
  const isEpisode = s.type === 'episode' && s.showTitle
  const percent = s.durationMs ? Math.min(100, (s.offsetMs / s.durationMs) * 100) : 0
  const paused = s.state === 'paused'
  return (
    <Card className="flex gap-4 p-4">
      <Poster thumb={s.thumb} className="w-24" />
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-lg font-semibold">{isEpisode ? s.showTitle : s.title}</p>
        <p className="truncate text-sm text-zinc-400">{isEpisode ? meta(episodeCode(s.season, s.episode), s.title) : s.year}</p>
        <p className="mt-3 truncate text-sm font-medium">{s.user}</p>
        <p className="mt-1 truncate text-xs text-zinc-500">{meta(s.platform, s.player)}</p>
        <div className="mt-auto pt-3">
          <div className="flex flex-wrap gap-1.5">
            <Badge tone={paused ? 'zinc' : 'green'}>
              <span className="inline-flex items-center gap-1">
                {paused ? <Pause size={11} /> : <Play size={11} />}
                {paused ? t('Pausiert') : t('Läuft')}
              </span>
            </Badge>
            <Badge tone={s.decision === 'Transcode' ? 'amber' : 'zinc'}>{s.decision}</Badge>
            {s.resolution && <Badge>{/^\d+$/.test(s.resolution) ? `${s.resolution}p` : s.resolution.toUpperCase()}</Badge>}
            {s.location && <Badge>{s.location.toUpperCase()}</Badge>}
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full rounded-full bg-amber-400" style={{ width: `${percent}%` }} />
          </div>
          <p className="mt-1 flex justify-between text-xs text-zinc-500 tabular-nums">
            <span>{fmtDuration(s.offsetMs)}</span>
            <span>{fmtDuration(s.durationMs)}</span>
          </p>
        </div>
      </div>
    </Card>
  )
}

// ---------------------------------------------------------------------------

export function RatingTile({ r }: { r: Rating }) {
  return (
    <Tile
      thumb={r.thumb}
      title={r.title}
      open={{ rating_key: r.rating_key, type: r.type, title: r.title, year: r.year, thumb: r.thumb }}
      info={meta(
        typeLabel(r.type),
        r.year,
        fmtSize(r.size),
        r.seen_at ? t('gesehen am {date}', { date: fmtDate(r.seen_at) }) : t('nicht im Verlauf'),
      )}
    >
      <p className="flex items-center gap-2 text-sm text-zinc-300">
        <span className="truncate">{userName(r.user_name, r.user_id)}</span>
        <span className="text-zinc-600">–</span>
        <Stars value={r.rating} showValue={false} />
      </p>
      {r.rated_at && <p className="text-xs text-zinc-500">{fmtDate(r.rated_at)}</p>}
    </Tile>
  )
}

export function RatingsView({ userId }: { userId: number | null }) {
  const { items, total, error, more } = usePaged<Rating>(`/ratings${userQuery(userId)}`)
  return (
    <div>
      <ErrorNote message={error} />
      {items.length ? (
        <TileGrid>
          {items.map((r) => (
            <RatingTile key={`${r.user_id}-${r.rating_key}`} r={r} />
          ))}
        </TileGrid>
      ) : (
        <Empty>{t('Noch keine Bewertungen.')}</Empty>
      )}
      <MoreButton shown={items.length} total={total} onClick={more} />
    </div>
  )
}

/** Suchfeld, das den Wert erst nach einer kurzen Tipp-Pause weitergibt. */
export function SearchBox({ onSearch, info, placeholder }: { onSearch: (value: string) => void; info: string; placeholder?: string }) {
  const [input, setInput] = useState('')
  useEffect(() => {
    const timer = setTimeout(() => onSearch(input.trim()), 300)
    return () => clearTimeout(timer)
  }, [input, onSearch])
  return (
    <label className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 focus-within:border-zinc-600">
      <Search size={16} className="text-zinc-500" />
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        placeholder={placeholder ?? t('Titel suchen')}
        className="w-full bg-transparent text-sm outline-none placeholder:text-zinc-600"
      />
      <span className="text-xs whitespace-nowrap text-zinc-500">{info}</span>
    </label>
  )
}

export const queryString = (parts: (string | false | 0 | null)[]) => {
  const query = parts.filter(Boolean).join('&')
  return query ? `?${query}` : ''
}

/** Kachel wie unter „Offene Bewertungen“: Poster links, alles Weitere daneben. */
export function Tile({
  thumb,
  tmdbPoster,
  url,
  title,
  aside,
  info,
  note,
  open,
  children,
}: {
  thumb: string | null
  tmdbPoster?: string | null
  url?: string | null
  title: string
  /** Steht rechts neben dem Titel, z. B. die Größe */
  aside?: ReactNode
  info: string
  /** Hervorgehobene Zusatzzeile */
  note?: string
  /** Mit dieser Angabe öffnet ein Klick auf Bild oder Titel das Info-Fenster */
  open?: TitleRef
  children?: ReactNode
}) {
  const showInfo = useTitleInfo()
  const poster = <Poster thumb={thumb} tmdbPoster={tmdbPoster} url={url} className="w-14" />
  return (
    <Card className="flex gap-4 p-3">
      {open ? (
        <button onClick={() => showInfo(open)} className="shrink-0 self-start rounded-md transition hover:opacity-80" aria-label={t('Infos zu „{title}“', { title })}>
          {poster}
        </button>
      ) : (
        <span className="shrink-0 self-start">{poster}</span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          {open ? (
            <button onClick={() => showInfo(open)} className="min-w-0 flex-1 truncate text-left font-medium hover:text-amber-300">
              {title}
            </button>
          ) : (
            <p className="min-w-0 flex-1 truncate font-medium">{title}</p>
          )}
          {aside}
        </div>
        <p className="truncate text-sm text-zinc-500">{info}</p>
        {note && <p className="truncate text-xs text-amber-300/80">{note}</p>}
        {children}
      </div>
    </Card>
  )
}

export function TileGrid({ children }: { children: ReactNode }) {
  // So viele Spalten, wie mit mindestens 19rem Breite passen: eine am Handy, fünf oder mehr am großen Monitor
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,19rem),1fr))] gap-3">{children}</div>
}

/** Eine Zeile pro Person in einer Kachel: Name – Stand, dahinter die Bewertung. */
export function PersonLine({ name, status, highlight, rating }: { name: string; status: string; highlight?: boolean; rating?: number | null }) {
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className="max-w-[45%] shrink-0 truncate text-zinc-300">{name}</span>
      <span className="text-zinc-600">–</span>
      <span className={`truncate ${highlight ? 'text-amber-300' : 'text-zinc-500'}`} title={status}>
        {status}
      </span>
      {rating != null && <span className="shrink-0 font-medium whitespace-nowrap text-amber-400">★ {starValue(rating)}</span>}
    </p>
  )
}

function titleStatus(p: TitlePerson, item: TitleSummary): { status: string; highlight: boolean } {
  const isShow = item.type === 'show'
  // Bei gelöschten Titeln ist nicht mehr bekannt, wie viele Folgen es gab, und zu tun ist auch nichts mehr
  if (item.gone) {
    const seen = isShow ? (p.watched ? t(p.watched === 1 ? '{n} Folge gesehen' : '{n} Folgen gesehen', { n: p.watched }) : '') : p.seen_at ? seenLabel(p) : ''
    return { status: seen || t('nicht gesehen'), highlight: false }
  }
  const complete = isShow ? item.leaf_count > 0 && (p.watched ?? 0) >= item.leaf_count : p.seen_at != null
  const seen = isShow ? (p.watched ? showProgress(p, item.leaf_count) : t('nicht gesehen')) : p.seen_at ? seenLabel(p) : t('nicht gesehen')
  const open = complete && p.rating == null
  return { status: open ? meta(seen, t('nicht bewertet')) : seen, highlight: open }
}

export function TitlesView({ userId }: { userId: number | null }) {
  const [search, setSearch] = useState('')
  const [shared, setShared] = useState(false)
  const [gone, setGone] = useState(true)
  const query = queryString([userId && `user=${userId}`, search && `q=${encodeURIComponent(search)}`, shared && 'min=2', !gone && 'gone=0'])
  const { items, total, error, more } = usePaged<TitleSummary>(`/titles${query}`, 30)

  return (
    <div className="space-y-4">
      <SearchBox onSearch={setSearch} info={t('{n} Titel', { n: num(total) })} />
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-zinc-400">
        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="h-4 w-4 accent-amber-400" />
        {t('Nur Titel, die mehrere gesehen oder bewertet haben')}
      </label>
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-zinc-400">
        <input type="checkbox" checked={gone} onChange={(e) => setGone(e.target.checked)} className="h-4 w-4 accent-amber-400" />
        {t('Auch Titel zeigen, die nicht mehr auf dem Server liegen')}
      </label>
      <ErrorNote message={error} />
      {items.length ? (
        <TileGrid>
          {items.map((item) => (
            <Tile
              key={item.rating_key ?? `${item.type}-${item.title}`}
              thumb={item.thumb}
              tmdbPoster={item.poster}
              title={item.title}
              info={meta(typeLabel(item.type), item.year, fmtSize(item.size))}
              note={item.gone ? t('nicht mehr auf dem Server') : undefined}
              open={item.gone ? undefined : { rating_key: item.rating_key, type: item.type, title: item.title, year: item.year, thumb: item.thumb }}
            >
              {item.people.map((p) => (
                <PersonLine key={p.user_id} name={p.name} rating={p.rating} {...titleStatus(p, item)} />
              ))}
            </Tile>
          ))}
        </TileGrid>
      ) : (
        <Empty>{t('Keine Titel gefunden.')}</Empty>
      )}
      <MoreButton shown={items.length} total={total} onClick={more} />
    </div>
  )
}

function watchlistStatus(p: TitlePerson, item: WatchlistTitle): { status: string; highlight: boolean } {
  const isShow = item.type === 'show'
  const finished = isShow ? item.leaf_count > 0 && (p.watched ?? 0) >= item.leaf_count : p.seen_at != null
  let status: string
  if (item.rating_key == null) status = t('wartet')
  else if (finished) status = seenLabel(p)
  else if (isShow && p.watched) status = showProgress(p, item.leaf_count)
  else status = t('noch nicht gesehen')
  return { status, highlight: finished }
}

type WatchlistFilter = 'all' | 'done' | 'shared' | 'missing'

export function WatchlistView({ userId, configured }: { userId: number | null; configured: boolean }) {
  const { data, error } = useApi<WatchlistTitle[]>(`/watchlist${userQuery(userId)}`, 60_000)
  const [filter, setFilter] = useState<WatchlistFilter>('all')
  const [search, setSearch] = useState('')

  if (!configured) {
    return <Empty>{t('Für die Merklisten fehlt die Verbindung zu Seerr. Du kannst sie unter Einstellungen eintragen.')}</Empty>
  }

  const isDone = (item: WatchlistTitle) =>
    item.people.some((p) => (item.type === 'show' ? item.leaf_count > 0 && (p.watched ?? 0) >= item.leaf_count : p.seen_at != null))
  const tests: Record<WatchlistFilter, (item: WatchlistTitle) => boolean> = {
    all: () => true,
    done: isDone,
    shared: (item) => item.people.length > 1,
    missing: (item) => item.rating_key == null,
  }
  const labels: Record<WatchlistFilter, string> = {
    all: t('Alle'),
    done: t('Gesehen, noch auf der Merkliste'),
    shared: t('Von mehreren gewünscht'),
    missing: t('Nicht auf dem Server'),
  }
  const options = Object.fromEntries(
    (Object.keys(labels) as WatchlistFilter[]).map((id) => [id, `${labels[id]} (${(data ?? []).filter(tests[id]).length})`]),
  ) as Record<WatchlistFilter, string>
  // Gesucht wird im Titel und in den Namen derer, die ihn auf der Merkliste haben
  const needle = search.toLowerCase()
  const items = (data ?? [])
    .filter(tests[filter])
    .filter((item) => !needle || item.title.toLowerCase().includes(needle) || item.people.some((p) => p.name.toLowerCase().includes(needle)))
    .sort((a, b) => a.title.localeCompare(b.title, locale()))

  return (
    <div className="space-y-4">
      <MismatchNotice />
      <SearchBox onSearch={setSearch} info={t('{n} Titel', { n: num(items.length) })} placeholder={t('Titel oder Name suchen')} />
      <Chips value={filter} options={options} onChange={setFilter} />
      <ErrorNote message={error} />
      {items.length ? (
        <TileGrid>
          {items.map((item) => (
            <Tile
              key={`${item.type}-${item.tmdb_id}`}
              thumb={item.thumb}
              tmdbPoster={item.poster}
              title={item.title}
              open={{ rating_key: item.rating_key, type: item.type, tmdb_id: item.tmdb_id, title: item.title, year: item.year, thumb: item.thumb, poster: item.poster }}
              info={meta(typeLabel(item.type), item.year, fmtSize(item.size))}
              note={item.rating_key == null ? meta(t('nicht auf dem Server'), item.request?.label ?? t('nicht angefragt')) : undefined}
            >
              {item.people.map((p) => (
                <PersonLine key={p.user_id} name={p.name} rating={p.rating} {...watchlistStatus(p, item)} />
              ))}
            </Tile>
          ))}
        </TileGrid>
      ) : (
        data && <Empty>{t('Keine Einträge auf der Merkliste.')}</Empty>
      )}
    </div>
  )
}

/** Listen bleiben auch am großen Monitor lesbar schmal. */
export const LIST_WIDTH = 'max-w-6xl'

export function HistoryView({ userId }: { userId: number | null }) {
  const [search, setSearch] = useState('')
  const query = queryString([userId && `user=${userId}`, search && `q=${encodeURIComponent(search)}`])
  const { items, total, error, more } = usePaged<HistoryItem>(`/history${query}`)

  return (
    <div className={`space-y-4 ${LIST_WIDTH}`}>
      <SearchBox onSearch={setSearch} info={t('{n} Einträge', { n: num(total) })} />
      <ErrorNote message={error} />
      {items.length ? (
        <List>
          {items.map((h) => (
            <Row
              key={h.id}
              thumb={h.thumb}
              tmdbPoster={h.poster}
              {...historyTitle(h)}
              user={userName(h.user_name, h.user_id)}
              right={<span className="text-sm text-zinc-400 tabular-nums">{fmtDateTime(h.viewed_at)}</span>}
            />
          ))}
        </List>
      ) : (
        <Empty>{t('Keine Einträge gefunden.')}</Empty>
      )}
      <MoreButton shown={items.length} total={total} onClick={more} />
    </div>
  )
}

// ---------------------------------------------------------------------------

const INACTIVE_DAYS = [30, 90, 180, 365]

export function UsersView({ users, onSelect }: { users: User[]; onSelect: (id: number) => void }) {
  // Ab wann jemand als inaktiv gilt, merkt sich der Browser
  const [days, setDays] = useState(() => Number(localStorage.getItem('inactive-days')) || 90)
  const [onlyInactive, setOnlyInactive] = useState(false)
  if (!users.length) return <Empty>{t('Noch keine Benutzer geladen.')}</Empty>
  const cutoff = Date.now() / 1000 - days * 86400
  // Nur wer noch Zugriff hat, kann inaktiv sein; ohne Verlauf zählt als nie aktiv
  const inactive = (u: User) => Boolean(u.active) && !u.is_owner && (u.last_seen ?? 0) < cutoff
  const count = users.filter(inactive).length
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          onClick={() => setOnlyInactive(!onlyInactive)}
          className={`rounded-lg px-3 py-1.5 font-medium ${onlyInactive ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
        >
          {t('Inaktiv ({n})', { n: count })}
        </button>
        <label className="flex items-center gap-2 text-zinc-400">
          {t('seit mindestens')}
          <select
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value))
              localStorage.setItem('inactive-days', e.target.value)
            }}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 outline-none focus:border-zinc-600"
          >
            {INACTIVE_DAYS.map((n) => (
              <option key={n} value={n}>
                {t('{n} Tagen', { n })}
              </option>
            ))}
          </select>
        </label>
      </div>
      {onlyInactive && count === 0 && <Empty>{t('Niemand mit Zugriff war so lange inaktiv.')}</Empty>}
    <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-4">
      {users.filter((u) => !onlyInactive || inactive(u)).map((u) => {
        const figures: [string, number, string][] = [
          [t('Gesehen'), u.plays, ''],
          [t('Bewertet'), u.ratings, ''],
          [t('Offen'), u.open, u.open ? 'text-amber-300' : ''],
        ]
        return (
          <button key={u.id} onClick={() => onSelect(u.id)} className="text-left">
            <Card className={`p-4 transition hover:border-zinc-600 ${u.active ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{u.name}</p>
                  <p className="text-xs text-zinc-500">
                    {u.last_seen ? t('zuletzt aktiv {when}', { when: ago(u.last_seen) }) : t('noch nichts gesehen')}
                  </p>
                </div>
                {u.is_owner ? (
                  <Badge tone="amber">{t('Besitzer')}</Badge>
                ) : !u.active ? (
                  <Badge>{t('kein Zugriff')}</Badge>
                ) : (
                  inactive(u) && <Badge tone="red">{t('inaktiv')}</Badge>
                )}
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
                {figures.map(([label, value, tone]) => (
                  <div key={label} className="rounded-lg bg-zinc-800/50 py-2">
                    <dd className={`text-lg font-semibold tabular-nums ${tone}`}>{num(value)}</dd>
                    <dt className="text-xs text-zinc-500">{label}</dt>
                  </div>
                ))}
              </dl>
            </Card>
          </button>
        )
      })}
    </div>
    </div>
  )
}
