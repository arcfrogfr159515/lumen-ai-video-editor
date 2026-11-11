import { beforeEach, describe, expect, it, vi } from 'vitest'

// A desktop whose writes take a moment, like a real one saving a large project — and a Save dialog that stays open.
const disk = new Map<string, string>()
const calls = { cleared: 0, autosaved: 0, closed: 0 }
let dialog: (() => Promise<string | null>) | null = null
let saveBeforeClose: () => Promise<void> = async () => {}
let saveTakes = 20

vi.mock('@/lib/platform', () => ({
  platform: { isMac: false },
  desktop: {
    project: {
      save: (path: string, text: string) =>
        new Promise((resolve) =>
          setTimeout(() => {
            disk.set(path, text)
            resolve({ path })
          }, saveTakes),
        ),
      open: async (path: string) => ({ path, text: disk.get(path)!, missing: [] }),
      confirmDiscard: async () => 'discard',
      startupFile: async () => null,
      recovery: async () => null,
      onOpenRequest: () => {},
      onSaveBeforeClose: (fn: () => Promise<void>) => void (saveBeforeClose = fn),
      saveAs: async (_name: string, text: string) => {
        const path = await dialog!()
        if (!path) return null
        disk.set(path, text)
        return { path }
      },
      autosave: (snap: unknown) => {
        if (snap === null) calls.cleared++
        else calls.autosaved++
        return Promise.resolve()
      },
      setState: () => {},
      recent: async () => [],
      closeWindow: () => void calls.closed++,
    },
  },
}))

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, info: () => {}, warning: () => {} }) }))
// The transport runs on animation frames, which only a browser has.
vi.mock('@/editor/playback', () => ({ playback: { pause: () => {}, seek: () => {} } }))

const { isDirty, openProject, saveProject, saveProjectAs, startSession, useSession } = await import('./session')
const { dispatch, getProject, useEditor } = await import('@/editor/store')
const { createEmptyProject } = await import('@/editor/new-project')

const FILE = 'C:/films/film.lumen'
const mark = (label: string) => dispatch('marker.add', { frame: getProject().markers.length * 10, label })
const labels = (text: string | undefined) => (JSON.parse(text ?? '{"markers":[]}') as { markers: { label: string }[] }).markers.map((m) => m.label)
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms))

beforeEach(() => {
  disk.clear()
  calls.cleared = calls.autosaved = calls.closed = 0
  dialog = null
  saveTakes = 20
  useEditor.getState().loadProject(createEmptyProject('Film'))
  useSession.setState({ path: FILE, savedVersion: useEditor.getState().version, home: false })
})

describe('saving', () => {
  it('marks the project saved, and drops its recovery copy, when nothing changed meanwhile', async () => {
    mark('one')
    expect(isDirty()).toBe(true)
    expect(await saveProject()).toBe(true)
    expect(labels(disk.get(FILE))).toEqual(['one'])
    expect(isDirty()).toBe(false)
    expect(calls.cleared).toBe(1)
  })

  it('keeps an edit made while the file was being written as unsaved', async () => {
    mark('before the save')
    const saving = saveProject()
    // The file is on its way to disk; the editing goes on.
    mark('during the save')
    expect(await saving).toBe(true)
    expect(labels(disk.get(FILE))).toEqual(['before the save'])
    // The editor knows the file is behind: closing will ask, and the recovery copy is not thrown away.
    expect(isDirty()).toBe(true)
    expect(calls.cleared).toBe(0)
    // Saving again brings the file up to date.
    expect(await saveProject()).toBe(true)
    expect(labels(disk.get(FILE))).toEqual(['before the save', 'during the save'])
    expect(isDirty()).toBe(false)
    expect(calls.cleared).toBe(1)
  })

  it('writes the project as it is when the Save dialog closes, not as it was when it opened', async () => {
    useSession.setState({ path: null, savedVersion: -1 })
    mark('before the dialog')
    let choose: (path: string | null) => void = () => {}
    dialog = () => new Promise((resolve) => (choose = resolve))
    const saving = saveProjectAs()
    // The dialog is open; the Copilot goes on editing.
    await tick()
    mark('while the dialog was open')
    choose('C:/films/new.lumen')
    expect(await saving).toBe(true)
    expect(labels(disk.get('C:/films/new.lumen'))).toEqual(['before the dialog', 'while the dialog was open'])
    expect(useSession.getState().path).toBe('C:/films/new.lumen')
    expect(isDirty()).toBe(false)
  })

  it('leaves everything as it was when the Save dialog is cancelled', async () => {
    useSession.setState({ path: null, savedVersion: -1 })
    mark('unsaved')
    dialog = async () => null
    expect(await saveProjectAs()).toBe(false)
    expect(useSession.getState().path).toBeNull()
    expect(isDirty()).toBe(true)
    expect(calls.cleared).toBe(0)
  })

  it('does not hand the file of one project to another opened while it was being written', async () => {
    const other = createEmptyProject('Other')
    disk.set('C:/films/other.lumen', JSON.stringify(other))
    mark('in the film')
    saveTakes = 60
    const saving = saveProject()
    // The film is on its way to disk; another project opens before the write ends.
    expect(await openProject('C:/films/other.lumen')).toBe(true)
    expect(getProject().name).toBe('Other')
    await saving
    // The film was written to its own file...
    expect(labels(disk.get(FILE))).toEqual(['in the film'])
    // ...and the open project still belongs to its own: saving it again must not land on the film.
    expect(useSession.getState().path).toBe('C:/films/other.lumen')
    expect(isDirty()).toBe(false)
    mark('in the other')
    await saveProject()
    expect(labels(disk.get(FILE))).toEqual(['in the film'])
    expect(labels(disk.get('C:/films/other.lumen'))).toEqual(['in the other'])
  })

  it('closes the window only once everything is in the file', async () => {
    const interval = vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never)
    await startSession()
    interval.mockRestore()
    useSession.setState({ path: FILE, savedVersion: useEditor.getState().version, home: false })
    mark('before closing')
    const closing = saveBeforeClose()
    // "Save" was chosen in the close prompt; an agent's edit lands while the file is being written.
    mark('while closing')
    await closing
    expect(labels(disk.get(FILE))).toEqual(['before closing', 'while closing'])
    expect(calls.closed).toBe(1)
    expect(isDirty()).toBe(false)
  })

  it('reports a write that failed and stays unsaved', async () => {
    const { desktop } = await import('@/lib/platform')
    const save = desktop!.project.save
    desktop!.project.save = () => Promise.reject(new Error('The disk is full.'))
    mark('one')
    expect(await saveProject()).toBe(false)
    expect(isDirty()).toBe(true)
    expect(calls.cleared).toBe(0)
    desktop!.project.save = save
  })
})
