import { useState, type ReactNode } from 'react'
import { useApi, type Stats } from './api'
import { locale, mark, t } from './i18n'
import { Card, Chips, Empty, ErrorNote, fmtDate, num } from './ui'

// Eine Datenreihe pro Diagramm, deshalb eine Farbe; gegen den dunklen Hintergrund geprüft
const MARK = '#3987e5'

interface Point {
  label: string
  /** Beschriftung unter der Säule; leer lassen, um nur jede x-te zu beschriften */
  tick?: string
  value: number
}

type Format = (value: number) => string

function ChartCard({ title, points, format, children }: { title: string; points: Point[]; format: Format; children: ReactNode }) {
  const [table, setTable] = useState(false)
  return (
    <Card className="p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <button onClick={() => setTable(!table)} className="text-xs text-zinc-500 hover:text-zinc-300">
          {table ? t('Als Diagramm') : t('Als Tabelle')}
        </button>
      </div>
      {!points.length ? (
        <p className="py-6 text-center text-sm text-zinc-500">{t('Keine Daten im gewählten Zeitraum.')}</p>
      ) : table ? (
        <table className="w-full text-sm">
          <tbody>
            {points.map((p) => (
              <tr key={p.label} className="border-t border-zinc-800/70">
                <td className="py-1 text-zinc-300">{p.label}</td>
                <td className="py-1 text-right tabular-nums">{format(p.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        children
      )}
    </Card>
  )
}

/** Rangliste: ein Balken pro Zeile, Wert an der Spitze. */
function Bars({ title, points, format }: { title: string; points: Point[]; format: Format }) {
  const max = Math.max(1, ...points.map((p) => p.value))
  return (
    <ChartCard title={title} points={points} format={format}>
      <ul className="space-y-1.5">
        {points.map((p) => (
          <li key={p.label} className="grid grid-cols-[minmax(0,10rem)_1fr] items-center gap-3 text-sm" title={`${p.label}: ${format(p.value)}`}>
            <span className="truncate text-zinc-300">{p.label}</span>
            <span className="flex items-center gap-2">
              <span className="h-3 rounded-r" style={{ width: `${(p.value / max) * 82}%`, minWidth: 2, backgroundColor: MARK }} />
              <span className="text-xs whitespace-nowrap text-zinc-400 tabular-nums">{format(p.value)}</span>
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  )
}

/** Verlauf über eine feste Achse (Wochentag, Stunde, Monat): Säulen mit Wert beim Überfahren. */
function Columns({ title, points, format }: { title: string; points: Point[]; format: Format }) {
  const max = Math.max(1, ...points.map((p) => p.value))
  const peak = points.findIndex((p) => p.value === max)
  return (
    <ChartCard title={title} points={points} format={format}>
      <div className="flex h-36 items-end gap-0.5 border-b border-zinc-800 pt-5">
        {points.map((p, i) => (
          <div key={p.label} className="group relative flex h-full flex-1 items-end justify-center">
            <div className="w-full max-w-6 rounded-t group-hover:brightness-125" style={{ height: `${(p.value / max) * 100}%`, backgroundColor: MARK }} />
            <span
              className={`pointer-events-none absolute z-10 rounded bg-zinc-800 px-1.5 py-0.5 text-xs whitespace-nowrap text-zinc-100 ${
                i === peak ? 'group-hover:bg-zinc-700' : 'hidden group-hover:block'
              }`}
              style={{ bottom: `calc(${(p.value / max) * 100}% + 4px)` }}
            >
              <span className="hidden group-hover:inline">{p.label}: </span>
              {format(p.value)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5">
        {points.map((p) => (
          <span key={p.label} className="flex-1 text-center text-[11px] text-zinc-500">
            {p.tick ?? p.label}
          </span>
        ))}
      </div>
    </ChartCard>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-sm text-zinc-500">{label}</p>
    </Card>
  )
}

// Schlüssel mit Buchstaben, damit die Reihenfolge der Knöpfe erhalten bleibt
type Range = 'd30' | 'd90' | 'd365' | 'd0'
const WEEKDAYS = [mark('Sonntag'), mark('Montag'), mark('Dienstag'), mark('Mittwoch'), mark('Donnerstag'), mark('Freitag'), mark('Samstag')]
const DECISIONS: Record<string, string> = { 'direct play': 'Direct Play', copy: 'Direct Stream', transcode: mark('Transkodiert') }

const hours: Format = (seconds) =>
  t('{n} Std.', { n: (seconds / 3600).toLocaleString(locale(), { maximumFractionDigits: seconds >= 36_000 ? 0 : 1 }) })

export function StatsView({ userId }: { userId: number | null }) {
  const [range, setRange] = useState<Range>('d30')
  const [metric, setMetric] = useState<'plays' | 'seconds'>('plays')
  const { data, error } = useApi<Stats>(`/stats?days=${range.slice(1)}${userId ? `&user=${userId}` : ''}`, 120_000)

  if (!data) return <ErrorNote message={error} />
  const key = data.timed ? metric : 'plays'
  const format = key === 'seconds' ? hours : num

  const weekday = [1, 2, 3, 4, 5, 6, 0].map((d) => ({
    label: t(WEEKDAYS[d]!),
    tick: t(WEEKDAYS[d]!).slice(0, 2),
    value: data.perWeekday.find((x) => x.day === d)?.[key] ?? 0,
  }))
  const hour = Array.from({ length: 24 }, (_, h) => ({
    label: t('{h} Uhr', { h }),
    tick: h % 6 === 0 ? String(h) : '',
    value: data.perHour.find((x) => x.hour === h)?.[key] ?? 0,
  }))
  const month = data.perMonth.map((m) => {
    const [year, mon] = m.month.split('-')
    return { label: `${mon}.${year}`, tick: `${mon}/${year!.slice(2)}`, value: m[key] }
  })
  const ranges: Record<Range, string> = { d30: t('30 Tage'), d90: t('90 Tage'), d365: t('1 Jahr'), d0: t('Gesamt') }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips value={range} options={ranges} onChange={setRange} />
        {data.timed && <Chips value={metric} options={{ plays: t('Wiedergaben'), seconds: t('Stunden') }} onChange={setMetric} />}
      </div>
      <ErrorNote message={error} />
      {!data.timed && (
        <p className="text-sm text-zinc-500">
          {t(
            'Für die Zeit vor dem {date} kennt Blackbriar nur den Plex-Verlauf ohne Dauer und Gerät, deshalb wird hier gezählt statt gemessen. Seitdem schreibt es jede Wiedergabe selbst mit. Ein Import aus Tautulli oder Tracearr (unter Einstellungen) ergänzt die Vergangenheit.',
            { date: fmtDate(data.recordingSince) },
          )}
        </p>
      )}

      {data.totals.plays === 0 ? (
        <Empty>{t('Im gewählten Zeitraum wurde nichts gesehen.')}</Empty>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Figure label={t('Wiedergaben')} value={num(data.totals.plays)} />
            {data.timed && <Figure label={t('Gesehene Zeit')} value={hours(data.totals.seconds)} />}
            <Figure label={t('Aktive Benutzer')} value={num(data.totals.users)} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2 min-[1900px]:grid-cols-3">
            <Bars title={t('Nach Benutzer')} points={data.perUser.map((u) => ({ label: u.name, value: u[key] }))} format={format} />
            <Columns title={t('Nach Monat')} points={month} format={format} />
            <Columns title={t('Nach Wochentag')} points={weekday} format={format} />
            <Columns title={t('Nach Uhrzeit')} points={hour} format={format} />
            <Bars title={t('Meistgesehene Filme (nach Benutzern)')} points={data.topMovies.map((m) => ({ label: m.title, value: m.users }))} format={num} />
            <Bars title={t('Meistgesehene Serien (nach Folgen)')} points={data.topShows.map((s) => ({ label: s.title, value: s.plays }))} format={num} />
            {data.platforms.length > 0 && (
              <Bars title={t('Geräte')} points={data.platforms.map((p) => ({ label: p.name, value: p.plays }))} format={num} />
            )}
            {data.decisions.length > 0 && (
              <Bars title={t('Wiedergabeart')} points={data.decisions.map((d) => ({ label: t(DECISIONS[d.name] ?? d.name), value: d.plays }))} format={num} />
            )}
          </div>
        </>
      )}
    </div>
  )
}
