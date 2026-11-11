/**
 * Reading HTML that may be anything: a real page, half a page, or one written
 * to waste time. The patterns pages are usually picked apart with — "<" up to
 * the next ">", an opening tag up to its closing tag — look again from every
 * "<" or every opening tag when what they look for isn't there, so a page of
 * nothing but "<" takes time that grows with the square of its size: seventeen
 * seconds for a quarter of a megabyte, over an hour for the four megabytes a
 * page may be, all of it in the main process, with every window frozen.
 *
 * Everything here goes through the text once.
 */

/**
 * The page with every "<" that doesn't open a tag — no ">" before the next
 * "<", or before the end — turned into text ("&lt;"). After this, each "<"
 * left is closed by the first ">" after it and has no "<" inside, so a pattern
 * such as `<a[^>]*>` can't run past the tag it started in.
 */
export function tidyTags(html: string): string {
  let out = ''
  let from = 0
  let lt = html.indexOf('<')
  while (lt >= 0) {
    const next = html.indexOf('<', lt + 1)
    const gt = html.indexOf('>', lt + 1)
    if (gt < 0) {
      // No tag closes from here on: every "<" left is text.
      out += html.slice(from, lt) + html.slice(lt).replaceAll('<', '&lt;')
      return out
    }
    if (next >= 0 && next < gt) {
      // Another "<" comes first: this one opens nothing. (All of them up to the one that the ">" belongs to.)
      const last = html.lastIndexOf('<', gt)
      out += html.slice(from, lt) + html.slice(lt, last).replaceAll('<', '&lt;')
      from = last
      lt = html.indexOf('<', gt + 1)
      continue
    }
    lt = next
  }
  return out + html.slice(from)
}

let tidied: { raw: string; tidy: string } | null = null

/** tidyTags, remembered for the page last asked about (a page is asked about many times in a row). */
export function tidy(html: string): string {
  if (tidied?.raw !== html) tidied = { raw: html, tidy: tidyTags(html) }
  return tidied.tidy
}

const isNameEnd = (ch: string | undefined) => ch === undefined || ch === '>' || ch === '/' || ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\f'

export interface Element {
  /** The opening tag, as written. */
  tag: string
  /** What is between the opening and the closing tag. */
  inner: string
  start: number
  /** Just past the closing tag. */
  end: number
}

/**
 * Every `<name …>…</name>` in the page, in order, each ending at the first
 * closing tag after it (elements of the same name inside one another aren't
 * told apart, as with the patterns this replaces). When no closing tag is
 * left, it stops: no later opening tag could have one either.
 */
export function* elements(html: string, name: string, lower = html.toLowerCase()): Generator<Element> {
  const open = `<${name}`
  const close = `</${name}`
  let at = 0
  for (;;) {
    const start = lower.indexOf(open, at)
    if (start < 0) return
    if (!isNameEnd(lower[start + open.length])) {
      at = start + open.length
      continue
    }
    const tagEnd = html.indexOf('>', start)
    if (tagEnd < 0) return
    let closing = lower.indexOf(close, tagEnd + 1)
    while (closing >= 0 && !isNameEnd(lower[closing + close.length])) closing = lower.indexOf(close, closing + close.length)
    if (closing < 0) return
    const closeEnd = html.indexOf('>', closing)
    if (closeEnd < 0) return
    yield { tag: html.slice(start, tagEnd + 1), inner: html.slice(tagEnd + 1, closing), start, end: closeEnd + 1 }
    at = closeEnd + 1
  }
}

export const firstElement = (html: string, name: string): Element | null => elements(html, name).next().value ?? null

/** The page without its comments. */
export function stripComments(html: string): string {
  let out = ''
  let at = 0
  for (;;) {
    const start = html.indexOf('<!--', at)
    if (start < 0) break
    const end = html.indexOf('-->', start + 4)
    if (end < 0) break
    out += html.slice(at, start)
    at = end + 3
  }
  return out + html.slice(at)
}

/**
 * The page with every element of these names — tags and all that is between
 * them — replaced by `to`. An opening tag with no closing tag after it stays
 * as it is.
 */
export function dropElements(html: string, names: readonly string[], to = ' '): string {
  const lower = html.toLowerCase()
  // Names that have no closing tag left: nothing later can be one of them.
  const spent = new Set<string>()
  let out = ''
  let from = 0
  let lt = lower.indexOf('<')
  while (lt >= 0) {
    const name = names.find((n) => !spent.has(n) && lower.startsWith(n, lt + 1))
    if (!name) {
      lt = lower.indexOf('<', lt + 1)
      continue
    }
    const closing = lower.indexOf(`</${name}>`, lt + 1 + name.length)
    if (closing < 0) {
      spent.add(name)
      if (spent.size === names.length) break
      lt = lower.indexOf('<', lt + 1)
      continue
    }
    out += html.slice(from, lt) + to
    from = closing + name.length + 3
    lt = lower.indexOf('<', from)
  }
  return out + html.slice(from)
}
