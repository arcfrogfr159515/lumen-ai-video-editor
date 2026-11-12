import {
  ArrowDownToLine,
  Captions,
  Check,
  Cpu,
  ChevronDown,
  Clock,
  Download,
  FilePlus,
  FolderOpen,
  FolderArchive,
  FolderSearch,
  ListVideo,
  Gauge,
  History,
  House,
  Info,
  Keyboard,
  PencilLine,
  Redo2,
  RefreshCw,
  Save,
  SaveAll,
  Settings2,
  Square,
  Undo2,
  Upload,
  Languages,
  SunMoon,
} from 'lucide-react'
import { useRef, useState } from 'react'
import { openRecorder, stopRecording, useRecorder } from '@/capture/recorder'
import { AiSparkle, APP_NAME, LogoMark } from '@/components/brand'
import { fmtClock } from '@/features/record/RecordDialog'
import { Button, IconButton } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuSub, MenuTrigger } from '@/components/ui/menu'
import { Tip } from '@/components/ui/tooltip'
import { dispatch, useEditor } from '@/editor/store'
import { QueueIndicator } from '@/features/export/RenderQueue'
import { JobsIndicator } from '@/features/integrations/JobsIndicator'
import { useUI } from '@/editor/ui-store'
import { cn } from '@/lib/cn'
import { desktop, platform } from '@/lib/platform'
import { checkForUpdates, installUpdate, useUpdates } from '@/lib/updates'
import { collectProject, openProject, refreshRecent, useDirty, useSession } from '@/project/session'
import { LANGUAGES, languageChoice, ttc } from '@/lib/i18n'
import { chooseTheme, themeChoice } from '@/lib/theme'
import { switchLanguage } from './language'
import { pickSubtitles, saveSubtitles } from '@/project/subtitle-files'
import { actions } from './actions'
import { tt } from '@/lib/i18n'
import { ttx } from '@/lib/i18n-react'

export function TitleBar() {
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const undoLabel = useEditor((s) => s.past[s.past.length - 1]?.label)
  const redoLabel = useEditor((s) => s.future[0]?.label)
  const rightTab = useUI((s) => s.rightTab)
  const setExportOpen = useUI((s) => s.setExportOpen)
  const setPaletteOpen = useUI((s) => s.setPaletteOpen)

  const home = useSession((s) => s.home)

  const windowsControls = platform.isElectron && !platform.isMac
  const style = { paddingRight: windowsControls ? 'calc(100vw - env(titlebar-area-width, calc(100vw - 140px)) + 8px)' : 12 }
  const headerClass = cn('drag-region relative z-20 flex h-11 shrink-0 items-center gap-1.5 pl-2.5', platform.isElectron && platform.isMac && 'pl-[82px]')

  if (home) {
    return (
      <header className={headerClass} style={style}>
        <AppMenu />
        <div className="no-drag ml-auto flex items-center gap-0.5">
          <UpdatePill />
          <JobsIndicator />
        </div>
      </header>
    )
  }

  return (
    <header className={headerClass} style={style}>
      <AppMenu />
      <span className="px-0.5 text-fg-4">/</span>
      <ProjectName />
      <SaveBadge />

      {/* Command bar */}
      <button
        type="button"
        onClick={() => setPaletteOpen(true)}
        className="no-drag group absolute left-1/2 flex h-7 w-[min(380px,28vw)] -translate-x-1/2 items-center gap-2 rounded-lg bg-ink/[0.04] px-2.5 text-sm text-fg-4 shadow-[inset_0_0_0_1px_rgb(from_var(--color-ink)_r_g_b/0.06)] outline-none transition-colors hover:bg-ink/[0.07] hover:text-fg-3 focus-visible:ring-2 focus-visible:ring-accent/60"
      >
        <AiSparkle className="size-3.5 opacity-80 transition-opacity group-hover:opacity-100" />
        <span className="truncate">{tt('Search, or ask Copilot to edit…')}</span>
        <Kbd combo="mod+k" bound className="ml-auto" />
      </button>

      <div className="no-drag ml-auto flex items-center gap-0.5">
        <UpdatePill />
        <QueueIndicator />
        <JobsIndicator />
        <div className="mx-1.5 h-4 w-px bg-line-2" />
        <IconButton label={undoLabel ? tt('Undo {0}', undoLabel) : tt('Undo')} shortcut="mod+z" disabled={!canUndo} onClick={actions.undo} tooltipSide="bottom">
          <Undo2 />
        </IconButton>
        <IconButton label={redoLabel ? tt('Redo {0}', redoLabel) : tt('Redo')} shortcut="mod+shift+z" disabled={!canRedo} onClick={actions.redo} tooltipSide="bottom">
          <Redo2 />
        </IconButton>
        <div className="mx-2 h-4 w-px bg-line-2" />
        <RecordButton />
        <Button
          variant="ghost"
          size="sm"
          onClick={actions.toggleCopilot}
          className={cn('gap-1.5', rightTab === 'copilot' && 'bg-ink/[0.07] text-fg')}
        >
          <AiSparkle />
          {tt('Copilot')}
        </Button>
        <Button variant="primary" size="sm" className="ml-1.5 px-3" onClick={() => setExportOpen(true)}>
          <Upload />
          {tt('Export')}
        </Button>
      </div>
    </header>
  )
}

/** Opens the record window; while a recording runs it is the clock, and a click on the square stops it. */
function RecordButton() {
  const phase = useRecorder((s) => s.phase)
  const seconds = useRecorder((s) => s.stats.seconds)
  if (phase === 'idle')
    return (
      <IconButton label={tt('Record a screen or window')} shortcut="mod+shift+r" onClick={() => void openRecorder()} tooltipSide="bottom">
        <span className="grid size-[17px] place-items-center rounded-full ring-[1.5px] ring-current">
          <span className="size-[7px] rounded-full bg-danger" />
        </span>
      </IconButton>
    )
  const rolling = phase === 'recording' || phase === 'paused'
  return (
    <div className="mr-1 flex h-7 items-center gap-1 rounded-full bg-danger/14 pr-1 pl-2.5 text-xs font-medium text-danger tabular">
      <button type="button" className="flex items-center gap-1.5" onClick={() => void openRecorder()} title={tt('Show the recording')}>
        <span className={cn('size-2 rounded-full bg-danger', phase === 'recording' && 'animate-pulse-soft')} />
        {phase === 'paused' ? tt('Paused') : phase === 'finishing' ? tt('Finishing') : phase === 'countdown' ? tt('Starting') : phase === 'preparing' ? tt('Getting ready') : fmtClock(seconds)}
        {phase === 'paused' && <span className="text-danger/70">{fmtClock(seconds)}</span>}
      </button>
      {rolling && (
        <button type="button" aria-label={tt('Stop recording')} title={tt('Stop recording')} onClick={() => void stopRecording().catch(() => {})} className="grid size-5 place-items-center rounded-full hover:bg-danger/20">
          <Square className="size-2.5" fill="currentColor" />
        </button>
      )}
    </div>
  )
}

function AppMenu() {
  const setShortcutsOpen = useUI((s) => s.setShortcutsOpen)
  const setExportOpen = useUI((s) => s.setExportOpen)
  const setAboutOpen = useUI((s) => s.setAboutOpen)
  const updateReady = useUpdates((s) => s.status === 'ready')
  const home = useSession((s) => s.home)
  const recent = useSession((s) => s.recent)
  const autoProxies = useUI((s) => s.autoProxies)
  return (
    <Menu onOpenChange={(open) => open && void refreshRecent()}>
      <MenuTrigger asChild>
        <button
          type="button"
          className="no-drag group flex h-8 items-center gap-2 rounded-lg pr-1.5 pl-1 outline-none transition-colors hover:bg-ink/[0.05] focus-visible:ring-2 focus-visible:ring-accent/60 data-[state=open]:bg-ink/[0.07]"
        >
          <LogoMark className="size-[22px] drop-shadow-[0_2px_10px_rgb(from_var(--color-accent)_r_g_b/0.3)]" />
          <span className="text-sm font-semibold tracking-tight text-fg">{APP_NAME}</span>
          <ChevronDown className="size-3 text-fg-4 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </MenuTrigger>
      <MenuContent className="w-60">
        <MenuLabel>{tt('File')}</MenuLabel>
        <MenuItem icon={<FilePlus />} shortcut="mod+n" onSelect={actions.home}>
          {tt('New project…')}
        </MenuItem>
        <MenuItem icon={<FolderOpen />} shortcut="mod+o" disabled={!desktop} onSelect={actions.open}>
          {tt('Open project…')}
        </MenuItem>
        <MenuSub icon={<Clock />} label={tt('Open recent')}>
          {recent.length ? (
            recent.slice(0, 10).map((r) => (
              <MenuItem key={r.path} disabled={!r.exists} onSelect={() => void openProject(r.path)}>
                {r.name}
              </MenuItem>
            ))
          ) : (
            <MenuItem disabled>{tt('No recent projects')}</MenuItem>
          )}
        </MenuSub>
        {!home && (
          <>
            <MenuSeparator />
            <MenuItem icon={<Save />} shortcut="mod+s" onSelect={() => void actions.save()}>
              {tt('Save')}
            </MenuItem>
            <MenuItem icon={<SaveAll />} shortcut="mod+shift+s" onSelect={actions.saveAs}>
              {tt('Save as…')}
            </MenuItem>
            <MenuItem icon={<Download />} shortcut="mod+i" onSelect={actions.importMedia}>
              {tt('Import media…')}
            </MenuItem>
            <MenuSub icon={<Captions />} label={tt('Subtitles')}>
              <MenuItem onSelect={pickSubtitles}>{tt('Import SRT / VTT…')}</MenuItem>
              <MenuItem onSelect={() => void saveSubtitles('srt')}>{tt('Export captions as SRT…')}</MenuItem>
              <MenuItem onSelect={() => void saveSubtitles('vtt')}>{tt('Export captions as WebVTT…')}</MenuItem>
            </MenuSub>
            <MenuItem icon={<Upload />} shortcut="mod+e" onSelect={() => setExportOpen(true)}>
              {tt('Export…')}
            </MenuItem>
            <MenuItem icon={<ListVideo />} shortcut="mod+shift+e" onSelect={() => useUI.getState().setQueueOpen(true)}>
              {tt('Render queue…')}
            </MenuItem>
            <MenuItem icon={<History />} disabled={!desktop} onSelect={() => useUI.getState().setVersionsOpen(true)}>
              {tt('Version history…')}
            </MenuItem>
            <MenuItem icon={<FolderArchive />} disabled={!desktop} onSelect={() => void collectProject()}>
              {tt('Collect project…')}
            </MenuItem>
            <MenuItem icon={<House />} onSelect={actions.home}>
              {tt('Start screen')}
            </MenuItem>
            <MenuSeparator />
            <MenuItem icon={autoProxies ? <Check /> : <Gauge />} onSelect={() => useUI.getState().setAutoProxies(!autoProxies)}>
              {tt('Make proxies for 4K footage')}
            </MenuItem>
          </>
        )}
        <MenuSeparator />
        <MenuItem icon={<Keyboard />} shortcut="?" onSelect={() => setShortcutsOpen(true)}>
          {tt('Keyboard shortcuts')}
        </MenuItem>
        <MenuItem icon={<Cpu />} disabled={!desktop} onSelect={() => useUI.getState().setGraphicsOpen(true)}>
          {tt('Graphics and encoding…')}
        </MenuItem>
        <MenuSub icon={<SunMoon />} label={tt('Appearance')}>
          {(
            [
              ['dark', ttc('theme', 'Dark')],
              ['light', ttc('theme', 'Light')],
              ['system', tt('Same as this computer')],
            ] as const
          ).map(([id, label]) => (
            <MenuItem key={id} checked={themeChoice() === id} onSelect={() => chooseTheme(id)}>
              {label}
            </MenuItem>
          ))}
        </MenuSub>
        {/* In both languages, so it can be found by someone who reads neither of what is on screen. */}
        <MenuSub icon={<Languages />} label="Language · 语言">
          <MenuItem checked={languageChoice() === 'system'} onSelect={() => switchLanguage('system')}>
            {tt('Same as this computer')}
          </MenuItem>
          {LANGUAGES.map((l) => (
            <MenuItem key={l.id} checked={languageChoice() === l.id} onSelect={() => switchLanguage(l.id)}>
              {l.name}
            </MenuItem>
          ))}
        </MenuSub>
        {updateReady ? (
          <MenuItem icon={<RefreshCw />} onSelect={() => void installUpdate()}>
            {tt('Restart to update')}
          </MenuItem>
        ) : (
          <MenuItem icon={<RefreshCw />} disabled={!desktop} onSelect={() => void checkForUpdates()}>
            {tt('Check for updates…')}
          </MenuItem>
        )}
        <MenuItem icon={<Info />} onSelect={() => setAboutOpen(true)}>
          {ttx('About {0}', APP_NAME)}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

/** A downloaded update waiting for a restart — or one on its way. */
function UpdatePill() {
  const status = useUpdates((s) => s.status)
  const version = useUpdates((s) => s.version)
  const progress = useUpdates((s) => s.progress)
  const setAboutOpen = useUI((s) => s.setAboutOpen)
  if (status === 'ready') {
    return (
      <Tip content={tt('Lumen {0} is downloaded — restart to install it', version)} side="bottom">
        <button
          type="button"
          onClick={() => void installUpdate()}
          className="mr-1 flex h-7 items-center gap-1.5 rounded-lg bg-accent/[0.14] px-2.5 text-xs font-medium text-accent-2 outline-none transition-colors hover:bg-accent/[0.22] focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <RefreshCw className="size-3.5" />
          {tt('Restart to update')}
        </button>
      </Tip>
    )
  }
  if (status === 'downloading') {
    return (
      <Tip content={tt('Downloading Lumen {0} — it installs when you restart', version)} side="bottom">
        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          className="mr-1 flex h-7 items-center gap-1.5 rounded-lg px-2 text-xs text-fg-3 tabular-nums outline-none transition-colors hover:bg-ink/[0.05] hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <ArrowDownToLine className="size-3.5" />
          {Math.round((progress ?? 0) * 100)}%
        </button>
      </Tip>
    )
  }
  return null
}

function ProjectName() {
  const name = useEditor((s) => s.project.name)
  const path = useSession((s) => s.path)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  const commit = () => {
    const next = draft.trim()
    if (next && next !== name) dispatch('project.update', { name: next })
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setEditing(false)
        }}
        className="no-drag h-7 w-48 rounded-md bg-ink/[0.06] px-2 text-sm font-medium text-fg shadow-[inset_0_0_0_1px_rgb(from_var(--color-accent)_r_g_b/0.6)] outline-none"
      />
    )
  }

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          onDoubleClick={() => {
            setDraft(name)
            setEditing(true)
          }}
          className="no-drag group flex h-7 max-w-[220px] items-center gap-1.5 rounded-md px-2 text-sm font-medium text-fg-2 outline-none transition-colors hover:bg-ink/[0.05] hover:text-fg data-[state=open]:bg-ink/[0.07] data-[state=open]:text-fg"
        >
          <span className="truncate">{name}</span>
          <ChevronDown className="size-3 shrink-0 text-fg-4" />
        </button>
      </MenuTrigger>
      <MenuContent>
        <MenuItem
          icon={<PencilLine />}
          onSelect={() => {
            setDraft(name)
            setEditing(true)
          }}
        >
          {tt('Rename')}
        </MenuItem>
        <MenuItem
          icon={<Settings2 />}
          onSelect={() => {
            useUI.getState().clearSelection()
            useUI.getState().setRightTab('inspector')
          }}
        >
          {tt('Project settings')}
        </MenuItem>
        {path && (
          <MenuItem icon={<FolderSearch />} onSelect={() => void desktop?.files.reveal(path)}>
            {tt('Show in folder')}
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<House />} onSelect={actions.home}>
          {tt('Close project')}
        </MenuItem>
      </MenuContent>
    </Menu>
  )
}

function SaveBadge() {
  const dirty = useDirty()
  const path = useSession((s) => s.path)
  if (!dirty && path) {
    return (
      <Tip content={path}>
        <span className="no-drag flex items-center gap-1 pl-1 text-xs text-fg-4">
          <Check className="size-3" />
          {tt('Saved')}
        </span>
      </Tip>
    )
  }
  return (
    <Tip content={path ? tt('Save changes') : tt('Save this project to a file')} shortcut="mod+s">
      <button
        type="button"
        onClick={() => void actions.save()}
        className="no-drag hit-24 flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs text-fg-3 transition-colors hover:bg-ink/[0.06] hover:text-fg"
      >
        <span className="size-1.5 rounded-full bg-accent" />
        {path ? tt('Unsaved changes') : tt('Not saved')}
      </button>
    </Tip>
  )
}
