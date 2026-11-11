import type {
  AnimPreset,
  ClipAnimation,
  ColorGrade,
  EffectKind,
  TextStyle,
  TransitionKind,
  Transform,
} from './types'
import { tt } from '@/lib/i18n'

// ─── Looks (color presets) ───────────────────────────────────────────────

export interface Look {
  id: string
  name: string
  grade: ColorGrade
}

const g = (p: Partial<ColorGrade>): ColorGrade => ({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  tint: 0,
  vignette: 0,
  ...p,
})

export const LOOKS: Look[] = [
  { id: 'natural', name: tt('Natural'), grade: g({}) },
  { id: 'cinematic', name: tt('Cinematic'), grade: g({ exposure: -4, contrast: 22, saturation: -6, temperature: 8, tint: -6, vignette: 30 }) },
  { id: 'golden', name: tt('Golden Hour'), grade: g({ exposure: 6, contrast: 8, saturation: 14, temperature: 42, tint: 6, vignette: 12 }) },
  { id: 'nordic', name: tt('Nordic'), grade: g({ exposure: 2, contrast: 10, saturation: -24, temperature: -30, tint: -4 }) },
  { id: 'vivid', name: tt('Vivid'), grade: g({ contrast: 14, saturation: 38 }) },
  { id: 'faded', name: tt('Faded Film'), grade: g({ exposure: 8, contrast: -26, saturation: -18, temperature: 10, vignette: 18 }) },
  { id: 'moody', name: tt('Moody'), grade: g({ exposure: -14, contrast: 24, saturation: -22, temperature: -12, vignette: 48 }) },
  { id: 'dream', name: tt('Dream'), grade: g({ exposure: 12, contrast: -14, saturation: 12, tint: 18, temperature: 6 }) },
  { id: 'noir', name: tt('Noir'), grade: g({ contrast: 38, saturation: -100, vignette: 44 }) },
  { id: 'teal', name: tt('Teal Night'), grade: g({ exposure: -6, contrast: 16, saturation: 6, temperature: -40, tint: -14, vignette: 26 }) },
]

// ─── Transitions ─────────────────────────────────────────────────────────

export const TRANSITIONS: { kind: TransitionKind; name: string; description: string; is3d?: boolean }[] = [
  { kind: 'dissolve', name: tt('Cross Dissolve'), description: tt('Blend smoothly between shots') },
  { kind: 'dip', name: tt('Dip to Black'), description: tt('Fade out, then in') },
  { kind: 'flash', name: tt('Flash'), description: tt('Bright white pop on the cut') },
  { kind: 'slide', name: tt('Slide'), description: tt('Next shot slides over') },
  { kind: 'push', name: tt('Push'), description: tt('Next shot pushes the last away') },
  { kind: 'zoom', name: tt('Zoom'), description: tt('Punch in to the next shot') },
  { kind: 'wipe', name: tt('Wipe'), description: tt('Soft-edged horizontal wipe') },
  { kind: 'blur', name: tt('Blur'), description: tt('Defocus through the cut') },
  { kind: 'cube', name: tt('Cube'), description: tt('Rotate to the next face'), is3d: true },
  { kind: 'flip', name: tt('Flip'), description: tt('Turn the shot over like a card'), is3d: true },
  { kind: 'door', name: tt('Doorway'), description: tt('Doors swing open onto the next shot'), is3d: true },
  { kind: 'swing', name: tt('Swing In'), description: tt('Next shot drops in on a hinge'), is3d: true },
  { kind: 'page', name: tt('Page Curl'), description: tt('Peel the shot away like paper'), is3d: true },
  { kind: 'warp', name: tt('Warp Zoom'), description: tt('Fly through into the next shot'), is3d: true },
  { kind: 'shatter', name: tt('Shatter'), description: tt('Burst into pieces'), is3d: true },
  { kind: 'spin', name: tt('3D Spin'), description: tt('Spin away in depth'), is3d: true },
]

export const is3dTransition = (kind: TransitionKind) => TRANSITIONS.some((t) => t.kind === kind && t.is3d)

// ─── Effects ─────────────────────────────────────────────────────────────

export const EFFECTS: { kind: EffectKind; name: string; description: string; amount: number; is3d?: boolean; params?: Record<string, number | string> }[] = [
  { kind: 'blur', name: tt('Gaussian Blur'), description: tt('Soften the whole frame'), amount: 30 },
  { kind: 'glow', name: tt('Glow'), description: tt('Dreamy highlight bloom'), amount: 45 },
  { kind: 'vignette', name: tt('Vignette'), description: tt('Darken the edges'), amount: 50 },
  { kind: 'grain', name: tt('Film Grain'), description: tt('Organic 16mm texture'), amount: 40 },
  { kind: 'mono', name: tt('Monochrome'), description: tt('Rich black & white'), amount: 100 },
  { kind: 'shake', name: tt('Camera Shake'), description: tt('Handheld energy'), amount: 35 },
  { kind: 'pulse', name: tt('Zoom Pulse'), description: tt('Beat-synced punch-in'), amount: 40 },
  { kind: 'leak', name: tt('Light Leak'), description: tt('Warm drifting flare'), amount: 55 },
  { kind: 'rgb', name: tt('RGB Split'), description: tt('Chromatic glitch offset'), amount: 30 },
  { kind: 'sharpen', name: tt('Sharpen'), description: tt('Crisp up soft footage'), amount: 40 },
  { kind: 'chromaKey', name: tt('Chroma Key'), description: tt('Remove a green or blue screen'), amount: 100, params: { color: '#00d84a', tolerance: 32, softness: 18, spill: 60 } },
  { kind: 'lumaKey', name: tt('Luma Key'), description: tt('Drop out the black (or white)'), amount: 100, params: { threshold: 18, softness: 12, invert: 0 } },
  { kind: 'tilt3d', name: tt('3D Tilt'), description: tt('Floating card with depth'), amount: 60, is3d: true },
  { kind: 'curve3d', name: tt('Curved Screen'), description: tt('Wrap the shot like a cinema screen'), amount: 55, is3d: true },
  { kind: 'wave3d', name: tt('Flag Wave'), description: tt('Ripples like fabric in the wind'), amount: 45, is3d: true },
  { kind: 'cube3d', name: tt('Photo Cube'), description: tt('Your shot on a spinning cube'), amount: 60, is3d: true },
  { kind: 'mirror3d', name: tt('Reflection'), description: tt('Stand on a glossy floor'), amount: 60, is3d: true },
]

export const is3dEffect = (kind: EffectKind) => EFFECTS.some((e) => e.kind === kind && e.is3d)

// ─── Animations ──────────────────────────────────────────────────────────

export const ANIMATIONS: { preset: AnimPreset; name: string; textOnly?: boolean }[] = [
  { preset: 'none', name: tt('None') },
  { preset: 'fade', name: tt('Fade') },
  { preset: 'rise', name: tt('Rise') },
  { preset: 'drop', name: tt('Drop') },
  { preset: 'pop', name: tt('Pop') },
  { preset: 'zoom', name: tt('Zoom') },
  { preset: 'blur', name: tt('Blur') },
  { preset: 'wipe', name: tt('Wipe') },
  { preset: 'typewriter', name: tt('Typewriter'), textOnly: true },
  { preset: 'spin3d', name: tt('3D Spin') },
  { preset: 'flip3d', name: tt('3D Flip') },
]

// ─── Speed ramps ─────────────────────────────────────────────────────────

/** Speed-ramp shapes: the speed at positions 0 (clip start) to 1 (clip end). */
export const SPEED_RAMPS: { id: string; name: string; description: string; points: { at: number; speed: number }[] }[] = [
  { id: 'montage', name: tt('Montage'), description: tt('Bursts of speed around a slow beat'), points: [{ at: 0, speed: 1 }, { at: 0.22, speed: 3 }, { at: 0.5, speed: 0.5 }, { at: 0.78, speed: 3 }, { at: 1, speed: 1 }] },
  { id: 'hero', name: tt('Hero'), description: tt('Fast in, slow-motion moment, fast out'), points: [{ at: 0, speed: 2 }, { at: 0.38, speed: 2 }, { at: 0.5, speed: 0.3 }, { at: 0.62, speed: 2 }, { at: 1, speed: 2 }] },
  { id: 'bullet', name: tt('Bullet'), description: tt('Racing, then time nearly stops, then racing'), points: [{ at: 0, speed: 4 }, { at: 0.4, speed: 0.2 }, { at: 0.6, speed: 0.2 }, { at: 1, speed: 4 }] },
  { id: 'flash-in', name: tt('Flash in'), description: tt('Starts fast and settles to real time'), points: [{ at: 0, speed: 5 }, { at: 0.35, speed: 1 }, { at: 1, speed: 1 }] },
  { id: 'flash-out', name: tt('Flash out'), description: tt('Real time, then whips away fast'), points: [{ at: 0, speed: 1 }, { at: 0.65, speed: 1 }, { at: 1, speed: 5 }] },
  { id: 'ramp-up', name: tt('Speed up'), description: tt('Slow motion building to fast'), points: [{ at: 0, speed: 0.5 }, { at: 1, speed: 3 }] },
  { id: 'ramp-down', name: tt('Slow down'), description: tt('Fast easing into slow motion'), points: [{ at: 0, speed: 3 }, { at: 1, speed: 0.4 }] },
]

// ─── Title presets ───────────────────────────────────────────────────────

export interface TitlePreset {
  id: string
  name: string
  sample: string
  text: Partial<TextStyle>
  transform?: Partial<Transform>
  animation?: Partial<ClipAnimation>
  /** seconds */
  duration: number
  is3d?: boolean
}

export const TITLE_PRESETS: TitlePreset[] = [
  {
    id: 'cinematic',
    name: tt('Cinematic'),
    sample: tt('YOUR TITLE'),
    text: { font: 'sans', size: 104, weight: 500, uppercase: true, letterSpacing: 0.42, shadow: 0.45 },
    animation: { in: { preset: 'blur', duration: 24 }, out: { preset: 'fade', duration: 18 } },
    duration: 4,
  },
  {
    id: 'elegant',
    name: tt('Elegant Serif'),
    sample: tt('Your story'),
    text: { font: 'serif', size: 128, weight: 400, italic: true, letterSpacing: -0.01, shadow: 0.4 },
    animation: { in: { preset: 'rise', duration: 24 }, out: { preset: 'fade', duration: 18 } },
    duration: 4,
  },
  {
    id: 'headline',
    name: tt('Bold Headline'),
    sample: tt('Big news'),
    text: { font: 'display', size: 150, weight: 800, letterSpacing: -0.03, shadow: 0.3 },
    animation: { in: { preset: 'pop', duration: 14 }, out: { preset: 'zoom', duration: 12 } },
    duration: 3,
  },
  {
    id: 'lower-third',
    name: tt('Lower Third'),
    sample: tt('Your Name'),
    text: { font: 'sans', size: 44, weight: 600, align: 'left', background: 'rgba(12,12,16,0.72)', shadow: 0 },
    transform: { x: -520, y: 360 },
    animation: { in: { preset: 'wipe', duration: 16 }, out: { preset: 'fade', duration: 12 } },
    duration: 4,
  },
  {
    id: 'subtitle',
    name: tt('Subtitle'),
    sample: tt('Your caption here.'),
    text: { font: 'sans', size: 46, weight: 500, background: 'rgba(0,0,0,0.55)', shadow: 0 },
    transform: { y: 400 },
    animation: { in: { preset: 'fade', duration: 6 }, out: { preset: 'fade', duration: 6 } },
    duration: 2.5,
  },
  {
    id: 'neon',
    name: tt('Neon Glow'),
    sample: tt('After dark'),
    text: { font: 'display', size: 120, weight: 700, color: '#f6ecff', glow: '#b28cff', shadow: 0 },
    animation: { in: { preset: 'zoom', duration: 18 }, out: { preset: 'fade', duration: 14 } },
    duration: 3,
  },
  {
    id: 'handwritten',
    name: tt('Handwritten'),
    sample: tt('see you soon'),
    text: { font: 'hand', size: 140, weight: 500, color: '#fff3e0', shadow: 0.35 },
    animation: { in: { preset: 'typewriter', duration: 36 }, out: { preset: 'fade', duration: 18 } },
    duration: 4,
  },
  {
    id: '3d-chrome',
    name: tt('3D Chrome'),
    sample: 'TITLE',
    text: { font: 'sans', size: 150, weight: 800, uppercase: true, letterSpacing: 0.04, extrude: 0.32, material: 'chrome', bevel: true, shadow: 0 },
    animation: { in: { preset: 'spin3d', duration: 30 }, out: { preset: 'fade', duration: 14 } },
    duration: 4,
    is3d: true,
  },
  {
    id: '3d-gold',
    name: tt('3D Gold'),
    sample: tt('Premiere'),
    text: { font: 'serif', size: 170, weight: 400, italic: true, extrude: 0.22, material: 'gold', bevel: true, shadow: 0 },
    animation: { in: { preset: 'flip3d', duration: 30 }, out: { preset: 'fade', duration: 14 } },
    duration: 4,
    is3d: true,
  },
  {
    id: '3d-block',
    name: tt('3D Block'),
    sample: 'BOLD',
    text: { font: 'display', size: 190, weight: 800, uppercase: true, extrude: 0.5, material: 'matte', color: '#d6ee00', bevel: true, shadow: 0 },
    animation: { in: { preset: 'pop', duration: 16 }, out: { preset: 'zoom', duration: 12 } },
    duration: 3,
    is3d: true,
  },
  {
    id: 'chapter',
    name: tt('Chapter'),
    sample: tt('CHAPTER 01'),
    text: { font: 'mono', size: 34, weight: 500, uppercase: true, letterSpacing: 0.28, color: '#ffffffd9', align: 'left', shadow: 0.4 },
    transform: { x: -560, y: 400 },
    animation: { in: { preset: 'typewriter', duration: 28 }, out: { preset: 'fade', duration: 12 } },
    duration: 3.5,
  },
]
