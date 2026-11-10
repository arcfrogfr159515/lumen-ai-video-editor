/**
 * The timeline's view options and tools, in one menu on the toolbar: what the
 * lanes show, and the dialogs that work on the whole timeline.
 */
import { AudioLines, Copy, Eraser, GalleryHorizontalEnd, Gauge, ListChecks, Palette, ScanLine, SlidersHorizontal, StickyNote } from 'lucide-react'
import { IconButton } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { useUI } from '@/editor/ui-store'
import { useTimelineView } from '@/editor/timeline-view'

export function TimelineTools() {
  const view = useTimelineView()
  const set = view.set
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label="Timeline view and tools">
          <SlidersHorizontal />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-[270px]">
        <MenuLabel>Show</MenuLabel>
        <MenuItem icon={<GalleryHorizontalEnd />} checked={view.minimap} onSelect={() => set({ minimap: !view.minimap })}>
          Overview strip
        </MenuItem>
        <MenuItem icon={<StickyNote />} checked={view.showNotes} onSelect={() => set({ showNotes: !view.showNotes })}>
          Notes and tasks on clips
        </MenuItem>
        <MenuItem icon={<AudioLines />} checked={view.pauseGuides} onSelect={() => set({ pauseGuides: !view.pauseGuides })}>
          Guides where speech pauses
        </MenuItem>
        <MenuItem icon={<ScanLine />} checked={view.cutGuides} onSelect={() => set({ cutGuides: !view.cutGuides })}>
          Guides at shot cuts
        </MenuItem>
        <MenuItem icon={<Copy />} checked={view.showReuse} onSelect={() => set({ showReuse: !view.showReuse })}>
          Footage used more than once
        </MenuItem>
        <MenuItem icon={<Palette />} onSelect={() => set({ colorsOpen: true })}>
          Clip colours…
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Tools</MenuLabel>
        <MenuItem icon={<Eraser />} onSelect={() => set({ cleanup: 'gaps' })}>
          Clean up gaps and flash frames…
        </MenuItem>
        <MenuItem icon={<Gauge />} onSelect={() => set({ cleanup: 'rates' })}>
          Frame rates of the footage…
        </MenuItem>
        <MenuItem icon={<ListChecks />} onSelect={() => useUI.getState().setLeftTab('notes')}>
          Markers and clip notes
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
