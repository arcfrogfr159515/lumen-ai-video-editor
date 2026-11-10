/**
 * The storyboard: the timeline as cards, one per clip of the story track, in
 * sections where chapter markers divide it. Reordering is done on whole
 * stretches of the timeline, so a card moves with everything over and under it.
 */
import { chapters } from './markers'
import { clipEnd, clipsOnTrack, isMagnetic } from './ops'
import type { Frame, Project, Track } from './types'

export interface StoryCard {
  clipId: string
  /** Its number in the film, from 1. */
  number: number
  start: Frame
  end: Frame
  sectionId: string
}

export interface StorySection {
  /** The chapter marker that starts it; 'opening' for what comes before the first chapter, 'all' when there are none. */
  id: string
  markerId?: string
  title: string
  start: Frame
  end: Frame
  cards: StoryCard[]
}

/** The track whose clips tell the story: the main track, else the lowest video track that has clips. */
export function storyTrack(project: Pick<Project, 'tracks' | 'clips'>): Track | undefined {
  const main = project.tracks.find((t) => t.role === 'main')
  if (main) return main
  const used = new Set(Object.values(project.clips).map((c) => c.trackId))
  return [...project.tracks].reverse().find((t) => t.kind === 'video' && t.role !== 'titles' && t.role !== 'captions' && used.has(t.id))
}

/** The story track's clips as cards, in sections. A film with no chapters is one section. */
export function storyboard(project: Pick<Project, 'tracks' | 'clips' | 'markers'>): StorySection[] {
  const track = storyTrack(project)
  const clips = track ? clipsOnTrack(project, track.id) : []
  const end = clips.length ? clipEnd(clips[clips.length - 1]) : 0
  const marks = chapters(project)
  const sections: StorySection[] = marks.length
    ? marks.map((c) => ({ id: c.markerId ?? 'opening', ...(c.markerId ? { markerId: c.markerId } : {}), title: c.title, start: c.start, end: c.end, cards: [] }))
    : [{ id: 'all', title: '', start: 0, end, cards: [] }]
  clips.forEach((clip, i) => {
    // A card belongs to the section it starts in.
    const section = sections.find((s) => clip.start >= s.start && clip.start < s.end) ?? sections[sections.length - 1]
    section.cards.push({ clipId: clip.id, number: i + 1, start: clip.start, end: clipEnd(clip), sectionId: section.id })
  })
  return sections
}

export const storyCards = (sections: readonly StorySection[]): StoryCard[] => sections.flatMap((s) => s.cards)


export interface StoryMove {
  /** The stretch of the timeline to pick up. */
  start: Frame
  end: Frame
  /** Where it goes, as a frame of the timeline as it is now. */
  to: Frame
}

/**
 * The moves that put some cards before another card (or, with `before` null,
 * at the end). Cards that sit side by side travel as one stretch; scattered
 * ones are brought together in the order they had. Each move is given in
 * frames of the timeline as the moves before it leave it. Empty when the
 * cards are already there.
 */
export function cardMoves(sections: readonly StorySection[], clipIds: readonly string[], before: string | null): StoryMove[] {
  const cards = storyCards(sections)
  const moving = cards.filter((c) => clipIds.includes(c.clipId))
  if (!moving.length || (before && clipIds.includes(before))) return []
  const target = before ? cards.find((c) => c.clipId === before) : undefined
  if (before && !target) return []
  // The order the film will be in: the moving cards taken out, then put back before the target.
  const rest = cards.filter((c) => !clipIds.includes(c.clipId))
  const at = target ? rest.indexOf(target) : rest.length
  const wanted = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
  if (wanted.every((c, i) => c === cards[i])) return []

  // Play the reordering out card by card on a list of lengths, noting each stretch that has to travel.
  let order = cards.map((c) => ({ id: c.clipId, length: c.end - c.start }))
  const startOf = (list: typeof order, index: number) => cards[0].start + list.slice(0, index).reduce((n, c) => n + c.length, 0)
  const moves: StoryMove[] = []
  for (let i = 0; i < wanted.length; i++) {
    if (order[i].id === wanted[i].clipId) continue
    // The run of cards that belongs here, as it lies further on.
    const from = order.findIndex((c) => c.id === wanted[i].clipId)
    let run = 1
    while (from + run < order.length && i + run < wanted.length && order[from + run].id === wanted[i + run].clipId) run++
    const start = startOf(order, from)
    const end = startOf(order, from + run)
    moves.push({ start, end, to: startOf(order, i) })
    const taken = order.splice(from, run)
    order.splice(i, 0, ...taken)
  }
  return moves
}

/** The move that puts a whole section before another (or at the end, with `before` null). Null when it is already there. */
export function sectionMove(sections: readonly StorySection[], sectionId: string, before: string | null): StoryMove | null {
  const index = sections.findIndex((s) => s.id === sectionId)
  if (index < 0 || before === sectionId) return null
  const section = sections[index]
  const target = before ? sections.find((s) => s.id === before) : undefined
  if (before && !target) return null
  const to = target ? target.start : sections[sections.length - 1].end
  // Before the section that already follows it, or at the end when it is last: nothing to do.
  if (to === section.end || to === section.start) return null
  return { start: section.start, end: section.end, to }
}

/** Whether a track is one whose clips sit edge to edge, so cards can be reordered freely. */
export const reorderable = (track: Track | undefined) => isMagnetic(track)
