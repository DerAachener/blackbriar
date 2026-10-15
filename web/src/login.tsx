import { useCallback, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react'
import { KeyRound, LogIn, Star, UserPlus } from 'lucide-react'
import { api } from './api'
import { setLanguage, t, type Language } from './i18n'
import { ErrorNote } from './ui'

interface Me {
  required: boolean
  authenticated: boolean
  user: string | null
  /** Die Installation gehört noch niemandem; die erste Anmeldung richtet sie ein */
  setup: boolean
  /** Es gibt ein Konto mit Benutzername und Passwort */
  account: boolean
  /** Ein Plex-Konto ist verbunden; nur dann ist die Anmeldung über Plex möglich */
  plex: boolean
  language: Language
}

const inputClass = 'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 outline-none focus:border-amber-400'
const primaryClass = 'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-amber-400 px-4 py-2.5 font-medium text-zinc-950 transition hover:bg-amber-300 disabled:opacity-50'
const secondaryClass = 'inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 py-2.5 font-medium text-zinc-200 transition hover:border-zinc-500 disabled:opacity-50'

/** Eingabefeld mit Beschriftung darüber, für die Anmeldeseite und die Einstellungen. */
export function Field({ label, ...input }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block space-y-1.5 text-left text-sm">
      <span className="text-zinc-300">{label}</span>
      <input {...input} className={inputClass} />
    </label>
  )
}

/** Wird ausgelöst, wenn eine Abfrage mit „nicht angemeldet“ scheitert, z. B. nach Ablauf der Sitzung. */
export const UNAUTHORIZED_EVENT = 'blackbriar-unauthorized'

/** Zeigt die App erst nach der Anmeldung; `children` bekommt den Namen und eine Funktion zum Abmelden. */
export function AuthGate({ children }: { children: (auth: { user: string | null; logout: () => void }) => ReactNode }) {
  const [me, setMe] = useState<Me>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  // Bei der Einrichtung: Konto anlegen statt über Plex
  const [creating, setCreating] = useState(false)

  const load = useCallback(
    () =>
      api<Me>('/auth/me')
        .then((data) => {
          // Vor dem ersten Rendern der App, damit jede Beschriftung gleich in der richtigen Sprache steht
          setLanguage(data.language)
          setMe(data)
        })
        .catch((e: Error) => setError(e.message)),
    [],
  )

  useEffect(() => {
    // Plex schickt den Browser nach der Bestätigung mit ?pin=… zurück; dann wird die Anmeldung abgeschlossen
    const pin = new URLSearchParams(location.search).get('pin')
    if (!pin) {
      void load()
      return
    }
    history.replaceState(null, '', location.pathname + location.hash)
    setBusy(true)
    let tries = 0
    const check = (): Promise<void> =>
      api<{ status: string; setup?: boolean }>('/auth/plex/check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: Number(pin) }),
      }).then((r) => {
        // Plex braucht nach der Bestätigung manchmal einen Moment
        if (r.status === 'pending' && ++tries < 15) return new Promise<void>((resolve) => setTimeout(resolve, 2000)).then(check)
        if (r.status === 'pending') throw new Error(t('Plex hat die Anmeldung nicht bestätigt. Bitte noch einmal versuchen.'))
        // Frisch eingerichtet: Als Nächstes muss der Server gewählt werden
        if (r.setup) location.hash = 'settings/plex'
      })
    check()
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setBusy(false)
        void load()
      })
  }, [load])

  useEffect(() => {
    const onUnauthorized = () => void load()
    addEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
    return () => removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized)
  }, [load])

  const login = () => {
    setBusy(true)
    setError('')
    api<{ url: string }>('/auth/plex/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) })
      .then(({ url }) => location.assign(url))
      .catch((e: Error) => {
        setError(e.message)
        setBusy(false)
      })
  }
  const logout = () => void api('/auth/logout', { method: 'POST' }).finally(load)

  const send = (path: string, body: object, after?: () => void) => {
    setBusy(true)
    setError('')
    api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(() => {
        setPassword('')
        setRepeat('')
        after?.()
        return load()
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false))
  }
  const createAccount = () => {
    if (password !== repeat) return setError(t('Die beiden Passwörter stimmen nicht überein.'))
    send('/auth/account/setup', { code, name, password }, () => (location.hash = 'settings/plex'))
  }
  const passwordLogin = () => send('/auth/account/login', { name, password })

  if (me?.authenticated) return <>{children({ user: me.user, logout })}</>

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-sm space-y-5 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center">
        <div className="flex items-center justify-center gap-2 text-2xl font-bold tracking-tight">
          <Star size={26} className="fill-amber-400 text-amber-400" />
          Blackbriar
        </div>
        {me && (me.setup || !me.account) && (
          <p className="text-sm text-zinc-400">
            {me.setup
              ? t('Willkommen. Melde dich mit dem Plex-Konto an, dem der Server gehört, oder leg ein eigenes Konto an. Damit wird Blackbriar eingerichtet.')
              : t('Zugang hat nur der Besitzer des Plex-Servers.')}
          </p>
        )}
        {me?.setup && (
          <label className="block space-y-1.5 text-left text-sm">
            <span className="text-zinc-300">{t('Einrichtungscode')}</span>
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
              autoComplete="off"
              spellCheck={false}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-center font-mono tracking-widest uppercase outline-none focus:border-amber-400"
            />
            <span className="block text-xs text-zinc-500">{t('Der Code steht im Protokoll des Containers, zum Beispiel über „docker logs blackbriar“.')}</span>
          </label>
        )}
        {/* Einrichtung mit eigenem Konto */}
        {me?.setup && creating && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              createAccount()
            }}
          >
            <Field label={t('Benutzername')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" />
            <Field label={t('Passwort')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            <Field label={t('Passwort wiederholen')} type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} autoComplete="new-password" />
            <p className="text-left text-xs text-zinc-500">{t('Mindestens zehn Zeichen. Plex verbindest du danach unter Einstellungen → Plex.')}</p>
            <ErrorNote message={error} />
            <button type="submit" disabled={busy || !code.trim() || !name.trim() || !password} className={primaryClass}>
              <UserPlus size={17} /> {busy ? t('Einen Moment …') : t('Konto anlegen')}
            </button>
            <button type="button" onClick={() => setCreating(false)} className="text-sm text-zinc-400 hover:text-zinc-200">
              {t('Doch mit Plex anmelden')}
            </button>
          </form>
        )}

        {/* Anmeldung mit Benutzername und Passwort */}
        {me && !me.setup && me.account && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              passwordLogin()
            }}
          >
            <Field label={t('Benutzername')} value={name} onChange={(e) => setName(e.target.value)} autoComplete="username" />
            <Field label={t('Passwort')} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
            <button type="submit" disabled={busy || !name.trim() || !password} className={primaryClass}>
              <KeyRound size={17} /> {busy ? t('Einen Moment …') : t('Anmelden')}
            </button>
          </form>
        )}

        {/* Anmeldung über Plex: bei der Einrichtung und immer, wenn ein Plex-Konto verbunden ist */}
        {me && !creating && (me.setup || me.plex) && (
          <>
            {!me.setup && me.account && <p className="text-xs text-zinc-500">{t('oder')}</p>}
            {(me.setup || !me.account) && <ErrorNote message={error} />}
            <button
              onClick={login}
              disabled={busy || (me.setup && !code.trim())}
              className={!me.setup && me.account ? secondaryClass : primaryClass}
            >
              <LogIn size={17} /> {busy ? t('Einen Moment …') : t('Mit Plex anmelden')}
            </button>
            {me.setup && (
              <button onClick={() => setCreating(true)} className={secondaryClass}>
                <UserPlus size={17} /> {t('Eigenes Konto anlegen')}
              </button>
            )}
          </>
        )}
        {me && !me.setup && me.account && <ErrorNote message={error} />}
      </div>
    </div>
  )
}
