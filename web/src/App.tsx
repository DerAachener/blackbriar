import { useEffect, useState } from 'react'
import {
  Archive,
  BarChart3,
  CalendarClock,
  ExternalLink,
  Bookmark,
  HardDrive,
  LayoutDashboard,
  LogOut,
  Menu,
  History,
  Hourglass,
  Radio,
  RefreshCw,
  Settings as SettingsIcon,
  Star,
  Trash2,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react'
import { api, useApi, type Status, type User } from './api'
import { mark, t } from './i18n'
import { CleanupView, FilesView, NotInPlexView, OpenView } from './media'
import { SettingsView } from './settings'
import { StatsView } from './stats'
import { Button, ErrorNote, PROJECT_URL } from './ui'
import { UpcomingView } from './upcoming'
import { UserView } from './user'
import { DashboardView } from './dashboard'
import { TitleDialog } from './detail'
import { TitleInfoContext, type TitleRef } from './titleinfo'
import { TitlesView, UsersView, WatchlistView } from './views'

type TabId = 'dashboard' | 'upcoming' | 'open' | 'watchlist' | 'cleanup' | 'titles' | 'files' | 'notinplex' | 'stats' | 'users' | 'settings'

/** `short` kennzeichnet die Ansichten für die Leiste am Handy und ist dort die Beschriftung. */
const TABS: { id: TabId; label: string; icon: LucideIcon; short?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, short: mark('Start') },
  { id: 'upcoming', label: mark('Was kommt'), icon: CalendarClock, short: mark('Kommt') },
  { id: 'open', label: mark('Offene Bewertungen'), icon: Hourglass, short: mark('Offen') },
  { id: 'watchlist', label: mark('Merklisten'), icon: Bookmark, short: mark('Merklisten') },
  { id: 'cleanup', label: mark('Kann weg'), icon: Trash2 },
  { id: 'titles', label: mark('Verlauf'), icon: History },
  { id: 'files', label: mark('Bibliothek'), icon: HardDrive },
  { id: 'notinplex', label: mark('Warteliste'), icon: Archive },
  { id: 'stats', label: mark('Statistik'), icon: BarChart3 },
  { id: 'users', label: mark('Benutzer'), icon: Users },
  { id: 'settings', label: mark('Einstellungen'), icon: SettingsIcon },
]
const FILTERABLE: TabId[] = ['open', 'watchlist', 'titles', 'stats']

/** Die Adresse hat die Form #tab, #users/123 für die Seite eines Benutzers oder #settings/reiter. */
function routeFromHash(): { tab: TabId; detail: number | null } {
  const [raw, detail] = location.hash.slice(1).split('/')
  // Alte Lesezeichen auf den früheren Verlauf landen in der zusammengelegten Ansicht
  const id = raw === 'history' ? 'titles' : raw
  const tab = TABS.some((x) => x.id === id) ? (id as TabId) : 'dashboard'
  return { tab, detail: tab === 'users' && detail ? Number(detail) || null : null }
}

export function App({ user, logout }: { user: string | null; logout: () => void }) {
  const [route, setRoute] = useState(routeFromHash)
  const [userId, setUserId] = useState<number | null>(null)
  const users = useApi<User[]>('/users', 60_000)
  const status = useApi<Status>('/status', 30_000)
  const { tab } = route

  useEffect(() => {
    const onHash = () => setRoute(routeFromHash())
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  // Das Logo aus Einstellungen → E-Mail dient auch als Kopf der Seitenleiste; ohne Logo steht dort der Name
  const [logo, setLogo] = useState(true)

  // Menü mit allen Ansichten, nur am Handy
  const [menuOpen, setMenuOpen] = useState(false)
  // Titel, dessen Info-Fenster gerade offen ist
  const [info, setInfo] = useState<TitleRef>()
  const go = (hash: string) => {
    location.hash = hash
    setRoute(routeFromHash())
    setMenuOpen(false)
    scrollTo(0, 0)
  }
  // Holt die Benutzerliste neu von Plex und wartet, bis der Abgleich durch ist
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const refreshUsers = async () => {
    setRefreshing(true)
    setRefreshError('')
    try {
      await api('/sync', { method: 'POST' })
      do {
        await new Promise((resolve) => setTimeout(resolve, 1000))
      } while ((await api<Status>('/status')).sync.running)
      users.reload()
      status.reload()
    } catch (e) {
      setRefreshError((e as Error).message)
    } finally {
      setRefreshing(false)
    }
  }

  const openCount = (users.data ?? []).reduce((sum, u) => sum + u.open, 0)
  const selected = route.detail ? users.data?.find((u) => u.id === route.detail) : undefined
  const title = selected ? selected.name : t(TABS.find((x) => x.id === tab)!.label)

  const openBadge = openCount > 0 && (
    <span className="rounded-full bg-amber-400/15 px-2 text-xs text-amber-300 tabular-nums">{openCount}</span>
  )

  return (
    <TitleInfoContext.Provider value={setInfo}>
    <div className="min-h-screen md:flex">
      {/* Ab Tablet: schmale Symbolleiste, ab Laptop mit Beschriftung */}
      <aside className="sticky top-0 hidden h-screen w-16 shrink-0 flex-col overflow-y-auto border-r border-zinc-800 p-2 md:flex lg:w-64 lg:p-3">
        {/* Ein Klick auf das Logo führt zur Startseite */}
        <button onClick={() => go('dashboard')} title={t('Zur Startseite')} className="mb-6 block w-full rounded-lg px-2 pt-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 lg:pt-0">
          {/* Schmale Leiste: nur der Stern. Breite Leiste: das eigene Logo, falls eines hochgeladen ist. */}
          <div className={`flex items-center justify-center gap-2 text-lg font-bold tracking-tight lg:justify-start ${logo ? 'lg:hidden' : ''}`}>
            <Star size={20} className="shrink-0 fill-amber-400 text-amber-400" />
            <span className="hidden lg:inline">Blackbriar</span>
          </div>
          {logo && <img src="/api/mail/logo" alt="Blackbriar" onError={() => setLogo(false)} className="hidden w-full lg:block" />}
        </button>
        <nav className="space-y-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => go(id)}
              title={t(label)}
              className={`relative flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition lg:justify-start lg:py-2 ${
                tab === id ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200'
              }`}
            >
              <Icon size={18} className="shrink-0" />
              <span className="hidden truncate lg:inline">{t(label)}</span>
              {id === 'open' && openCount > 0 && (
                <>
                  <span className="ml-auto hidden lg:inline">{openBadge}</span>
                  <span className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-amber-400 lg:hidden" />
                </>
              )}
            </button>
          ))}
        </nav>
        <div className="mt-auto space-y-1 pt-3">
          {user && (
            <button
              onClick={logout}
              title={t('{name} abmelden', { name: user })}
              className="flex w-full items-center justify-center gap-3 rounded-lg px-3 py-2.5 text-sm text-zinc-500 transition hover:bg-zinc-900 hover:text-zinc-200 lg:justify-start lg:py-2"
            >
              <LogOut size={18} className="shrink-0" />
              <span className="hidden truncate lg:inline">{t('{name} abmelden', { name: user })}</span>
            </button>
          )}
          {/* Link zur Projektseite als eigene Zeile, darunter die Versionsnummer */}
          <a
            href={PROJECT_URL}
            target="_blank"
            rel="noreferrer"
            title={t('Projektseite öffnen')}
            className="hidden items-center gap-1.5 px-3 pt-2 text-xs text-zinc-500 transition hover:text-amber-300 lg:flex"
          >
            <ExternalLink size={12} /> {t('Projektseite')}
          </a>
          {status.data?.version && <p className="hidden px-3 text-xs text-zinc-600 lg:block">{t('Version: {version}', { version: status.data.version })}</p>}
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 pt-5 pb-28 md:px-6 md:pt-6 md:pb-8 xl:px-8">
        <div className="mx-auto max-w-[120rem]">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3 md:mb-6">
            <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
            {FILTERABLE.includes(tab) && (
              <select
                value={userId ?? ''}
                onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : null)}
                className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-zinc-600"
                aria-label={t('Benutzer')}
              >
                <option value="">{t('Alle Benutzer')}</option>
                {(users.data ?? []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            )}
            {tab === 'users' && !selected && (
              <Button onClick={() => void refreshUsers()} disabled={refreshing}>
                <RefreshCw size={15} className={refreshing ? 'animate-spin' : ''} /> {t('Aktualisieren')}
              </Button>
            )}
          </header>

          {refreshError && (
            <div className="mb-6">
              <ErrorNote message={refreshError} />
            </div>
          )}

          {status.data && !status.data.plexConfigured && tab !== 'settings' && (
            <div className="mb-6">
              <p className="rounded-lg bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
                {t('Plex ist noch nicht verbunden. Wähle deinen Server aus oder trag Adresse und Token ein.')}{' '}
                <a href="#settings/plex" className="font-medium underline hover:text-amber-100">
                  {t('Zu Einstellungen → Plex')}
                </a>
              </p>
            </div>
          )}

          {tab === 'dashboard' && <DashboardView />}
          {tab === 'upcoming' && <UpcomingView seerrConfigured={status.data?.seerrConfigured ?? false} />}
          {tab === 'open' && <OpenView userId={userId} onChange={users.reload} />}
          {tab === 'watchlist' && <WatchlistView userId={userId} configured={status.data?.seerrConfigured ?? true} />}
          {tab === 'cleanup' && <CleanupView />}
          {tab === 'titles' && <TitlesView userId={userId} />}
          {tab === 'files' && <FilesView />}
          {tab === 'notinplex' && <NotInPlexView />}
          {tab === 'stats' && <StatsView userId={userId} />}
          {tab === 'users' &&
            (selected ? (
              <UserView
                key={selected.id}
                user={selected}
                seerrConfigured={status.data?.seerrConfigured ?? true}
                onBack={() => go('users')}
                onChange={users.reload}
              />
            ) : (
              <UsersView users={users.data ?? []} onSelect={(id) => go(`users/${id}`)} />
            ))}
          {tab === 'settings' && <SettingsView />}
        </div>
      </main>

      {/* Handy: die vier wichtigsten Ansichten unten, alles Weitere unter „Mehr“ */}
      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-zinc-800 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {TABS.filter((x) => x.short).map(({ id, short, icon: Icon }) => (
          <button
            key={id}
            onClick={() => go(id)}
            className={`relative grid place-items-center gap-0.5 py-2 text-[11px] ${tab === id && !menuOpen ? 'text-amber-400' : 'text-zinc-500'}`}
          >
            <Icon size={21} />
            {t(short!)}
            {id === 'open' && openCount > 0 && <span className="absolute top-1.5 right-[28%] h-2 w-2 rounded-full bg-amber-400" />}
          </button>
        ))}
        <button
          onClick={() => setMenuOpen(!menuOpen)}
          aria-expanded={menuOpen}
          className={`grid place-items-center gap-0.5 py-2 text-[11px] ${
            menuOpen || !TABS.find((x) => x.id === tab)?.short ? 'text-amber-400' : 'text-zinc-500'
          }`}
        >
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
          {t('Mehr')}
        </button>
      </nav>

      {menuOpen && (
        <div className="fixed inset-0 z-30 overflow-y-auto bg-zinc-950 px-4 pt-6 pb-28 md:hidden">
          <button onClick={() => go('dashboard')} title={t('Zur Startseite')} className="mb-5 block text-left">
            {logo ? (
              <img src="/api/mail/logo" alt="Blackbriar" onError={() => setLogo(false)} className="h-16" />
            ) : (
              <span className="flex items-center gap-2 text-lg font-bold tracking-tight">
                <Star size={20} className="fill-amber-400 text-amber-400" />
                Blackbriar
              </span>
            )}
          </button>
          <div className="grid grid-cols-2 gap-2">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => go(id)}
                className={`flex items-center gap-3 rounded-xl border px-3 py-3.5 text-left text-sm font-medium ${
                  tab === id ? 'border-amber-400/50 bg-zinc-900 text-white' : 'border-zinc-800 bg-zinc-900/60 text-zinc-300'
                }`}
              >
                <Icon size={19} className="shrink-0" />
                <span className="min-w-0 flex-1">{t(label)}</span>
                {id === 'open' && openBadge}
              </button>
            ))}
          </div>
          {user && (
            <button onClick={logout} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-zinc-800 px-3 py-3 text-sm text-zinc-400">
              <LogOut size={17} /> {t('{name} abmelden', { name: user })}
            </button>
          )}
          <a href={PROJECT_URL} target="_blank" rel="noreferrer" className="mt-4 flex items-center justify-center gap-1.5 text-xs text-zinc-500">
            <ExternalLink size={12} /> {t('Projektseite')}
          </a>
          {status.data?.version && <p className="mt-1 text-center text-xs text-zinc-600">{t('Version: {version}', { version: status.data.version })}</p>}
        </div>
      )}
    </div>
    {info && <TitleDialog target={info} onClose={() => setInfo(undefined)} />}
    </TitleInfoContext.Provider>
  )
}
