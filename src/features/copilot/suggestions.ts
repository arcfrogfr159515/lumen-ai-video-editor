/** Starter prompts for the Copilot (and the command palette). They go to whichever brain is connected. */
import { tt } from '@/lib/i18n'

export const STARTERS = [
  { title: tt('Tighten the speech'), subtitle: tt('Cut long pauses and dead air'), prompt: tt('Remove the long pauses from the speech in my edit') },
  { title: tt('Add captions'), subtitle: tt('Transcribe and lay subtitles'), prompt: tt('Transcribe the speech and add captions') },
  { title: tt('Make it cinematic'), subtitle: tt('One grade across every shot'), prompt: tt('Give every shot a consistent cinematic color grade') },
  { title: tt('Duck the music'), subtitle: tt('Lower it under the voice'), prompt: tt('Duck the music under the speech') },
  { title: tt('Tighten the pacing'), subtitle: tt('Trim slow shots'), prompt: tt('Tighten the pacing: trim the slowest shots so the edit moves') },
  { title: tt('Vertical for Reels'), subtitle: tt('Reframe to 9:16'), prompt: tt('Make this a vertical 9:16 edit for Reels and TikTok') },
  { title: 'Smooth transitions', subtitle: tt('Between every shot'), prompt: 'Add tasteful transitions between the shots on the main track' },
  { title: tt('Review my edit'), subtitle: tt('Pacing, audio and color notes'), prompt: tt('Review my edit and tell me what to improve') },
]
