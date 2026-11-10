/**
 * How the timeline is shown and which of its tools are open: view preferences
 * that are remembered between sessions, and dialogs that are not.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { MarkerFilter } from '@/editor/markers'

/** The pane of the clean-up dialog. */
export type CleanupTab = 'gaps' | 'reuse' | 'rates'

interface TimelineViewState {
  /** The timeline as cards instead of lanes. */
  storyboard: boolean
  /** The overview strip above the ruler: the whole timeline, with the part on screen marked. */
  minimap: boolean
  /** Guide lines (and snap targets) where speech pauses. */
  pauseGuides: boolean
  /** Guide lines (and snap targets) at the shot cuts found inside clips. */
  cutGuides: boolean
  /** Stripes on footage that plays more than once. */
  showReuse: boolean
  /** Notes and open tasks shown on the clips. */
  showNotes: boolean
  /** The marker kinds shown on the ruler and in the list (empty: all of them). */
  markerKinds: MarkerFilter[]
  /** Hide to-dos that are ticked off. */
  hideDone: boolean

  colorsOpen: boolean
  cleanup: CleanupTab | null
  compareOpen: boolean
  macrosOpen: boolean
  directorOpen: boolean
  batchOpen: boolean
  /** The source monitor, with the media it shows. */
  sourceMonitor: { assetId: string } | null

  set: (patch: Partial<Omit<TimelineViewState, 'set' | 'toggleMarkerKind'>>) => void
  toggleMarkerKind: (kind: MarkerFilter) => void
}

export const useTimelineView = create<TimelineViewState>()(
  persist(
    (set) => ({
      storyboard: false,
      minimap: true,
      pauseGuides: true,
      cutGuides: true,
      showReuse: false,
      showNotes: true,
      markerKinds: [],
      hideDone: false,

      colorsOpen: false,
      cleanup: null,
      compareOpen: false,
      macrosOpen: false,
      directorOpen: false,
      batchOpen: false,
      sourceMonitor: null,

      set: (patch) => set(patch),
      toggleMarkerKind: (kind) => set((s) => ({ markerKinds: s.markerKinds.includes(kind) ? s.markerKinds.filter((k) => k !== kind) : [...s.markerKinds, kind] })),
    }),
    {
      name: 'lumen.timeline-view.v1',
      partialize: (s) => ({
        storyboard: s.storyboard,
        minimap: s.minimap,
        pauseGuides: s.pauseGuides,
        cutGuides: s.cutGuides,
        showReuse: s.showReuse,
        showNotes: s.showNotes,
        markerKinds: s.markerKinds,
        hideDone: s.hideDone,
      }),
    },
  ),
)

export const timelineView = () => useTimelineView.getState()
