/**
 * What was typed into a field for a number or a time, read as it was meant. An input method for Chinese or Japanese
 * types its own colon and full stop (： 。) and, in full-width mode, its own digits (１２３): none of them is the
 * character a number is written with here. A time typed "1：30" was no time, a number typed "1。5" was 15 — what
 * was no digit, point or sign was thrown away, and the rest was the number — and "１２" was 0.
 */

/** The same characters at their usual width, the ideographic full stop as a point. */
export const halfWidth = (typed: string) => typed.normalize('NFKC').replace(/。/g, '.')

/** The number typed (a unit or anything else beside it left out), or null when what was typed holds none. */
export function typedNumber(typed: string): number | null {
  const digits = halfWidth(typed).replace(/[^\d.+-]/g, '')
  // Nothing of it is a number: the field stays as it was. (An empty rest is 0 as a number, and was taken for it.)
  if (!digits) return null
  const n = Number(digits)
  return Number.isFinite(n) ? n : null
}
