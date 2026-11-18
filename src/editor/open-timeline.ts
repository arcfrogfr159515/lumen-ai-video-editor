/**
 * Which timeline is open — to ask, minutes later, whether it still is. Work that takes that long (a render, a
 * transcription) is asked for on one timeline and ends with an edit; by then the user may have opened another
 * timeline of the project, or another project. The edit belongs on the timeline it was asked for, or on none.
 */
import { openSequenceId } from './sequences'
import { getProject } from './store'

export interface TimelineRef {
  project: string
  timeline: string
}

/** The timeline that is open now. */
export function whichTimeline(): TimelineRef {
  const p = getProject()
  return { project: p.id, timeline: openSequenceId(p) }
}

/** Whether that timeline is the open one still. */
export function stillOpen(where: TimelineRef) {
  const p = getProject()
  return p.id === where.project && openSequenceId(p) === where.timeline
}
