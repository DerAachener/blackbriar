import { useEffect, useState, type ReactNode } from 'react'
import { Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { api, useApi, type Keyword, type Release, type Topic, type TopicTitles } from './api'
import { locale, t } from './i18n'
import { CHANGED } from './titleinfo'
import { ago, Button, Card, Empty, ErrorNote, meta, num } from './ui'
import { TileGrid } from './views'

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: body ? { 'content-type': 'application/json' } : undefined,
  body: body ? JSON.stringify(body) : undefined,
})
const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm outline-none placeholder:text-zinc-600 focus:border-amber-400'
const selectClass = 'rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm outline-none focus:border-zinc-600'
const chip = (active: boolean) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium transition ${active ? 'bg-amber-400 text-zinc-950' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`

type Draft = { id?: string; name: string; keywords: Keyword[]; docsOnly: boolean }

/** Thema anlegen oder ändern: ein Name und die Schlagwörter, nach denen TMDB durchsucht wird. */
function Editor({ draft, onSaved, onDeleted, onCancel }: { draft: Draft; onSaved: (topic: Topic) => void; onDeleted: () => void; onCancel: () => void }) {
  const [form, setForm] = useState(draft)
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Keyword[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setHits([])
      return
    }
    let active = true
    const timer = setTimeout(() => {
      api<Keyword[]>(`/topics/keywords?q=${encodeURIComponent(q)}`)
        .then((list) => active && setHits(list))
        .catch((e: Error) => active && setError(e.message))
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query])

  const has = (k: Keyword) => form.keywords.some((x) => x.id === k.id)
  const save = () => {
    setError('')
    const body = { name: form.name, keywords: form.keywords, docsOnly: form.docsOnly }
    api<Topic>(form.id ? `/topics/${form.id}` : '/topics', json(form.id ? 'PUT' : 'POST', body))
      .then(onSaved)
      .catch((e: Error) => setError(e.message))
  }
  const remove = () => void api(`/topics/${form.id}`, json('DELETE')).then(onDeleted)

  return (
    <Card className="space-y-3 p-4">
      <p className="font-medium">{form.id ? t('Thema ändern') : t('Neues Thema')}</p>
      <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={t('Name, z. B. Krankenhaus und Rettung')} className={`${inputClass} max-w-md`} />
      <div className="space-y-2">
        <p className="text-sm text-zinc-400">
          {t('Schlagwörter: TMDB führt sie auf Englisch. Ein Titel gehört zum Thema, wenn er eines davon trägt.')}
        </p>
        {form.keywords.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {form.keywords.map((k) => (
              <button
                key={k.id}
                onClick={() => setForm({ ...form, keywords: form.keywords.filter((x) => x.id !== k.id) })}
                title={t('Entfernen')}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/60 bg-amber-400/10 px-2.5 py-1 text-sm"
              >
                {k.name} <X size={13} />
              </button>
            ))}
          </div>
        )}
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('Schlagwort suchen, z. B. hospital, police, wildlife')} className={`${inputClass} max-w-md`} />
        {hits.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {hits.filter((k) => !has(k)).map((k) => (
              <button
                key={k.id}
                onClick={() => setForm({ ...form, keywords: [...form.keywords, k] })}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800 px-2.5 py-1 text-sm text-zinc-300 hover:border-zinc-600"
              >
                <Plus size={13} /> {k.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-zinc-300">
        <input type="checkbox" checked={form.docsOnly} onChange={(e) => setForm({ ...form, docsOnly: e.target.checked })} className="h-4 w-4 accent-amber-400" />
        {t('Nur Dokus und Reality, keine Spielfilme und Spielserien')}
      </label>
      <ErrorNote message={error} />
      <div className="flex flex-wrap gap-2">
        <Button primary onClick={save} disabled={!form.name.trim() || !form.keywords.length}>
          {t('Speichern')}
        </Button>
        <Button onClick={onCancel}>{t('Abbrechen')}</Button>
        {form.id && (
          <Button onClick={remove}>
            <Trash2 size={15} /> {t('Thema löschen')}
          </Button>
        )}
      </div>
    </Card>
  )
}

type Sort = 'popular' | 'new' | 'title'

/**
 * „Meine Themen“ unter „Was kommt“: der ganze Katalog von TMDB zu selbst gewählten Schlagwörtern, nicht nur Neustarts.
 * Die Zeile selbst zeichnet die aufrufende Ansicht, damit sie aussieht und sich verhält wie die übrigen.
 */
export function TopicsSection({ kind, providers, row }: { kind: '' | 'movie' | 'show'; providers: string[]; row: (r: Release) => ReactNode }) {
  const list = useApi<{ topics: Topic[]; presets: string[] }>('/topics')
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState<Draft>()
  const [data, setData] = useState<TopicTitles>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sort, setSort] = useState<Sort>('popular')
  const [mine, setMine] = useState(false)
  const [hideOwned, setHideOwned] = useState(false)
  const [shown, setShown] = useState(60)

  const topics = list.data?.topics ?? []
  const current = topics.find((x) => x.id === selected) ?? topics[0]

  const load = (id: string, fresh = false) => {
    setLoading(true)
    setError('')
    api<TopicTitles>(`/topics/${id}/titles${fresh ? '?fresh=1' : ''}`)
      .then((d) => {
        setData(d)
        setShown(60)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }
  // Schlüssel aus Thema und Schlagwörtern: Nach dem Ändern eines Themas wird neu geholt
  const signature = current ? `${current.id}:${current.keywords.map((k) => k.id).join(',')}:${current.docsOnly}` : ''
  useEffect(() => {
    setData(undefined)
    if (current) load(current.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  // Wurde ein Titel ausgeblendet, kommt die Liste ohne ihn neu; der Server hat das Thema noch vorrätig
  useEffect(() => {
    if (!current) return
    const refresh = () =>
      void api<TopicTitles>(`/topics/${current.id}/titles`)
        .then(setData)
        .catch(() => {})
    addEventListener(CHANGED, refresh)
    return () => removeEventListener(CHANGED, refresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const addPreset = (index: number) => {
    setError('')
    api<Topic>('/topics', json('POST', { preset: index }))
      .then((topic) => {
        list.reload()
        setSelected(topic.id)
      })
      .catch((e: Error) => setError(e.message))
  }

  if (!list.data) return <ErrorNote message={list.error} />

  const titles = (data && current && data.topic.id === current.id ? data.titles : [])
    .filter((r) => (!kind || r.type === kind) && (!mine || r.providers.some((p) => providers.includes(p))) && (!hideOwned || !r.in_library))
    .sort((a, b) => (sort === 'new' ? b.date.localeCompare(a.date) : sort === 'title' ? a.title.localeCompare(b.title, locale()) : 0))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {topics.map((x) => (
          <button key={x.id} onClick={() => setSelected(x.id)} className={chip(current?.id === x.id)}>
            {x.name}
          </button>
        ))}
        <button onClick={() => setDraft({ name: '', keywords: [], docsOnly: true })} className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-zinc-700 px-3 py-1.5 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200">
          <Plus size={14} /> {t('Neues Thema')}
        </button>
      </div>

      {draft && (
        <Editor
          key={draft.id ?? 'new'}
          draft={draft}
          onCancel={() => setDraft(undefined)}
          onSaved={(topic) => {
            setDraft(undefined)
            list.reload()
            setSelected(topic.id)
          }}
          onDeleted={() => {
            setDraft(undefined)
            setSelected('')
            list.reload()
          }}
        />
      )}

      {!topics.length && !draft && (
        <Card className="space-y-3 p-4">
          <p className="text-sm text-zinc-400">
            {t(
              'Hier zeigt Blackbriar alles, was TMDB zu einem Thema kennt, nicht nur Neustarts: Dokus über Notaufnahmen, Polizei, Natur oder was dich sonst interessiert. Fang mit einer Vorlage an oder lege ein eigenes Thema an.',
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            {list.data.presets.map((name, i) => (
              <Button key={name} onClick={() => addPreset(i)}>
                <Plus size={15} /> {name}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <ErrorNote message={error} />

      {current && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
              {loading
                ? t('Thema wird geholt, das dauert einige Sekunden …')
                : data
                  ? meta(t('{n} Titel', { n: num(titles.length) }), t('Stand: {when}', { when: ago(data.fetchedAt) }), current.keywords.map((k) => k.name).join(', '))
                  : ''}
              {!loading && (
                <>
                  <button onClick={() => load(current.id, true)} className="inline-flex items-center gap-1 hover:text-zinc-300">
                    <RefreshCw size={12} /> {t('Neu holen')}
                  </button>
                  <button onClick={() => setDraft({ ...current })} className="inline-flex items-center gap-1 hover:text-zinc-300">
                    <Pencil size={12} /> {t('Thema ändern')}
                  </button>
                </>
              )}
            </p>
            <span className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
                <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="h-4 w-4 accent-amber-400" />
                {t('Nur bei meinen Anbietern')}
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-400">
                <input type="checkbox" checked={hideOwned} onChange={(e) => setHideOwned(e.target.checked)} className="h-4 w-4 accent-amber-400" />
                {t('Schon auf dem Server ausblenden')}
              </label>
              <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={selectClass} aria-label={t('Sortierung')}>
                <option value="popular">{t('Bekannteste zuerst')}</option>
                <option value="new">{t('Neueste zuerst')}</option>
                <option value="title">{t('Sortiert nach Titel')}</option>
              </select>
            </span>
          </div>
          {titles.length > 0 && <TileGrid>{titles.slice(0, shown).map(row)}</TileGrid>}
          {titles.length > shown && (
            <div className="flex justify-center">
              <Button onClick={() => setShown(shown + 60)}>{t('Mehr laden ({shown} von {total})', { shown, total: titles.length })}</Button>
            </div>
          )}
          {data && !loading && titles.length === 0 && <Empty>{t('Zu diesem Thema und dieser Auswahl kennt TMDB nichts.')}</Empty>}
        </>
      )}
    </div>
  )
}
