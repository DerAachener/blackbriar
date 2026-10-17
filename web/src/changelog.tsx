import { useEffect, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { api } from './api'
import { t } from './i18n'

export interface ChangelogSection {
  version: string
  date: string
  items: string[]
}

/** `Code` und **fett** aus dem Änderungsverlauf; mehr Markdown kommt dort nicht vor. */
function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/).map((part, i) =>
    part.startsWith('`') ? (
      <code key={i} className="rounded bg-zinc-800 px-1 text-[0.9em] text-zinc-200">
        {part.slice(1, -1)}
      </code>
    ) : part.startsWith('**') ? (
      <strong key={i}>{part.slice(2, -2)}</strong>
    ) : (
      part
    ),
  )
}

/** Fenster mit Fassungen aus dem Änderungsverlauf, neueste oben. */
export function ChangelogDialog({ title, sections, onClose }: { title: string; sections: ChangelogSection[]; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[88dvh] w-full max-w-2xl flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-zinc-800 px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} aria-label={t('Schließen')} className="rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-800 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-5 overflow-y-auto px-5 py-4">
          {sections.map((s) => (
            <section key={s.version} className="space-y-2">
              <p className="flex items-baseline gap-2">
                <span className="font-mono text-sm font-semibold text-amber-300">{s.version}</span>
                <span className="text-xs text-zinc-500">{s.date}</span>
              </p>
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-zinc-300 marker:text-zinc-600">
                {s.items.map((item, i) => (
                  <li key={i}>{inline(item)}</li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <div className="border-t border-zinc-800 px-5 py-3 text-right">
          <button onClick={onClose} className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-amber-300">
            {t('Verstanden')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Einmal nach einem Update: zeigt, was seit der zuletzt gesehenen Fassung neu ist. */
export function ChangelogNews() {
  const [sections, setSections] = useState<ChangelogSection[]>([])
  useEffect(() => {
    api<ChangelogSection[]>('/changelog/news')
      .then(setSections)
      .catch(() => setSections([]))
  }, [])
  if (!sections.length) return null
  const close = () => {
    setSections([])
    void api('/changelog/seen', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {})
  }
  return <ChangelogDialog title={t('Was ist neu')} sections={sections} onClose={close} />
}

/** Alle bisherigen Fassungen; für die Versionsnummer in der Seitenleiste und unter Einstellungen → Status. */
export function ChangelogAll({ onClose }: { onClose: () => void }) {
  const [sections, setSections] = useState<ChangelogSection[]>()
  useEffect(() => {
    api<ChangelogSection[]>('/changelog')
      .then(setSections)
      .catch(() => setSections([]))
  }, [])
  if (!sections) return null
  return <ChangelogDialog title={t('Alle Updates')} sections={sections} onClose={onClose} />
}
