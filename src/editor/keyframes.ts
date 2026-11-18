import { clamp, lerp } from '@/lib/math'
import { easeAt } from './easing'
import type { AnimatableProp, Clip, Keyframe } from './types'

export const ANIMATABLE: AnimatableProp[] = ['x', 'y', 'scale', 'rotation', 'opacity', 'volume', 'rotateX', 'rotateY', 'z', 'speed']

/**
 * The values a property can have, where it has bounds: the ones a clip's own value of it is held to (`transform`
 * and `audioMix` in commands.ts). Where a clip sits and how far it is turned have none; its speed has its own
 * (timing.ts).
 */
export const PROP_RANGE = { scale: [0, 20], opacity: [0, 1], rotateX: [-360, 360], rotateY: [-360, 360], z: [-20000, 5000], volume: [-60, 12] } as const satisfies Partial<Record<AnimatableProp, readonly [number, number]>>

/** A value brought within what its property can be. */
export function inRange(prop: AnimatableProp, value: number): number {
  const range = (PROP_RANGE as Partial<Record<AnimatableProp, readonly [number, number]>>)[prop]
  return range ? clamp(value, range[0], range[1]) : value
}

/** The static (un-animated) value of a property. */
export function baseValue(clip: Clip, prop: AnimatableProp): number {
  if (prop === 'volume') return clip.audio.volume
  if (prop === 'speed') return clip.speed
  return clip.transform[prop] ?? 0
}

export function evalKeyframes(kfs: Keyframe[], frame: number): number {
  if (frame <= kfs[0].frame) return kfs[0].value
  const last = kfs[kfs.length - 1]
  if (frame >= last.frame) return last.value
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i]
    const b = kfs[i + 1]
    if (frame >= a.frame && frame < b.frame) {
      const t = clamp((frame - a.frame) / (b.frame - a.frame), 0, 1)
      return lerp(a.value, b.value, easeAt(a.easing, t))
    }
  }
  return last.value
}

/** Value of a property at a frame relative to the clip start. */
export function propAt(clip: Clip, prop: AnimatableProp, localFrame: number): number {
  const kfs = clip.keyframes[prop]
  return kfs && kfs.length ? evalKeyframes(kfs, localFrame) : baseValue(clip, prop)
}

export function isAnimated(clip: Clip, prop: AnimatableProp) {
  return Boolean(clip.keyframes[prop]?.length)
}

export function keyframeAt(clip: Clip, prop: AnimatableProp, localFrame: number) {
  return clip.keyframes[prop]?.find((k) => k.frame === localFrame)
}

/** Sorted, de-duplicated keyframe frames across all properties (for timeline diamonds). */
export function allKeyframeFrames(clip: Clip): number[] {
  const set = new Set<number>()
  for (const prop of ANIMATABLE) clip.keyframes[prop]?.forEach((k) => set.add(k.frame))
  return [...set].sort((a, b) => a - b)
}
