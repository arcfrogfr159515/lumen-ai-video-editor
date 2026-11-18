/**
 * The words of a text, in any script. Most languages put spaces between their words; Chinese and Japanese don't,
 * and taken for "what stands between two spaces" a whole sentence of theirs is one word: one caption however long
 * it is, one "word" of kinetic type as wide as the sentence. Their words are the ones the platform's dictionary
 * gives — single characters where there is none.
 */

/** A character of a script written without spaces between words: Chinese and Japanese (Korean spells its words apart). */
export const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u
const SAID = /[\p{L}\p{N}]/u
/** What opens a quote or a bracket: it belongs with the word after it. */
const OPENS = /^[“‘「『（(《〈【\[]+$/u
let segmenter: Intl.Segmenter | null | undefined

/** A stretch of text without spaces as its words: the ones its language's dictionary knows — single characters where there is no such dictionary here. */
function unspacedWords(run: string): { index: number; text: string }[] {
  if (segmenter === undefined) segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'word' }) : null
  if (segmenter) return [...segmenter.segment(run)].map((s) => ({ index: s.index, text: s.segment }))
  const out: { index: number; text: string }[] = []
  let index = 0
  for (const ch of run) {
    out.push({ index, text: ch })
    index += ch.length
  }
  return out
}

/**
 * Where the words of a text begin and end in it. Words are what stands between spaces — and, in a script written
 * without spaces, the words within such a stretch. A mark stays with the word it follows, an opening quote with
 * the one it opens.
 */
export function wordSpans(text: string): [number, number][] {
  const spans: [number, number][] = []
  for (const run of text.matchAll(/\S+/g)) {
    const at = run.index ?? 0
    if (!UNSPACED.test(run[0])) {
      spans.push([at, at + run[0].length])
      continue
    }
    let opened: number | null = null
    for (const part of unspacedWords(run[0])) {
      const [a, b] = [at + part.index, at + part.index + part.text.length]
      if (OPENS.test(part.text)) opened ??= a
      else if (!SAID.test(part.text) && opened === null && spans.length) spans[spans.length - 1][1] = b
      else {
        spans.push([opened ?? a, b])
        opened = null
      }
    }
    // (A quote opened and never followed by a word: with the word before it.)
    if (opened !== null) {
      if (spans.length) spans[spans.length - 1][1] = at + run[0].length
      else spans.push([opened, at + run[0].length])
    }
  }
  return spans
}

/** The words of a text, each as it is written there. */
export const wordsOf = (text: string): string[] => wordSpans(text).map(([a, b]) => text.slice(a, b))
