/**
 * The timeline's view options and tools, in one menu on the toolbar: what the
 * lanes show, and the dialogs that work on the whole timeline.
 */
import { AudioLines, CircleDot, Clapperboard, Copy, Eraser, GalleryHorizontalEnd, Gauge, GitBranch, GitCompare, LayoutGrid, ListChecks, MonitorPlay, Palette, ScanLine, SeparatorVertical, SlidersHorizontal, StickyNote, Wand } from 'lucide-react'
import { IconButton } from '@/components/ui/button'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { useUI } from '@/editor/ui-store'
import { timelineActions } from './timeline-actions'
import { useTimelineView } from '@/editor/timeline-view'
import { tt } from '@/lib/i18n'

export function TimelineTools() {
  const view = useTimelineView()
  const set = view.set
  return (
    <Menu>
      <MenuTrigger asChild>
        <IconButton label={tt('Timeline view and tools')}>
          <SlidersHorizontal />
        </IconButton>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-[270px]">
        <MenuLabel>{tt('Show')}</MenuLabel>
        <MenuItem icon={<LayoutGrid />} shortcut="shift+s" checked={view.storyboard} onSelect={() => set({ storyboard: !view.storyboard })}>
          {tt('Storyboard')}
        </MenuItem>
        <MenuItem icon={<GalleryHorizontalEnd />} checked={view.minimap} onSelect={() => set({ minimap: !view.minimap })}>
          {tt('Overview strip')}
        </MenuItem>
        <MenuItem icon={<StickyNote />} checked={view.showNotes} onSelect={() => set({ showNotes: !view.showNotes })}>
          {tt('Notes and tasks on clips')}
        </MenuItem>
        <MenuItem icon={<AudioLines />} checked={view.pauseGuides} onSelect={() => set({ pauseGuides: !view.pauseGuides })}>
          {tt('Guides where speech pauses')}
        </MenuItem>
        <MenuItem icon={<ScanLine />} checked={view.cutGuides} onSelect={() => set({ cutGuides: !view.cutGuides })}>
          {tt('Guides at shot cuts')}
        </MenuItem>
        <MenuItem icon={<Copy />} checked={view.showReuse} onSelect={() => set({ showReuse: !view.showReuse })}>
          {tt('Footage used more than once')}
        </MenuItem>
        <MenuItem icon={<Palette />} onSelect={() => set({ colorsOpen: true })}>
          {tt('Clip colours…')}
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>{tt('Tools')}</MenuLabel>
        <MenuItem icon={<SeparatorVertical />} shortcut="t" onSelect={() => timelineActions.toggleTrimMode()}>
          {tt('Trim mode on the nearest cut')}
        </MenuItem>
        <MenuItem icon={<CircleDot />} onSelect={() => set({ macrosOpen: true })}>
          {tt('Macros…')}
        </MenuItem>
        <MenuItem icon={<Clapperboard />} onSelect={() => set({ directorOpen: true })}>
          {tt('Auto-direct a multicam clip…')}
        </MenuItem>
        <MenuItem icon={<GitBranch />} onSelect={() => timelineActions.branch()}>
          {tt('Branch this timeline')}
        </MenuItem>
        <MenuItem icon={<GitCompare />} onSelect={() => set({ compareOpen: true })}>
          {tt('Compare versions…')}
        </MenuItem>
        <MenuItem icon={<Wand />} onSelect={() => timelineActions.openBatch()}>
          {tt('Batch-edit the selected clips')}
        </MenuItem>
        <MenuItem icon={<MonitorPlay />} onSelect={() => timelineActions.openSourceMonitor()}>
          {tt('Source monitor for the selected media')}
        </MenuItem>
        <MenuItem icon={<Eraser />} onSelect={() => set({ cleanup: 'gaps' })}>
          {tt('Clean up gaps and flash frames…')}
        </MenuItem>
        <MenuItem icon={<Gauge />} onSelect={() => set({ cleanup: 'rates' })}>
          {tt('Frame rates of the footage…')}
        </MenuItem>
        <MenuItem icon={<ListChecks />} onSelect={() => useUI.getState().setLeftTab('notes')}>
          {tt('Markers and clip notes')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}
