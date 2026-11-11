import { net } from 'electron'
import type { TranscriptSegment } from '../../../shared/integrations'
import { within } from '../deadline'
import { phrases } from '../elevenlabs'
import { providerBaseURL, providerKey } from './providers'

/**
 * Speech-to-text with the user's OpenAI key (Whisper, with word timings).
 * The editor sends 16 kHz mono WAV in pieces of at most ~10 minutes.
 */
/** How long OpenAI has for one piece, the reading of its answer included. */
export const TRANSCRIBE_LIMITS = { ms: 5 * 60_000 }

export async function transcribeWithOpenAI(wav: Uint8Array, language?: string): Promise<TranscriptSegment[]> {
  const key = providerKey('openai')
  if (!key) throw new Error('Add an OpenAI API key in Integrations › AI models to transcribe with OpenAI.')
  const base = providerBaseURL('openai') || 'https://api.openai.com/v1'
  const form = new FormData()
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'speech.wav')
  form.append('model', 'whisper-1')
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'word')
  form.append('timestamp_granularities[]', 'segment')
  if (language) form.append('language', language)
  // A piece is ten minutes of speech at most, and comes back in well under a minute.
  const json = await within(TRANSCRIBE_LIMITS.ms, 'OpenAI', null, async (signal) => {
    const res = await net.fetch(`${base}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal })
    if (res.status === 401 || res.status === 403) throw new Error('OpenAI rejected the API key.')
    if (res.status === 429) throw new Error('OpenAI is rate-limiting this key (or it has no credit left).')
    if (!res.ok) throw new Error(`OpenAI transcription failed (${res.status}): ${(await res.text()).slice(0, 200)}`)
    return (await res.json()) as {
      words?: { word: string; start: number; end: number }[]
      segments?: { start: number; end: number; text: string }[]
    }
  })
  if (json.words?.length) return phrases(json.words.map((w) => ({ text: w.word.trim(), start: w.start, end: w.end })).filter((w) => w.text))
  return (json.segments ?? []).map((s) => ({ start: s.start, end: s.end, text: s.text.trim() })).filter((s) => s.text)
}
