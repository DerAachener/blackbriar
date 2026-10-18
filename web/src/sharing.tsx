import { useEffect, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { api } from './api'
import { t } from './i18n'
import { ErrorNote } from './ui'

interface SharingSection {
  id: number
  title: string
}
interface SharingUser {
  userId: number
  name: string
  allLibraries: boolean
  sectionIds: number[]
}
interface Sharing {
  sections: SharingSection[]
  users: SharingUser[]
}

/**
 * Freigaben einer Mediathek für alle Benutzer (`section`) oder aller Mediatheken für einen Benutzer (`userId`).
 * Gespeichert wird nur, was sich geändert hat, und erst nach einer Rückfrage.
 */
export function SharingDialog({ section, userId, onClose }: { section?: string; userId?: number; onClose: () => void }) {
  const [data, setData] = useState<Sharing>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<string[]>()
  // Gewünschter Stand je „Benutzer:Mediathek“; was hier nicht steht, bleibt wie bei Plex
  const [wanted, setWanted] = useState<Record<string, boolean>>({})

  useEffect(() => {
    api<Sharing>('/sharing')
      .then(setData)
      .catch((e: Error) => setError(e.message))
  }, [])

  const target = data?.sections.find((s) => s.title === section)
  const person = data?.users.find((u) => u.userId === userId)
  // Zeilen: bei einer Mediathek alle Benutzer, bei einem Benutzer alle Mediatheken
  const rows = useMemo(() => {
    if (!data) return []
    if (target) return data.users.map((u) => ({ user: u, sec: target, label: u.name }))
    if (person) return data.sections.map((s) => ({ user: person, sec: s, label: s.title }))
    return []
  }, [data, target, person])

  const keyOf = (u: SharingUser, s: SharingSection) => `${u.userId}:${s.id}`
  const isShared = (u: SharingUser, s: SharingSection) => wanted[keyOf(u, s)] ?? u.sectionIds.includes(s.id)
  const changes = rows
    .filter(({ user, sec }) => isShared(user, sec) !== user.sectionIds.includes(sec.id))
    .map(({ user, sec }) => ({ userId: user.userId, sectionId: sec.id, shared: isShared(user, sec), user, sec }))
  const setAll = (value: boolean) => setWanted(Object.fromEntries(rows.map(({ user, sec }) => [keyOf(user, sec), value])))

  const save = () => {
    const lines = changes.map((c) => `${c.shared ? '+' : '−'} ${target ? c.user.name : c.sec.title}`)
    // Wer bisher alle Mediatheken automatisch bekam, wechselt mit einer Änderung auf eine feste Liste
    const loses = [...new Set(changes.filter((c) => c.user.allLibraries).map((c) => c.user.name))]
    const warning = loses.length
      ? `\n\n${t('Diese Benutzer bekommen bisher automatisch alle Mediatheken. Nach der Änderung bekommen sie neue Mediatheken nicht mehr von selbst: {names}', { names: loses.join(', ') })}`
      : ''
    const head = target ? t('Freigaben für „{name}“ ändern?', { name: target.title }) : t('Freigaben für {name} ändern?', { name: person!.name })
    if (!confirm(`${head}\n\n${lines.join('\n')}${warning}`)) return
    setBusy(true)
    setError('')
    api<Sharing & { results: string[] }>('/sharing', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ changes: changes.map(({ userId, sectionId, shared }) => ({ userId, sectionId, shared })) }),
    })
      .then((r) => {
        setData({ sections: r.sections, users: r.users })
        setWanted({})
        setResults(r.results)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }

  const title = section ? t('Freigaben: {name}', { name: section }) : person ? t('Freigaben: {name}', { name: person.name }) : t('Freigaben')
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[88dvh] w-full max-w-lg flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label={t('Schließen')} className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-5 py-4 text-sm">
          {!data && !error && <p className="text-zinc-400">{t('Freigaben werden bei Plex gelesen …')}</p>}
          <ErrorNote message={error} />
          {data && !rows.length && <p className="text-zinc-400">{userId ? t('Dieser Benutzer hat keine Freigabe auf deinem Server.') : t('Diese Mediathek kennt Plex nicht.')}</p>}
          {rows.length > 0 && (
            <>
              {target && (
                <div className="flex gap-2">
                  <button onClick={() => setAll(true)} className="rounded-md bg-zinc-800 px-3 py-1 text-zinc-200 hover:bg-zinc-700">
                    {t('Allen')}
                  </button>
                  <button onClick={() => setAll(false)} className="rounded-md bg-zinc-800 px-3 py-1 text-zinc-200 hover:bg-zinc-700">
                    {t('Keinem')}
                  </button>
                </div>
              )}
              {person?.allLibraries && <p className="text-xs text-zinc-500">{t('Bekommt bei Plex automatisch alle Mediatheken.')}</p>}
              <ul className="divide-y divide-zinc-800/70">
                {rows.map(({ user, sec, label }) => {
                  const changed = isShared(user, sec) !== user.sectionIds.includes(sec.id)
                  return (
                    <li key={keyOf(user, sec)}>
                      <label className="flex cursor-pointer items-center justify-between gap-3 py-2">
                        <span>
                          {label}
                          {target && user.allLibraries && <span className="ml-2 text-xs text-zinc-500">{t('alle Mediatheken')}</span>}
                          {changed && <span className="ml-2 text-xs text-amber-300">{t('geändert')}</span>}
                        </span>
                        <input
                          type="checkbox"
                          checked={isShared(user, sec)}
                          onChange={(e) => setWanted({ ...wanted, [keyOf(user, sec)]: e.target.checked })}
                          className="h-4 w-4 shrink-0 accent-amber-400"
                        />
                      </label>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
          {results && (
            <div className="space-y-1 rounded-md border border-emerald-400/20 bg-emerald-400/5 p-2 text-xs text-emerald-200">
              {results.length ? results.map((r) => <p key={r}>{r}</p>) : <p>{t('Nichts geändert.')}</p>}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-zinc-800 px-5 py-3">
          <button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-zinc-400 hover:text-zinc-200">
            {t('Schließen')}
          </button>
          <button
            onClick={save}
            disabled={busy || !changes.length}
            className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-amber-300 disabled:opacity-40"
          >
            {busy ? t('Einen Moment …') : changes.length ? t('{n} Änderungen speichern', { n: changes.length }) : t('Speichern')}
          </button>
        </div>
      </div>
    </div>
  )
}
