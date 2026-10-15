import { useState } from 'react'
import { usePaged } from './api'
import { locale, mark, t } from './i18n'
import { Badge, Card, Chips, Empty, ErrorNote, num } from './ui'
import { MoreButton, queryString } from './views'

interface LogEntry {
  id: number
  at: number
  kind: string
  level: 'info' | 'warn' | 'error'
  text: string
}

type Kind = '' | 'sync' | 'mail' | 'telegram' | 'delete' | 'backup' | 'auth' | 'settings'

const KINDS: Record<Kind, string> = {
  '': mark('Alles'),
  sync: mark('Abgleich'),
  mail: mark('Mails'),
  telegram: 'Telegram',
  delete: mark('Löschen'),
  backup: mark('Sicherung'),
  auth: mark('Anmeldung'),
  settings: mark('Einstellungen'),
}

const dateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** Was Blackbriar wann getan hat, neueste Einträge zuerst. */
export function LogPanel() {
  const [kind, setKind] = useState<Kind>('')
  const [problems, setProblems] = useState(false)
  const query = queryString([kind && `kind=${kind}`, problems && 'level=problems'])
  const { items, total, error, more } = usePaged<LogEntry>(`/events${query}`, 60)
  const options = Object.fromEntries((Object.keys(KINDS) as Kind[]).map((id) => [id, t(KINDS[id])])) as Record<Kind, string>

  return (
    <section className="space-y-4">
      <p className="text-sm text-zinc-400">
        {t(
          'Was Blackbriar wann getan hat: Abgleich, verschickte Mails und Telegram-Nachrichten, Löschungen, Sicherungen, Anmeldungen und geänderte Einstellungen. Einträge bleiben 90 Tage. Vom Abgleich steht hier nur, was auffällt: Fehler, deren Ende und von Hand gestartete Läufe.',
        )}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips<Kind> value={kind} options={options} onChange={setKind} />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input type="checkbox" checked={problems} onChange={(e) => setProblems(e.target.checked)} className="h-4 w-4 accent-amber-400" />
          {t('Nur Warnungen und Fehler')}
        </label>
      </div>
      <ErrorNote message={error} />
      {items.length ? (
        <Card className="divide-y divide-zinc-800/70 px-4 py-1">
          {items.map((e) => (
            <div key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
              <span className="w-40 shrink-0 text-xs text-zinc-500 tabular-nums">{dateTime(e.at)}</span>
              <span className="w-28 shrink-0">
                <Badge tone={e.level === 'error' ? 'red' : e.level === 'warn' ? 'amber' : 'zinc'}>{t(KINDS[e.kind as Kind] ?? e.kind)}</Badge>
              </span>
              <span className={`min-w-0 flex-1 break-words ${e.level === 'error' ? 'text-red-300' : e.level === 'warn' ? 'text-amber-200' : ''}`}>{e.text}</span>
            </div>
          ))}
        </Card>
      ) : (
        <Empty>{t('Noch keine Einträge.')}</Empty>
      )}
      <p className="text-xs text-zinc-500">{t('{n} Einträge', { n: num(total) })}</p>
      <MoreButton shown={items.length} total={total} onClick={more} />
    </section>
  )
}
