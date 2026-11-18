/**
 * Voice prompts: record from the microphone, transcribe (OpenAI Whisper with a
 * key, otherwise Whisper on this computer) and hand back the text.
 */
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { transcribeSpeech, transcribers, TRANSCRIBER_NAMES } from '@/project/transcribe'
import { onWhisperProgress } from '@/project/whisper'
import { tt } from '@/lib/i18n'

type VoiceState = 'idle' | 'recording' | 'transcribing'

/** The recording that is running, with the microphone it holds. */
let live: { recorder: MediaRecorder; stream: MediaStream } | null = null
/** The microphone has been asked for and hasn't answered yet: the button still reads “idle” meanwhile. */
let asking = false
/** Goes up each time the button goes away: what was started for it isn't carried on with. */
let gone = 0

/**
 * Lets go of the recording — and of the microphone — when the button it was made with goes away (the Copilot's
 * panel gives way to the Inspector). Nothing is transcribed: nobody is left to hand the words to. Left running,
 * it kept the microphone open, and the button drawn when the panel came back had no hold on it.
 */
export function abandonVoice() {
  gone++
  const was = live
  live = null
  if (!was) return
  was.recorder.onstop = null
  try {
    if (was.recorder.state !== 'inactive') was.recorder.stop()
  } finally {
    was.stream.getTracks().forEach((t) => t.stop())
  }
}

export function useVoiceInput(onText: (text: string) => void) {
  const [state, setState] = useState<VoiceState>('idle')
  useEffect(() => abandonVoice, [])

  const start = async () => {
    // One press, one recording. Pressed again before the microphone had answered, a second recording started beside
    // the first, and stopping stopped only the second: the first kept the microphone open until Lumen closed.
    if (asking || live) return
    asking = true
    const mine = gone
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      toast.error(tt('Microphone unavailable'), { description: tt('Allow Lumen to use the microphone in your system settings, then try again.') })
      return
    } finally {
      asking = false
    }
    // The button went away while the microphone was being asked for: it is handed straight back.
    if (mine !== gone) return void stream.getTracks().forEach((t) => t.stop())
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '' })
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop())
      if (live?.recorder === rec) live = null
      setState('transcribing')
      const using = transcribers().find((t) => t !== 'elevenlabs') ?? 'local'
      let toastId: string | number | undefined
      const off = onWhisperProgress((m) => {
        if (m.type === 'progress' && m.status === 'progress' && m.total && m.total > 5_000_000) {
          toastId = toast.loading(tt('Downloading the speech model… {0}%', Math.round(m.progress ?? 0)), { id: toastId, description: tt('One time, about 75 MB. Then it works offline.') })
        }
      })
      try {
        const bytes = await new Blob(chunks).arrayBuffer()
        const ctx = new OfflineAudioContext(1, 1, 48000)
        const buffer = await ctx.decodeAudioData(bytes)
        const text = await transcribeSpeech(buffer)
        if (toastId !== undefined) toast.dismiss(toastId)
        if (text) onText(text)
        else toast(tt('Didn’t catch that'), { description: tt('Nothing was heard in the recording.') })
      } catch (err) {
        if (toastId !== undefined) toast.dismiss(toastId)
        toast.error(tt('Voice input failed'), { description: `${TRANSCRIBER_NAMES[using]}: ${err instanceof Error ? err.message : String(err)}` })
      } finally {
        off()
        setState('idle')
      }
    }
    live = { recorder: rec, stream }
    rec.start()
    setState('recording')
  }

  const stop = () => live?.recorder.state === 'recording' && live.recorder.stop()

  return { state, toggle: () => (state === 'recording' ? stop() : state === 'idle' ? void start() : undefined) }
}
