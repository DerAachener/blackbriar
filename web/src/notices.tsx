import { useState } from 'react'
import { EyeOff, ExternalLink, PackageCheck, Shuffle } from 'lucide-react'
import { api, useApi, type Notice } from './api'
import { t } from './i18n'
import { Poster } from './ui'

/** Hinweise zu Serien: Staffel komplett oder Folgen von verschiedenen Release-Gruppen; erscheint nur, wenn es welche gibt. */
export function SeasonNotices() {
  const { data, reload } = useApi<Notice[]>('/notices', 300_000)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState('')
  // Bei vielen Hinweisen stehen zunächst nur die ersten da, sonst verdrängt der Abschnitt den Rest des Dashboards
  const [all, setAll] = useState(false)
  if (!data?.length) return null
  const FIRST = 3
  const shown = all ? data : data.slice(0, FIRST)

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
        <button onClick={() => setAll(!all)} className="text-sm text-sky-200 hover:underline">
          {all ? t('Weniger anzeigen') : t('{n} weitere anzeigen', { n: data.length - FIRST })}
        </button>
      )}
    </section>
  )
}
