import { useState } from 'react'
import { Eye, RotateCcw, Send } from 'lucide-react'
import { api, useApi, type WelcomeData } from './api'
import { locale, t } from './i18n'
import { Badge, Button, Card } from './ui'
import { Heading } from './views'

const put = (body: unknown): RequestInit => ({ method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
const dateTime = (ts: number) => new Date(ts * 1000).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
const areaClass = 'w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm leading-relaxed outline-none focus:border-amber-400'
const linkButton = 'inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700'

type Note = { id: number | 'texts'; text: string; ok: boolean } | undefined

/** Die Einrichtungs-Anleitung für Benutzer: die Schritte, die Willkommens-Mail und wer wie weit ist. */
export function WelcomeSettings() {
  const { data, reload } = useApi<WelcomeData>('/welcome')
  const [steps, setSteps] = useState<string>()
  const [mail, setMail] = useState<string>()
  const [note, setNote] = useState<Note>()
  const [busy, setBusy] = useState<number>()
  if (!data) return null

  const stepsText = steps ?? data.steps
  const mailText = mail ?? data.mail
  const changed = steps !== undefined || mail !== undefined
  const fail = (id: number | 'texts') => (e: Error) => setNote({ id, text: e.message, ok: false })
  const noteLine = (id: number | 'texts') =>
    note?.id === id && <p className={`rounded-lg px-3 py-2 text-sm ${note.ok ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'}`}>{note.text}</p>

  const save = () =>
    api('/welcome', put({ steps: stepsText, mail: mailText }))
      .then(() => {
        setSteps(undefined)
        setMail(undefined)
        setNote({ id: 'texts', text: t('Gespeichert.'), ok: true })
        reload()
      })
      .catch(fail('texts'))
  const send = (id: number, name: string, email: string | null) => {
    if (!confirm(t('Die Willkommens-Mail jetzt an {name} ({email}) schicken?', { name, email: email ?? '–' }))) return
    setBusy(id)
    setNote(undefined)
    api<{ message: string }>(`/welcome/users/${id}/send`, { method: 'POST' })
      .then((r) => {
        setNote({ id, text: r.message, ok: true })
        reload()
      })
      .catch(fail(id))
      .finally(() => setBusy(undefined))
  }
  const reset = (id: number, name: string) => {
    if (!confirm(t('Die Einrichtung von {name} auf Anfang zurücksetzen? {name} beginnt dann wieder beim ersten Schritt.', { name }))) return
    void api(`/welcome/users/${id}/reset`, { method: 'POST' }).then(reload).catch(fail(id))
  }

  return (
    <>
      <section className="space-y-3">
        <Heading>{t('Anleitung für neue und bestehende Benutzer')}</Heading>
        <Card className="space-y-4 p-4 text-sm">
          <p className="text-zinc-400">
            {t(
              'Der Benutzer bekommt eine Mail mit einem persönlichen Link. Dahinter führt eine Seite Schritt für Schritt durch deine Anleitung. Der nächste Schritt erscheint erst, wenn der aktuelle mit „OK, erledigt“ bestätigt ist. Die Regeln stehen am besten im letzten Schritt.',
            )}
          </p>
          <div className="space-y-1.5">
            <label className="block font-medium" htmlFor="welcome-steps">
              {t('Schritte')}
            </label>
            <p className="text-xs text-zinc-500">
              {t(
                'Jede Zeile „## Überschrift“ beginnt einen Schritt, darunter steht der Text. Eine Zeile mit „- “ am Anfang wird zur Aufzählung, **fett** und Links gehen auch. {name}, {server} und {app} setzt Blackbriar ein.',
              )}
            </p>
            <textarea id="welcome-steps" value={stepsText} onChange={(e) => setSteps(e.target.value)} rows={18} className={`${areaClass} font-mono`} spellCheck={false} />
            <p className="text-xs text-zinc-500">
              {data.stepsCustom || steps !== undefined ? t('Das ist dein eigener Text. Löschst du ihn ganz, gilt wieder das Beispiel.') : t('Das ist das Beispiel. Ändere es nach deinen Wünschen, dann gilt dein Text.')}
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="block font-medium" htmlFor="welcome-mail">
              {t('Text in der Mail')}
            </label>
            <p className="text-xs text-zinc-500">{t('Steht über dem Knopf zur Anleitung. Mit {name} und {server}; die Anrede setzt Blackbriar davor.')}</p>
            <textarea id="welcome-mail" value={mailText} onChange={(e) => setMail(e.target.value)} rows={4} className={areaClass} />
          </div>
          {noteLine('texts')}
          <div className="flex flex-wrap gap-2">
            <Button primary onClick={() => void save()} disabled={!changed}>
              {t('Speichern')}
            </Button>
            <a href="/api/welcome/preview" target="_blank" rel="noreferrer" className={linkButton}>
              <Eye size={15} /> {t('Anleitung ansehen')}
            </a>
          </div>
          {changed && <p className="text-xs text-zinc-500">{t('Die Vorschau zeigt den gespeicherten Stand.')}</p>}
        </Card>
      </section>

      <section className="space-y-3">
        <Heading>{t('Pro Benutzer')}</Heading>
        {(!data.canSend.mail || !data.canSend.url) && (
          <Card className="space-y-1 border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200">
            {!data.canSend.mail && <p>{t('Zum Verschicken fehlt das Mail-Postfach (Reiter „Mail“).')}</p>}
            {!data.canSend.url && <p>{t('Zum Verschicken fehlt die Adresse „Von außen“, damit der Link in der Mail funktioniert.')}</p>}
          </Card>
        )}
        <Card className="divide-y divide-zinc-800/70 px-4 py-1">
          {data.users.length === 0 && <p className="py-3 text-sm text-zinc-500">{t('Noch keine Benutzer außer dir.')}</p>}
          {data.users.map((u) => (
            <div key={u.id} className="space-y-2 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <span className="font-medium">{u.name}</span>
                  <span className="block truncate text-xs text-zinc-500">
                    {!u.email
                      ? t('keine Adresse')
                      : u.done
                        ? t('fertig am {date}', { date: dateTime(u.done_at ?? u.sent_at ?? 0) })
                        : u.sent_at
                          ? t('Mail am {date}, {n} von {total} Schritten', { date: dateTime(u.sent_at), n: u.step, total: u.total })
                          : t('noch keine Mail geschickt')}
                  </span>
                </div>
                {u.done ? <Badge tone="green">{t('fertig')}</Badge> : u.step > 0 ? <Badge tone="amber">{t('{n} von {total}', { n: u.step, total: u.total })}</Badge> : <Badge>{t('offen')}</Badge>}
              </div>
              {noteLine(u.id)}
              <div className="flex flex-wrap gap-2">
                <a href={`/api/welcome/users/${u.id}/preview`} target="_blank" rel="noreferrer" className={linkButton}>
                  <Eye size={15} /> {t('Mail ansehen')}
                </a>
                <Button onClick={() => send(u.id, u.name, u.email)} disabled={busy === u.id || !u.email || !data.canSend.mail || !data.canSend.url}>
                  <Send size={15} /> {busy === u.id ? t('Sende …') : u.sent_at ? t('Noch einmal senden') : t('Willkommen senden')}
                </Button>
                {(u.step > 0 || u.done) && (
                  <Button onClick={() => reset(u.id, u.name)}>
                    <RotateCcw size={15} /> {t('Zurücksetzen')}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </Card>
      </section>

      {data.log.length > 0 && (
        <section className="space-y-3">
          <Heading>{t('Verschickte Mails')}</Heading>
          <Card className="divide-y divide-zinc-800/70 px-4 py-1">
            {data.log.map((l, i) => (
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
