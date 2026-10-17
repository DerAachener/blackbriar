import { useState } from 'react'
import { Copy, EyeOff, ExternalLink, FolderTree, PackageCheck, Shuffle, Trash2 } from 'lucide-react'
import { api, useApi, type Notice, type NoticeVersion } from './api'
import { t } from './i18n'
import { fileResolution, fmtSize, meta, Poster } from './ui'

/** Hinweise zu Serien: Staffel komplett oder Folgen von verschiedenen Release-Gruppen; erscheint nur, wenn es welche gibt. */
export function SeasonNotices() {
  const { data: all, reload } = useApi<Notice[]>('/notices', 300_000)
  const data = all?.filter((n) => n.kind === 'complete' || n.kind === 'groups')
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  // Bei vielen Hinweisen stehen zunächst nur die ersten da, sonst verdrängt der Abschnitt den Rest des Dashboards
  const [expanded, setExpanded] = useState(false)
  if (!data?.length) return null
  const FIRST = 3
  const shown = expanded ? data : data.slice(0, FIRST)

  const act = (id: number, what: 'ignore' | 'unmonitor') => {
    setBusy(id)
    setError('')
    void api(`/notices/${id}/${what}`, { method: 'POST' })
      .catch((err: Error) => setError(err.message))
      .finally(() => {
        setBusy(null)
        reload()
      })
  }

  return (
    <section className="space-y-3 rounded-xl border border-sky-400/30 bg-sky-400/5 p-4">
      <div className="space-y-1">
        <p className="font-medium text-sky-200">{t('Serien: Staffeln und Release-Gruppen')}</p>
        <p className="text-sm text-zinc-400">
          {t(
            'Komplette Staffeln kannst du in Sonarr auf „nicht beobachtet“ setzen, damit Sonarr nichts mehr daran austauscht. Bei gemischten Release-Gruppen zählt die Gruppe mit den meisten Folgen der Staffel.',
          )}
        </p>
        {error && <p className="text-sm text-red-300">{error}</p>}
      </div>
      <ul className="space-y-2">
        {shown.map((n) => (
          <li key={n.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-zinc-900/70 p-2">
            <Poster thumb={n.thumb} className="w-10" />
            <div className="min-w-0 flex-1 basis-56 text-sm">
              <p className="flex items-center gap-2 font-medium">
                {n.kind === 'complete' ? <PackageCheck size={15} className="shrink-0 text-emerald-300" /> : <Shuffle size={15} className="shrink-0 text-amber-300" />}
                <span>
                  {n.title} · {t('Staffel {n}', { n: n.season })}
                </span>
              </p>
              <p className="text-zinc-400">{n.detail}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {n.kind === 'complete' && (
                <button
                  onClick={() => act(n.id, 'unmonitor')}
                  disabled={busy === n.id}
                  className="rounded-md bg-sky-500/20 px-3 py-1.5 text-sm text-sky-100 transition hover:bg-sky-500/30 disabled:opacity-50"
                >
                  {t('Auf „nicht beobachtet“ setzen')}
                </button>
              )}
              {n.url && (
                <a
                  href={n.url}
                  target="_blank"
                  rel="noreferrer"
                  title={t('In Sonarr öffnen')}
                  aria-label={t('In Sonarr öffnen')}
                  className="rounded-md p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                >
                  <ExternalLink size={16} />
                </a>
              )}
              <button
                onClick={() => act(n.id, 'ignore')}
                disabled={busy === n.id}
                title={t('Hinweis ausblenden')}
                aria-label={t('Hinweis ausblenden')}
                className="rounded-md p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
              >
                <EyeOff size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {data.length > FIRST && (
        <button onClick={() => setExpanded(!expanded)} className="text-sm text-sky-200 hover:underline">
          {expanded ? t('Weniger anzeigen') : t('{n} weitere anzeigen', { n: data.length - FIRST })}
        </button>
      )}
    </section>
  )
}

/** Eine Datei eines Films mit ihren Angaben; die umgewandelte ist markiert. */
function VersionLine({ v, showFolder }: { v: NoticeVersion; showFolder?: boolean }) {
  const audio = [v.audio_codec?.toUpperCase(), v.audio_channels ? `${v.audio_channels} ${t('Kanäle')}` : ''].filter(Boolean).join(' ')
  return (
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-2">
        <span className="break-all">{v.file}</span>
        {!showFolder && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${v.converted ? 'bg-emerald-400/15 text-emerald-300' : 'bg-zinc-800 text-zinc-400'}`}
          >
            {v.converted ? t('umgewandelt') : t('alt')}
          </span>
        )}
      </span>
      <span className="block text-xs text-zinc-500">{meta(showFolder ? t('Ordner: {name}', { name: v.folder }) : '', fmtSize(v.size), fileResolution(v.resolution), v.video_codec ?? '', audio)}</span>
    </span>
  )
}

/** Filme mit mehr als einer Datei in derselben Fassung, etwa nach dem Umwandeln; die alte lässt sich hier löschen. */
export function VersionNotices() {
  const { data: all, reload } = useApi<Notice[]>('/notices', 300_000)
  const data = all?.filter((n) => n.kind === 'versions' || n.kind === 'merged')
  const [busy, setBusy] = useState<number | null>(null)
  const [message, setMessage] = useState<{ text: string; ok: boolean }>()
  // Wie bei den Serien: zunächst drei, der Rest lässt sich aufklappen
  const [expanded, setExpanded] = useState(false)
  if (!data?.length && !message) return null
  const FIRST = 3
  const shown = expanded ? (data ?? []) : (data ?? []).slice(0, FIRST)

  const ignore = (id: number) => {
    setBusy(id)
    void api(`/notices/${id}/ignore`, { method: 'POST' }).finally(() => {
      setBusy(null)
      reload()
    })
  }
  const remove = (n: Notice, v: NoticeVersion) => {
    if (!confirm(t('„{file}“ aus „{title}“ löschen? Die Datei wird in Plex endgültig gelöscht, die andere Version bleibt.', { file: v.file, title: n.title }))) return
    setBusy(n.id)
    setMessage(undefined)
    api<{ message: string }>(`/notices/${n.id}/delete-version`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mediaId: v.media_id }) })
      .then((r) => setMessage({ text: `${n.title}: ${r.message}`, ok: true }))
      .catch((err: Error) => setMessage({ text: err.message, ok: false }))
      .finally(() => {
        setBusy(null)
        reload()
      })
  }

  return (
    <section className="space-y-3 rounded-xl border border-violet-400/30 bg-violet-400/5 p-4">
      <div className="space-y-1">
        <p className="font-medium text-violet-200">{t('Filme: mehrere Dateien')}</p>
        <p className="text-sm text-zinc-400">
          {t(
            'Liegen zwei Dateien eines Films im selben Ordner, ist meist eine alt, etwa nach dem Umwandeln; 4K und 1080p zählen getrennt. Nach dem Löschen liest Radarr den Film neu ein und übernimmt die verbliebene Datei. Liegen sie in verschiedenen Ordnern, hat Plex zwei Filme zusammengelegt.',
          )}
        </p>
        {message && <p className={`text-sm ${message.ok ? 'text-emerald-300' : 'text-red-300'}`}>{message.text}</p>}
      </div>
      <ul className="space-y-2">
        {shown.map((n) => (
          <li key={n.id} className="flex flex-wrap items-start gap-3 rounded-lg bg-zinc-900/70 p-2">
            <Poster thumb={n.thumb} className="w-10" />
            <div className="min-w-0 flex-1 basis-64 space-y-2 text-sm">
              <p className="flex items-center gap-2 font-medium">
                {n.kind === 'merged' ? <FolderTree size={15} className="shrink-0 text-amber-300" /> : <Copy size={15} className="shrink-0 text-violet-300" />}
                <span>{n.title}</span>
              </p>
              {n.kind === 'merged' && (
                <div className="space-y-1 rounded-md border border-amber-400/20 bg-amber-400/5 p-2 text-zinc-300">
                  <p>{n.detail}</p>
                  <p className="text-xs text-zinc-400">
                    {t('In Plex beim Film auf „…“ → „Aufteilen“ klicken. Danach beim falsch erkannten Eintrag „Zuordnung korrigieren“ wählen. Der Hinweis verschwindet beim nächsten Abgleich.')}
                  </p>
                </div>
              )}
              <ul className="space-y-1.5">
                {n.versions?.map((v) => (
                  <li key={v.media_id} className="flex items-start justify-between gap-3">
                    <VersionLine v={v} showFolder={n.kind === 'merged'} />
                    {n.canDelete && (
                      <button
                        onClick={() => remove(n, v)}
                        disabled={busy === n.id}
                        title={t('Diese Version löschen')}
                        aria-label={t('Diese Version löschen')}
                        className={`shrink-0 rounded-md p-1.5 transition disabled:opacity-50 ${v.converted ? 'text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300' : 'text-red-300 hover:bg-red-500/15'}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {n.kind === 'versions' && !n.canDelete && <p className="text-xs text-zinc-500">{t('Löschen ist in den Einstellungen unter Bibliothek ausgeschaltet; die alte Version kannst du dann in Plex löschen.')}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {n.url && (
                <a href={n.url} target="_blank" rel="noreferrer" title={t('In Radarr öffnen')} aria-label={t('In Radarr öffnen')} className="rounded-md p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300">
                  <ExternalLink size={16} />
                </a>
              )}
              <button
                onClick={() => ignore(n.id)}
                disabled={busy === n.id}
                title={t('Hinweis ausblenden')}
                aria-label={t('Hinweis ausblenden')}
                className="rounded-md p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300 disabled:opacity-50"
              >
                <EyeOff size={16} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {(data?.length ?? 0) > FIRST && (
        <button onClick={() => setExpanded(!expanded)} className="text-sm text-violet-200 hover:underline">
          {expanded ? t('Weniger anzeigen') : t('{n} weitere anzeigen', { n: (data?.length ?? 0) - FIRST })}
        </button>
      )}
    </section>
  )
}
