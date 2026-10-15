import { useEffect, useState } from 'react'
import { Check, Copy, Trash2 } from 'lucide-react'
import { api, useApi, type DetailPerson, type Settings, type Status, type TitleDetail } from './api'
import { locale, t } from './i18n'
import { DeleteDialog, type DeleteTarget } from './media'
import { CHANGED, type TitleRef } from './titleinfo'
import { Badge, episodeCode, episodes, ErrorNote, fileResolution, fileValues, fmtDate, fmtDateTime, fmtSize, meta, num, typeLabel } from './ui'
import { ArrLink, InfoDialog } from './upcoming'
import { PersonLine, seenLabel } from './views'

const resolution = fileResolution
const mixed = fileValues
const bitrate = (kbps: number | null) => (kbps ? `${(kbps / 1000).toLocaleString(locale(), { maximumFractionDigits: 1 })} Mbit/s` : '')

function personStatus(p: DetailPerson, d: TitleDetail): { status: string; highlight: boolean } {
  const isShow = d.type === 'show'
  const finished = isShow ? d.leaf_count > 0 && (p.watched ?? 0) >= d.leaf_count : p.seen_at != null
  const seen = isShow
    ? p.watched
      ? meta(
          t('{done}/{total} Folgen', { done: Math.min(p.watched, d.leaf_count || p.watched), total: d.leaf_count || p.watched }),
          p.marked > 0 && t('{seen} gesehen, {marked} als gesehen markiert', { seen: Math.max(0, p.watched - p.marked), marked: p.marked }),
          p.seen_at && t('zuletzt {date}', { date: fmtDate(p.seen_at) }),
        )
      : d.rating_key != null && t('nicht gesehen')
    : p.seen_at
      ? seenLabel(p)
      : d.rating_key != null && t('nicht gesehen')
  const open = finished && p.rating == null
  return { status: meta(p.requested && t('angefragt'), p.on_watchlist && t('Merkliste'), seen, open && t('nicht bewertet')), highlight: open }
}

function Label({ children }: { children: string }) {
  return <p className="pt-2 text-xs font-semibold tracking-wider text-zinc-500 uppercase first:pt-0">{children}</p>
}

/** Pfad der Datei bzw. des Serienordners, so wie Plex ihn sieht; lässt sich kopieren, wo der Browser das erlaubt. */
function PathLine({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)
  const copy = () =>
    void navigator.clipboard.writeText(path).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  return (
    <p className="flex items-start gap-2 text-xs text-zinc-500">
      <span className="min-w-0 break-all select-all">{path}</span>
      {navigator.clipboard && (
        <button onClick={copy} title={t('Pfad kopieren')} aria-label={t('Pfad kopieren')} className="shrink-0 rounded p-0.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300">
          {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
        </button>
      )}
    </p>
  )
}

/** Was Blackbriar selbst zu dem Titel weiß: Datei, Personen, letzte Wiedergaben. */
function Facts({ d, canDelete, onDelete }: { d: TitleDetail; canDelete: boolean; onDelete: () => void }) {
  const f = d.file
  return (
    <div className="space-y-1 text-sm">
      <Label>{t('Auf dem Server')}</Label>
      {d.rating_key == null ? (
        <p className="text-amber-300/90">{meta(t('nicht auf dem Server'), d.request ?? t('nicht angefragt'))}</p>
      ) : (
        <>
          {/* Beschriftung über jedem Wert: Sonst ist bei „gemischt“ nicht zu erkennen, was gemeint ist */}
          {/* Jede Spalte so breit wie ihr Inhalt: Gleich breite Spalten brechen längere Werte wie „hevc und h264“ um */}
          <dl className="flex flex-wrap justify-around gap-x-4 gap-y-2 py-1 text-center">
            {(
              [
                [t('Mediathek'), d.section],
                [t('Größe'), fmtSize(f?.size)],
                [t('Folgen'), d.type === 'show' && f ? num(f.files) : ''],
                [t('Auflösung'), resolution(f?.resolution ?? null)],
                [t('Video-Codec'), mixed(f?.video_codec ?? null)],
                [t('Bitrate'), bitrate(f?.bitrate ?? null)],
                [t('Dateiformat'), mixed(f?.container ?? null)],
              ] as const
            )
              .filter(([, value]) => value)
              .map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[11px] tracking-wide text-zinc-500 uppercase">{label}</dt>
                  <dd className="whitespace-nowrap text-zinc-200">{value}</dd>
                </div>
              ))}
          </dl>
          <p className="text-zinc-500">{meta(d.added_at && t('hinzugefügt am {date}', { date: fmtDate(d.added_at) }), d.request && t('Seerr: {state}', { state: d.request }))}</p>
          {d.path && <PathLine path={d.path} />}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {f && f.files > 0 && f.converted === f.files && <Badge tone="green">{t('umgewandelt')}</Badge>}
            {f && f.converted > 0 && f.converted < f.files && <Badge tone="amber">{t('{done}/{total} umgewandelt', { done: f.converted, total: f.files })}</Badge>}
            {d.arr.map((a) => (
              <ArrLink key={a.name} name={a.name} url={a.url} />
            ))}
            {d.airing && (
              <span className="text-xs text-amber-300/80">{meta(t('läuft noch'), d.airing.next && t('nächste Folge {date}', { date: fmtDate(d.airing.next) }))}</span>
            )}
          </div>
        </>
      )}

      {d.seasons.length > 0 && (
        <>
          <Label>{t('Staffeln')}</Label>
          <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
          {d.seasons.map((s) => (
            <p key={s.season} className="text-zinc-400">
              {meta(
                s.season === 0 ? t('Extras') : t('Staffel {n}', { n: s.season }),
                episodes(s.episodes),
                fmtSize(s.size),
                s.groups.map((g) => (s.groups.length > 1 ? `${g.name} (${g.episodes})` : g.name)).join(', '),
              )}
            </p>
          ))}
          </div>
        </>
      )}

      <Label>{t('Wer')}</Label>
      {d.people.length ? (
        d.people.map((p) => <PersonLine key={p.user_id} name={p.name} rating={p.rating} {...personStatus(p, d)} />)
      ) : (
        <p className="text-zinc-500">{t('Bisher hat ihn niemand gesehen, bewertet oder gewünscht.')}</p>
      )}

      {d.plays.length > 0 && (
        <>
          <Label>{t('Letzte Wiedergaben')}</Label>
          <ul className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
            {d.plays.map((p, i) => (
              <li key={i} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-zinc-300">
                  {p.user_name}
                  {d.type === 'show' && <span className="text-zinc-500"> · {meta(episodeCode(p.season, p.episode), p.title)}</span>}
                </span>
                <span className="shrink-0 text-xs text-zinc-500 tabular-nums">{fmtDateTime(p.viewed_at)}</span>
              </li>
            ))}
          </ul>
          {d.plays_total > d.plays.length && <p className="text-xs text-zinc-600">{t('die letzten {shown} von {total}', { shown: d.plays.length, total: d.plays_total })}</p>}
        </>
      )}

      {canDelete && d.rating_key != null && f && f.files > 0 && (
        <div className="pt-2">
          <button onClick={onDelete} className="inline-flex items-center gap-2 rounded-lg bg-red-400/10 px-3 py-1.5 text-sm font-medium text-red-300 transition hover:bg-red-400/20">
            <Trash2 size={15} /> {t('Vom Server löschen')}
          </button>
        </div>
      )}
    </div>
  )
}

/** Das Info-Fenster zu einem Titel: oben die Kurzinfo von TMDB, darunter alles aus Blackbriar. */
export function TitleDialog({ target, onClose }: { target: TitleRef; onClose: () => void }) {
  const settings = useApi<Settings>('/settings')
  const status = useApi<Status>('/status')
  const [detail, setDetail] = useState<TitleDetail>()
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState<DeleteTarget>()
  const [deleted, setDeleted] = useState(false)

  useEffect(() => {
    let active = true
    const query = [target.rating_key != null && `key=${target.rating_key}`, target.type && `type=${target.type}`, target.tmdb_id != null && `tmdb=${target.tmdb_id}`]
      .filter(Boolean)
      .join('&')
    api<TitleDetail>(`/title?${query}`)
      .then((d) => active && setDetail(d))
      .catch((e: Error) => active && setError(e.message))
    return () => {
      active = false
    }
  }, [target.rating_key, target.type, target.tmdb_id])

  const d = detail
  const type = d?.type ?? (target.type === 'show' ? 'show' : 'movie')
  const onWatchlists = (d?.people ?? []).filter((p) => p.on_watchlist).map((p) => p.name)
  return (
    <>
      <InfoDialog
        tmdb={Boolean(status.data?.tmdbConfigured)}
        onClose={() => !deleting && onClose()}
        target={{
          type,
          tmdb_id: d?.tmdb_id ?? target.tmdb_id ?? null,
          title: d?.title || target.title,
          year: d?.year ?? target.year,
          thumb: d?.thumb ?? target.thumb,
          poster: d?.poster ?? target.poster,
          overview: d?.summary,
          contextBelow: true,
          context: d ? (
            <Facts
              d={d}
              canDelete={Boolean(settings.data?.allowDelete)}
              onDelete={() =>
                setDeleting({
                  ratingKey: d.rating_key!,
                  title: d.title,
                  what: t('ganzer Titel'),
                  files: d.file?.files ?? 0,
                  size: d.file?.size ?? 0,
                  arr: d.arr.map((a) => a.name),
                  airing: d.airing,
                  note: onWatchlists.length ? t('Er steht noch auf der Merkliste von {names}.', { names: onWatchlists.join(', ') }) : undefined,
                })
              }
            />
          ) : error ? (
            <ErrorNote message={error} />
          ) : (
            <p className="text-sm text-zinc-500">{meta(typeLabel(type), t('Lade …'))}</p>
          ),
        }}
      />
      {deleting && (
        <DeleteDialog
          target={deleting}
          seerr={Boolean(status.data?.seerrConfigured)}
          onClose={() => {
            setDeleting(undefined)
            // Nach dem Löschen gibt es zu dem Titel nichts mehr zu zeigen
            if (deleted) onClose()
          }}
          onDone={() => {
            setDeleted(true)
            dispatchEvent(new Event(CHANGED))
          }}
        />
      )}
    </>
  )
}
