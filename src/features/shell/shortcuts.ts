import { openRecorder } from '@/capture/recorder'
import { playback } from '@/editor/playback'
import { timelineView } from '@/editor/timeline-view'
import { useUI } from '@/editor/ui-store'
import { timelineActions } from '@/features/timeline/timeline-actions'
import { actions } from './actions'
import { tt } from '@/lib/i18n'
import { defineShortcuts } from '@/lib/keybindings'

export interface Shortcut {
  id: string
  label: string
  group: 'Playback' | 'Editing' | 'Multicam' | 'Tools' | 'View' | 'App'
  /**
   * The combos it comes with, e.g. "mod+shift+z"; the first is shown in the UI. The user can move a shortcut to
   * other keys (the shortcuts dialog): what it runs on is `keysOf(id)`, and no two shortcuts come with the same combo.
   */
  keys: string[]
  run: () => void
  /** Also fires while typing in a text field. */
  global?: boolean
}

const ui = () => useUI.getState()

export const SHORTCUTS: Shortcut[] = [
  // Playback
  { id: 'play', label: tt('Play / pause'), group: 'Playback', keys: ['space'], run: () => playback.toggle() },
  { id: 'shuttle-back', label: tt('Play backward (tap to speed up)'), group: 'Playback', keys: ['j'], run: () => playback.shuttle(-1) },
  { id: 'stop', label: tt('Stop'), group: 'Playback', keys: ['k'], run: () => playback.pause() },
  { id: 'shuttle-fwd', label: tt('Play forward (tap to speed up)'), group: 'Playback', keys: ['l'], run: () => playback.shuttle(1) },
  { id: 'prev-frame', label: tt('Previous frame'), group: 'Playback', keys: ['left'], run: () => playback.step(-1) },
  { id: 'next-frame', label: tt('Next frame'), group: 'Playback', keys: ['right'], run: () => playback.step(1) },
  { id: 'back-second', label: tt('Back one second'), group: 'Playback', keys: ['shift+left'], run: () => actions.stepSeconds(-1) },
  { id: 'fwd-second', label: tt('Forward one second'), group: 'Playback', keys: ['shift+right'], run: () => actions.stepSeconds(1) },
  { id: 'play-in-out', label: tt('Play in to out'), group: 'Playback', keys: ['shift+space'], run: actions.playInToOut },
  { id: 'render', label: tt('Render previews in to out (or the whole timeline)'), group: 'Playback', keys: ['enter'], run: actions.renderPreviews },
  { id: 'go-in', label: tt('Go to in point'), group: 'Playback', keys: ['shift+i'], run: actions.goToIn },
  { id: 'go-out', label: tt('Go to out point'), group: 'Playback', keys: ['shift+o'], run: actions.goToOut },
  { id: 'prev-edit', label: tt('Previous edit point'), group: 'Playback', keys: ['up'], run: () => actions.jumpEdit(-1) },
  { id: 'next-edit', label: tt('Next edit point'), group: 'Playback', keys: ['down'], run: () => actions.jumpEdit(1) },
  { id: 'start', label: tt('Go to start'), group: 'Playback', keys: ['home'], run: actions.goToStart },
  { id: 'end', label: tt('Go to end'), group: 'Playback', keys: ['end'], run: actions.goToEnd },
  { id: 'mute-preview', label: tt('Mute / unmute the preview'), group: 'Playback', keys: ['shift+m'], run: () => playback.toggleMute() },

  // Editing
  { id: 'split', label: tt('Split at playhead'), group: 'Editing', keys: ['s', 'mod+b'], run: actions.split },
  { id: 'scene-split', label: tt('Smart scene split'), group: 'Editing', keys: ['alt+s'], run: () => void actions.detectScenes('split') },  { id: 'delete', label: tt('Delete'), group: 'Editing', keys: ['delete', 'backspace'], run: () => actions.deleteSelection(false) },
  { id: 'ripple', label: tt('Ripple delete'), group: 'Editing', keys: ['shift+delete', 'shift+backspace'], run: () => actions.deleteSelection(true) },
  { id: 'duplicate', label: tt('Duplicate'), group: 'Editing', keys: ['mod+d'], run: actions.duplicateSelection },
  { id: 'select-all', label: tt('Select all clips'), group: 'Editing', keys: ['mod+a'], run: actions.selectAll },
  { id: 'deselect', label: tt('Deselect'), group: 'Editing', keys: ['esc'], run: () => ui().clearSelection() },
  { id: 'undo', label: tt('Undo'), group: 'Editing', keys: ['mod+z'], run: actions.undo },
  { id: 'redo', label: tt('Redo'), group: 'Editing', keys: ['mod+shift+z', 'mod+y'], run: actions.redo },
  { id: 'marker', label: tt('Add marker'), group: 'Editing', keys: ['m'], run: actions.addMarker },
  { id: 'copy', label: tt('Copy'), group: 'Editing', keys: ['mod+c'], run: actions.copy },
  { id: 'cut', label: tt('Cut'), group: 'Editing', keys: ['mod+x'], run: actions.cut },
  { id: 'paste', label: tt('Paste at playhead'), group: 'Editing', keys: ['mod+v'], run: () => actions.paste('free') },
  { id: 'paste-insert', label: tt('Paste insert (push clips later)'), group: 'Editing', keys: ['mod+shift+v'], run: () => actions.paste('insert') },
  { id: 'copy-attributes', label: tt('Copy attributes'), group: 'Editing', keys: ['mod+shift+c'], run: () => actions.copyAttributes() },
  { id: 'paste-attributes', label: tt('Paste attributes…'), group: 'Editing', keys: ['mod+alt+v'], run: actions.pasteAttributes },
  { id: 'mark-in', label: tt('Mark in'), group: 'Editing', keys: ['i'], run: actions.markIn },
  { id: 'mark-out', label: tt('Mark out'), group: 'Editing', keys: ['o'], run: actions.markOut },
  { id: 'mark-clip', label: tt('Mark in and out around selection'), group: 'Editing', keys: ['x'], run: actions.markSelection },
  { id: 'clear-in-out', label: tt('Clear in and out'), group: 'Editing', keys: ['alt+x'], run: actions.clearInOut },
  { id: 'lift', label: tt('Lift (leave a gap)'), group: 'Editing', keys: [';'], run: actions.lift },
  { id: 'extract', label: tt('Extract (close the gap)'), group: 'Editing', keys: ["'"], run: actions.extract },
  { id: 'freeze', label: tt('Freeze frame'), group: 'Editing', keys: ['shift+f'], run: actions.freezeFrame },
  { id: 'detach-audio', label: tt('Detach / reattach audio'), group: 'Editing', keys: ['mod+l'], run: actions.toggleAudioLink },
  { id: 'group', label: tt('Group clips'), group: 'Editing', keys: ['mod+g'], run: actions.group },
  { id: 'crossfade', label: tt('Crossfade with the clip before'), group: 'Editing', keys: ['mod+shift+d'], run: actions.crossfade },
  { id: 'ungroup', label: tt('Ungroup clips'), group: 'Editing', keys: ['mod+shift+g'], run: actions.ungroup },
  { id: 'nest', label: tt('Nest selection into a timeline'), group: 'Editing', keys: ['mod+alt+n'], run: actions.nestSelection },
  { id: 'open-nested', label: tt('Open the nested timeline'), group: 'Editing', keys: ['mod+alt+enter'], run: () => actions.openNested() },
  { id: 'trim-mode', label: tt('Trim mode: trim the nearest cut with J K L'), group: 'Editing', keys: ['t'], run: () => timelineActions.toggleTrimMode() },
  { id: 'macro-record', label: tt('Record a macro on the selected clip / stop recording'), group: 'Editing', keys: ['alt+r'], run: () => void timelineActions.toggleRecording() },
  { id: 'macro-run', label: tt('Run the last macro on the selected clips'), group: 'Editing', keys: ['alt+shift+r'], run: () => timelineActions.runMacro() },
  { id: 'source-insert', label: tt('Insert from the source monitor'), group: 'Editing', keys: [','], run: () => timelineActions.sourceEdit('insert') },
  { id: 'source-overwrite', label: tt('Overwrite from the source monitor'), group: 'Editing', keys: ['.'], run: () => timelineActions.sourceEdit('overwrite') },
  { id: 'next-take', label: tt('Show the next take'), group: 'Editing', keys: ['alt+t'], run: () => timelineActions.switchTake(1) },
  { id: 'prev-take', label: tt('Show the previous take'), group: 'Editing', keys: ['alt+shift+t'], run: () => timelineActions.switchTake(-1) },

  // Multicam
  ...Array.from({ length: 9 }, (_, i): Shortcut => ({ id: `angle-${i + 1}`, label: tt('Cut to camera {0}', i + 1), group: 'Multicam', keys: [String(i + 1)], run: () => actions.cutToAngle(i + 1) })),

  // Tools
  { id: 'tool-select', label: tt('Select tool'), group: 'Tools', keys: ['v'], run: () => ui().setTool('select') },
  { id: 'tool-blade', label: tt('Blade tool'), group: 'Tools', keys: ['b', 'c'], run: () => ui().setTool('blade') },
  { id: 'tool-roll', label: tt('Roll tool (move a cut)'), group: 'Tools', keys: ['r'], run: () => ui().setTool('roll') },
  { id: 'tool-slip', label: tt('Slip tool (change the footage in place)'), group: 'Tools', keys: ['y'], run: () => ui().setTool('slip') },
  { id: 'tool-slide', label: tt('Slide tool (move between neighbours)'), group: 'Tools', keys: ['u'], run: () => ui().setTool('slide') },
  { id: 'snapping', label: tt('Toggle snapping'), group: 'Tools', keys: ['n'], run: () => ui().toggleSnapping() },

  // View
  { id: 'zoom-in', label: tt('Zoom in'), group: 'View', keys: ['=', '+'], run: () => actions.zoom(1.35) },
  { id: 'zoom-out', label: tt('Zoom out'), group: 'View', keys: ['-'], run: () => actions.zoom(1 / 1.35) },
  { id: 'zoom-fit', label: tt('Zoom to fit'), group: 'View', keys: ['shift+z'], run: actions.zoomToFit },
  { id: 'guides', label: tt('Toggle safe-area guides'), group: 'View', keys: ['g'], run: () => ui().setShowGuides(!ui().showGuides) },
  { id: 'storyboard', label: tt('Storyboard: the timeline as cards'), group: 'View', keys: ['shift+s'], run: () => timelineView().set({ storyboard: !timelineView().storyboard }) },

  // App
  { id: 'palette', label: tt('Command palette'), group: 'App', keys: ['mod+k'], run: () => ui().setPaletteOpen(!ui().paletteOpen), global: true },
  { id: 'copilot', label: tt('Toggle Copilot'), group: 'App', keys: ['mod+j'], run: actions.toggleCopilot, global: true },
  { id: 'import', label: tt('Import media'), group: 'App', keys: ['mod+i'], run: actions.importMedia, global: true },
  { id: 'export', label: tt('Export'), group: 'App', keys: ['mod+e'], run: () => ui().setExportOpen(true), global: true },
  { id: 'queue', label: tt('Render queue'), group: 'App', keys: ['mod+shift+e'], run: () => ui().setQueueOpen(true), global: true },
  { id: 'record', label: tt('Record a screen or window'), group: 'App', keys: ['mod+shift+r'], run: () => void openRecorder(), global: true },
  { id: 'save', label: tt('Save'), group: 'App', keys: ['mod+s'], run: () => void actions.save(), global: true },
  { id: 'save-as', label: tt('Save as…'), group: 'App', keys: ['mod+shift+s'], run: actions.saveAs, global: true },
  { id: 'open', label: tt('Open project…'), group: 'App', keys: ['mod+o'], run: actions.open, global: true },
  { id: 'new', label: tt('New project'), group: 'App', keys: ['mod+n'], run: actions.home, global: true },
  { id: 'help', label: tt('Keyboard shortcuts'), group: 'App', keys: ['?'], run: () => ui().setShortcutsOpen(true) },
]

defineShortcuts(SHORTCUTS)

/** The combo a shortcut comes with, to name it by where its keys are drawn (a `shortcut` prop, a bound `Kbd`). */
export const shortcutFor = (id: string) => SHORTCUTS.find((s) => s.id === id)?.keys[0]
