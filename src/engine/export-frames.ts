/**
 * The timeline frame that frame `index` of an export shows: an export at `fps` frames a second of a timeline at
 * `timelineFps`, from timeline frame `start` on. A whole number wherever the two rates meet on a frame — always,
 * when they are the same rate — and a point between two frames where they don't.
 *
 * Multiplied before it is divided: both are whole numbers, and so is their product. Divided first, frame 29 of an
 * export at 25 a second was 1.16 s — which times 25 is 28.999999999999996. A hair before frame 29 is still the
 * clip that ends there: at a cut on such a frame (one in twenty at 25 and 50 a second, one in sixty at 30 and 60)
 * the export showed the clip before the cut for one frame more, footage from past where it had been trimmed, and
 * the clip after it a frame late.
 */
export const timelineFrameAt = (index: number, fps: number, timelineFps: number, start = 0) => start + (index * timelineFps) / fps
