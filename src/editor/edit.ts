import { isAnimated } from './keyframes'
import { usePlayback } from './playback'
import { dispatch, getProject } from './store'
import type { AnimatableProp } from './types'
import { tt } from '@/lib/i18n'

/**
 * Sets an animatable property the way motion designers expect: if the property
 * is already keyframed, it auto-keys at the playhead; otherwise it changes the
 * static value. Continuous gestures pass a `coalesce` key → one undo step.
 */
export function setAnimatable(clipId: string, prop: AnimatableProp, value: number, coalesce?: string) {
  const clip = getProject().clips[clipId]
  if (!clip) return
  if (isAnimated(clip, prop)) {
    const local = Math.max(0, Math.min(clip.duration, usePlayback.getState().frame - clip.start))
    dispatch('keyframe.set', { clipId, prop, frame: local, value }, { coalesce })
  } else if (prop === 'volume') {
    dispatch('clip.update', { ids: [clipId], patch: { audio: { volume: value } } }, { coalesce, label: tt('Edit volume') })
  } else {
    dispatch('clip.update', { ids: [clipId], patch: { transform: { [prop]: value } } }, { coalesce, label: tt('Edit {0}', prop) })
  }
}

/** Frame relative to the clip start, clamped into the clip. */
export function localFrame(clipId: string) {
  const clip = getProject().clips[clipId]
  if (!clip) return 0
  return Math.max(0, Math.min(clip.duration, usePlayback.getState().frame - clip.start))
}
