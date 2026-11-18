import { beforeEach, describe, expect, it, vi } from 'vitest'

// Moving the playhead while paused needs nothing of a browser; stopping playback would.
vi.stubGlobal('cancelAnimationFrame', () => {})
vi.stubGlobal('requestAnimationFrame', () => 0)

const { runAgentTool } = await import('../agent-tools')
const { playback, usePlayback } = await import('@/editor/playback')
const { freshProject } = await import('@/editor/test-helpers')

async function seek(args: Record<string, unknown>) {
  const res = await runAgentTool('seek', args)
  const said = res.content.find((c) => c.type === 'text')
  return { refused: res.isError === true, text: said && 'text' in said ? said.text : '', frame: usePlayback.getState().frame }
}

beforeEach(() => {
  freshProject('Seek')
  playback.seek(45)
})

describe('the playhead', () => {
  it('goes where the Copilot sends it', async () => {
    expect(await seek({ seconds: 2 })).toMatchObject({ refused: false, frame: 60 })
    expect(await seek({ seconds: '3.5' })).toMatchObject({ refused: false, frame: 105 })
    expect(await seek({ seconds: 0 })).toMatchObject({ refused: false, frame: 0 })
  })

  it('stays where it is when the Copilot names no time, or one that isn’t a number', async () => {
    // What a model sends isn't checked against what a tool asks for. A call without `seconds` made the time
    // "not a number", and the playhead with it: the timecode read NaN, and nothing played until the ruler was clicked.
    for (const args of [{}, { seconds: 'soon' }, { seconds: null }, { seconds: '' }, { time: 2 }]) {
      const res = await seek(args)
      expect(res, JSON.stringify(args)).toMatchObject({ refused: true, frame: 45 })
      expect(res.text).toMatch(/seconds/)
    }
  })

  it('is never moved to a time that isn’t one, whoever asks', () => {
    for (const nowhere of [NaN, Infinity, -Infinity]) {
      playback.seek(nowhere)
      expect(usePlayback.getState()).toMatchObject({ frame: 45, pausedFrame: 45 })
    }
    playback.seek(-20)
    expect(usePlayback.getState().frame).toBe(0)
  })
})
