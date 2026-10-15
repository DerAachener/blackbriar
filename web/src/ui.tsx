import type { ReactNode } from 'react'
import { Film } from 'lucide-react'
import { locale, t } from './i18n'

/** `thumb` ist ein Plex-Pfad; `tmdbPoster` der Ersatz für Titel, die nicht auf dem Server liegen. */
/** Die Projektseite von Blackbriar mit Beschreibung und Neuigkeiten */
export const PROJECT_URL = 'https://apps.der-aachener.de/'

export function Poster({
  thumb,
  tmdbPoster,
  url,
  className = 'w-12',
}: {
  thumb: string | null
  tmdbPoster?: string | null
  /** Vollständige Adresse eines Posters von außerhalb, z. B. aus Radarr oder Sonarr */
  url?: string | null
  className?: string
}) {
  const shape = `${className} aspect-[2/3] shrink-0 rounded-md bg-zinc-800`
  // TMDB liefert die Adresse in voller Größe; für die Liste reicht die kleine Fassung
  if (!thumb && url) return <img src={url.replace('/t/p/original/', '/t/p/w185/')} alt="" loading="lazy" className={`${shape} object-cover`} />
  if (!thumb && tmdbPoster) {
    return <img src={`https://image.tmdb.org/t/p/w185${tmdbPoster}`} alt="" loading="lazy" className={`${shape} object-cover`} />
  }
  if (!thumb) {
    return (
      <div className={`${shape} grid place-items-center text-zinc-600`}>
        <Film size={18} />
      </div>
    )
  }
  return <img src={`/api/image?path=${encodeURIComponent(thumb)}&w=240`} alt="" loading="lazy" className={`${shape} object-cover`} />
}

/** Plex speichert 0 bis 10; angezeigt wird die Hälfte, also 0,5 bis 5 Sterne. */
export const starValue = (rating: number) => (rating / 2).toLocaleString(locale(), { minimumFractionDigits: 1 })

/** `value` ist der Plex-Wert von 0 bis 10; gezeigt werden fünf Sterne mit halben Schritten. */
export function Stars({ value, showValue = true }: { value: number; showValue?: boolean }) {
  const label = starValue(value)
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap" title={t('{n} von 5', { n: label })}>
      <span className="relative text-lg leading-none text-zinc-700" aria-hidden>
        ★★★★★
        <span className="absolute inset-0 overflow-hidden text-amber-400" style={{ width: `${value * 10}%` }}>
          ★★★★★
        </span>
      </span>
      {showValue && <span className="text-sm font-medium text-zinc-300">{label}</span>}
    </span>
  )
}

export function UserTag({ name }: { name: string }) {
  return <span className="block truncate text-sm text-zinc-300">{name}</span>
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-xl border border-zinc-800 bg-zinc-900/60 ${className}`}>{children}</div>
}

export function Badge({ children, tone = 'zinc' }: { children: ReactNode; tone?: 'zinc' | 'amber' | 'green' | 'red' }) {
  const tones = {
    zinc: 'bg-zinc-800 text-zinc-300',
    amber: 'bg-amber-400/15 text-amber-300',
    green: 'bg-emerald-400/15 text-emerald-300',
    red: 'bg-red-400/15 text-red-300',
  }
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-zinc-800 px-4 py-10 text-center text-sm text-zinc-500">{children}</p>
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null
  return <p className="rounded-lg bg-red-400/10 px-4 py-3 text-sm text-red-300">{message}</p>
}

export function Button({
  children,
  onClick,
  primary,
  danger,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  primary?: boolean
  /** Für Aktionen, die sich nicht rückgängig machen lassen */
  danger?: boolean
  disabled?: boolean
}) {
  const look = danger
    ? 'bg-red-500 text-white hover:bg-red-400'
    : primary
      ? 'bg-amber-400 text-zinc-950 hover:bg-amber-300'
      : 'bg-zinc-800 text-zinc-100 hover:bg-zinc-700'
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 ${look}`}
    >
      {children}
    </button>
  )
}

/** Umschalter aus nebeneinanderliegenden Knöpfen. */
export function Chips<T extends string>({ value, options, onChange }: { value: T; options: Partial<Record<T, string>>; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(Object.keys(options) as T[]).map((id) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            value === id ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
          }`}
        >
          {options[id]}
        </button>
      ))}
    </div>
  )
}

/** Zahl mit den Tausendertrennzeichen der gewählten Sprache. */
export const num = (n: number) => n.toLocaleString(locale())

/**
 * Dateiangaben einer Serie: Haben die Folgen verschiedene Werte, liefert der Server alle, durch Komma getrennt.
 * Bis drei werden genannt, darüber steht „gemischt“.
 */
export function fileValues(value: string | null | undefined, format: (v: string) => string = (v) => v): string {
  if (!value) return ''
  const list = value.split(',').map(format)
  if (list.length > 3) return t('gemischt')
  return list.length > 1 ? `${list.slice(0, -1).join(', ')}${t(' und ')}${list.at(-1)}` : list[0]!
}
export const fileResolution = (r: string | null | undefined) => fileValues(r, (v) => (/^\d+$/.test(v) ? `${v}p` : v.toUpperCase()))

/** Dateigröße in GB bzw. TB oder MB, mit einer Nachkommastelle. */
export function fmtSize(bytes: number | null | undefined): string {
  if (!bytes) return ''
  const [value, unit] = bytes >= 1e12 ? [bytes / 1e12, 'TB'] : bytes >= 1e9 ? [bytes / 1e9, 'GB'] : [bytes / 1e6, 'MB']
  return `${value.toLocaleString(locale(), { maximumFractionDigits: value >= 100 ? 0 : 1 })} ${unit}`
}

/** Verbindet die vorhandenen Teile einer Metazeile mit Mittelpunkt. */
export const meta = (...parts: (string | number | null | undefined | false)[]) => parts.filter(Boolean).join(' · ')

export const typeLabel = (type: string) => (type === 'show' ? t('Serie') : type === 'episode' ? t('Folge') : t('Film'))

/** „1 Folge“ oder „5 Folgen“, je nach Anzahl. */
export const episodes = (n: number) => t(n === 1 ? '{n} Folge' : '{n} Folgen', { n })

export const fmtDate = (ts: number) => new Date(ts * 1000).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' })

export const fmtDateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function ago(ts: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - ts)
  if (sec < 60) return t('gerade eben')
  if (sec < 3600) return t('vor {n} Min.', { n: Math.floor(sec / 60) })
  if (sec < 86400) return t('vor {n} Std.', { n: Math.floor(sec / 3600) })
  const days = Math.floor(sec / 86400)
  return days === 1 ? t('vor 1 Tag') : t('vor {n} Tagen', { n: days })
}

export function fmtDuration(ms: number): string {
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function episodeCode(season: number | null, episode: number | null): string {
  if (season == null || episode == null) return ''
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
}
