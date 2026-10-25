import { useState, type ReactNode } from 'react'
import { Eye, Send } from 'lucide-react'
import { api, useApi, type MailPrefs, type MailPrefsData } from './api'
import { locale, mark, t } from './i18n'
import { Badge, Button, Card } from './ui'
import { Heading } from './views'

// Newsletter und Erinnerung teilen sich den Aufbau: ein Standard für alle, darunter die Benutzer,
// jeder mit dem Standard oder eigenen Einstellungen. Unterschiedlich sind nur das Formular und die Texte.

type Kind = 'newsletter' | 'reminder'
type MailUser = MailPrefsData['users'][number]

const selectClass = 'rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-amber-400'
const WEEKDAYS = [mark('Sonntag'), mark('Montag'), mark('Dienstag'), mark('Mittwoch'), mark('Donnerstag'), mark('Freitag'), mark('Samstag')]
const RHYTHMS: Record<MailPrefs['rhythm'], string> = {
  weekly: mark('jede Woche'),
  biweekly: mark('alle zwei Wochen'),
  monthly: mark('einmal im Monat'),
}
const SECTIONS: [keyof MailPrefs['sections'], string][] = [
  ['added', mark('Neue Filme, Staffeln und Folgen')],
  ['watchlist', mark('Was auf der eigenen Merkliste stand, oben hervorheben')],
  ['ratings', mark('Wie zuletzt bewertet wurde, ohne Namen')],
]

const put = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const dateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString(locale(), { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

interface FormProps {
  prefs: MailPrefs
  onChange: (prefs: MailPrefs) => void
}

function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      {label}
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-amber-400" />
    </label>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 accent-amber-400" />
      {label}
    </label>
  )
}

function HourSelect({ value, onChange }: { value: number; onChange: (hour: number) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))} className={selectClass} aria-label={t('Uhrzeit')}>
      {Array.from({ length: 24 }, (_, h) => (
        <option key={h} value={h}>
          {t('{hour} Uhr', { hour: h })}
        </option>
      ))}
    </select>
  )
}

function NewsletterForm({ prefs, onChange }: FormProps) {
  return (
    <div className="space-y-3 text-sm">
      <Switch label={t('Newsletter verschicken')} checked={prefs.newsletter} onChange={(newsletter) => onChange({ ...prefs, newsletter })} />
      <Switch
        label={t('Sofort Bescheid geben, wenn ein Titel von der eigenen Merkliste da ist')}
        checked={prefs.instant}
        onChange={(instant) => onChange({ ...prefs, instant })}
      />
      <div className={`space-y-3 ${prefs.newsletter ? '' : 'opacity-50'}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {t('Wann')}
          <span className="flex flex-wrap items-center gap-2">
            <select value={prefs.rhythm} onChange={(e) => onChange({ ...prefs, rhythm: e.target.value as MailPrefs['rhythm'] })} className={selectClass} aria-label={t('Rhythmus')}>
              {(Object.keys(RHYTHMS) as MailPrefs['rhythm'][]).map((id) => (
                <option key={id} value={id}>
                  {t(RHYTHMS[id])}
                </option>
              ))}
            </select>
            <select value={prefs.day} onChange={(e) => onChange({ ...prefs, day: Number(e.target.value) })} className={selectClass} aria-label={t('Wochentag')}>
              {WEEKDAYS.map((day, i) => (
                <option key={day} value={i}>
                  {t(day)}
                </option>
              ))}
            </select>
            <HourSelect value={prefs.hour} onChange={(hour) => onChange({ ...prefs, hour })} />
          </span>
        </div>
        <div>
          <p className="mb-1.5 text-zinc-400">{t('Inhalt')}</p>
          <div className="grid gap-1.5">
            {SECTIONS.map(([key, label]) => (
              <Check key={key} label={t(label)} checked={prefs.sections[key]} onChange={(v) => onChange({ ...prefs, sections: { ...prefs.sections, [key]: v } })} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ReminderForm({ prefs, onChange }: FormProps) {
  const number = (key: 'reminderDays' | 'reminderMax', min: number, max: number) => (
    <input
      type="number"
      min={min}
      max={max}
      value={prefs[key]}
      onChange={(e) => onChange({ ...prefs, [key]: Math.min(max, Math.max(min, Number(e.target.value) || min)) })}
      className={`${selectClass} w-20 text-right`}
    />
  )
  return (
    <div className="space-y-3 text-sm">
      <Switch label={t('Erinnerungen verschicken')} checked={prefs.reminder} onChange={(reminder) => onChange({ ...prefs, reminder })} />
      <div className={`space-y-3 ${prefs.reminder ? '' : 'opacity-50'}`}>
        <label className="flex items-center justify-between gap-4">
          {t('Erste Erinnerung so viele Tage nach dem Schauen')}
          {number('reminderDays', 0, 365)}
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            {t('Höchstens so oft pro Titel')}
            <span className="block text-xs text-zinc-500">{t('Zwischen zwei Erinnerungen an denselben Titel liegt eine Woche.')}</span>
          </span>
          {number('reminderMax', 1, 10)}
        </label>
        <div className="flex items-center justify-between gap-4">
          {t('Uhrzeit')}
          <HourSelect value={prefs.reminderHour} onChange={(reminderHour) => onChange({ ...prefs, reminderHour })} />
        </div>
        <div>
          <p className="mb-1.5 text-zinc-400">{t('Erinnern, wenn etwas gesehen wurde und …')}</p>
          <div className="grid gap-1.5">
            <Check label={t('noch nicht bewertet ist')} checked={prefs.reminderRated} onChange={(reminderRated) => onChange({ ...prefs, reminderRated })} />
            <Check label={t('noch auf der Merkliste steht')} checked={prefs.reminderWatchlist} onChange={(reminderWatchlist) => onChange({ ...prefs, reminderWatchlist })} />
          </div>
        </div>
      </div>
    </div>
  )
}

/** Wann und womit der Newsletter kommt, in einem Satz. */
function describeNewsletter(prefs: MailPrefs): string {
  if (!prefs.newsletter) return t('aus')
  const when =
    prefs.rhythm === 'monthly' ? t('am ersten {day} im Monat', { day: t(WEEKDAYS[prefs.day]!) }) : `${t(RHYTHMS[prefs.rhythm])}, ${t(WEEKDAYS[prefs.day]!)}`
  return t('{when} um {hour} Uhr', { when, hour: prefs.hour })
}

function describeReminder(prefs: MailPrefs): string {
  if (!prefs.reminder) return t('aus')
  return t('nach {days} Tagen, höchstens {max}×, um {hour} Uhr', { days: prefs.reminderDays, max: prefs.reminderMax, hour: prefs.reminderHour })
}

interface KindConfig {
  on: (prefs: MailPrefs) => boolean
  describe: (prefs: MailPrefs) => string
  Form: (props: FormProps) => ReactNode
  unsub: (u: MailUser) => number | null
  /** Zusatz zur Statuszeile eines Benutzers */
  extra: (u: MailUser) => string
  /** Hinweis im aufgeklappten Benutzer */
  hint: (u: MailUser) => string
  texts: { intro: string; confirm: string; unsubscribed: string }
}

const KINDS: Record<Kind, KindConfig> = {
  newsletter: {
    on: (p) => p.newsletter,
    describe: describeNewsletter,
    Form: NewsletterForm,
    unsub: (u) => u.newsletter_unsub,
    extra: (u) => (u.next ? t('nächster {date}', { date: dateTime(u.next) }) : ''),
    hint: (u) =>
      u.newsletter_sent_at
        ? t('Der nächste Newsletter enthält, was seit dem {date} dazugekommen ist.', { date: dateTime(u.newsletter_sent_at) })
        : t('Der erste Newsletter enthält, was im letzten Zeitraum dazugekommen ist.'),
    texts: {
      intro: mark('Gilt für alle, bei denen unten „Standard“ steht, und für jeden neuen Benutzer. Ohne Neues auf dem Server wird nichts verschickt.'),
      confirm: mark('Den Newsletter jetzt an {name} ({email}) schicken?'),
      unsubscribed: mark('{name} hat den Newsletter über den Link in der Mail abbestellt und bekommt ihn nicht, egal was oben steht.'),
    },
  },
  reminder: {
    on: (p) => p.reminder,
    describe: describeReminder,
    Form: ReminderForm,
    unsub: (u) => u.reminder_unsub,
    extra: (u) => t('{open} offen, {due} fällig', { open: u.reminders.open, due: u.reminders.due }),
    hint: (u) =>
      t('Offen sind {open} Titel ({unrated} ohne Bewertung, {listed} noch auf der Merkliste), davon würden jetzt {due} angemahnt. Fällt die Erinnerung auf einen Tag mit Newsletter, steht sie mit in dessen Mail.', {
        open: u.reminders.open,
        unrated: u.reminders.unrated,
        listed: u.reminders.listed,
        due: u.reminders.due,
      }),
    texts: {
      intro: mark(
        'Gilt für alle, bei denen unten „Standard“ steht, und für jeden neuen Benutzer. Erinnert wird an Titel, die jemand zu Ende gesehen hat: Filme, sobald sie im Verlauf stehen, Serien, wenn alle vorhandenen Folgen gesehen sind.',
      ),
      confirm: mark('Die Erinnerung jetzt an {name} ({email}) schicken?'),
      unsubscribed: mark('{name} hat die Erinnerungen über den Link in der Mail abbestellt und bekommt sie nicht, egal was oben steht.'),
    },
  },
}

type Note = { id: number | 'defaults'; text: string; ok: boolean } | undefined

function MailKindSettings({ kind }: { kind: Kind }) {
  const cfg = KINDS[kind]
  const { data, reload } = useApi<MailPrefsData>('/mail/prefs')
  const [defaults, setDefaults] = useState<MailPrefs>()
  const [open, setOpen] = useState<number>()
  const [note, setNote] = useState<Note>()
  const [busy, setBusy] = useState<number>()
  if (!data) return null
  const standard = defaults ?? data.defaults

  const fail = (id: number | 'defaults') => (e: Error) => setNote({ id, text: e.message, ok: false })
  const saveDefaults = () =>
    api('/mail/defaults', put(standard))
      .then(() => {
        setDefaults(undefined)
        setNote({ id: 'defaults', text: t('Standard gespeichert.'), ok: true })
        reload()
      })
      .catch(fail('defaults'))
  const saveUser = (id: number, prefs: MailPrefs | null) => api(`/mail/users/${id}`, put({ part: kind, prefs })).then(reload).catch(fail(id))
  // `sample` schickt einen Probe-Newsletter mit allem aus den letzten sieben Tagen, der nicht als verschickt zählt
  const send = (u: MailUser, sample = false) => {
    const question = sample
      ? t('Probe-Newsletter mit allem aus den letzten 7 Tagen an {name} ({email}) schicken? Er zählt nicht als verschickt.', { name: u.name, email: u.email ?? '–' })
      : t(cfg.texts.confirm, { name: u.name, email: u.email ?? '–' })
    if (!confirm(question)) return
    setBusy(u.id)
    setNote(undefined)
    api<{ sent: boolean; message: string }>(`/mail/users/${u.id}/send`, post({ kind, sample }))
      .then((r) => {
        setNote({ id: u.id, text: r.message, ok: r.sent })
        reload()
      })
      .catch(fail(u.id))
      .finally(() => setBusy(undefined))
  }
  const noteLine = (id: number | 'defaults') =>
    note?.id === id && <p className={`rounded-lg px-3 py-2 text-sm ${note.ok ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'}`}>{note.text}</p>
  const log = data.log[kind]

  return (
    <>
      <section className="space-y-3">
        <Heading>{t('Standard für alle')}</Heading>
        <Card className="space-y-4 p-4">
          <p className="text-sm text-zinc-400">{t(cfg.texts.intro)}</p>
          <cfg.Form prefs={standard} onChange={setDefaults} />
          {noteLine('defaults')}
          <Button primary onClick={() => void saveDefaults()} disabled={!defaults}>
            {t('Speichern')}
          </Button>
        </Card>
      </section>

      <section className="space-y-3">
        <Heading>{t('Pro Benutzer')}</Heading>
        <Card className="divide-y divide-zinc-800/70 px-4 py-1">
          {data.users.map((u) => {
            const own = u.own[kind]
            const unsub = cfg.unsub(u)
            const expanded = open === u.id
            const extra = cfg.on(u.prefs) ? cfg.extra(u) : ''
            return (
              <div key={u.id} className="space-y-3 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <button onClick={() => setOpen(expanded ? undefined : u.id)} className="min-w-0 flex-1 text-left">
                    <span className="font-medium">{u.name}</span>
                    <span className="block truncate text-xs text-zinc-500">
                      {!u.email
                        ? t('keine Adresse')
                        : unsub
                          ? t('selbst abbestellt am {date}', { date: dateTime(unsub) })
                          : `${own ? t('eigene Einstellungen') : t('Standard')}: ${cfg.describe(u.prefs)}${extra ? ` · ${extra}` : ''}`}
                    </span>
                  </button>
                  {unsub ? <Badge tone="red">{t('abbestellt')}</Badge> : cfg.on(u.prefs) ? <Badge tone="green">{t('an')}</Badge> : <Badge>{t('aus')}</Badge>}
                </div>
                {expanded && (
                  <div className="space-y-3 rounded-lg bg-zinc-950/60 p-3">
                    <label className="flex items-center justify-between gap-4">
                      {t('Einstellungen')}
                      <select value={own ? 'own' : 'default'} onChange={(e) => void saveUser(u.id, e.target.value === 'own' ? u.prefs : null)} className={selectClass}>
                        <option value="default">{t('Standard verwenden')}</option>
                        <option value="own">{t('Eigene Einstellungen')}</option>
                      </select>
                    </label>
                    {own && <cfg.Form prefs={u.prefs} onChange={(prefs) => void saveUser(u.id, prefs)} />}
                    {unsub && (
                      <p className="text-zinc-400">
                        {t(cfg.texts.unsubscribed, { name: u.name })}{' '}
                        <button onClick={() => void api(`/mail/users/${u.id}/resubscribe`, post({ kind })).then(reload).catch(fail(u.id))} className="text-amber-300 hover:underline">
                          {t('Wieder anmelden')}
                        </button>
                      </p>
                    )}
                    {noteLine(u.id)}
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`/api/mail/users/${u.id}/preview?kind=${kind}`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
                      >
                        <Eye size={15} /> {t('Vorschau')}
                      </a>
                      <Button onClick={() => send(u)} disabled={busy === u.id || !u.email}>
                        <Send size={15} /> {busy === u.id ? t('Sende …') : t('Jetzt senden')}
                      </Button>
                      {kind === 'newsletter' && (
                        <Button onClick={() => send(u, true)} disabled={busy === u.id || !u.email}>
                          <Send size={15} /> {t('Probe senden')}
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500">{cfg.hint(u)}</p>
                  </div>
                )}
              </div>
            )
          })}
        </Card>
      </section>

      {log.length > 0 && (
        <section className="space-y-3">
          <Heading>{t('Verschickte Mails')}</Heading>
          <Card className="divide-y divide-zinc-800/70 px-4 py-1">
            {log.map((l, i) => (
              <div key={i} className="py-2 text-sm">
                <p className="flex flex-wrap items-center justify-between gap-x-4">
                  <span className="min-w-0 truncate">
                    {l.user_name} · <span className="text-zinc-400">{l.subject}</span>
                  </span>
                  <span className="text-xs text-zinc-500">{dateTime(l.at)}</span>
                </p>
                {!l.ok && <p className="text-xs text-red-300">{l.error}</p>}
              </div>
            ))}
          </Card>
        </section>
      )}
    </>
  )
}

export const NewsletterSettings = () => <MailKindSettings kind="newsletter" />
export const ReminderSettings = () => <MailKindSettings kind="reminder" />
