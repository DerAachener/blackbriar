import { AlertTriangle, EyeOff } from 'lucide-react'
import { api, useApi, type Mismatch } from './api'
import { t } from './i18n'
import { Poster } from './ui'

function TmdbLink({ type, id }: { type: string; id: number }) {
  return (
    <a
      href={`https://www.themoviedb.org/${type === 'show' ? 'tv' : 'movie'}/${id}`}
      target="_blank"
      rel="noreferrer"
      className="text-zinc-200 underline decoration-zinc-600 underline-offset-2 hover:decoration-zinc-300"
    >
      TMDB {id}
    </a>
  )
}

/** Hinweis auf Titel, die Plex vermutlich falsch zugeordnet hat; erscheint nur, wenn es welche gibt. */
export function MismatchNotice() {
  const { data, reload } = useApi<Mismatch[]>('/mismatches', 300_000)
  if (!data?.length) return null

  const ignore = (key: string) =>
    void api('/mismatches/ignore', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key }) }).then(reload)

  return (
    <section className="space-y-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-4">
      <div className="flex gap-3">
        <AlertTriangle size={20} className="mt-0.5 shrink-0 text-amber-300" />
        <div className="space-y-1">
          <p className="font-medium text-amber-200">{t('Plex hat vermutlich falsch zugeordnet')}</p>
          <p className="text-sm text-zinc-400">
            {t(
              'Diese Titel liegen auf dem Server, aber unter einer anderen TMDB-Nummer als gewünscht. Seerr hält sie deshalb für fehlend und fragt sie über die Merkliste immer wieder an. Abhilfe in Plex: beim Titel ⋯ → Übereinstimmung korrigieren.',
            )}
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {data.map((m) => (
          <li key={m.key} className="flex items-center gap-3 rounded-lg bg-zinc-900/70 p-2">
            <Poster thumb={m.thumb} className="w-10" />
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-medium">
                {m.title}
                {m.year ? ` (${m.year})` : ''}
              </p>
              <p className="text-zinc-400">
                {t('Gewünscht:')} <TmdbLink type={m.type} id={m.wanted_tmdb} /> · {m.sources.join(', ')}
              </p>
              <p className="text-zinc-400">
                {t('In Plex:')} <TmdbLink type={m.type} id={m.plex_tmdb} />
              </p>
            </div>
            <button
              onClick={() => ignore(m.key)}
              title={t('Ausblenden, weil es wirklich zwei verschiedene Titel sind')}
              aria-label={t('Ausblenden, weil es wirklich zwei verschiedene Titel sind')}
              className="shrink-0 rounded-md p-2 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
            >
              <EyeOff size={16} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
