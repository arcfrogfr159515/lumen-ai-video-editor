import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent, AgentRunRequest } from '../../../shared/ai'

// Claude Code and Codex are stand-ins: asked whether they are there and signed in (which the test holds back, as
// the real ones take seconds over it), and then launched — which is what the test watches for.
const env = vi.hoisted(() => ({
  root: '',
  held: true,
  waiting: [] as (() => void)[],
  started: [] as string[][],
}))

vi.mock('electron', () => ({ app: { getPath: (name: string) => `${env.root}/${name}`, getVersion: () => '9.9.9' } }))
vi.mock('../server', () => ({ bridgeEndpoint: async () => ({ url: 'http://127.0.0.1:0/mcp', token: 't' }) }))
vi.mock('./chats', () => ({ loadSessions: () => new Map<string, string>(), saveSessions: () => {} }))
vi.mock('node:child_process', async () => {
  const { EventEmitter } = await import('node:events')
  const { PassThrough } = await import('node:stream')
  const says = (args: string[]) => {
    if (args.includes('--version')) return '2.1.0\n'
    if (args.includes('auth')) return '{"loggedIn":true,"authMethod":"claude.ai"}'
    if (args.includes('debug')) return '{"models":[]}'
    return 'Logged in using ChatGPT\n'
  }
  return {
    execFile: (_file: string, args: string[], _opts: unknown, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      const answer = () => cb(null, says(args), '')
      if (env.held) env.waiting.push(answer)
      else setTimeout(answer, 1)
    },
    spawn: (command: string, args: string[]) => {
      env.started.push([path.basename(command), ...args])
      const child = Object.assign(new EventEmitter(), { pid: 4242, stdin: { end: () => {} }, stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {} })
      // It says nothing and goes, so the turn ends.
      setTimeout(() => {
        child.stdout.end()
        child.stderr.end()
        child.emit('close', 0)
      }, 5)
      return child
    },
  }
})

env.root = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-agent-turns-test-'))
const bin = path.join(env.root, 'bin')
fs.mkdirSync(bin)
const suffix = process.platform === 'win32' ? '.exe' : ''
for (const name of ['claude', 'codex']) fs.writeFileSync(path.join(bin, name + suffix), '')
const PATH = process.env.PATH
process.env.PATH = `${bin}${path.delimiter}${PATH ?? ''}`
process.env.CODEX_HOME = path.join(env.root, 'codex-home')

const { runLocal, stopLocal } = await import('./local-agents')

afterAll(() => {
  process.env.PATH = PATH
  delete process.env.CODEX_HOME
  fs.rmSync(env.root, { recursive: true, force: true })
})
beforeEach(() => {
  env.held = true
  env.waiting = []
  env.started = []
})

const turn = (runId: string, agent: 'claude-code' | 'codex') => {
  const events: AgentEvent[] = []
  const request = { runId, conversationId: `chat-${runId}`, target: { kind: 'local', agent }, prompt: 'Cut the silences' } as AgentRunRequest
  return { events, ended: runLocal(request, (e) => events.push(e)) }
}
/** The agent is being asked whether it is there and signed in. */
const beingAsked = async () => {
  for (let i = 0; i < 500 && !env.waiting.length; i++) await new Promise((r) => setTimeout(r, 2))
  expect(env.waiting.length).toBeGreaterThan(0)
}
/** It answers, and whatever it is asked from here on it answers at once. */
const answers = () => {
  env.held = false
  for (const answer of env.waiting.splice(0)) answer()
}

describe('a turn given to the user’s own Claude Code or Codex', () => {
  it('launches the agent once it has said it is there and signed in', async () => {
    const claude = turn('run-claude', 'claude-code')
    await beingAsked()
    answers()
    await claude.ended
    expect(env.started.map((s) => s[0])).toEqual([`claude${suffix}`])
    expect(env.started[0]).toContain('-p')
  })

  it('isn’t launched after all when the turn was stopped while the agent was still being asked', async () => {
    const claude = turn('run-stopped', 'claude-code')
    await beingAsked()
    // The chat says "Stopped." from here on, and no longer listens to this turn.
    stopLocal('run-stopped')
    answers()
    await claude.ended
    expect(env.started).toEqual([])
    expect(claude.events).toEqual([{ runId: 'run-stopped', type: 'error', code: 'cancelled', message: 'Stopped.' }])
  })

  it('goes the same for Codex', async () => {
    const codex = turn('run-codex-stopped', 'codex')
    await beingAsked()
    stopLocal('run-codex-stopped')
    answers()
    await codex.ended
    expect(env.started).toEqual([])
    expect(codex.events).toEqual([{ runId: 'run-codex-stopped', type: 'error', code: 'cancelled', message: 'Stopped.' }])
  })

  it('still starts the next turn, and a turn that is over can be “stopped” without holding one back later', async () => {
    stopLocal('run-after')
    const codex = turn('run-after', 'codex')
    await beingAsked()
    answers()
    await codex.ended
    expect(env.started.map((s) => s[0])).toEqual([`codex${suffix}`])
    expect(env.started[0]).toContain('exec')
  })
})
