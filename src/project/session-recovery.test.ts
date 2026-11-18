import { beforeEach, describe, expect, it, vi } from 'vitest'

// Lumen closed without a goodbye, with changes that weren't saved. The copy it kept of them is offered when Lumen
// starts again — on the start screen — until the user takes it or turns it down.

const env = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  startup: null as string | null,
  recovery: null as { text: string; savedAt: number; path: string | null; name: string } | null,
  cleared: 0,
  autosaved: 0,
  discarded: 0,
  /** What the user answers when asked about unsaved changes, and how often they were asked. */
  choice: 'discard' as 'save' | 'discard' | 'cancel',
  asked: 0,
}))

vi.mock('@/lib/platform', () => ({
  platform: { isMac: false },
  desktop: {
    project: {
      save: async (path: string, text: string) => {
        env.disk.set(path, text)
        return { path }
      },
      open: async (path: string) => ({ path, text: env.disk.get(path)!, missing: [] }),
      confirmDiscard: async () => {
        env.asked++
        return env.choice
      },
      startupFile: async () => env.startup,
      recovery: async () => env.recovery,
      discardRecovery: async () => void env.discarded++,
      onOpenRequest: () => {},
      onSaveBeforeClose: () => {},
      autosave: (snap: unknown) => {
        if (snap === null) env.cleared++
        else env.autosaved++
        return Promise.resolve()
      },
      setState: () => {},
      recent: async () => [],
      closeWindow: () => {},
    },
  },
}))

vi.mock('sonner', () => ({ toast: Object.assign(() => {}, { error: () => {}, success: () => {}, info: () => {}, warning: () => {}, dismiss: () => {} }) }))
// The transport runs on animation frames, which only a browser has.
vi.mock('@/editor/playback', () => ({ playback: { pause: () => {}, seek: () => {} } }))

const FILM = 'C:/films/film.lumen'
const OTHER = 'C:/films/other.lumen'

/** Lumen, started afresh: with the file it was opened with (if any) and the copy the last run left behind. */
async function start() {
  vi.resetModules()
  const session = await import('./session')
  const store = await import('@/editor/store')
  const { createEmptyProject } = await import('@/editor/new-project')
  const film = createEmptyProject('Film')
  env.disk.set(FILM, JSON.stringify(film))
  env.disk.set(OTHER, JSON.stringify(createEmptyProject('Other')))
  // What wasn't saved: the film, with a marker more than its file has.
  env.recovery = { text: JSON.stringify({ ...film, markers: [{ id: 'mk_lost', frame: 30, label: 'not saved yet', color: 'blue' }] }), savedAt: Date.now() - 60_000, path: FILM, name: 'Film' }
  const interval = vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never)
  await session.startSession()
  interval.mockRestore()
  const mark = (label: string) => store.dispatch('marker.add', { frame: store.getProject().markers.length * 10 + 5, label })
  return { ...session, ...store, mark }
}

beforeEach(() => {
  env.disk.clear()
  env.startup = null
  env.recovery = null
  env.cleared = env.autosaved = env.discarded = 0
  env.choice = 'discard'
  env.asked = 0
})

describe('what wasn’t saved when Lumen closed unexpectedly', () => {
  it('is still offered when Lumen is started by opening a project file', async () => {
    // Double-clicking the film — the most natural way back in after a crash.
    env.startup = FILM
    const { useSession, getProject } = await start()
    expect(getProject().name).toBe('Film')
    expect(getProject().markers).toHaveLength(0)
    // The copy is where it was (opening the file deleted it at once: the next start had nothing to offer)…
    expect(env.cleared).toBe(0)
    expect(useSession.getState().recovery?.name).toBe('Film')
    // …and the start screen, which is where it is offered, is what shows — over the project that was opened.
    expect(useSession.getState().home).toBe(true)
    expect(useSession.getState().hasProject).toBe(true)
  })

  it('opens straight into the project when there is nothing to offer', async () => {
    env.startup = FILM
    vi.resetModules()
    const session = await import('./session')
    const { createEmptyProject } = await import('@/editor/new-project')
    env.disk.set(FILM, JSON.stringify(createEmptyProject('Film')))
    const interval = vi.spyOn(globalThis, 'setInterval').mockReturnValue(0 as never)
    await session.startSession()
    interval.mockRestore()
    expect(session.useSession.getState().home).toBe(false)
  })

  it('stays on disk when another project is opened, made or saved before the offer is answered', async () => {
    const { openProject, newProject, saveProject, useSession, getProject } = await start()
    expect(useSession.getState().home).toBe(true)
    expect(await openProject(OTHER)).toBe(true)
    expect(getProject().name).toBe('Other')
    expect(env.cleared).toBe(0)
    // Saved as it is — nothing of this project was ever in the copy.
    expect(await saveProject()).toBe(true)
    expect(env.cleared).toBe(0)
    expect(await newProject({})).toBe(true)
    expect(env.cleared).toBe(0)
    expect(useSession.getState().recovery?.name).toBe('Film')
  })

  it('gives its place to the open project’s own unsaved changes when they need one, and is that project’s from then on', async () => {
    const { openProject, saveProject, mark } = await start()
    await openProject(OTHER)
    vi.useFakeTimers()
    try {
      mark('in the other')
      await vi.advanceTimersByTimeAsync(2100)
      expect(env.autosaved).toBe(1)
      // The file now holds it all: the copy — the other project's, by now — has nothing to add.
      expect(await saveProject()).toBe(true)
      expect(env.cleared).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('is deleted when it is turned down', async () => {
    const { discardRecovery, openProject, useSession } = await start()
    await discardRecovery()
    expect(env.discarded).toBe(1)
    expect(useSession.getState().recovery).toBeNull()
    // Nothing is on offer any more: opening a project clears the place as it always did.
    await openProject(OTHER)
    expect(env.cleared).toBe(1)
  })

  it('is the open project’s own copy once it is taken', async () => {
    const { recover, openProject, getProject, isDirty, useSession } = await start()
    await recover()
    expect(getProject().markers.map((m) => m.label)).toEqual(['not saved yet'])
    expect(isDirty()).toBe(true)
    expect(useSession.getState().recovery).toBeNull()
    // Given up after all (“Don’t save” is what the prompt answers here): it isn’t offered again.
    await openProject(OTHER)
    expect(env.cleared).toBe(1)
  })
})

describe('taking back what wasn’t saved while another project is open', () => {
  const labels = (text: string | undefined) => (JSON.parse(text ?? '{"markers":[]}') as { markers: { label: string }[] }).markers.map((m) => m.label)

  it('asks first when that project has changes of its own that aren’t saved, and leaves everything be on Cancel', async () => {
    const { recover, openProject, getProject, isDirty, useSession, mark } = await start()
    await openProject(OTHER)
    mark('in the other')
    expect(isDirty()).toBe(true)
    env.asked = 0
    env.choice = 'cancel'
    await recover()
    // It was never asked: the recovered film was loaded over the other project, whose changes went without a word.
    expect(env.asked).toBe(1)
    expect(getProject().name).toBe('Other')
    expect(getProject().markers.map((m) => m.label)).toEqual(['in the other'])
    expect(isDirty()).toBe(true)
    // The offer is still there to take later.
    expect(useSession.getState().recovery?.name).toBe('Film')
  })

  it('saves that project first when the answer is Save', async () => {
    const { recover, openProject, getProject, useSession, mark } = await start()
    await openProject(OTHER)
    mark('in the other')
    env.choice = 'save'
    await recover()
    expect(labels(env.disk.get(OTHER))).toEqual(['in the other'])
    expect(getProject().name).toBe('Film')
    expect(getProject().markers.map((m) => m.label)).toEqual(['not saved yet'])
    expect(useSession.getState().path).toBe(FILM)
    expect(useSession.getState().recovery).toBeNull()
  })

  it('gives that project’s changes up when the answer is Don’t save', async () => {
    const { recover, openProject, getProject, mark } = await start()
    await openProject(OTHER)
    mark('in the other')
    env.asked = 0
    env.choice = 'discard'
    await recover()
    expect(env.asked).toBe(1)
    expect(labels(env.disk.get(OTHER))).toEqual([])
    expect(getProject().markers.map((m) => m.label)).toEqual(['not saved yet'])
  })

  it('asks nothing when that project has no unsaved changes', async () => {
    const { recover, openProject, getProject } = await start()
    await openProject(OTHER)
    env.asked = 0
    await recover()
    expect(env.asked).toBe(0)
    expect(getProject().name).toBe('Film')
  })
})
