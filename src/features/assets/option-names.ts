import { ttc } from '@/lib/i18n'

/** What an option is one of: a side to align to, the look of a motion graphic, a 3D background's set of colours or kind of form. */
export type OptionKind = 'side' | 'style' | 'palette' | 'form'

/**
 * An option that is listed under the name the code has for it (“editorial”, “left”, “blobs”), with a capital put
 * on by the list: that name in English, the window's word for it in another language.
 */
export const optionName = (kind: OptionKind, id: string) => ttc(kind, id)
