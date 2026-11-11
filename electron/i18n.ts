/**
 * What the main process says, in the window's language: the titles and buttons of the system's file dialogs, the
 * question asked when a project is closed unsaved, and the errors a user reads when a file can't be opened or
 * written. Written in English where it is said — `mt('Save project')` — and looked up in ./locales, the way the
 * editor does it in src/lib/i18n.ts.
 *
 * The window settles its language (the user's choice, or the computer's) and tells this process, which remembers it
 * for the next start; until it has been told, it goes by the computer's language, which is the window's default too.
 */
import { app } from 'electron'
import { readJson, writeJson } from './integrations/paths'
import zhCN from './locales/zh-CN'

export type Language = 'en' | 'zh-CN'
const FILE = 'language.json'
const DICTIONARIES: Record<Language, Record<string, string> | null> = { en: null, 'zh-CN': zhCN }

function languageFor(tag: string): Language | null {
  const [lang, ...rest] = tag.toLowerCase().split(/[-_]/)
  if (lang === 'en') return 'en'
  if (lang === 'zh') return rest.some((part) => part === 'hant' || part === 'tw' || part === 'hk' || part === 'mo') ? null : 'zh-CN'
  return null
}

let current: Language | null = null

/** The language dialogs are shown in. */
export function language(): Language {
  if (current) return current
  // Tests are written in English, wherever they run.
  if (process.env.VITEST) return (current = 'en')
  try {
    const stored = readJson<{ language?: string }>(FILE, {}).language
    if (stored === 'en' || stored === 'zh-CN') return (current = stored)
    // Before the app is ready the computer's language isn't known yet: answer for now, and ask again next time.
    return app.isReady() ? (current = languageFor(app.getLocale()) ?? 'en') : (languageFor(app.getLocale()) ?? 'en')
  } catch {
    return 'en'
  }
}

/** What the window speaks: remembered, so the next start's first dialog is in it too. */
export function setLanguage(next: unknown) {
  if (next !== 'en' && next !== 'zh-CN') return
  // Told at every start: nothing is written unless it is news (what was remembered, or the computer's own language).
  if (next === language()) return
  current = next
  try {
    writeJson(FILE, { language: next })
  } catch {
    // It is still used until Lumen closes.
  }
}

/** A sentence of the main process, in the window's language; `{0}`, `{1}`… are where values go. */
export function mt(text: string, ...args: unknown[]): string {
  const found = DICTIONARIES[language()]?.[text] ?? text
  return args.length ? found.replace(/\{(\d+)\}/g, (place, at) => (Number(at) < args.length ? String(args[Number(at)]) : place)) : found
}
