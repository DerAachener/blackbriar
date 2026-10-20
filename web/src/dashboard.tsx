import type { ReactNode } from 'react'
import { AlertTriangle, CalendarClock, Hourglass, HardDrive, Inbox, Trash2, type LucideIcon } from 'lucide-react'
import { useApi, type Dashboard, type HistoryItem, type Page, type Rating, type Session, type Storage } from './api'
import { locale, t } from './i18n'
import { MismatchNotice } from './mismatch'
import { useTitleInfo } from './titleinfo'
import { SeasonNotices, VersionNotices } from './notices'
import { ago, Card, Empty, ErrorNote, fmtDate, fmtSize, meta, num, Poster } from './ui'
import { Heading, historyTitle, PersonLine, RatingTile, SessionCard, Tile, TileGrid, userName } from './views'

const dateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString(locale(), { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Eine Zahl mit Beschriftung; der Klick führt zur Ansicht dahinter. */
function Figure({ icon: Icon, label, value, detail, tab, tone = '', children }: {
  icon: LucideIcon
  label: string
  value: string
  detail?: string
  /** Ansicht, die ein Klick öffnet, z. B. „open“ */
  tab: string
  tone?: string
  children?: ReactNode
}) {
  return (
    <a href={`#${tab}`} className="block">
      <Card className="h-full space-y-2 p-4 transition hover:border-zinc-600">
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <Icon size={16} /> {label}
        </p>
        <p className={`text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
        {children}
        {detail && <p className="text-xs text-zinc-500">{detail}</p>}
      </Card>
    </a>
  )
}

export function DashboardView() {
  const live = useApi<{ sessions: Session[]; error: string }>('/sessions', 5000)
  const board = useApi<Dashboard>('/dashboard', 60_000)
  const store = useApi<Storage>('/storage', 300_000)
  const ratings = useApi<Page<Rating>>('/ratings?limit=6', 60_000)
  const history = useApi<Page<HistoryItem>>('/history?limit=6', 60_000)
  const showInfo = useTitleInfo()
  const sessions = live.data?.sessions ?? []
  const d = board.data
  const disk = store.data?.disks[0]
  const used = disk?.total ? Math.min(1, Math.max(0, 1 - disk.free / disk.total)) : null

  return (
    <div className="space-y-8">
      <section>
        <Heading>{t('Aktuelle Wiedergaben ({n})', { n: sessions.length })}</Heading>
        <ErrorNote message={live.error || live.data?.error || ''} />
        {sessions.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,24rem),1fr))] gap-4">
            {sessions.map((s) => (
              <SessionCard key={s.id} s={s} />
            ))}
          </div>
        ) : (
          <Empty>{t('Gerade schaut niemand.')}</Empty>
        )}
      </section>

      <ErrorNote message={board.error} />
      {d && (
        <section className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,14rem),1fr))] gap-4">
          <Figure
            icon={Hourglass}
            label={t('Offene Bewertungen')}
            value={num(d.open)}
            tone={d.open ? 'text-amber-300' : ''}
            detail={d.open ? t('gesehen, aber noch nicht bewertet') : t('alles bewertet')}
            tab="open"
          />
          <Figure
            icon={Trash2}
            label={t('Kann weg')}
            value={fmtSize(d.cleanup.size + d.cleanup.episodeSize) || '0 GB'}
            detail={meta(
              t('{n} Titel', { n: d.cleanup.titles }),
              d.cleanup.episodes > 0 && t(d.cleanup.episodes === 1 ? '{n} gesehene Folge' : '{n} gesehene Folgen', { n: d.cleanup.episodes }),
            )}
            tab="cleanup"
          />
          {disk && (
            <Figure
              icon={HardDrive}
              label={t('Freier Speicher')}
              value={fmtSize(disk.free)}
              detail={disk.total ? t('von {total}', { total: fmtSize(disk.total) }) : undefined}
              tab="files"
            >
              {used != null && (
                <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800" role="img" aria-label={t('{n} % belegt', { n: Math.round(used * 100) })}>
                  <div className={`h-full rounded-full ${used > 0.9 ? 'bg-red-400' : used > 0.75 ? 'bg-amber-400' : 'bg-emerald-400'}`} style={{ width: `${used * 100}%` }} />
                </div>
              )}
            </Figure>
          )}
          {d.pending != null && (
            <Figure
              icon={Inbox}
              label={t('Wünsche in Arbeit')}
              value={num(d.pending)}
              detail={t('angefragt, aber noch nicht auf dem Server')}
              tab="watchlist"
            />
          )}
        </section>
      )}

      {d && (
        <section className="space-y-3">
          <Heading>{t('Im Blick behalten')}</Heading>
          <MismatchNotice />
          <SeasonNotices />
          <VersionNotices />
          {d.warnings.length > 0 && (
            <Card className="space-y-2 border-amber-400/30 bg-amber-400/5 p-4">
              {d.warnings.map((w) => (
                <p key={w} className="flex gap-2 text-sm text-amber-200">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {w}
                </p>
              ))}
            </Card>
          )}
          {d.warnings.length === 0 && d.ready && <Card className="px-4 py-2 text-sm text-zinc-500">{t('Keine Warnungen. Abgleich, Mailversand und Sicherung laufen.')}</Card>}
          <Card className="divide-y divide-zinc-800/70 px-4 py-1 text-sm">
            <p className="flex flex-wrap items-center justify-between gap-x-4 py-2">
              <span className="flex items-center gap-2 text-zinc-400">
                <CalendarClock size={15} /> {t('Nächster Newsletter')}
              </span>
              <span>
                {d.next.newsletter
                  ? meta(dateTime(d.next.newsletter), t('{n} Empfänger', { n: d.next.recipients }))
                  : t('für niemanden eingeschaltet')}
              </span>
            </p>
            <p className="flex flex-wrap items-center justify-between gap-x-4 py-2">
              <span className="flex items-center gap-2 text-zinc-400">
                <CalendarClock size={15} /> {t('Nächster Wochenrückblick per Telegram')}
              </span>
              <span>{d.next.weekly ? dateTime(d.next.weekly) : t('ausgeschaltet')}</span>
            </p>
            {d.unsubscribed > 0 && (
              <p className="flex flex-wrap items-center justify-between gap-x-4 py-2">
                <span className="text-zinc-400">{t('Mails selbst abbestellt')}</span>
                <a href="#settings/newsletter" className="text-amber-300 hover:underline">
                  {t('{n} Benutzer', { n: d.unsubscribed })}
                </a>
              </p>
            )}
          </Card>
        </section>
      )}

      {d && (
        <section>
          <Heading>{t('Neu in den letzten sieben Tagen ({n})', { n: d.added.length })}</Heading>
          {d.added.length ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-4">
              {d.added.map((a) => (
                <button
                  key={a.rating_key}
                  onClick={() => showInfo({ rating_key: a.rating_key, type: a.type, title: a.title, year: a.year, thumb: a.thumb })}
                  className="min-w-0 text-left text-sm transition hover:opacity-80"
                >
                  <Poster thumb={a.thumb} className="w-full" />
                  <p className="mt-1.5 line-clamp-2 leading-snug font-medium" title={a.title}>
                    {a.title}
                  </p>
                  <p className="text-xs text-zinc-500">{a.detail || a.year}</p>
                  {a.section && <p className="truncate text-xs text-zinc-500">{a.section}</p>}
                  <p className="text-xs text-zinc-600">{ago(a.added_at)}</p>
                </button>
              ))}
            </div>
          ) : (
            <Empty>{t('In den letzten sieben Tagen ist nichts dazugekommen.')}</Empty>
          )}
        </section>
      )}

      <section>
        <Heading>{t('Zuletzt gesehen')}</Heading>
        {history.data?.items.length ? (
          <TileGrid>
            {history.data.items.map((h) => {
              const { title, meta: info } = historyTitle(h)
              return (
                <Tile
                  key={h.id}
                  thumb={h.thumb}
                  tmdbPoster={h.poster}
                  title={title}
                  info={info}
                  open={h.rating_key != null ? { rating_key: h.rating_key, type: h.type === 'episode' ? 'show' : h.type, title, thumb: h.thumb, poster: h.poster } : undefined}
                >
                  <PersonLine name={userName(h.user_name, h.user_id)} status={t('gesehen {when}', { when: ago(h.viewed_at) })} />
                  <p className="text-xs text-zinc-500">{fmtDate(h.viewed_at)}</p>
                </Tile>
              )
            })}
          </TileGrid>
        ) : (
          <Empty>{t('Der Verlauf ist noch leer.')}</Empty>
        )}
      </section>

      <section>
        <Heading>{t('Zuletzt bewertet')}</Heading>
        {ratings.data?.items.length ? (
          <TileGrid>
            {ratings.data.items.map((r) => (
              <RatingTile key={`${r.user_id}-${r.rating_key}`} r={r} />
            ))}
          </TileGrid>
        ) : (
          <Empty>{t('Noch keine Bewertungen.')}</Empty>
        )}
      </section>
    </div>
  )
}
