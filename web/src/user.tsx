import { useState } from 'react'
import { ArrowLeft, Share2 } from 'lucide-react'
import { api, type User } from './api'
import { t } from './i18n'
import { StatsView } from './stats'
import { ago, Badge, Card, Chips, num } from './ui'
import { SharingDialog } from './sharing'
import { OpenView } from './media'
import { HistoryView, RatingsView, WatchlistView } from './views'

type Section = 'open' | 'watchlist' | 'ratings' | 'history' | 'stats'

/** Alles zu einem Benutzer auf einer Seite. */
export function UserView({
  user,
  seerrConfigured,
  onBack,
  onChange,
}: {
  user: User
  seerrConfigured: boolean
  onBack: () => void
  onChange: () => void
}) {
  const [section, setSection] = useState<Section>('open')
  const [sharing, setSharing] = useState(false)
  const figures: [string, string, string][] = [
    [t('Gesehen'), num(user.plays), ''],
    [t('Bewertet'), num(user.ratings), ''],
    [t('Offen'), num(user.open), user.open ? 'text-amber-300' : ''],
    [t('Zuletzt aktiv'), user.last_seen ? ago(user.last_seen) : t('nie'), ''],
  ]
  const sections: Record<Section, string> = {
    open: t('Offene Bewertungen'),
    watchlist: t('Plex Merkliste'),
    ratings: t('Bewertungen'),
    history: t('Verlauf'),
    stats: t('Statistik'),
  }
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200">
          <ArrowLeft size={15} /> {t('Alle Benutzer')}
        </button>
        {user.is_owner ? <Badge tone="amber">{t('Besitzer')}</Badge> : !user.active && <Badge>{t('kein Zugriff')}</Badge>}
        {!user.is_owner && (
          <label
            className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-zinc-400"
            title={t('Bei diesem Benutzer zählt Ansehen als fertig. Er erscheint nicht unter den offenen Bewertungen und bekommt keine Erinnerungen.')}
          >
            <input
              type="checkbox"
              checked={Boolean(user.never_rates)}
              onChange={(e) =>
                void api(`/users/${user.id}/never-rates`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ value: e.target.checked }) }).then(onChange)
              }
              className="h-4 w-4 accent-amber-400"
            />
            {t('bewertet nie')}
          </label>
        )}
      </div>
      {(user.sections.length > 0 || !user.is_owner) && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-zinc-500">
          {user.sections.length > 0 && <span>{t('Zugriff auf: {names}', { names: user.sections.join(', ') })}</span>}
          {!user.is_owner && (
            <button onClick={() => setSharing(true)} className="inline-flex items-center gap-1 text-sky-300 hover:underline">
              <Share2 size={13} /> {t('Freigaben bearbeiten')}
            </button>
          )}
        </p>
      )}
      {sharing && (
        <SharingDialog
          userId={user.id}
          onClose={() => {
            setSharing(false)
            onChange()
          }}
        />
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {figures.map(([label, value, tone]) => (
          <Card key={label} className="px-4 py-3">
            <p className={`text-xl font-semibold ${tone}`}>{value}</p>
            <p className="text-sm text-zinc-500">{label}</p>
          </Card>
        ))}
      </div>
      <Chips value={section} options={sections} onChange={setSection} />
      {section === 'open' && <OpenView userId={user.id} onChange={onChange} />}
      {section === 'watchlist' && <WatchlistView userId={user.id} configured={seerrConfigured} />}
      {section === 'ratings' && <RatingsView userId={user.id} />}
      {section === 'history' && <HistoryView userId={user.id} />}
      {section === 'stats' && <StatsView userId={user.id} />}
    </div>
  )
}
