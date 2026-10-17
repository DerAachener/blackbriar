import { statSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import nodemailer from 'nodemailer'
import { config, mailConfigured } from './config.ts'
import { db, getSetting, setSetting } from './db.ts'
import { locale, t } from './i18n.ts'
import { getServerName } from './plex.ts'
import { escapeHtml } from './telegram.ts'

// E-Mails an die Benutzer: Newsletter und Erinnerungen. Bilder hängen an der Mail selbst (cid:),
// damit sie auch ohne Abruf von außen erscheinen und niemand über Bildadressen die Bibliothek sieht.

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'mail')
const LOGO_DIR = join(config.dataDir, 'mail')

// Farben des Mail-Designs; der Hintergrund passt zu den mitgelieferten Wochen-Kästchen
export const MAIL_COLORS = {
  page: '#1c1d14',
  band: '#2a2c1c',
  card: '#33352a',
  text: '#e9e7dc',
  muted: '#a9a793',
  accent: '#caa646',
  onAccent: '#1c1d14',
}

export interface Attachment {
  cid: string
  filename: string
  content: Buffer
  contentType: string
}

/** Das hochgeladene Logo für den Kopf der Mail, falls es eines gibt. */
export function mailLogo(): { path: string; type: string } | null {
  for (const [ext, type] of [['png', 'image/png'], ['jpg', 'image/jpeg']] as const) {
    const path = join(LOGO_DIR, `logo.${ext}`)
    if (existsSync(path)) return { path, type }
  }
  return null
}

/** Speichert das Logo; erlaubt sind PNG und JPEG. */
export function saveMailLogo(data: Buffer): void {
  const png = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  const jpg = data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
  if (!png && !jpg) throw new Error(t('Das Logo muss eine PNG- oder JPEG-Datei sein.'))
  removeMailLogo()
  mkdirSync(LOGO_DIR, { recursive: true })
  writeFileSync(join(LOGO_DIR, png ? 'logo.png' : 'logo.jpg'), data)
}

export function removeMailLogo(): void {
  for (const ext of ['png', 'jpg']) rmSync(join(LOGO_DIR, `logo.${ext}`), { force: true })
}

/** Ein Bild aus dem Kopf der Mails für den Abruf von außen: `logo.png`, `logo.jpg` oder `week-NN.png`. */
export function mailHeadImage(name: string): { data: Buffer; type: string } | null {
  const week = /^week-(\d\d)\.png$/.exec(name)
  if (week) {
    const n = Number(week[1])
    const file = join(ASSETS, 'kw', `kw-${week[1]}.png`)
    return n >= 1 && n <= 53 && existsSync(file) ? { data: readFileSync(file), type: 'image/png' } : null
  }
  const logo = mailLogo()
  if (logo && (name === 'logo.png' || name === 'logo.jpg')) return { data: readFileSync(logo.path), type: logo.type }
  return null
}

/** Kalenderwoche nach ISO 8601: Die Woche beginnt montags, die erste Woche enthält den 4. Januar. */
export function isoWeek(date = new Date()): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - day)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.ceil(((d.getTime() - yearStart) / 86400_000 + 1) / 7)
}

/** Name, unter dem die Mails verschickt werden; ohne Angabe „Blackbriar“. */
export const senderName = () => config.mailFromName || 'Blackbriar'

/**
 * Baut die ganze Mail um einen Inhalt herum: Kopf mit Kalenderwoche und Logo, Fuß mit Hinweisen.
 * Tabellen und feste Farben, weil Mailprogramme modernes CSS nicht zuverlässig darstellen.
 */
export function mailLayout(options: { title: string; body: string; footer?: string; width?: number }): { html: string; attachments: Attachment[] } {
  const c = MAIL_COLORS
  const attachments: Attachment[] = []
  const week = isoWeek()
  const weekFile = join(ASSETS, 'kw', `kw-${String(week).padStart(2, '0')}.png`)
  const logo = mailLogo()
  const name = escapeHtml(senderName())
  const weekLabel = t('Kalenderwoche {n}', { n: week })
  // Breite am großen Bildschirm; am Handy füllt die Mail die Breite des Geräts
  const width = options.width ?? 600

  let head: string
  if (logo && existsSync(weekFile)) {
    // Werden die Poster geladen statt angehängt, gilt das auch für den Kopf: Sonst blieben genau diese zwei Bilder als
    // Anhänge übrig, und manche Mailprogramme listen sie unter der Mail auf.
    const remote = getSetting('mail_posters') === 'remote' && Boolean(config.publicUrl)
    const logoName = 'logo.' + (logo.type === 'image/png' ? 'png' : 'jpg')
    let weekSrc = 'cid:week'
    let logoSrc = 'cid:logo'
    if (remote) {
      weekSrc = `${config.publicUrl}/api/public/head/week-${String(week).padStart(2, '0')}.png`
      // Die Zahl am Ende wechselt mit dem Logo, damit Mailprogramme nach einem neuen Logo nicht das alte zeigen
      logoSrc = `${config.publicUrl}/api/public/head/${logoName}?v=${Math.floor(statSync(logo.path).mtimeMs / 1000)}`
    } else {
      attachments.push({ cid: 'week', filename: 'kw.png', content: readFileSync(weekFile), contentType: 'image/png' })
      attachments.push({ cid: 'logo', filename: logoName, content: readFileSync(logo.path), contentType: logo.type })
    }
    // Kästchen und Logo teilen sich die Breite im Verhältnis ihrer Bilder (176:498) und schrumpfen am Handy gemeinsam;
    // ohne Bilder steht der Text aus alt da
    head = `<table role="presentation" width="440" cellpadding="0" cellspacing="0" style="width:100%;max-width:440px"><tr>
<td width="26%" style="width:26%;vertical-align:middle"><img src="${weekSrc}" width="114" alt="${escapeHtml(weekLabel)}" style="display:block;width:100%;height:auto;border:0;color:${c.accent};font-size:14px"></td>
<td width="74%" style="width:74%;vertical-align:middle"><img src="${logoSrc}" width="326" alt="${name}" style="display:block;width:100%;height:auto;border:0;color:${c.text};font-size:18px"></td>
</tr></table>`
  } else {
    head = `<div style="font-size:12px;letter-spacing:3px;color:${c.accent};text-transform:uppercase">${escapeHtml(weekLabel)}</div>
      <div style="font-size:26px;letter-spacing:3px;font-weight:bold;color:${c.text};text-transform:uppercase">${name}</div>`
  }

  const html = `<!doctype html>
<html lang="${locale().slice(0, 2)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${escapeHtml(options.title)}</title>
</head>
<body style="margin:0;padding:0;background:${c.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.page}">
<tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="width:100%;max-width:${width}px;background:${c.band};font-family:Arial,Helvetica,sans-serif;color:${c.text}">
<tr><td style="padding:18px 20px 14px;border-bottom:3px solid ${c.accent}">${head}</td></tr>
<tr><td style="padding:22px 20px 8px;font-size:15px;line-height:1.6">${options.body}</td></tr>
<tr><td style="padding:18px 20px 22px;font-size:12px;line-height:1.6;color:${c.muted}">${options.footer ?? ''}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
  return { html, attachments }
}

// Auf Wunsch klingen die Mails wie ein Briefing aus einem Agentenfilm: Anrede, Betreff und Überschriften wechseln,
// alles, was man verstehen muss (Titel, Daten, Abbestellen), bleibt sachlich.
export const briefingTone = () => getSetting('mail_briefing') === '1'
export const setBriefingTone = (on: boolean) => setSetting('mail_briefing', on ? '1' : '0')

/** Wählt je nach Ton den sachlichen oder den Briefing-Text und übersetzt ihn. */
export const tone = (neutral: string, briefing: string, values?: Record<string, string | number>) => t(briefingTone() ? briefing : neutral, values)

/** Die Anrede am Anfang jeder Mail. */
export const greeting = (userId: number) => tone('Hallo {name},', 'Agent {name},', { name: greetingName(userId) })

/** Der Server heißt in den Mails so, wie ihn die Benutzer aus Plex kennen: „Name [Plex]“. */
export async function plexWhere(): Promise<string> {
  const server = await getServerName()
  return server ? `${server} [Plex]` : 'Plex'
}

/** Der Satz im Fuß jeder Mail, der sagt, warum sie kommt. */
export async function mailReason(): Promise<string> {
  const server = await getServerName()
  if (!server) return t('Du bekommst diese Mail, weil du Zugriff auf diesen Plex-Server hast.')
  return tone('Du bekommst diese Mail, weil du Zugriff auf den Plex-Server {server} hast.', 'Diese Nachricht ging an dich, weil du Zugriff auf den Plex-Server {server} hast.', { server })
}

/** Überschrift eines Abschnitts in der Mail. */
export const mailHeading = (text: string) =>
  `<div style="font-size:12px;letter-spacing:2px;color:${MAIL_COLORS.accent};text-transform:uppercase;margin:18px 0 8px">${escapeHtml(text)}</div>`

function heloName(): string | undefined {
  try {
    if (config.publicUrl) return new URL(config.publicUrl).hostname
  } catch {
    // keine gültige Adresse eingetragen: weiter mit der Domain des Absenders
  }
  return config.mailFrom.split('@')[1] || undefined
}

function transport() {
  if (!mailConfigured()) throw new Error(t('Erst das Postfach eintragen und speichern.'))
  const port = config.mailPort
  return nodemailer.createTransport({
    host: config.mailHost,
    port,
    // Der Name, mit dem sich Blackbriar beim Mailserver meldet. Ohne Angabe wäre es im Container „[127.0.0.1]“,
    // was manche Spamfilter negativ werten; besser die öffentliche Adresse, sonst die Domain des Absenders.
    name: heloName(),
    // 465 ist von Anfang an verschlüsselt; auf anderen Ports wird nach dem Verbinden umgeschaltet, und zwar zwingend
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: config.mailUser, pass: config.mailPassword },
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
  })
}

/** Fehler, bei denen ein späterer zweiter Versuch Sinn hat: keine Verbindung oder eine vorläufige Absage (SMTP 4xx). */
export class TransientMailError extends Error {}
export const isTransient = (err: unknown) => err instanceof TransientMailError

/** Meldungen des Mailservers in verständliche Worte fassen, ohne Zugangsdaten zu nennen. */
function mailError(err: unknown): Error {
  const e = err as { code?: string; responseCode?: number; message?: string }
  if (e.code === 'EAUTH' || e.responseCode === 535) return new Error(t('Der Mailserver lehnt die Anmeldung ab. Stimmen Benutzer und Passwort?'))
  if (e.code === 'ENOTFOUND' || e.code === 'EDNS') return new Error(t('Der Mailserver wurde nicht gefunden. Stimmt die Adresse?'))
  if (e.code === 'ETIMEDOUT' || e.code === 'ECONNECTION' || e.code === 'ECONNREFUSED' || e.code === 'ESOCKET') {
    return new TransientMailError(t('Keine Verbindung zum Mailserver. Stimmen Adresse und Port (465 oder 587)?'))
  }
  if (e.responseCode && e.responseCode >= 400 && e.responseCode < 500) {
    return new TransientMailError(t('Der Mailserver meldet: {detail}', { detail: String(e.message ?? err).slice(0, 200) }))
  }
  return new Error(t('Der Mailserver meldet: {detail}', { detail: String(e.message ?? err).slice(0, 200) }))
}

export interface Mail {
  to: string
  subject: string
  html: string
  /** Fassung ohne Formatierung für Mailprogramme, die kein HTML zeigen */
  text: string
  attachments?: Attachment[]
  /** Zusätzliche Kopfzeilen, etwa zum Abbestellen mit einem Klick */
  headers?: Record<string, string>
}

export async function sendMail(mail: Mail): Promise<void> {
  try {
    await transport().sendMail({
      from: { name: senderName(), address: config.mailFrom },
      to: mail.to,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      headers: mail.headers,
      attachments: (mail.attachments ?? []).map((a) => ({ ...a, contentDisposition: 'inline' as const })),
    })
  } catch (err) {
    throw mailError(err)
  }
}

/**
 * Kurze Nachricht an den Betreiber, wenn etwas seine Aufmerksamkeit braucht: an das Postfach, über das verschickt wird.
 * Scheitert auch das, bleibt es beim Eintrag im Protokoll.
 */
export function notifyOwner(subject: string, text: string): void {
  if (!mailConfigured()) return
  const c = MAIL_COLORS
  const layout = mailLayout({
    title: subject,
    body: `<p style="margin:0 0 10px;font-weight:bold">${escapeHtml(subject)}</p><p style="margin:0;color:${c.muted};white-space:pre-line">${escapeHtml(text)}</p>`,
    footer: escapeHtml(t('Diese Meldung geht nur an dich als Betreiber.')),
  })
  void sendMail({ to: config.mailFrom, subject: `${senderName()}: ${subject}`, html: layout.html, text, attachments: layout.attachments }).catch((err) =>
    console.error(t('Meldung an den Betreiber nicht verschickt:'), (err as Error).message),
  )
}

/** Adresse eines Benutzers: die vom Besitzer eingetragene, sonst die des Plex-Kontos. */
export function userEmail(userId: number): string {
  const row = db.prepare('SELECT email, email_override FROM users WHERE id = ?').get(userId)
  return String(row?.email_override || row?.email || '')
}

/** Wie ein Benutzer in der Mail angesprochen wird: mit dem vom Besitzer vergebenen Namen, sonst mit dem Plex-Namen. */
export function greetingName(userId: number): string {
  return String(db.prepare('SELECT name FROM users WHERE id = ?').get(userId)?.name ?? '')
}

/** Für die Vorschau im Browser: Die angehängten Bilder stehen direkt im HTML, weil es dort kein cid: gibt. */
export function inlineImages(html: string, attachments: Attachment[]): string {
  return attachments.reduce((out, a) => out.replaceAll(`cid:${a.cid}`, `data:${a.contentType};base64,${a.content.toString('base64')}`), html)
}

/** Die Testmail: zeigt Kopf, Farben und einen Knopf, damit das Design vor dem ersten Versand zu sehen ist. */
export function testMail(): Mail {
  const owner = db.prepare('SELECT id FROM users WHERE is_owner = 1').get()
  const to = (owner && userEmail(owner.id as number)) || config.mailFrom
  const c = MAIL_COLORS
  const body = `<p style="margin:0 0 12px">${escapeHtml(owner ? greeting(owner.id as number) : '')}</p>
<p style="margin:0 0 12px">${escapeHtml(t('das Postfach funktioniert. So sehen Kopf und Farben der Mails aus, die Blackbriar verschickt.'))}</p>
${mailHeading(t('Beispiel für einen Abschnitt'))}
<p style="margin:0 0 14px;color:${c.muted}">${escapeHtml(t('Hier stehen später die neuen Titel und die Erinnerungen.'))}</p>
<span style="display:inline-block;background:${c.accent};color:${c.onAccent};font-size:13px;font-weight:bold;padding:8px 16px;border-radius:4px">${escapeHtml(t('So sieht ein Knopf aus'))}</span>`
  const layout = mailLayout({
    title: t('Testmail'),
    body,
    footer: escapeHtml(t('Diese Testmail ging nur an dich. Andere Benutzer bekommen erst Post, wenn du es bei ihnen einschaltest.')),
  })
  return {
    to,
    subject: t('{name}: Testmail', { name: senderName() }),
    html: layout.html,
    text: t('Das Postfach funktioniert. Diese Testmail ging nur an dich.'),
    attachments: layout.attachments,
  }
}

/**
 * Testnachricht an einen einzelnen Benutzer: Der Besitzer sieht, ob die Adresse erreichbar ist, und der Empfänger
 * kann die Mail aus dem Spam-Ordner holen, bevor die erste echte kommt.
 */
export async function userTestMail(userId: number): Promise<Mail> {
  const c = MAIL_COLORS
  const hello = greeting(userId)
  const lines = [
    t('das ist eine Testnachricht. Wenn du sie liest, kommt die Post von hier künftig bei dir an: Hinweise auf neue Filme und Serien und ab und zu eine Erinnerung.'),
    t('Lag diese Mail im Spam- oder Werbeordner? Dann markiere sie dort bitte als „Kein Spam“ oder verschiebe sie in den Posteingang. So landen die nächsten gleich richtig.'),
    t('Du musst nicht antworten.'),
  ]
  const body =
    `<p style="margin:0 0 12px">${escapeHtml(hello)}</p>` +
    lines.map((line, i) => `<p style="margin:0 0 12px${i ? `;color:${c.muted}` : ''}">${escapeHtml(line)}</p>`).join('')
  const reason = await mailReason()
  const subject = t('{name}: Testnachricht', { name: senderName() })
  const layout = mailLayout({ title: subject, body, footer: escapeHtml(reason) })
  return { to: userEmail(userId), subject, html: layout.html, text: [hello, '', ...lines, '', reason].join('\n'), attachments: layout.attachments }
}

/** Prüft das Postfach und schickt dem Besitzer die Testmail; liefert die Adresse, an die sie ging. */
export async function sendTestMail(): Promise<string> {
  const mail = testMail()
  await sendMail(mail)
  return mail.to
}
