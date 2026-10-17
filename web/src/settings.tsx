import { useEffect, useState, type ReactNode } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronUp, Download, LogOut, PlugZap, RefreshCw, Send, Trash2, Upload } from 'lucide-react'
import { api, useApi, type ConnectionKey, type Connections, type ImportStatus, type Provider, type SectionInfo, type Settings, type Status, type User } from './api'
import { locale, mark, t } from './i18n'
import { LogPanel } from './log'
import { Field } from './login'
import { ChangelogAll } from './changelog'
import { NewsletterSettings, ReminderSettings } from './newsletter'
import { ago, Badge, Button, Card, ErrorNote, fmtDate, fmtSize, meta, num, PROJECT_URL } from './ui'
import { Heading } from './views'

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body ? { 'content-type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
})

const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm outline-none placeholder:text-zinc-600 focus:border-amber-400'
const selectClass = 'rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm outline-none focus:border-amber-400'

type NoteState = { text: string; ok: boolean } | undefined

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2 text-sm">
      <span>
        {label}
        {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4 shrink-0 accent-amber-400" />
    </label>
  )
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-zinc-400">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  )
}

function Note({ note }: { note: NoteState }) {
  if (!note) return null
  return <p className={`rounded-lg px-4 py-3 text-sm ${note.ok ? 'bg-emerald-400/10 text-emerald-300' : 'bg-red-400/10 text-red-300'}`}>{note.text}</p>
}

// ---------------------------------------------------------------------------

type ServiceId = 'plex' | 'seerr' | 'radarr' | 'radarr4k' | 'sonarr' | 'sonarr4k' | 'tmdb' | 'tautulli' | 'tracearr' | 'telegram' | 'mail'

interface Service {
  name: string
  /** Überschrift, wenn mehrere Verbindungen in einem Reiter stehen */
  heading?: string
  required?: boolean
  /** Wofür die Verbindung gebraucht wird */
  purpose: string
  /** Wo die Zugangsdaten zu finden sind */
  help: string[]
  /** Felder mit `optional` dürfen leer bleiben, ohne dass die Verbindung als unvollständig gilt */
  fields: { key: ConnectionKey; label: string; placeholder: string; secret?: boolean; optional?: boolean }[]
  /** Beschriftung der Schaltfläche zum Prüfen, falls sie mehr tut als verbinden */
  testLabel?: string
}

// Die Texte stehen hier auf Deutsch und werden erst bei der Anzeige übersetzt; `mark` kennzeichnet sie fürs Wörterbuch
const ADDRESS = mark('Adresse')
const API_KEY = mark('API-Key')

const SERVICES: Record<ServiceId, Service> = {
  plex: {
    name: 'Plex',
    required: true,
    purpose: mark('Die Grundlage: laufende Wiedergaben, Verlauf, Bewertungen und die Bibliothek kommen von hier.'),
    help: [
      mark('Adresse: so, wie du Plex im Heimnetz erreichst, mit dem Port 32400.'),
      mark(
        'Token: Bei der ersten Anmeldung mit Plex trägt Blackbriar ihn selbst ein. Von Hand: in Plex Web bei einem Film auf „…“ → „Medieninfo“ → „XML anzeigen“; am Ende der Adresse steht X-Plex-Token=…',
      ),
      mark('Es muss der Token des Serverbesitzers sein, sonst lassen sich die Bewertungen der anderen nicht lesen. Nur dieses Konto kann sich anmelden.'),
    ],
    fields: [
      { key: 'plexUrl', label: ADDRESS, placeholder: 'http://192.168.1.10:32400' },
      { key: 'plexToken', label: mark('Token'), placeholder: mark('Token des Serverbesitzers'), secret: true },
    ],
  },
  seerr: {
    name: 'Seerr',
    purpose: mark(
      'Liefert die Merklisten aller Benutzer, die Anfragen und den Stand jedes Wunsches. Ohne Seerr fehlen „Merklisten“ und „Kann weg“.',
    ),
    help: [mark('API-Key: in Seerr unter Einstellungen → Allgemein.')],
    fields: [
      { key: 'seerrUrl', label: ADDRESS, placeholder: 'http://192.168.1.10:5055' },
      { key: 'seerrApiKey', label: API_KEY, placeholder: mark('API-Key aus Seerr'), secret: true },
    ],
  },
  radarr: {
    name: 'Radarr',
    heading: mark('Radarr (Standard, z. B. 1080p)'),
    purpose: mark('Zeigt unter „Bibliothek“, welche Filme Radarr noch verwaltet, und füllt die „Warteliste“.'),
    help: [mark('API-Key: in Radarr unter Settings → General.')],
    fields: [
      { key: 'radarrUrl', label: ADDRESS, placeholder: 'http://192.168.1.10:7878' },
      { key: 'radarrApiKey', label: API_KEY, placeholder: mark('API-Key aus Radarr'), secret: true },
    ],
  },
  radarr4k: {
    name: 'Radarr 4K',
    heading: mark('Radarr 4K (zweite Instanz, optional)'),
    purpose: mark('Nur nötig, wenn du für 4K eine eigene Radarr-Instanz betreibst.'),
    help: [mark('Adresse und API-Key der zweiten Instanz, zu finden wie bei der ersten.')],
    fields: [
      { key: 'radarr4kUrl', label: ADDRESS, placeholder: 'http://192.168.1.10:7879' },
      { key: 'radarr4kApiKey', label: API_KEY, placeholder: mark('API-Key aus Radarr 4K'), secret: true },
    ],
  },
  sonarr: {
    name: 'Sonarr',
    heading: mark('Sonarr (Standard, z. B. 1080p)'),
    purpose: mark(
      'Zeigt unter „Bibliothek“, welche Serien Sonarr noch verwaltet, ob sie beendet sind und wann die nächste Folge kommt, und füllt die „Warteliste“.',
    ),
    help: [mark('API-Key: in Sonarr unter Settings → General.')],
    fields: [
      { key: 'sonarrUrl', label: ADDRESS, placeholder: 'http://192.168.1.10:8989' },
      { key: 'sonarrApiKey', label: API_KEY, placeholder: mark('API-Key aus Sonarr'), secret: true },
    ],
  },
  sonarr4k: {
    name: 'Sonarr 4K',
    heading: mark('Sonarr 4K (zweite Instanz, optional)'),
    purpose: mark('Nur nötig, wenn du für 4K eine eigene Sonarr-Instanz betreibst.'),
    help: [mark('Adresse und API-Key der zweiten Instanz, zu finden wie bei der ersten.')],
    fields: [
      { key: 'sonarr4kUrl', label: ADDRESS, placeholder: 'http://192.168.1.10:8990' },
      { key: 'sonarr4kApiKey', label: API_KEY, placeholder: mark('API-Key aus Sonarr 4K'), secret: true },
    ],
  },
  tmdb: {
    name: 'TMDB',
    purpose: mark('Für „Was kommt“: Neustarts im Kino und bei den Streaminganbietern, samt Postern.'),
    help: [mark('Schlüssel: kostenlos mit einem Konto bei themoviedb.org unter Einstellungen → API. Der kurze API-Schlüssel und das lange Lesetoken gehen beide.')],
    fields: [{ key: 'tmdbApiKey', label: API_KEY, placeholder: mark('API-Schlüssel oder Lesetoken von TMDB'), secret: true }],
  },
  tautulli: {
    name: 'Tautulli',
    heading: 'Tautulli',
    purpose: mark('Einmaliger Import der Wiedergaben aus der Zeit vor Blackbriar, mit Dauer, Gerät und Wiedergabeart.'),
    help: [mark('API-Key: in Tautulli unter Settings → Web Interface.')],
    fields: [
      { key: 'tautulliUrl', label: ADDRESS, placeholder: 'http://192.168.1.10:8181' },
      { key: 'tautulliApiKey', label: API_KEY, placeholder: mark('API-Key aus Tautulli'), secret: true },
    ],
  },
  tracearr: {
    name: 'Tracearr',
    heading: 'Tracearr',
    purpose: mark('Einmaliger Import wie bei Tautulli, dazu die Codecs früherer Transkodierungen für die Bibliothek.'),
    help: [mark('API-Key: in Tracearr unter Settings → General.')],
    fields: [
      { key: 'tracearrUrl', label: ADDRESS, placeholder: 'http://192.168.1.10:3000' },
      { key: 'tracearrApiKey', label: API_KEY, placeholder: mark('API-Key aus Tracearr'), secret: true },
    ],
  },
  telegram: {
    name: 'Telegram',
    purpose: mark('Für die Nachrichten bei neuen Bewertungen, die Erinnerungen und den Wochenrückblick.'),
    help: [
      mark('Bot anlegen: in Telegram @BotFather öffnen, /newbot senden und den Token hier eintragen.'),
      mark('Dem neuen Bot einmal /start schicken, sonst darf er dir nicht schreiben.'),
      mark('Chat-ID: deine eigene Benutzer-ID, z. B. von @userinfobot. Für eine Gruppe die ID der Gruppe.'),
    ],
    fields: [
      { key: 'telegramBotToken', label: mark('Bot-Token'), placeholder: mark('Token von @BotFather'), secret: true },
      { key: 'telegramChatId', label: mark('Chat-ID'), placeholder: mark('ID des Empfängers') },
    ],
  },
  mail: {
    name: mark('E-Mail'),
    purpose: mark('Für Newsletter und Erinnerungen an deine Benutzer. Verschickt wird über ein eigenes Postfach.'),
    help: [
      mark('Server, Port, Benutzer und Passwort nennt dir der Anbieter des Postfachs unter „SMTP“ oder „Postausgang“.'),
      mark('Port 465 ist von Anfang an verschlüsselt, 587 schaltet nach dem Verbinden um. Beides geht; unverschlüsselt verschickt Blackbriar nicht.'),
      mark('Von außen: die Adresse, unter der Blackbriar aus dem Internet erreichbar ist. Sie wird für die Links in den Mails gebraucht, etwa zum Abbestellen.'),
      mark('„Testmail an mich“ schickt eine Mail an deine eigene Adresse, an niemanden sonst.'),
    ],
    testLabel: mark('Testmail an mich'),
    fields: [
      { key: 'mailHost', label: mark('Server'), placeholder: 'mail.example.com' },
      { key: 'mailPort', label: mark('Port'), placeholder: '465', optional: true },
      { key: 'mailUser', label: mark('Benutzer'), placeholder: mark('meist die E-Mail-Adresse') },
      { key: 'mailPassword', label: mark('Passwort'), placeholder: mark('Passwort des Postfachs'), secret: true },
      { key: 'mailFrom', label: mark('Absender'), placeholder: 'briefing@example.com' },
      { key: 'mailFromName', label: mark('Absendername'), placeholder: mark('z. B. der Name deines Servers'), optional: true },
      { key: 'publicUrl', label: mark('Von außen'), placeholder: 'https://blackbriar.example.com', optional: true },
    ],
  },
}

const isConfigured = (id: ServiceId, connections: Connections) =>
  SERVICES[id].fields.every((f) => f.optional || connections[f.key].source !== 'none')

function ServiceForm({ id, connections, onSaved, children }: { id: ServiceId; connections: Connections; onSaved: () => void; children?: ReactNode }) {
  const service = SERVICES[id]
  // Nur was hier steht, wurde geändert; geheime Felder starten leer und bleiben ohne Eingabe unverändert
  const [draft, setDraft] = useState<Partial<Record<ConnectionKey, string>>>({})
  const [note, setNote] = useState<NoteState>()
  const [busy, setBusy] = useState(false)
  const dirty = Object.keys(draft).length > 0

  const run = (action: () => Promise<string>) => {
    setBusy(true)
    setNote(undefined)
    action()
      .then((text) => setNote({ text, ok: true }))
      .catch((e: Error) => setNote({ text: e.message, ok: false }))
      .finally(() => setBusy(false))
  }
  const save = () =>
    run(async () => {
      await api('/connections', json('PUT', draft))
      setDraft({})
      onSaved()
      return id === 'mail' ? t('Gespeichert.') : t('Gespeichert. Der Abgleich läuft neu an.')
    })
  const test = () => run(async () => (await api<{ message: string }>(`/connections/test/${id}`, json('POST'))).message)

  return (
    <Card className="space-y-4 p-4">
      {service.heading && <p className="font-semibold">{t(service.heading)}</p>}
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-zinc-400">{t(service.purpose)}</p>
        {isConfigured(id, connections) ? (
          <Badge tone="green">{t('eingerichtet')}</Badge>
        ) : (
          <Badge tone={service.required ? 'red' : 'zinc'}>{service.required ? t('fehlt') : t('optional')}</Badge>
        )}
      </div>
      <div className="space-y-3">
        {service.fields.map((f) => {
          const current = connections[f.key]
          const stored = current.source === 'env' ? t('aus Umgebungsvariable – zum Ändern neu eingeben') : t('gespeichert – zum Ändern neu eingeben')
          return (
            <label key={f.key} className="grid items-center gap-1 text-sm sm:grid-cols-[7rem_1fr]">
              <span className="text-zinc-400">{t(f.label)}</span>
              <input
                type={f.secret ? 'password' : 'text'}
                autoComplete="off"
                value={draft[f.key] ?? (f.secret ? '' : current.value)}
                onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                placeholder={f.secret && current.source !== 'none' ? stored : t(f.placeholder)}
                className={inputClass}
              />
            </label>
          )
        })}
      </div>
      <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-500">
        {service.help.map((line) => (
          <li key={line}>{t(line)}</li>
        ))}
      </ul>
      <Note note={note} />
      <div className="flex flex-wrap gap-2">
        <Button primary onClick={save} disabled={!dirty || busy}>
          {t('Speichern')}
        </Button>
        <Button onClick={test} disabled={dirty || busy}>
          {service.testLabel ? <Send size={15} /> : <PlugZap size={15} />} {t(service.testLabel ?? 'Verbindung testen')}
        </Button>
      </div>
      {children}
    </Card>
  )
}

/** Noch kein Plex-Konto eingetragen (Einrichtung mit eigenem Konto): über plex.tv verbinden statt das Token von Hand zu suchen. */
function PlexConnect() {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const connect = () => {
    setBusy(true)
    setError('')
    api<{ url: string }>('/plex/connect', { method: 'POST' })
      .then(({ url }) => location.assign(url))
      .catch((e: Error) => {
        setError(e.message)
        setBusy(false)
      })
  }
  return (
    <div className="space-y-3 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4">
      <div className="space-y-1">
        <p className="font-medium text-amber-200">{t('Verbinde dein Plex-Konto')}</p>
        <p className="text-sm text-zinc-400">
          {t('Melde dich bei Plex mit dem Konto an, dem der Server gehört. Danach wählst du hier den Server, und du kannst dich auch über Plex bei Blackbriar anmelden.')}
        </p>
      </div>
      <Button onClick={connect} disabled={busy}>
        <PlugZap size={15} /> {busy ? t('Einen Moment …') : t('Mit Plex verbinden')}
      </Button>
      <ErrorNote message={error} />
    </div>
  )
}

/** Neuer Schlüssel für alle Webhook-Adressen. Danach gelten die alten Adressen in Plex, Radarr und Sonarr nicht mehr. */
function NewWebhookKey({ onDone }: { onDone: () => void }) {
  const [note, setNote] = useState<NoteState>()
  const renew = () => {
    if (!confirm(t('Neuen Schlüssel erzeugen? Die bisherigen Adressen in Plex, Radarr und Sonarr funktionieren danach nicht mehr; du musst dort die neuen eintragen.'))) return
    api('/settings/webhook-key', json('POST', {}))
      .then(() => {
        onDone()
        setNote({ text: t('Neuer Schlüssel erzeugt. Trag die neuen Adressen in Plex, Radarr und Sonarr ein.'), ok: true })
      })
      .catch((e: Error) => setNote({ text: e.message, ok: false }))
  }
  return (
    <div className="flex flex-wrap items-center gap-3 pt-1">
      <Button onClick={renew}>
        <RefreshCw size={15} /> {t('Neuen Schlüssel erzeugen')}
      </Button>
      {note ? (
        <span className={`text-xs ${note.ok ? 'text-emerald-400' : 'text-red-400'}`}>{note.text}</span>
      ) : (
        <span className="text-xs text-zinc-500">{t('Gilt für alle Webhooks. Nötig, wenn eine Adresse in fremde Hände geraten ist, etwa auf einem Bildschirmfoto.')}</span>
      )}
    </div>
  )
}

/** Sucht die eigenen Plex-Server über plex.tv, damit die Adresse nicht von Hand eingetragen werden muss. */
// Bei der Einrichtung (Token da, Adresse fehlt) steht die Auswahl oben und sucht von selbst; später ist sie ein Knopf unter dem Formular.
function ServerPicker({ connections, onSaved, setup }: { connections: Connections; onSaved: () => void; setup: boolean }) {
  const [servers, setServers] = useState<{ name: string; uri: string }[]>()
  const [note, setNote] = useState<NoteState>()
  const [searching, setSearching] = useState(false)
  const hasToken = connections.plexToken.source !== 'none'

  const search = () => {
    setNote(undefined)
    setSearching(true)
    api<{ name: string; uri: string }[]>('/plex/servers')
      .then((found) => {
        setServers(found)
        if (!found.length)
          setNote({
            text: setup ? t('Kein Server gefunden. Trag die Adresse unten von Hand ein.') : t('Zu diesem Konto wurde kein eigener Server im Heimnetz gefunden.'),
            ok: false,
          })
      })
      .catch((e: Error) => setNote({ text: e.message, ok: false }))
      .finally(() => setSearching(false))
  }
  useEffect(() => {
    if (setup && hasToken) search()
    // Nur beim Öffnen der Seite suchen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  if (!hasToken) return null
  const choose = (uri: string) =>
    api('/connections', json('PUT', { plexUrl: uri }))
      .then(() => {
        onSaved()
        setNote({ text: t('{uri} übernommen. Der Abgleich läuft an.', { uri }), ok: true })
      })
      .catch((e: Error) => setNote({ text: e.message, ok: false }))

  return (
    <div className={setup ? 'space-y-3 rounded-xl border border-amber-400/40 bg-amber-400/5 p-4' : 'space-y-3'}>
      {setup ? (
        <div className="space-y-1">
          <p className="font-medium text-amber-200">{t('Wähle deinen Plex-Server')}</p>
          <p className="text-sm text-zinc-400">{searching ? t('Suche deine Plex-Server …') : t('Ein Klick trägt die Adresse ein, danach läuft der erste Abgleich an.')}</p>
        </div>
      ) : (
        <Button onClick={search}>{t('Meine Plex-Server suchen')}</Button>
      )}
      {servers?.map((s) => (
        <button
          key={s.uri}
          onClick={() => void choose(s.uri)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 text-left text-sm hover:border-zinc-600"
        >
          <span className="font-medium">{s.name}</span>
          <span className="text-zinc-400">{s.uri}</span>
        </button>
      ))}
      <Note note={note} />
    </div>
  )
}

// ---------------------------------------------------------------------------

/** Logo für den Kopf der Mails und die Adressen, an die Blackbriar schreiben würde. */
function MailExtras() {
  const users = useApi<User[]>('/users')
  const tone = useApi<{ briefing: boolean; remotePosters: boolean; canRemote: boolean }>('/mail/tone')
  const [version, setVersion] = useState(0)
  const [hasLogo, setHasLogo] = useState(true)
  const [note, setNote] = useState<NoteState>()
  const [editing, setEditing] = useState<{ id: number; field: 'email' | 'name'; value: string }>()
  const [names, setNames] = useState('')
  const [namesNote, setNamesNote] = useState<NoteState>()

  const upload = (file: File | undefined) => {
    if (!file) return
    setNote(undefined)
    const reader = new FileReader()
    reader.onload = () =>
      api('/mail/logo', json('PUT', { data: reader.result }))
        .then(() => {
          setHasLogo(true)
          setVersion((v) => v + 1)
          setNote({ text: t('Logo gespeichert.'), ok: true })
        })
        .catch((e: Error) => setNote({ text: e.message, ok: false }))
    reader.readAsDataURL(file)
  }
  const remove = () =>
    api('/mail/logo', json('DELETE'))
      .then(() => {
        setHasLogo(false)
        setNote({ text: t('Logo entfernt.'), ok: true })
      })
      .catch((e: Error) => setNote({ text: e.message, ok: false }))
  const saveEdit = () => {
    if (!editing) return
    const request =
      editing.field === 'email'
        ? api(`/users/${editing.id}/email`, json('PUT', { email: editing.value }))
        : api(`/users/${editing.id}/display-name`, json('PUT', { name: editing.value }))
    request
      .then(() => {
        setEditing(undefined)
        setNamesNote(undefined)
        users.reload()
      })
      .catch((e: Error) => setNamesNote({ text: e.message, ok: false }))
  }
  const importNames = () =>
    api<{ matched: number; unknown: string[] }>('/users/display-names', json('POST', { text: names }))
      .then((result) => {
        users.reload()
        if (result.unknown.length) {
          setNamesNote({ text: t('{n} übernommen. Nicht gefunden: {names}', { n: result.matched, names: result.unknown.join(', ') }), ok: false })
        } else {
          setNames('')
          setNamesNote({ text: t('{n} Namen übernommen.', { n: result.matched }), ok: true })
        }
      })
      .catch((e: Error) => setNamesNote({ text: e.message, ok: false }))
  // Benutzer, an den gerade eine Testnachricht geht
  const [testing, setTesting] = useState<number | null>(null)
  const [testNote, setTestNote] = useState<NoteState>()
  const sendTest = (id: number) => {
    setTesting(id)
    setTestNote(undefined)
    api<{ message: string }>(`/mail/users/${id}/test`, json('POST'))
      .then((r) => setTestNote({ text: r.message, ok: true }))
      .catch((e: Error) => setTestNote({ text: e.message, ok: false }))
      .finally(() => setTesting(null))
  }
  const active = (users.data ?? []).filter((u) => u.active)

  return (
    <>
      <section className="space-y-3">
        <Heading>{t('Kopf der Mails')}</Heading>
        <Card className="space-y-3 p-4">
          <p className="text-sm text-zinc-400">
            {t(
              'Links steht ein Kästchen mit der Kalenderwoche, daneben dein Logo. Am besten passt ein breiter Schriftzug in heller Farbe mit durchsichtigem Hintergrund, etwa 620 × 240 Pixel. Ohne Logo steht dort der Absendername als Text. Das Logo erscheint auch oben in der Seitenleiste von Blackbriar.',
            )}
          </p>
          {hasLogo && (
            <img
              key={version}
              src={`/api/mail/logo?v=${version}`}
              alt={t('Logo der Mails')}
              onError={() => setHasLogo(false)}
              className="h-20 rounded-md border border-zinc-800"
            />
          )}
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700">
              <Upload size={15} /> {t(hasLogo ? 'Anderes Logo hochladen' : 'Logo hochladen')}
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </label>
            {hasLogo && (
              <Button onClick={() => void remove()}>
                <Trash2 size={15} /> {t('Logo entfernen')}
              </Button>
            )}
            <a
              href="/api/mail/preview"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
            >
              {t('Vorschau der Testmail')}
            </a>
          </div>
          <Note note={note} />
        </Card>
      </section>

      <section className="space-y-3">
        <Heading>{t('Ton der Mails')}</Heading>
        <Card className="px-4 py-1">
          <Toggle
            label={t('Briefing-Ton')}
            hint={t(
              'Anrede, Betreff und Überschriften klingen wie ein Briefing aus einem Agentenfilm: „Agent …“, „Lagebericht“, „Einsatzbericht fehlt“. Titel, Daten und die Links zum Abbestellen bleiben sachlich.',
            )}
            checked={tone.data?.briefing ?? false}
            onChange={(briefing) => void api('/mail/tone', json('PUT', { briefing })).then(tone.reload)}
          />
        </Card>
      </section>

      <section className="space-y-3">
        <Heading>{t('Poster in den Mails')}</Heading>
        <Card className="px-4 py-1">
          <Toggle
            label={t('Poster von Blackbriar laden statt anhängen')}
            hint={
              tone.data && !tone.data.canRemote
                ? t('Dafür muss Blackbriar von außen erreichbar sein: erst oben im Feld „Von außen“ die Adresse eintragen. Bis dahin werden die Poster angehängt.')
                : t('Aus: Die Poster hängen an der Mail und erscheinen überall sofort; manche Mailprogramme listen sie zusätzlich als Anhänge auf, und die Mail wird über ein Megabyte groß. Ein: Die Mail bleibt klein und ohne Anhang-Liste; Outlook und Apple Mail zeigen die Poster dann teils erst nach „Bilder laden“. Das gilt auch für Logo und Kalenderwoche im Kopf.')
            }
            checked={tone.data?.remotePosters ?? false}
            onChange={(remotePosters) => void api('/mail/tone', json('PUT', { remotePosters })).then(tone.reload)}
          />
        </Card>
      </section>

      <section className="space-y-3">
        <Heading>{t('Namen und Adressen der Benutzer')}</Heading>
        <Card className="divide-y divide-zinc-800/70 px-4 py-1">
          {active.map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm">
              <span className="w-36 min-w-0 shrink-0 truncate text-zinc-400" title={u.plex_name}>
                {u.plex_name}
              </span>
              {editing?.id === u.id ? (
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type={editing.field === 'email' ? 'email' : 'text'}
                    autoFocus
                    value={editing.value}
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                    placeholder={editing.field === 'email' ? t('leer = Adresse aus Plex') : t('leer = Plex-Name')}
                    className={inputClass}
                  />
                  <Button primary onClick={saveEdit}>
                    {t('Speichern')}
                  </Button>
                </span>
              ) : (
                <>
                  <button
                    onClick={() => setEditing({ id: u.id, field: 'name', value: u.display_name ?? '' })}
                    title={t('Namen ändern')}
                    className={`w-32 min-w-0 shrink-0 truncate text-left hover:text-white ${u.display_name ? 'font-medium' : 'text-zinc-600'}`}
                  >
                    {u.display_name ?? t('kein eigener Name')}
                  </button>
                  <button
                    onClick={() => setEditing({ id: u.id, field: 'email', value: u.email_custom ? (u.email ?? '') : '' })}
                    title={t('Adresse ändern')}
                    className="min-w-0 flex-1 truncate text-left text-zinc-400 hover:text-zinc-200"
                  >
                    {u.email ?? t('keine Adresse')}
                    {u.email_custom ? ` (${t('von dir eingetragen')})` : ''}
                  </button>
                  <button
                    onClick={() => sendTest(u.id)}
                    disabled={!u.email || testing !== null}
                    title={t('Testnachricht an diese Adresse schicken')}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-zinc-200 transition hover:bg-zinc-700 disabled:opacity-40"
                  >
                    <Send size={13} className={testing === u.id ? 'animate-pulse' : ''} /> {t('Test')}
                  </button>
                </>
              )}
            </div>
          ))}
        </Card>
        <Note note={testNote} />
        <p className="text-xs text-zinc-500">
          {t(
            'Links der Plex-Name, daneben der Name, den du vergibst, und die Adresse aus dem Plex-Konto. Der vergebene Name erscheint überall in Blackbriar, in den Telegram-Nachrichten und als Anrede in den Mails. Ein Klick ändert Namen oder Adresse. Post bekommt nur, wer in den Reitern „Newsletter“ oder „Erinnerung“ eingeschaltet ist.',
          )}
        </p>
        <Card className="space-y-3 p-4">
          <p className="text-sm text-zinc-400">{t('Mehrere Namen auf einmal: eine Zeile pro Benutzer in der Form „Plex-Name = Name“.')}</p>
          <textarea
            value={names}
            onChange={(e) => setNames(e.target.value)}
            rows={4}
            placeholder={'plexname1 = Anna\nplexname2 = Ben'}
            className={`${inputClass} font-mono`}
          />
          <Note note={namesNote} />
          <Button onClick={() => void importNames()} disabled={!names.trim()}>
            {t('Namen übernehmen')}
          </Button>
        </Card>
      </section>
    </>
  )
}

const WEEKDAYS = [mark('Sonntag'), mark('Montag'), mark('Dienstag'), mark('Mittwoch'), mark('Donnerstag'), mark('Freitag'), mark('Samstag')]

interface FormProps {
  form: Settings
  setForm: (s: Settings) => void
  save: () => void
  note: NoteState
  run: (action: () => Promise<unknown>, success: string) => void
}

function SaveRow({ save, note, children }: { save: () => void; note: NoteState; children?: ReactNode }) {
  return (
    <div className="space-y-3">
      <Note note={note} />
      <div className="flex flex-wrap gap-2">
        <Button primary onClick={save}>
          {t('Speichern')}
        </Button>
        {children}
      </div>
    </div>
  )
}

function Notifications({ form, setForm, save, note, run }: FormProps) {
  return (
    <section className="space-y-3">
      <Heading>{t('Benachrichtigungen')}</Heading>
      <Card className="divide-y divide-zinc-800/70 px-4 py-1">
        <Toggle label={t('Nachricht, sobald jemand etwas bewertet')} checked={form.notifyRatings} onChange={(v) => setForm({ ...form, notifyRatings: v })} />
        <Toggle
          label={t('Erinnerung, wenn etwas gesehen, aber nicht bewertet wurde')}
          checked={form.notifyReminders}
          onChange={(v) => setForm({ ...form, notifyReminders: v })}
        />
        <Toggle
          label={t('Hinweis, wenn Plex einen gewünschten Titel vermutlich falsch zugeordnet hat')}
          checked={form.notifyMismatches}
          onChange={(v) => setForm({ ...form, notifyMismatches: v })}
        />
        <Toggle
          label={t('Hinweis, wenn eine Staffel komplett ist oder eine Folge von einer anderen Release-Gruppe kommt')}
          checked={form.notifySeasons}
          onChange={(v) => setForm({ ...form, notifySeasons: v })}
        />
        <label className="flex items-center justify-between gap-4 py-2 text-sm">
          {t('Erinnerung nach so vielen Tagen')}
          <input
            type="number"
            min={0}
            max={365}
            value={form.reminderDays}
            onChange={(e) => setForm({ ...form, reminderDays: Number(e.target.value) })}
            className={`${selectClass} w-20 text-right`}
          />
        </label>
        <Toggle label={t('Wochenrückblick')} checked={form.weeklyEnabled} onChange={(v) => setForm({ ...form, weeklyEnabled: v })} />
        <div className="flex items-center justify-between gap-4 py-2 text-sm">
          {t('Wochenrückblick verschicken am')}
          <span className="flex items-center gap-2">
            <select value={form.weeklyDay} onChange={(e) => setForm({ ...form, weeklyDay: Number(e.target.value) })} className={selectClass}>
              {WEEKDAYS.map((day, i) => (
                <option key={day} value={i}>
                  {t(day)}
                </option>
              ))}
            </select>
            {t('um')}
            <select value={form.weeklyHour} onChange={(e) => setForm({ ...form, weeklyHour: Number(e.target.value) })} className={selectClass}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {t('{h} Uhr', { h })}
                </option>
              ))}
            </select>
          </span>
        </div>
      </Card>
      <p className="text-xs text-zinc-500">
        {t('Erinnerungen gibt es nur für das, was seit der Installation gesehen wurde. Deine eigenen Bewertungen lösen keine Nachricht aus.')}
      </p>
      <SaveRow save={save} note={note}>
        <Button onClick={() => run(() => api('/telegram/test', json('POST')), t('Testnachricht verschickt.'))}>
          <Send size={15} /> {t('Testnachricht senden')}
        </Button>
        <Button onClick={() => run(() => api('/weekly/send', json('POST')), t('Wochenrückblick verschickt.'))}>
          <Send size={15} /> {t('Wochenrückblick jetzt senden')}
        </Button>
      </SaveRow>
    </section>
  )
}

/** Die Mediatheken aus Plex in eigener Reihenfolge; ausgeschaltete bleiben bei „Kann weg“, offenen Bewertungen, Erinnerungen und im Newsletter außen vor. */
function Sections() {
  const { data, reload } = useApi<SectionInfo[]>('/sections')
  if (!data?.length) return null
  const set = (name: string, included: boolean) => void api('/sections', json('PUT', { name, included })).then(reload)
  const move = (name: string, direction: 'up' | 'down') => void api('/sections/move', json('POST', { name, direction })).then(reload)
  const arrow = 'rounded p-0.5 text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-200 disabled:pointer-events-none disabled:opacity-20'
  return (
    <section className="space-y-3">
      <Heading>{t('Mediatheken')}</Heading>
      <Card className="divide-y divide-zinc-800/70 px-4 py-1">
        {data.map((s, i) => (
          <div key={s.name} className="flex items-center gap-3">
            {/* Reihenfolge wie in Plex; gilt in der Bibliothek, hier und beim Benutzer */}
            <span className="flex shrink-0 flex-col">
              <button onClick={() => move(s.name, 'up')} disabled={i === 0} title={t('Nach oben')} aria-label={t('{name} nach oben', { name: s.name })} className={arrow}>
                <ChevronUp size={14} />
              </button>
              <button onClick={() => move(s.name, 'down')} disabled={i === data.length - 1} title={t('Nach unten')} aria-label={t('{name} nach unten', { name: s.name })} className={arrow}>
                <ChevronDown size={14} />
              </button>
            </span>
            <div className={`min-w-0 flex-1 ${s.titles ? '' : 'opacity-60'}`}>
              <Toggle
                label={s.name}
                hint={meta(s.type === 'show' ? t('Serien') : t('Filme'), s.titles ? t('{n} Titel', { n: num(s.titles) }) : t('leer'), s.titles ? fmtSize(s.size) : '')}
                checked={s.included}
                onChange={(v) => set(s.name, v)}
              />
            </div>
          </div>
        ))}
      </Card>
      <p className="text-xs text-zinc-500">
        {t('Ausgeschaltete Mediatheken bleiben bei „Kann weg“, den offenen Bewertungen, den Erinnerungen und im Newsletter außen vor. In der Bibliothek und im Verlauf sind sie weiter zu sehen.')}{' '}
        {t('Mit den Pfeilen legst du die Reihenfolge fest, etwa wie in Plex; sie gilt auch in der Bibliothek und beim Benutzer.')}
      </p>
    </section>
  )
}

function LibrarySettings({ form, setForm, save, note }: FormProps) {
  return (
    <section className="space-y-3">
      <Card className="divide-y divide-zinc-800/70 px-4 py-1">
        <label className="grid items-center gap-1 py-2 text-sm sm:grid-cols-[1fr_14rem]">
          <span>
            {t('Kennzeichen für umgewandelte Dateien')}
            <span className="block text-xs text-zinc-500">
              {t('Text, der im Dateinamen oder Ordner vorkommt. Leer lassen, wenn du Dateien nicht selbst umwandelst.')}
            </span>
          </span>
          <input
            value={form.convertedMarker}
            onChange={(e) => setForm({ ...form, convertedMarker: e.target.value })}
            placeholder={t('z. B. -MeinKuerzel')}
            className={inputClass}
          />
        </label>
        <label className="grid items-center gap-1 py-2 text-sm sm:grid-cols-[1fr_14rem]">
          <span>
            {t('Wartezeit für „Gesehen, aber nicht bewertet“ in Tagen')}
            <span className="block text-xs text-zinc-500">
              {t('Hat jemand einen Titel zu Ende gesehen und bewertet ihn nicht, erscheint er nach dieser Zeit trotzdem unter „Kann weg“.')}
            </span>
          </span>
          <input
            type="number"
            min={0}
            max={365}
            value={form.cleanupWaitDays}
            onChange={(e) => setForm({ ...form, cleanupWaitDays: Number(e.target.value) })}
            className={inputClass}
          />
        </label>
        <Toggle
          label={t('Löschen aus Blackbriar erlauben')}
          hint={t(
            'Unter „Kann weg“ erscheinen dann Schaltflächen zum Löschen. Jedes Löschen wird einzeln bestätigt. In Plex muss „Löschen von Medien erlauben“ eingeschaltet sein.',
          )}
          checked={form.allowDelete}
          onChange={(v) => setForm({ ...form, allowDelete: v })}
        />
      </Card>
      <SaveRow save={save} note={note} />
    </section>
  )
}

/** Stand und Auslöser des einmaligen Imports aus Tautulli bzw. Tracearr. */
function ImportPanel({ source, status, onStart }: { source: 'tautulli' | 'tracearr'; status?: ImportStatus; onStart: () => void }) {
  const [error, setError] = useState('')
  const s = status?.[source]
  if (!s) return null
  const start = () => {
    setError('')
    api(`/import/${source}`, json('POST'))
      .then(onStart)
      .catch((e: Error) => setError(e.message))
  }
  return (
    <div className="space-y-2 border-t border-zinc-800/70 pt-4">
      <p className="text-sm text-zinc-400">
        {s.running
          ? t('Import läuft: {read} von {total} Einträgen gelesen', { read: num(s.read), total: num(s.total) })
          : s.count > 0
            ? meta(t('{n} Wiedergaben importiert', { n: num(s.count) }), s.lastImport ? t('zuletzt am {date}', { date: fmtDate(s.lastImport) }) : '')
            : t('Noch nichts importiert.')}
      </p>
      <ErrorNote message={error || s.error} />
      <Button onClick={start} disabled={!s.configured || s.running}>
        <Download size={15} className={s.running ? 'animate-pulse' : ''} /> {s.count > 0 ? t('Erneut importieren') : t('Jetzt importieren')}
      </Button>
    </div>
  )
}

function PastSource({ form, setForm, save, note }: FormProps) {
  return (
    <section className="space-y-3">
      <Card className="px-4 py-1">
        <label className="flex items-center justify-between gap-4 py-2 text-sm">
          <span>
            {t('Quelle für die Vergangenheit')}
            <span className="block text-xs text-zinc-500">
              {t('Aus beiden Quellen sind Wiedergaben importiert. Damit nichts doppelt zählt, gilt für die Zeit vor der eigenen Aufzeichnung nur eine davon.')}
            </span>
          </span>
          <select
            value={form.pastSource}
            onChange={(e) => setForm({ ...form, pastSource: e.target.value as Settings['pastSource'] })}
            className={selectClass}
          >
            <option value="tautulli">Tautulli</option>
            <option value="tracearr">Tracearr</option>
          </select>
        </label>
      </Card>
      <SaveRow save={save} note={note} />
    </section>
  )
}

/** Land und Anbieter für „Was kommt“. */
function UpcomingSettings({ form, setForm, save, note }: FormProps) {
  const catalog = useApi<Provider[]>('/tmdb/providers')
  const chosen = new Set(form.upcomingProviders)
  const [search, setSearch] = useState('')
  const all = catalog.data ?? []
  const needle = search.trim().toLowerCase()
  // Ein Land hat schnell über 200 Anbieter. Ohne Suche stehen die gewählten und die wichtigsten da,
  // mit Suche alle, die zum Begriff passen; so ist auch ein Anbieter von weiter hinten zu erreichen.
  const picked = all.filter((p) => chosen.has(p.name))
  const shown = needle
    ? all.filter((p) => p.name.toLowerCase().includes(needle)).slice(0, 60)
    : [...picked, ...all.filter((p) => !chosen.has(p.name)).slice(0, Math.max(0, 36 - picked.length))]
  const toggle = (name: string) =>
    setForm({ ...form, upcomingProviders: chosen.has(name) ? form.upcomingProviders.filter((p) => p !== name) : [...form.upcomingProviders, name] })
  return (
    <section className="space-y-3">
      <Heading>{t('Was kommt')}</Heading>
      <Card className="divide-y divide-zinc-800/70 px-4 py-1">
        <label className="flex items-center justify-between gap-4 py-2 text-sm">
          <span>
            {t('Land')}
            <span className="block text-xs text-zinc-500">{t('Zweistelliges Kürzel, z. B. DE, AT oder CH. Es bestimmt Starttermine und Anbieter.')}</span>
          </span>
          <input
            value={form.upcomingRegion}
            maxLength={2}
            onChange={(e) => setForm({ ...form, upcomingRegion: e.target.value.toUpperCase() })}
            className={`${selectClass} w-16 text-center uppercase`}
          />
        </label>
        <div className="py-3">
          <p className="text-sm">{t('Streaminganbieter')}</p>
          <p className="mb-3 text-xs text-zinc-500">{t('Nur Neustarts bei diesen Anbietern erscheinen unter „Was kommt“.')}</p>
          <ErrorNote message={catalog.error} />
          {all.length > shown.length || needle ? (
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('Anbieter suchen, z. B. HBO ({n} insgesamt)', { n: all.length })}
              className={`${inputClass} mb-3 max-w-sm`}
            />
          ) : null}
          {needle && shown.length === 0 && <p className="text-sm text-zinc-500">{t('Kein Anbieter mit diesem Namen.')}</p>}
          <div className="flex flex-wrap gap-2">
            {shown.map((p) => (
              <button
                key={p.id}
                onClick={() => toggle(p.name)}
                aria-pressed={chosen.has(p.name)}
                className={`inline-flex items-center gap-2 rounded-lg border py-1 pr-3 pl-1 text-sm ${
                  chosen.has(p.name) ? 'border-amber-400/60 bg-amber-400/10 text-white' : 'border-zinc-800 text-zinc-400 hover:border-zinc-600'
                }`}
              >
                {p.logo && <img src={`https://image.tmdb.org/t/p/w92${p.logo}`} alt="" className="h-6 w-6 rounded-md" />}
                {p.name}
              </button>
            ))}
          </div>
        </div>
      </Card>
      <SaveRow save={save} note={note} />
    </section>
  )
}

/** Anmeldung: Konto mit Passwort anlegen oder das Passwort ändern, dazu auf anderen Geräten abmelden. */
function AccountSettings() {
  const me = useApi<{ required: boolean; account: boolean; accountName: string | null }>('/auth/me')
  const [name, setName] = useState('')
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [note, setNote] = useState<NoteState>()
  const [devices, setDevices] = useState<NoteState>()
  if (!me.data?.required) return null
  const clear = () => {
    setCurrent('')
    setPassword('')
    setRepeat('')
  }
  const send = (path: string, body: object, success: string) => {
    if (password !== repeat) return setNote({ text: t('Die beiden Passwörter stimmen nicht überein.'), ok: false })
    api(path, json('POST', body))
      .then(() => {
        clear()
        setNote({ text: success, ok: true })
        me.reload()
      })
      .catch((e: Error) => setNote({ text: e.message, ok: false }))
  }
  const logoutOthers = () =>
    api<{ ended: number }>('/account/logout-others', json('POST', {}))
      .then(({ ended }) =>
        setDevices({ text: ended ? t('Auf {n} anderen Geräten abgemeldet.', { n: ended }) : t('Du warst auf keinem anderen Gerät angemeldet.'), ok: true }),
      )
      .catch((e: Error) => setDevices({ text: e.message, ok: false }))
  const message = (n: NoteState) => n && <p className={n.ok ? 'text-emerald-400' : 'text-red-400'}>{n.text}</p>

  return (
    <section className="space-y-3">
      <Heading>{t('Anmeldung')}</Heading>
      <Card className="space-y-3 p-4 text-sm">
        {me.data.account ? (
          <>
            <p className="text-zinc-400">
              {t('Du meldest dich mit dem Benutzernamen {name} und deinem Passwort an, oder über Plex, wenn es verbunden ist.', { name: me.data.accountName ?? '' })}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('Bisheriges Passwort')} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
              <Field label={t('Neues Passwort')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <Field label={t('Neues Passwort wiederholen')} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => send('/account/password', { current, password }, t('Passwort geändert. Auf anderen Geräten musst du dich neu anmelden.'))} disabled={!current || !password}>
                {t('Passwort ändern')}
              </Button>
              <span className="text-xs text-zinc-500">{t('Mindestens zehn Zeichen.')}</span>
            </div>
          </>
        ) : (
          <>
            <p className="text-zinc-400">
              {t('Bisher kommst du nur über Plex hinein. Mit einem eigenen Konto geht es auch, wenn plex.tv nicht erreichbar ist.')}
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label={t('Benutzername')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" />
              <Field label={t('Passwort')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
              <Field label={t('Passwort wiederholen')} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => send('/account', { name, password }, t('Konto angelegt. Du kannst dich jetzt auch mit Benutzername und Passwort anmelden.'))} disabled={!name.trim() || !password}>
                {t('Konto anlegen')}
              </Button>
              <span className="text-xs text-zinc-500">{t('Mindestens zehn Zeichen.')}</span>
            </div>
          </>
        )}
        {message(note)}
      </Card>
      <Card className="space-y-3 p-4 text-sm">
        <p className="text-zinc-400">{t('Meldet jedes andere Gerät und jeden anderen Browser ab, etwa wenn ein Handy verloren gegangen ist. Hier bleibst du angemeldet.')}</p>
        <Button onClick={logoutOthers}>
          <LogOut size={15} /> {t('Auf allen anderen Geräten abmelden')}
        </Button>
        {message(devices)}
      </Card>
      <p className="text-xs text-zinc-500">{t('Passwort vergessen? Starte den Container einmal mit AUTH_RESET=1. Das löscht das Konto mit Passwort, deine Daten bleiben.')}</p>
    </section>
  )
}
function GeneralSettings({ form, setForm, save, note }: FormProps) {
  return (
    <section className="space-y-3">
      <Card className="px-4 py-1">
        <label className="flex items-center justify-between gap-4 py-2 text-sm">
          <span>
            {t('Sprache')}
            <span className="block text-xs text-zinc-500">{t('Gilt für die Oberfläche und für die Telegram-Nachrichten.')}</span>
          </span>
          <select value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as Settings['language'] })} className={selectClass}>
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </label>
      </Card>
      <SaveRow save={save} note={note} />
    </section>
  )
}

function StatusPanel({ status }: { status?: Status }) {
  const [showChangelog, setShowChangelog] = useState(false)
  const [note, setNote] = useState<NoteState>()
  const s = status
  const sync = () =>
    api('/sync', json('POST'))
      .then(() => setNote({ text: t('Abgleich gestartet.'), ok: true }))
      .catch((e: Error) => setNote({ text: e.message, ok: false }))
  return (
    <section className="space-y-3">
      <Card className="divide-y divide-zinc-800/70 px-4 py-1">
        <Line label={t('Version')}>
          <button onClick={() => setShowChangelog(true)} title={t('Alle Updates anzeigen')} className="text-sky-300 hover:underline">
            {s?.version}
          </button>
          <span className="ml-2 text-xs text-zinc-500">{s ? (s.commit ?? t('aus dem Quelltext gestartet')) : ''}</span>
          <a href={PROJECT_URL} target="_blank" rel="noreferrer" className="ml-3 text-xs text-sky-300 hover:underline">
            {t('Projektseite')}
          </a>
        </Line>
        <Line label={t('Letzter erfolgreicher Abgleich')}>
          {s?.sync.running ? t('läuft gerade …') : s?.sync.lastSuccess ? ago(s.sync.lastSuccess) : t('noch keiner')}
        </Line>
        <Line label={t('Abfrage-Abstand')}>{s ? t('{n} Min.', { n: Math.round(s.syncIntervalSec / 60) }) : ''}</Line>
        <Line label={t('Daten')}>
          {s &&
            meta(
              t('{n} Verlaufseinträge', { n: num(s.counts.history) }),
              t('{n} Bewertungen', { n: num(s.counts.ratings) }),
              t('{n} Titel', { n: num(s.counts.library) }),
            )}
        </Line>
        <Line label={t('Wiedergaben')}>
          {s &&
            meta(
              t('{n} selbst aufgezeichnet', { n: num(s.counts.ownPlays) }),
              s.counts.plays > 0 && t('{n} aus Tautulli', { n: num(s.counts.plays) }),
              s.counts.tracearrPlays > 0 && t('{n} aus Tracearr', { n: num(s.counts.tracearrPlays) }),
              t('Aufzeichnung seit {date}', { date: fmtDate(s.recordingSince) }),
            )}
        </Line>
        <Line label={t('Sicherung')}>
          {s &&
            (s.backup.latest
              ? meta(
                  t('zuletzt {date}', { date: new Date(`${s.backup.latest}T12:00:00`).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric' }) }),
                  fmtSize(s.backup.size),
                  t('{n} aufbewahrt', { n: s.backup.count }),
                )
              : t('noch keine'))}
        </Line>
      </Card>
      {s?.sync.lastError && <ErrorNote message={t('Letzter Fehler: {error}', { error: s.sync.lastError })} />}
      <Note note={note} />
      <Button onClick={() => void sync()} disabled={s?.sync.running}>
        <RefreshCw size={15} className={s?.sync.running ? 'animate-spin' : ''} /> {t('Jetzt abgleichen')}
      </Button>
      {showChangelog && <ChangelogAll onClose={() => setShowChangelog(false)} />}
    </section>
  )
}

// ---------------------------------------------------------------------------

// Reihenfolge wie bei einer frischen Einrichtung: erst Plex, dann was Wünsche und Downloads verwaltet,
// dann die Quelle für die Vergangenheit, zum Schluss Benachrichtigungen und Feinheiten
const TABS = ['plex', 'seerr', 'radarr', 'sonarr', 'tmdb', 'tautulli', 'telegram', 'mail', 'newsletter', 'reminder', 'library', 'general', 'status', 'log'] as const
type TabId = (typeof TABS)[number]
type ServiceTab = Extract<TabId, ServiceId>
const EXTRA_LABELS: Record<Exclude<TabId, ServiceId>, string> = {
  newsletter: mark('Newsletter'),
  reminder: mark('Erinnerung'),
  library: mark('Bibliothek'),
  general: mark('Allgemein'),
  status: mark('Status'),
  log: mark('Protokoll'),
}
const isService = (id: TabId): id is ServiceTab => id in SERVICES
// Zusammengehörige Verbindungen stehen im selben Reiter
const SECOND: Partial<Record<ServiceTab, ServiceId>> = { radarr: 'radarr4k', sonarr: 'sonarr4k', tautulli: 'tracearr' }
// Tautulli und Tracearr teilen sich den Reiter „Import“
const tabLabel = (id: TabId) => (id === 'tautulli' ? t('Import') : isService(id) ? t(SERVICES[id].name) : t(EXTRA_LABELS[id]))

export function SettingsView() {
  const status = useApi<Status>('/status', 3000)
  const connections = useApi<Connections>('/connections')
  const saved = useApi<Settings>('/settings')
  // Der Reiter steht in der Adresse (#settings/newsletter), damit er ein Neuladen übersteht und sich verlinken lässt
  const [tab, setTabState] = useState<TabId>(() => {
    const wanted = location.hash.split('/')[1]
    return (TABS as readonly string[]).includes(wanted ?? '') ? (wanted as TabId) : 'plex'
  })
  const setTab = (id: TabId) => {
    setTabState(id)
    history.replaceState(null, '', `#settings/${id}`)
  }
  // Während eines Imports öfter nachfragen, damit der Fortschritt sichtbar ist
  const imports = useApi<ImportStatus>('/import', tab === 'tautulli' ? 2000 : 0)
  const [form, setForm] = useState<Settings>()
  const [note, setNote] = useState<NoteState>()
  useEffect(() => setForm(saved.data), [saved.data])
  useEffect(() => setNote(undefined), [tab])

  const run = (action: () => Promise<unknown>, success: string) => {
    setNote(undefined)
    action()
      .then(() => setNote({ text: success, ok: true }))
      .catch((e: Error) => setNote({ text: e.message, ok: false }))
  }
  const formProps = form && {
    form,
    setForm,
    note,
    run,
    save: () =>
      run(
        () =>
          api('/settings', json('PUT', form)).then(() => {
            // Die neue Sprache gilt für jede Beschriftung, deshalb die ganze Seite neu laden
            if (form.language !== saved.data?.language) location.reload()
            else saved.reload()
          }),
        t('Einstellungen gespeichert.'),
      ),
  }
  const next = TABS[TABS.indexOf(tab) + 1]
  const second = isService(tab) ? SECOND[tab] : undefined

  return (
    <div className="max-w-3xl space-y-6">
      {/* Umbrechen statt seitlich scrollen: Sonst fehlen die letzten Reiter, ohne dass man es merkt */}
      <div className="flex flex-wrap gap-x-1 border-b border-zinc-800" role="tablist">
        {TABS.map((id, i) => {
          // Der Import gilt als erledigt, sobald aus einer der beiden Quellen etwas da ist
          const imported = (imports.data?.tautulli.count ?? 0) + (imports.data?.tracearr.count ?? 0) > 0
          const done = id === 'tautulli' ? imported : isService(id) && connections.data ? isConfigured(id, connections.data) : false
          return (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium ${
                tab === id ? 'border-amber-400 text-white' : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {isService(id) && (
                <span
                  className={`grid h-5 w-5 place-items-center rounded-full text-[11px] ${
                    done ? 'bg-emerald-400/20 text-emerald-300' : 'bg-zinc-800 text-zinc-400'
                  }`}
                >
                  {done ? <Check size={12} /> : i + 1}
                </span>
              )}
              {tabLabel(id)}
            </button>
          )
        })}
      </div>

      {tab === 'tautulli' && (
        <p className="text-sm text-zinc-400">
          {imports.data
            ? t(
                'Seit dem {date} schreibt Blackbriar jede Wiedergabe selbst mit. Wer vorher Tautulli oder Tracearr genutzt hat, kann von dort einmalig die Wiedergaben der Zeit davor holen. Danach wird der Dienst hier nicht mehr gebraucht; die importierten Daten bleiben erhalten.',
                { date: fmtDate(imports.data.recordingSince) },
              )
            : ''}
        </p>
      )}
      {tab === 'plex' && connections.data && connections.data.plexToken.source === 'none' && <PlexConnect />}
      {tab === 'plex' && connections.data && connections.data.plexUrl.source === 'none' && <ServerPicker key="setup" setup connections={connections.data} onSaved={connections.reload} />}
      {isService(tab) && connections.data && (
        // Der Schlüssel sorgt dafür, dass beim Wechsel keine Eingaben des vorigen Dienstes stehen bleiben
        <ServiceForm
          key={tab}
          id={tab}
          connections={connections.data}
          onSaved={() => {
            connections.reload()
            imports.reload()
          }}
        >
          {tab === 'tautulli' && <ImportPanel source="tautulli" status={imports.data} onStart={imports.reload} />}
        </ServiceForm>
      )}
      {second && connections.data && (
        <ServiceForm
          key={second}
          id={second}
          connections={connections.data}
          onSaved={() => {
            connections.reload()
            imports.reload()
          }}
        >
          {second === 'tracearr' && <ImportPanel source="tracearr" status={imports.data} onStart={imports.reload} />}
        </ServiceForm>
      )}

      {(tab === 'radarr' || tab === 'sonarr') && (
        <section>
          <Heading>{t('Webhook (optional)')}</Heading>
          <Card className="space-y-2 p-4 text-sm text-zinc-400">
            <p>
              {t(
                'Damit Blackbriar Änderungen sofort mitbekommt, etwa ein ausgetauschtes Release, trage diese Adresse in {name} unter Settings → Connect → Webhook ein. Ohne sie fragt Blackbriar stündlich nach.',
                { name: tab === 'radarr' ? 'Radarr' : 'Sonarr' },
              )}
            </p>
            <code className="block rounded-md bg-zinc-950 px-3 py-2 break-all text-zinc-200">
              {`${location.origin}/api/webhook/arr${status.data?.webhookKey ? `?key=${status.data.webhookKey}` : ''}`}
            </code>
            <p className="text-xs text-zinc-500">
              {t(
                'Wähle dort die Ereignisse zu Import, Upgrade, Umbenennen, Hinzufügen und Löschen. Die Adresse gilt für alle Instanzen. Erreicht {name} Blackbriar nur über eine andere Adresse, etwa die im Heimnetz, ersetze den vorderen Teil.',
                { name: tab === 'radarr' ? 'Radarr' : 'Sonarr' },
              )}
            </p>
            {status.data?.webhookKey && <NewWebhookKey onDone={status.reload} />}
          </Card>
        </section>
      )}

      {tab === 'plex' && connections.data && connections.data.plexUrl.source !== 'none' && <ServerPicker key="later" setup={false} connections={connections.data} onSaved={connections.reload} />}
      {tab === 'plex' && <Sections />}
      {tab === 'plex' && (
        <section>
          <Heading>{t('Webhook (optional)')}</Heading>
          <Card className="space-y-2 p-4 text-sm text-zinc-400">
            <p>
              {t(
                'Damit Nachrichten sofort kommen und nicht erst beim nächsten Abgleich, trage diese Adresse in Plex unter Einstellungen → Webhooks ein. Dafür braucht der Server Plex Pass.',
              )}
            </p>
            <code className="block rounded-md bg-zinc-950 px-3 py-2 break-all text-zinc-200">
              {`${location.origin}/api/webhook/plex${status.data?.webhookKey ? `?key=${status.data.webhookKey}` : ''}`}
            </code>
            {status.data?.webhookKey && <NewWebhookKey onDone={status.reload} />}
          </Card>
        </section>
      )}
      {tab === 'tautulli' && formProps && (imports.data?.tautulli.count ?? 0) > 0 && (imports.data?.tracearr.count ?? 0) > 0 && (
        <PastSource {...formProps} />
      )}
      {tab === 'tmdb' && formProps && connections.data && isConfigured('tmdb', connections.data) && <UpcomingSettings {...formProps} />}
      {tab === 'telegram' && formProps && <Notifications {...formProps} />}
      {tab === 'mail' && <MailExtras />}
      {tab === 'newsletter' && <NewsletterSettings />}
      {tab === 'reminder' && <ReminderSettings />}
      {tab === 'library' && formProps && <LibrarySettings {...formProps} />}
      {tab === 'general' && formProps && <GeneralSettings {...formProps} />}
      {tab === 'general' && <AccountSettings />}
      {tab === 'status' && <StatusPanel status={status.data} />}
      {tab === 'log' && <LogPanel />}

      {next && (
        <div className="flex justify-end">
          <button onClick={() => setTab(next)} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
            {t('Weiter zu {name}', { name: tabLabel(next) })} <ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  )
}
