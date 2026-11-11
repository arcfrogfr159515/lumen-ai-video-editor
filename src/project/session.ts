/**
 * The open project as a document: where it lives on disk, whether it has
 * unsaved changes, new/open/save, recent projects and crash recovery.
 */
import { toast } from 'sonner'
import { create } from 'zustand'
import type { ProjectVersion, RecentProject, RecoveryInfo } from '@shared/app'
import { createEmptyProject } from '@/editor/new-project'
import { playback } from '@/editor/playback'
import { checkProject } from '@/editor/project-check'
import { getProject, migrateProject, useEditor } from '@/editor/store'
import type { Project, ProjectSettings } from '@/editor/types'
import { useUI } from '@/editor/ui-store'
import { desktop } from '@/lib/platform'
import { tt } from '@/lib/i18n'

interface SessionState {
  /** The .lumen file this project was opened from / saved to (null = never saved). */
  path: string | null
  /** Editor version at the last save/open — anything else means unsaved changes. */
  savedVersion: number
  /** The start screen (recent projects, new project) is showing. */
  home: boolean
  recent: RecentProject[]
  recovery: RecoveryInfo | null
  busy: boolean
  /** A project has been opened or created this session (the start screen can go back to it). */
  hasProject: boolean
}

export const useSession = create<SessionState>(() => ({
  path: null,
  savedVersion: useEditor.getState().version,
  home: true,
  recent: [],
  recovery: null,
  busy: false,
  hasProject: false,
}))

export const isDirty = () => useEditor.getState().version !== useSession.getState().savedVersion
export const useDirty = () => {
  const version = useEditor((s) => s.version)
  const saved = useSession((s) => s.savedVersion)
  return version !== saved
}

const errorText = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))

function serialize(project: Project) {
  return JSON.stringify(project)
}

/** Counts the projects loaded. A save that ends after another one was opened has nothing to say about that one. */
let loads = 0

/** The project as text, with the edit it is a picture of: writing it takes a moment, and editing goes on meanwhile. */
function snapshot() {
  return { text: serialize(getProject()), version: useEditor.getState().version, loads }
}

/**
 * The file at `path` now holds the project as it was at `version`. An edit
 * made while it was being written isn't in it: the project stays unsaved, and
 * its recovery copy stays (and is written again) rather than being thrown away.
 */
function markSaved(path: string | null, version: number) {
  useSession.setState({ path, savedVersion: version })
  syncWindow()
  if (useEditor.getState().version === version) void desktop?.project.autosave(null)
  else scheduleAutosave()
}

/** Opens what a project file held. Throws (ProjectError) when it isn't a project; a damaged one is repaired, and says how. */
function load(data: Project, path: string | null) {
  // Before anything of the open project is given up.
  const { project, repairs } = checkProject(data)
  const ready = migrateProject(project)
  loads++
  playback.pause()
  useUI.getState().clearSelection()
  useEditor.getState().loadProject(ready)
  playback.seek(0)
  // Repaired, it is no longer what the file holds: saving is what makes the repair stick.
  useSession.setState({ path, savedVersion: repairs.length ? -1 : useEditor.getState().version, home: false, hasProject: true })
  syncWindow()
  useUI.getState().requestFit()
  if (repairs.length) {
    const shown = repairs.slice(0, 4).map((r) => r[0].toUpperCase() + r.slice(1))
    toast.warning(tt('This project was damaged and has been repaired'), {
      description: tt('{0}.{1} The file is as it was until you save.', shown.join('. '), repairs.length > shown.length ? (' ' + tt('And {0} more.', repairs.length - shown.length)) : ''),
      duration: 15000,
    })
  }
}

/** If there are unsaved changes, asks what to do. Resolves false if the user cancelled. */
async function settleChanges(): Promise<boolean> {
  if (!isDirty() || !desktop) return true
  const choice = await desktop.project.confirmDiscard(getProject().name)
  if (choice === 'cancel') return false
  if (choice === 'save') return await saveProject()
  return true
}

export async function newProject(settings: Partial<ProjectSettings>, name = 'Untitled') {
  if (!(await settleChanges())) return false
  load(createEmptyProject(name, settings), null)
  void desktop?.project.autosave(null)
  return true
}

export async function openProject(path?: string) {
  if (!desktop) return false
  if (!(await settleChanges())) return false
  useSession.setState({ busy: true })
  try {
    const opened = await desktop.project.open(path)
    if (!opened) return false
    load(JSON.parse(opened.text) as Project, opened.path)
    void refreshRecent()
    if (opened.missing.length) {
      toast.warning(tt('{0} media file{1} missing', opened.missing.length, opened.missing.length > 1 ? tt('s are') : (' ' + tt('is'))), {
        description: tt('They were moved or deleted. Relink them from the Media panel.'),
      })
      useUI.getState().setLeftTab('media')
    }
    return true
  } catch (err) {
    toast.error('Couldn’t open the project', { description: errorText(err) })
    if (path) void refreshRecent()
    return false
  } finally {
    useSession.setState({ busy: false })
  }
}

/** Save to the current file, or ask where when the project has never been saved. */
export async function saveProject(): Promise<boolean> {
  const path = useSession.getState().path
  if (!path) return saveProjectAs()
  if (!desktop) return false
  try {
    const snap = snapshot()
    const res = await desktop.project.save(path, snap.text)
    // Another project opened meanwhile: the file is written, but it isn't the open project's.
    if (snap.loads === loads) markSaved(res.path, snap.version)
    void refreshRecent()
    return true
  } catch (err) {
    toast.error('Couldn’t save the project', { description: errorText(err) })
    return false
  }
}

export async function saveProjectAs(): Promise<boolean> {
  if (!desktop) return false
  try {
    let snap = snapshot()
    const res = await desktop.project.saveAs(getProject().name, snap.text)
    if (!res) return false
    // The Save dialog can stay open a long while, and the Copilot or an agent may have gone on editing: the new
    // file gets the project as it is now, not as it was when the dialog opened.
    if (snap.loads === loads && useEditor.getState().version !== snap.version) {
      snap = snapshot()
      await desktop.project.save(res.path, snap.text)
    }
    void refreshRecent()
    if (snap.loads !== loads) return true
    markSaved(res.path, snap.version)
    toast.success(tt('Project saved'), { description: res.path })
    return true
  } catch (err) {
    toast.error('Couldn’t save the project', { description: errorText(err) })
    return false
  }
}

export async function refreshRecent() {
  if (!desktop) return
  useSession.setState({ recent: await desktop.project.recent() })
}

export async function forgetRecent(path: string) {
  if (!desktop) return
  useSession.setState({ recent: await desktop.project.forget(path) })
}

export async function recover() {
  const info = useSession.getState().recovery
  if (!info) return
  try {
    load(JSON.parse(info.text) as Project, info.path)
  } catch (err) {
    toast.error('Couldn’t recover the project', { description: errorText(err) })
    return
  }
  // Recovered work isn't on disk yet: keep it marked as unsaved.
  useSession.setState({ savedVersion: -1, recovery: null })
  syncWindow()
}

export async function discardRecovery() {
  useSession.setState({ recovery: null })
  await desktop?.project.discardRecovery()
}

// ─── Versions & collecting ───────────────────────────────────────────────────────

/** Every stored version of the open project, newest first. */
export async function projectVersions(): Promise<ProjectVersion[]> {
  return desktop ? await desktop.project.versions(getProject().id) : []
}

/**
 * Makes an older version the current state. What was there first is stored as a
 * version too, so a restore can itself be undone from the history.
 */
export async function restoreVersion(version: ProjectVersion, asCopy = false) {
  if (!desktop) return false
  try {
    const path = useSession.getState().path
    const opened = await desktop.project.readVersion(getProject().id, version.id, path)
    const project = JSON.parse(opened.text) as Project
    if (asCopy) {
      if (!(await settleChanges())) return false
      project.id = crypto.randomUUID()
      project.name = `${project.name} (${new Date(version.savedAt).toLocaleDateString()})`
      load(project, null)
      useSession.setState({ savedVersion: -1 })
    } else {
      await desktop.project.snapshot({ text: serialize(getProject()), path, kind: 'restore' })
      load(project, path)
      // It's the current state now, but not what's in the file: keep it unsaved.
      useSession.setState({ savedVersion: -1 })
    }
    syncWindow()
    toast.success(asCopy ? tt('Opened the version as a new project') : tt('Version restored'), {
      description: asCopy ? tt('Save it to keep it.') : tt('Save to keep it — the state before the restore is in the version history.'),
    })
    if (opened.missing.length) toast.warning(tt('{0} media file{1} missing', opened.missing.length, opened.missing.length > 1 ? tt('s are') : (' ' + tt('is'))))
    return true
  } catch (err) {
    toast.error('Couldn’t restore that version', { description: errorText(err) })
    return false
  }
}

/** Copies the project and every media file into one folder the user picks. */
export async function collectProject() {
  if (!desktop) return
  const id = toast.loading(tt('Collecting project…'), { description: tt('Choose a folder') })
  const off = desktop.project.onCollectProgress((p) => {
    if (!p.total) return
    toast.loading(tt('Collecting project… {0}%', Math.round((p.done / p.total) * 100)), { id, description: p.file || tt('Writing the project file') })
  })
  try {
    const res = await desktop.project.collect(getProject().name, serialize(getProject()))
    if (!res) return void toast.dismiss(id)
    const size = res.bytes >= 1e9 ? `${(res.bytes / 1e9).toFixed(2)} GB` : `${Math.max(1, Math.round(res.bytes / 1e6))} MB`
    toast.success(tt('Project collected'), {
      id,
      description: tt('{0} media file{1} ({2}) copied next to the project.{3}', res.files, res.files === 1 ? '' : 's', size, res.missing.length ? (' ' + tt('{0} missing file{1} couldn’t be copied.', res.missing.length, res.missing.length > 1 ? 's' : '')) : ''),
      action: { label: tt('Open it'), onClick: () => void openProject(res.path) },
      duration: 12000,
    })
  } catch (err) {
    toast.error('Couldn’t collect the project', { id, description: errorText(err) })
  } finally {
    off()
  }
}

export function showHome(show = true) {
  useSession.setState({ home: show })
  if (show) void refreshRecent()
}

// ─── Background sync ─────────────────────────────────────────────────────

let lastState = ''
function syncWindow() {
  if (!desktop) return
  const state = { name: getProject().name, path: useSession.getState().path, dirty: isDirty() }
  const key = JSON.stringify(state)
  if (key === lastState) return
  lastState = key
  desktop.project.setState(state)
}

let autosaveTimer: ReturnType<typeof setTimeout> | undefined
function scheduleAutosave() {
  clearTimeout(autosaveTimer)
  autosaveTimer = setTimeout(() => {
    if (!desktop || !isDirty() || useSession.getState().home) return
    void desktop.project.autosave({ text: serialize(getProject()), path: useSession.getState().path, name: getProject().name })
  }, 2000)
}

/** While there are unsaved changes, a version is stored every ten minutes — history even if you never save. */
const SNAPSHOT_EVERY = 10 * 60 * 1000
let lastSnapshot = Date.now()
function maybeSnapshot() {
  if (!desktop || !isDirty() || useSession.getState().home || Date.now() - lastSnapshot < SNAPSHOT_EVERY) return
  lastSnapshot = Date.now()
  void desktop.project.snapshot({ text: serialize(getProject()), path: useSession.getState().path, kind: 'auto' }).catch(() => {})
}

let started = false

/** Wires window title, crash recovery, file-association opens and the close prompt; picks what to show first. */
export async function startSession() {
  if (started) return
  started = true
  useEditor.subscribe((s, prev) => {
    if (s.version !== prev.version || s.project.name !== prev.project.name) {
      syncWindow()
      scheduleAutosave()
    }
  })
  useSession.subscribe((s, prev) => {
    if (s.savedVersion !== prev.savedVersion || s.path !== prev.path) syncWindow()
  })
  if (!desktop) {
    useSession.setState({ home: false, hasProject: true })
    return
  }
  setInterval(maybeSnapshot, 60_000)
  desktop.project.onOpenRequest((path) => void openProject(path))
  desktop.project.onSaveBeforeClose(async () => {
    // Closing follows a save that got everything: an edit that arrived while the file was being written is saved too.
    for (let tries = 0; tries < 3 && isDirty(); tries++) if (!(await saveProject())) return
    if (!isDirty()) desktop!.project.closeWindow()
    else toast.info('Not closed yet', { description: 'The project kept changing while it was being saved. Close again once the edits are done.' })
  })
  syncWindow()
  const [startup, recovery] = await Promise.all([desktop.project.startupFile(), desktop.project.recovery()])
  useSession.setState({ recovery })
  await refreshRecent()
  if (startup) await openProject(startup)
}
