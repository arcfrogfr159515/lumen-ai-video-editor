import { describe, expect, it } from 'vitest'
import { toGray } from './analysis'
import { blendResidual, colorHistogram, contentDelta, cutsFromScores, histogramDelta, sceneCuts, sceneScanner, sceneThresholds, shiftsFromChange, toHsv } from './scenes'
import { crossCorrelate, envelopeOffset, onsetEnvelope, refineOffset } from './sync'
import { followPatch, frameMotion, type Gray } from './tracker'

/** Deterministic noise. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** A smooth random texture (value noise), sampled at any point — so shifted and turned views of it can be made. */
function texture(seed: number, cell = 6) {
  const r = rng(seed)
  const grid = new Float32Array(256 * 256).map(() => r() * 255)
  const at = (x: number, y: number) => grid[(((y % 256) + 256) % 256) * 256 + (((x % 256) + 256) % 256)]
  return (x: number, y: number) => {
    const gx = x / cell
    const gy = y / cell
    const x0 = Math.floor(gx)
    const y0 = Math.floor(gy)
    const fx = gx - x0
    const fy = gy - y0
    const top = at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx
    const bottom = at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx
    return top * (1 - fy) + bottom * fy
  }
}

function image(width: number, height: number, fn: (x: number, y: number) => number): Gray {
  const data = new Float32Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data[y * width + x] = fn(x, y)
  return { data, width, height }
}

describe('scene detection', () => {
  it('measures colour change between frames', () => {
    const red = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 255])
    const blue = new Uint8ClampedArray([0, 0, 255, 255, 0, 0, 255, 255])
    expect(contentDelta(toHsv(red), toHsv(red))).toBe(0)
    // Hue 0 vs 120 (a third of the wheel), same saturation and value.
    expect(contentDelta(toHsv(red), toHsv(blue))).toBeCloseTo(60 / 3 + 0, 5)
  })

  it('finds jumps well above their neighbours, not steady motion', () => {
    const r = rng(3)
    const scores = Array.from({ length: 300 }, (_, i) => (i === 0 ? 0 : 4 + r() * 3))
    // Cuts at 50 and 180; a long burst of fast motion (high but steady) from 100 to 140.
    scores[50] = 60
    scores[180] = 40
    for (let i = 100; i < 140; i++) scores[i] = 30 + r() * 4
    const { ratio, minContent } = sceneThresholds(50)
    expect(cutsFromScores(scores, { ratio, minContent, minGap: 15 })).toEqual([50, 180])
    // Two cuts closer than the shortest shot count once.
    scores[185] = 50
    expect(cutsFromScores(scores, { ratio, minContent, minGap: 15 })).toEqual([50, 180])
  })

  it('finds a cut through the blur of a transition, and through a blended frame', () => {
    const r = rng(5)
    const scores = Array.from({ length: 200 }, (_, i) => (i === 0 ? 0 : 5 + r() * 2))
    // A zoom blur building up to the cut at 60 and settling after it.
    ;[12, 19, 25, 32, 50, 13, 12, 10].forEach((s, k) => (scores[56 + k] = s))
    // A cut through one frame that is half of each shot: two jumps side by side.
    scores[130] = 30
    scores[131] = 34
    const { ratio, minContent } = sceneThresholds(50)
    expect(cutsFromScores(scores, { ratio, minContent, minGap: 15 })).toEqual([60, 131])
  })

  it('leaves out a flash the picture comes back from, and slivers at either end', () => {
    const scores: number[] = Array.from({ length: 120 }, (_, i) => (i === 0 ? 0 : 5))
    const stays: number[] = scores.map(() => 5)
    const jump = (i: number, left: number) => {
      scores[i] = 45
      stays[i] = left
    }
    // A cut at 40: the frames after it are as far from the frames before as the jump was.
    jump(40, 44)
    // One bright frame at 80: frame 81 looks like frame 79 again.
    jump(80, 9)
    jump(81, 9)
    // Jumps a few frames from either end.
    jump(4, 45)
    jump(116, 45)
    const opts = { ...sceneThresholds(50), minGap: 15 }
    expect(cutsFromScores(scores, { ...opts, stays })).toEqual([40])
    expect(cutsFromScores(scores, opts)).toEqual([40, 80])
  })

  it('reads a frame’s colour make-up, which moving the picture leaves alone', () => {
    const picture = (...colours: [number, number, number][]) => new Uint8ClampedArray(colours.flatMap((c) => [...c, 255]))
    const red: [number, number, number] = [255, 0, 0]
    const blue: [number, number, number] = [0, 0, 255]
    const green: [number, number, number] = [0, 255, 0]
    const one = toHsv(picture(red, red, blue, blue))
    const mirrored = toHsv(picture(blue, blue, red, red))
    expect(contentDelta(one, mirrored)).toBeGreaterThan(10)
    expect(histogramDelta(colorHistogram(one), colorHistogram(mirrored))).toBe(0)
    expect(histogramDelta(colorHistogram(one), colorHistogram(toHsv(picture(green, green, green, green))))).toBe(1)
    expect(histogramDelta(colorHistogram(one), colorHistogram(toHsv(picture(red, red, red, blue))))).toBeCloseTo(0.25, 6)
    // Greys have no hue: whatever toHsv makes of theirs, they count as the same colour.
    const grey = colorHistogram(Float32Array.from([10, 0, 128, 170, 0, 128]))
    expect(Math.max(...grey)).toBe(1)
  })

  it('tells the frame half-way through a dissolve from one either side of a cut', () => {
    const a = Float32Array.from([10, 200, 60, 90])
    const b = Float32Array.from([210, 40, 160, 30])
    const mean = a.map((v, k) => (v + b[k]) / 2)
    expect(blendResidual(a, mean, b)).toBe(0)
    expect(blendResidual(a, a, b)).toBeCloseTo(0.5, 6)
    expect(blendResidual(a, b, b)).toBeCloseTo(0.5, 6)
    // The same picture at both ends: nothing to judge by.
    expect(blendResidual(a, mean, a)).toBe(1)
  })

  it('finds transitions in how the colours change over a span', () => {
    const span = 12
    const change: number[] = new Array(400).fill(0.03)
    const raise = (from: number, to: number, value: number) => change.fill(value, from, to + 1)
    // A cut at 50: frames 50 to 61 are compared with frames of the shot before.
    raise(50, 61, 0.6)
    // A dissolve over frames 120 to 131: the change builds while it lasts and falls away over the span after.
    for (let k = 0; k < 12; k++) {
      change[120 + k] = 0.03 + (0.5 * (k + 1)) / 12
      change[132 + k] = 0.03 + 0.5 * (1 - (k + 1) / 12)
    }
    // Three odd frames: they pass.
    raise(200, 202, 0.7)
    // Someone walking up to the lens: the colours keep changing for over a second.
    raise(260, 300, 0.4)
    // A wipe at 340, with a shoulder that is no change of its own.
    raise(340, 351, 0.66)
    raise(352, 356, 0.32)
    const shifts = shiftsFromChange(change, { span, min: 0.3 })
    expect(shifts.map((s) => s.at)).toEqual([50, 125, 340])
    expect(shifts[0]).toMatchObject({ from: 50, to: 61, peak: 0.6 })
  })

  it('takes a slow change of colours for a dissolve only when its frames blend', () => {
    const span = 12
    const change: number[] = new Array(300).fill(0.02)
    // A second-long dissolve from frame 100: the colours change for as long, and for the span after.
    change.fill(0.35, 100, 142)
    const blend: number[] = new Array(300).fill(0.9)
    expect(shiftsFromChange(change, { span, min: 0.3, blend, maxWidth: 60 })).toEqual([])
    blend.fill(0.1, 118, 137)
    expect(shiftsFromChange(change, { span, min: 0.3, blend, maxWidth: 60 }).map((s) => s.at)).toEqual([115])
    expect(shiftsFromChange(change, { span, min: 0.3, blend, maxWidth: 30 })).toEqual([])
    expect(shiftsFromChange(change, { span, min: 0.3 })).toEqual([])
  })

  describe('from frames', () => {
    const W = 16
    const H = 12
    /** A frame of two flat colours side by side, with a little noise — and optionally lit up, or mixed with another. */
    function frame(left: number[], right: number[], noise: () => number, lift = 0): Uint8ClampedArray {
      const rgba = new Uint8ClampedArray(W * H * 4)
      for (let i = 0; i < W * H; i++) {
        const c = i % W < W / 2 ? left : right
        for (let k = 0; k < 3; k++) rgba[i * 4 + k] = c[k] + lift + (noise() - 0.5) * 6
        rgba[i * 4 + 3] = 255
      }
      return rgba
    }
    const mix = (a: number[], b: number[], t: number) => a.map((v, k) => v + (b[k] - v) * t)
    const A = [[200, 40, 40], [30, 30, 120]]
    const B = [[40, 180, 60], [220, 220, 60]]
    const C = [[150, 60, 200], [235, 235, 235]]

    /** 200 frames: shot A with one flash frame at 30, a cut to B at 60, B dissolving into C over frames 120 to 131. */
    function film() {
      const r = rng(9)
      return Array.from({ length: 200 }, (_, i) => {
        if (i < 60) return frame(A[0], A[1], r, i === 30 ? 150 : 0)
        if (i < 120) return frame(B[0], B[1], r)
        const t = Math.min(1, (i - 119) / 13)
        return frame(mix(B[0], C[0], t), mix(B[1], C[1], t), r)
      })
    }

    it('reads the same signals as comparing whole frames would', () => {
      const span = 5
      const frames = film().slice(20, 80)
      const scanner = sceneScanner(span)
      frames.forEach((f) => scanner.add(f))
      const { scores, stays, change, blend } = scanner.signals()
      const hsv = frames.map((f) => toHsv(f))
      const gray = frames.map((f) => toGray(f))
      const d = (a: number, b: number) => contentDelta(hsv[a], hsv[b])
      for (const i of [1, 2, 3, 9, 10, 11, 12, 39, 40, 41, 57, 58, 59]) {
        expect(scores[i]).toBeCloseTo(d(i - 1, i), 9)
        const around = [i >= 2 ? d(i - 2, i) : Infinity, i >= 3 ? d(i - 3, i) : Infinity, i + 1 < 60 ? d(i - 1, i + 1) : Infinity, i + 2 < 60 ? d(i - 1, i + 2) : Infinity]
        expect(stays![i]).toBeCloseTo(Math.min(...around), 9)
        expect(change![i]).toBeCloseTo(i >= span ? histogramDelta(colorHistogram(hsv[i - span]), colorHistogram(hsv[i])) : 0, 9)
        expect(blend![i]).toBeCloseTo(i >= 2 * span ? blendResidual(gray[i - 2 * span], gray[i - span], gray[i]) : 1, 9)
      }
    })

    it('splits at the cut and in the dissolve, not at the flash', () => {
      const span = 12
      const scanner = sceneScanner(span)
      film().forEach((f) => scanner.add(f))
      const signals = scanner.signals()
      const opts = { ...sceneThresholds(50), span, minGap: 18 }
      const cuts = sceneCuts(signals, opts)
      expect(cuts).toHaveLength(2)
      expect(cuts[0]).toBe(60)
      expect(cuts[1]).toBeGreaterThanOrEqual(122)
      expect(cuts[1]).toBeLessThanOrEqual(130)
      // The flash is a jump like the cut — it is what comes after that tells them apart.
      expect(signals.scores[30]).toBeGreaterThan(sceneThresholds(50).minContent)
      expect(cutsFromScores(signals.scores, { ...opts, minGap: 1 })).toContain(30)
      // Without the colours only the cut is found: nothing jumps in a dissolve.
      expect(sceneCuts({ scores: signals.scores, stays: signals.stays }, opts)).toEqual([60])
    })
  })
})

describe('audio sync', () => {
  it('cross-correlates like the direct sum', () => {
    const r = rng(7)
    const a = Float32Array.from({ length: 37 }, () => r() - 0.5)
    const b = Float32Array.from({ length: 11 }, () => r() - 0.5)
    const c = crossCorrelate(a, b)
    for (const k of [-10, -3, 0, 5, 26, 36]) {
      let s = 0
      for (let n = 0; n < b.length; n++) if (n + k >= 0 && n + k < a.length) s += a[n + k] * b[n]
      expect(c[k + b.length - 1]).toBeCloseTo(s, 9)
    }
  })

  it('finds how far one recording is from another by their sound', () => {
    const rate = 8000
    const r = rng(11)
    // A room: claps and speech-like bursts over noise, 30 s long.
    const room = new Float32Array(rate * 30)
    for (let i = 0; i < room.length; i++) room[i] = (r() - 0.5) * 0.01
    for (let k = 0; k < 40; k++) {
      const at = Math.floor(r() * (room.length - rate))
      const len = Math.floor(rate * (0.05 + r() * 0.3))
      for (let i = 0; i < len; i++) room[at + i] += Math.sin(i * 0.3 * (1 + k % 5)) * Math.exp(-i / (len / 3)) * 0.5
    }
    // Camera B started 3.217 s after camera A, recorded 20 s, quieter and noisier.
    const lag = Math.round(3.217 * rate)
    const b = new Float32Array(rate * 20)
    for (let i = 0; i < b.length; i++) b[i] = room[i + lag] * 0.3 + (r() - 0.5) * 0.004
    const coarse = envelopeOffset(onsetEnvelope(room, rate, 100), onsetEnvelope(b, rate, 100), 100)
    expect(Math.abs(coarse.offset - 3.217)).toBeLessThan(0.015)
    expect(coarse.confidence).toBeGreaterThan(8)
    const fine = refineOffset(onsetEnvelope(room, rate, 1000), onsetEnvelope(b, rate, 1000), 1000, coarse.offset, 0.03)
    expect(Math.abs(fine - 3.217)).toBeLessThan(0.003)
    // The other way round: A starts 3.217 s into B's timeline would be negative.
    const back = envelopeOffset(onsetEnvelope(b, rate, 100), onsetEnvelope(room, rate, 100), 100)
    expect(Math.abs(back.offset + 3.217)).toBeLessThan(0.015)
  })
})

describe('motion tracking', () => {
  it('follows a textured patch moving over a textured background', () => {
    const bg = texture(1, 9)
    const obj = texture(2, 3)
    const W = 320
    const H = 180
    const frames = Array.from({ length: 40 }, (_, i) => {
      // The object (a 30×30 square) moves right and down on a curve, with sub-pixel steps.
      const ox = 60 + i * 3.4
      const oy = 50 + 25 * Math.sin(i / 8)
      return {
        t: i / 30,
        gray: image(W, H, (x, y) => (x >= ox && x < ox + 30 && y >= oy && y < oy + 30 ? obj(x - ox, y - oy) : bg(x, y) * 0.8)),
        truth: [(ox + 15) / W, (oy + 15) / H],
      }
    })
    const box = { x: 75 / W, y: 65 / H, w: 30 / W, h: 30 / H }
    const path = followPatch(frames, box)
    expect(path).toHaveLength(40)
    for (let i = 0; i < 40; i += 7) {
      expect(Math.abs(path[i].x - frames[i].truth[0]) * W).toBeLessThan(1)
      expect(Math.abs(path[i].y - frames[i].truth[1]) * H).toBeLessThan(1)
    }
  })

  it('measures camera shift and turn, ignoring something moving on its own', () => {
    const scene = texture(5, 7)
    const W = 320
    const H = 180
    const view = (dx: number, dy: number, angle: number, walker?: number) =>
      image(W, H, (x, y) => {
        if (walker !== undefined && x > walker && x < walker + 40 && y > 60 && y < 120) return 255 - scene(x * 3, y * 3)
        // What the camera sees: the scene shifted and turned about the frame centre.
        const cx = x - W / 2
        const cy = y - H / 2
        const c = Math.cos(-angle)
        const s = Math.sin(-angle)
        return scene(cx * c - cy * s + W / 2 - dx, cx * s + cy * c + H / 2 - dy)
      })
    const m = frameMotion(view(0, 0, 0, 100), view(2.5, -1.5, 0.01, 110))
    expect(m.dx).toBeCloseTo(2.5, 0)
    expect(m.dy).toBeCloseTo(-1.5, 0)
    expect(m.angle).toBeCloseTo(0.01, 2)
    expect(m.used).toBeGreaterThan(20)
  })
})
