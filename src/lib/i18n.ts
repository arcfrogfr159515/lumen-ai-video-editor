/**
 * The interface in more than one language.
 *
 * What the interface says is written in the code, in English, where it is said:
 * `tt('Save a copy')`. The English is also the key — in another language the
 * same call answers with what `src/locales/<language>.ts` has for it, and with
 * the English where it has nothing, so a sentence that hasn't been translated
 * yet is still a sentence. Values are put in by position: `tt('{0} of {1}', a, b)`,
 * which lets a translation move them to where its grammar wants them.
 *
 * The language is settled once, as the window opens (so text can be made
 * anywhere, in a module as it loads as well as in a component), and a change
 * takes effect the next time Lumen starts.
 *
 * Not everything is translated on purpose: what is written for the model (tool
 * descriptions, prompts) stays in English, which is what models follow best.
 */
import zhCN from '@/locales/zh-CN'

export type Language = 'en' | 'zh-CN'
/** What the user picked: a language, or whatever the computer is set to. */
export type LanguageChoice = 'system' | Language

export const LANGUAGES: { id: Language; name: string }[] = [
  { id: 'en', name: 'English' },
  { id: 'zh-CN', name: '简体中文' },
]

const STORE = 'lumen.language'
const DICTIONARIES: Record<Language, Record<string, string> | null> = { en: null, 'zh-CN': zhCN }

/** The language for one of the computer's own, or null when it isn't one Lumen speaks. */
export function languageFor(tag: string): Language | null {
  const [lang, ...rest] = tag.toLowerCase().split(/[-_]/)
  if (lang === 'en') return 'en'
  // Simplified Chinese is for where it is read: not for readers of traditional characters, who are better served
  // by the English until there is a translation of their own.
  if (lang === 'zh') return rest.some((part) => part === 'hant' || part === 'tw' || part === 'hk' || part === 'mo') ? null : 'zh-CN'
  return null
}

export function languageChoice(): LanguageChoice {
  try {
    const stored = localStorage.getItem(STORE)
    return stored === 'en' || stored === 'zh-CN' ? stored : 'system'
  } catch {
    // No storage here (a worker, a test, the main process), or it can't be read.
    return 'system'
  }
}

/** The language the computer asks for, among those Lumen speaks. */
export function systemLanguage(): Language {
  // Only in a window. Node has a `navigator` too, with the language of whoever runs the tests — and the tests are
  // written in English, wherever they run and whatever they stand in for a window.
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || import.meta.env?.MODE === 'test') return 'en'
  for (const tag of navigator.languages?.length ? navigator.languages : [navigator.language]) {
    const found = tag ? languageFor(tag) : null
    if (found) return found
  }
  return 'en'
}

function settle(): Language {
  const choice = languageChoice()
  return choice === 'system' ? systemLanguage() : choice
}

/** The language this window speaks, for as long as it is open. */
export const language: Language = settle()

/** Remembers the choice. Answers whether Lumen has to be started again for it to show. */
export function chooseLanguage(choice: LanguageChoice): boolean {
  try {
    if (choice === 'system') localStorage.removeItem(STORE)
    else localStorage.setItem(STORE, choice)
  } catch {
    return false
  }
  return settle() !== language
}

/** What a sentence is in this window's language, values not yet put in. */
export function translation(text: string, into: Language = language): string {
  return DICTIONARIES[into]?.[text] ?? text
}

/** Puts values where `{0}`, `{1}`… stand. A place with no value is left as written. */
export function fill(text: string, args: readonly unknown[]): string {
  return args.length ? text.replace(/\{(\d+)\}/g, (place, at) => (Number(at) < args.length ? String(args[Number(at)]) : place)) : text
}

/**
 * Marks a name that is kept in English as data — something code looks things up by, or that is saved in a
 * project — and is translated only where it is shown, with `tt(value)`. It answers with what it was given.
 */
export const tm = <T extends string>(text: T): T => text

/** A sentence of the interface, in this window's language. */
export function tt(text: string, ...args: unknown[]): string {
  return fill(translation(text), args)
}

/**
 * The same words where they mean something else: `ttc('fade', 'In')` is "In" as it is said of a fade. The
 * dictionary has it as `In ⟦fade⟧`; without that entry it is whatever "In" is elsewhere.
 */
export function ttc(context: string, text: string, ...args: unknown[]): string {
  const dictionary = DICTIONARIES[language]
  return fill(dictionary?.[`${text} ⟦${context}⟧`] ?? dictionary?.[text] ?? text, args)
}

/**
 * A count with what is counted: `counted(3, 'clip')` is "3 clips", `counted(1, 'clip')` "1 clip" — or whatever
 * the dictionary has for `{0} clips` and `{0} clip`, in a language that may not tell one from many at all.
 */
export function counted(n: number, one: string, many = `${one}s`): string {
  return tt(n === 1 ? `{0} ${one}` : `{0} ${many}`, n)
}
