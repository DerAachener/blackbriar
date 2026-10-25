import { config, mailConfigured } from './config.ts'
import { db, getSetting, now, setSetting } from './db.ts'
import { logEvent } from './events.ts'
import { t } from './i18n.ts'
import { greeting, greetingName, MAIL_COLORS, mailLayout, mailReason, notifyOwner, plexWhere, sendMail, tone, userEmail, type Mail } from './mail.ts'
import { logMail, welcomeUrl } from './mailprefs.ts'
import { escapeHtml } from './telegram.ts'

// Einrichtungs-Anleitung für Benutzer: eine Seite hinter dem Link in der Willkommens-Mail, die Schritt für Schritt durchführt.
// Der nächste Schritt erscheint erst, wenn der aktuelle bestätigt ist; den Stand hält der Server je Benutzer, nicht die Seite.
// Die Schritte und der Mailtext gehören dem Besitzer und liegen in den Einstellungen, nicht im Programm.

export interface WelcomeStep {
  title: string
  body: string
}

/** Die Beispiel-Anleitung, solange der Besitzer keine eigene eingetragen hat. Allgemein gehalten, ohne Namen und Adressen. */
function defaultSteps(): WelcomeStep[] {
  return [
    {
      title: t('Mediatheken anheften'),
      body: t(
        'Öffne Plex und tippe links unten auf „Mehr“. Dort stehen {server} und die Mediatheken.\nHefte jede Mediathek an, die du nutzt. Die von Plex selbst („Filme & Serien“, „Live TV“) brauchst du nicht.',
      ),
    },
    {
      title: t('Kontoeinstellungen öffnen'),
      body: t('Geh zurück und öffne oben rechts deine Kontoeinstellungen.\nDie Bezeichnungen können je nach Gerät abweichen. Fernseher, Fire-TV-Stick, Tablet und Handy sehen unterschiedlich aus.'),
    },
    {
      title: t('Sichtbarkeit einstellen'),
      body: t('Suche nach „Sichtbarkeit des Benutzerkontos“ und „Teilen von Aktivitäten“ und stelle alles auf „Nur Freunde“.\nFalls es einen Speichern-Knopf gibt, speichere.'),
    },
    {
      title: t('Gesehen und Bewertungen abgleichen'),
      body: t(
        'Suche nach „Gespielt-Status und persönliche Bewertungen in ganz Plex synchronisieren“ und schalte es ein.\nDas ist wichtig: Nur dann sieht {app}, was du gesehen und bewertet hast.\nPrüfe außerdem, dass „Gesehen“ für persönliche Medien angezeigt wird, und speichere.',
      ),
    },
    {
      title: t('Merken aktivieren'),
      body: t('Suche den Reiter „Merken“ (die Merkliste). Ist er ausgeschaltet, schalte ihn ein.'),
    },
    {
      title: t('Jede Mediathek einmal öffnen'),
      body: t('Öffne nacheinander jede Mediathek von {server} und tippe oben auf „Mediathek“. Das genügt einmal.'),
    },
    {
      title: t('Bei Seerr anmelden'),
      body: t('Melde dich einmal in Seerr mit deinem Plex-Konto an. Die Adresse hast du mit der Einladung bekommen.\nDie Anmeldung verbindet deine Merkliste in Plex mit Seerr. Danach kannst du Seerr wieder schließen.'),
    },
    {
      title: t('Die Regeln'),
      body: t(
        'Alles, was auf dem Server liegt, darfst du schauen. Dafür gilt eine Regel:\n- Nach dem Schauen bewerten: in der Übersicht des Films oder der Serie bis zu 5 Sterne vergeben.\n- Steht der Titel auf deiner Merkliste, nimm ihn danach herunter.\n- Filme direkt nach dem Schauen bewerten. Bei Serien genügt eine Bewertung am Ende.\nDas dauert keine zwei Minuten und hält den Server sauber. Festplatten sind teuer.',
      ),
    },
  ]
}

const joinSteps = (steps: WelcomeStep[]): string => steps.map((s) => `## ${s.title}\n${s.body}`).join('\n\n')

/** Zerlegt den Text der Einstellungen: Jede Zeile `## Überschrift` beginnt einen Schritt. */
export function parseSteps(text: string): WelcomeStep[] {
  const steps: { title: string; lines: string[] }[] = []
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const heading = /^##\s+(.+?)\s*$/.exec(line)
    if (heading) steps.push({ title: heading[1]!, lines: [] })
    else steps.at(-1)?.lines.push(line)
  }
  return steps.map((s) => ({ title: s.title, body: s.lines.join('\n').trim() }))
}

/** Der Text der Schritte, wie er in den Einstellungen steht: der eigene, sonst das Beispiel. */
export function welcomeText(): { text: string; custom: boolean } {
  const own = getSetting('welcome_steps')
  return own ? { text: own, custom: true } : { text: joinSteps(defaultSteps()), custom: false }
}

export function welcomeSteps(): WelcomeStep[] {
  const own = getSetting('welcome_steps')
  return own ? parseSteps(own) : defaultSteps()
}

/** Der Satz in der Mail über dem Knopf: der eigene Text, sonst ein Standardtext im eingestellten Ton. */
export function welcomeMailText(): { text: string; custom: boolean } {
  const own = getSetting('welcome_mail')
  if (own) return { text: own, custom: true }
  return {
    text: tone(
      'willkommen auf {server}! Damit alles reibungslos läuft, führt dich eine kurze Anleitung durch ein paar Einstellungen. Das dauert wenige Minuten. Jeder Schritt wird einzeln gezeigt.',
      'willkommen im Einsatz auf {server}. Dein Einsatzbefehl besteht aus ein paar Schritten, die du der Reihe nach bestätigst. Das dauert wenige Minuten.',
    ),
    custom: false,
  }
}

/** Speichert Schritte und Mailtext. Leere Texte setzen auf das Beispiel zurück. */
export function saveWelcome(input: { steps?: unknown; mail?: unknown }): void {
  if (typeof input.steps === 'string') {
    const text = input.steps.trim()
    if (text && text !== joinSteps(defaultSteps()).trim()) {
      if (!parseSteps(text).length) throw new Error(t('Mindestens ein Schritt ist nötig. Jeder Schritt beginnt mit einer Zeile „## Überschrift“.'))
      setSetting('welcome_steps', text)
    } else setSetting('welcome_steps', '')
  }
  if (typeof input.mail === 'string') {
    const text = input.mail.trim()
    setSetting('welcome_mail', text === welcomeMailText().text.trim() ? '' : text)
  }
}

// ---------------------------------------------------------------------------
// Stand je Benutzer

export interface WelcomeState {
  /** Wie viele Schritte bestätigt sind */
  step: number
  total: number
  sent_at: number | null
  done: boolean
  done_at: number | null
}

export function welcomeState(userId: number, total = welcomeSteps().length): WelcomeState {
  const row = db.prepare('SELECT welcome_step, welcome_sent_at, welcome_done_at FROM users WHERE id = ?').get(userId)
  const step = Math.min(Number(row?.welcome_step ?? 0), total)
  const done = total > 0 && step >= total
  return { step, total, sent_at: (row?.welcome_sent_at as number | null) ?? null, done, done_at: done ? ((row?.welcome_done_at as number | null) ?? null) : null }
}

/**
 * Bestätigt den aktuellen Schritt. `index` ist der Schritt, den die Seite gerade zeigt; stimmt er nicht mit dem Stand
 * überein (Doppelklick, alte Seite), geschieht nichts. So lässt sich nichts überspringen.
 */
export function confirmStep(userId: number, index: number): WelcomeState {
  const total = welcomeSteps().length
  const state = welcomeState(userId, total)
  if (state.done || index !== state.step) return state
  const step = state.step + 1
  const finished = step >= total
  db.prepare('UPDATE users SET welcome_step = ?, welcome_done_at = ? WHERE id = ?').run(step, finished ? now() : null, userId)
  if (finished) {
    const name = greetingName(userId)
    logEvent('mail', t('{name} hat die Einrichtung abgeschlossen', { name }))
    notifyOwner(t('{name} hat die Einrichtung abgeschlossen', { name }), t('Alle Schritte der Anleitung sind bestätigt, auch die Regeln.'))
  }
  return welcomeState(userId, total)
}

export function resetWelcome(userId: number): void {
  db.prepare('UPDATE users SET welcome_step = 0, welcome_done_at = NULL WHERE id = ?').run(userId)
}

/** Alle Benutzer außer dem Besitzer mit ihrem Stand, für die Einstellungen. */
export function welcomeUsers() {
  const total = welcomeSteps().length
  return db
    .prepare("SELECT id, name, COALESCE(NULLIF(email_override, ''), email) AS email FROM users WHERE active = 1 AND is_owner = 0 ORDER BY name COLLATE NOCASE")
    .all()
    .map((u) => ({ ...u, ...welcomeState(u.id as number, total) }))
}

// ---------------------------------------------------------------------------
// Darstellung

const link = (text: string) => text.replace(/https?:\/\/[^\s<]+/g, (url) => `<a href="${url}" style="color:inherit" target="_blank" rel="noreferrer">${url}</a>`)
const inline = (text: string) => link(escapeHtml(text)).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

/** Der Text eines Schritts als HTML: Absätze, Aufzählungen mit „- “, **fett** und Links. Alles andere bleibt Text. */
export function markup(text: string, values: Record<string, string> = {}): string {
  const filled = text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all)
  const html: string[] = []
  let para: string[] = []
  let items: string[] = []
  const flush = () => {
    if (para.length) html.push(`<p style="margin:0 0 10px">${para.map(inline).join('<br>')}</p>`)
    if (items.length) html.push(`<ul style="margin:8px 0 10px;padding-left:20px">${items.map((i) => `<li style="margin:4px 0">${inline(i)}</li>`).join('')}</ul>`)
    para = []
    items = []
  }
  for (const line of filled.split('\n')) {
    const item = /^\s*-\s+(.*)$/.exec(line)
    if (item) {
      if (para.length) flush()
      items.push(item[1]!)
    } else if (!line.trim()) flush()
    else {
      if (items.length) flush()
      para.push(line.trim())
    }
  }
  flush()
  return html.join('')
}

/** Was die Platzhalter in den Texten bedeuten. */
export async function welcomeValues(userId: number): Promise<Record<string, string>> {
  return { name: greetingName(userId), server: await plexWhere(), app: config.mailFromName || 'Blackbriar' }
}

// ---------------------------------------------------------------------------
// Die Mail

export async function renderWelcome(userId: number): Promise<Mail> {
  const c = MAIL_COLORS
  const url = welcomeUrl(userId)
  const values = await welcomeValues(userId)
  const hello = greeting(userId)
  const intro = welcomeMailText().text.replace(/\{(\w+)\}/g, (all, key: string) => values[key] ?? all)
  const start = tone('Einrichtung starten', 'Einsatzbefehl öffnen')
  const body = `<p style="margin:0 0 6px">${escapeHtml(hello)}</p><p style="margin:0 0 16px;color:${c.muted};white-space:pre-line">${escapeHtml(intro)}</p>${
    url ? `<a href="${url}" style="display:inline-block;background:${c.accent};color:${c.onAccent};font-size:15px;font-weight:bold;padding:10px 20px;border-radius:4px;text-decoration:none">${escapeHtml(start)}</a>` : ''
  }`
  const reason = await mailReason()
  const subject = tone('Willkommen auf {where}', 'Einsatzbefehl für {where}', { where: await plexWhere() })
  const layout = mailLayout({ title: subject, body, footer: escapeHtml(reason) })
  return {
    to: userEmail(userId),
    subject,
    html: layout.html,
    text: [hello, intro, '', url ? `${start}: ${url}` : '', '', reason].join('\n'),
    attachments: layout.attachments,
  }
}

/** Schickt die Willkommens-Mail. Der Stand der Anleitung bleibt dabei, wie er ist; zurücksetzen geht getrennt. */
export async function sendWelcome(userId: number): Promise<void> {
  if (!mailConfigured()) throw new Error(t('Erst das Postfach eintragen und speichern.'))
  if (!userEmail(userId)) throw new Error(t('Für diesen Benutzer ist keine Adresse bekannt.'))
  if (!welcomeUrl(userId)) throw new Error(t('Dafür braucht Blackbriar die Adresse „Von außen“ unter Einstellungen, damit der Link in der Mail funktioniert.'))
  if (!welcomeSteps().length) throw new Error(t('Mindestens ein Schritt ist nötig. Jeder Schritt beginnt mit einer Zeile „## Überschrift“.'))
  const mail = await renderWelcome(userId)
  try {
    await sendMail(mail)
  } catch (err) {
    logMail(userId, 'welcome', mail.subject, (err as Error).message)
    throw err
  }
  db.prepare('UPDATE users SET welcome_sent_at = ? WHERE id = ?').run(now(), userId)
  logMail(userId, 'welcome', mail.subject)
}
