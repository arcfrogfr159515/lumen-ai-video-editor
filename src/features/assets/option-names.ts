import { ttc } from '@/lib/i18n'

/** What an option is one of: a side to align to, or the look of a motion graphic. */
export type OptionKind = 'side' | 'style'

/**
 * An option that is listed under the name the code has for it (“editorial”, “left”), with a capital put on by the
 * list: that name in English, the window's word for it in another language.
 */
export const optionName = (kind: OptionKind, id: string) => ttc(kind, id)
