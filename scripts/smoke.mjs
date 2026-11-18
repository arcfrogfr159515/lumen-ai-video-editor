#!/usr/bin/env node
// Starts a built Lumen and checks that it is one: the editor comes up, speaks the computer's language, makes a
// project, edits it, undoes and redoes.
//
//   npm run pack && npm run smoke                      the build in release/win-unpacked
//   node scripts/smoke.mjs path/to/Lumen.exe           another build
//
// What only a built Lumen shows is checked nowhere else: the unit tests run in Node, and a development run is not
// what is installed (it has every language pack Chromium has, for one — which is how an installed Lumen came up
// in English on a Chinese computer, and nothing noticed).
//
// It needs nothing installed: Node's own WebSocket talks to the build over the DevTools protocol. The build runs
// on a profile of its own (LUMEN_USER_DATA), made for the run and removed after it — never the user's.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const exe = path.resolve(process.argv[2] ?? path.join('release', 'win-unpacked', process.platform === 'win32' ? 'Lumen.exe' : 'Lumen'))
if (!fs.existsSync(exe)) {
  console.error(`smoke: no build at ${exe} — run "npm run pack" first, or give the path to one.`)
  process.exit(2)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lumen-smoke-'))
const port = await freePort()
const started = Date.now()
const child = spawn(exe, [`--remote-debugging-port=${port}`], { env: { ...process.env, LUMEN_USER_DATA: profile, LUMEN_TEST_EXPORT_DIR: path.join(profile, 'exports') }, stdio: 'ignore' })
let exited = false
child.once('exit', () => (exited = true))

const failures = []
const report = {}
const check = (what, ok, detail = '') => {
  if (!ok) failures.push(detail ? `${what} — ${detail}` : what)
  console.log(`${ok ? '  ok  ' : '  FAIL'} ${what}${detail && !ok ? ` — ${detail}` : ''}`)
}

/** The editor's page, once the build is listening. */
async function editorPage() {
  // A cold start on a busy computer (a build just written, a scanner reading it) has taken over half a minute.
  for (let i = 0; i < 900 && !exited; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = pages.find((p) => p.type === 'page' && /index\.html/.test(p.url))
      if (page) return page
    } catch {
      // Not listening yet.
    }
    await sleep(100)
  }
  throw new Error(exited ? 'Lumen closed before its editor appeared' : 'the editor never appeared (90 s)')
}

let nextId = 0
const waiting = new Map()
const connect = (url) =>
  new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.onopen = () => resolve(ws)
    ws.onerror = () => reject(new Error('could not talk to the editor'))
    ws.onmessage = (message) => {
      const answer = JSON.parse(message.data)
      waiting.get(answer.id)?.(answer)
      waiting.delete(answer.id)
    }
  })
const send = (ws, method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId
    waiting.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
/** Runs `expression` in the editor and answers with its value; throws with the page's own error. */
async function inEditor(ws, expression) {
  const { result } = await send(ws, 'Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result?.result?.value
}

try {
  const page = await editorPage()
  report.editorAppearedMs = Date.now() - started
  const ws = await connect(page.webSocketDebuggerUrl)
  let drawn = false
  for (let i = 0; i < 150 && !drawn; i++) {
    drawn = (await inEditor(ws, 'document.readyState === "complete" && (document.getElementById("root")?.childElementCount ?? 0) > 0')) === true
    if (!drawn) await sleep(100)
  }
  report.interfaceDrawnMs = Date.now() - started
  check('the editor comes up and draws its interface', drawn)
  // The handle a test run gets is put in place once the editor's own modules have loaded.
  for (let i = 0; i < 100 && (await inEditor(ws, 'Boolean(window.__lumen)')) !== true; i++) await sleep(100)

  // The language: the first of the computer's languages Lumen speaks, as the system lists them.
  const said = await inEditor(ws, `({ lang: document.documentElement.lang, system: window.lumen?.languages ?? null, browser: [...navigator.languages], test: window.lumen?.testMode === true, handle: Boolean(window.__lumen), text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 120) })`)
  report.language = said
  const speaks = (tag) => {
    const [lang, ...rest] = String(tag).toLowerCase().split(/[-_]/)
    if (lang === 'en') return 'en'
    if (lang === 'zh') return rest.some((part) => ['hant', 'tw', 'hk', 'mo'].includes(part)) ? null : 'zh-CN'
    return null
  }
  const expected = (said.system ?? []).map(speaks).find(Boolean) ?? 'en'
  check('the page is told the computer’s languages', Array.isArray(said.system) && said.system.length > 0, `window.lumen.languages is ${JSON.stringify(said.system)}`)
  check(`it speaks the computer’s language (${expected})`, said.lang === expected, `the page is in "${said.lang}"; the system lists ${JSON.stringify(said.system)}, the browser ${JSON.stringify(said.browser)}`)
  check('a test run has the editor’s handle', said.test && said.handle)

  // A project, edited: a timeline of titles, one changed, the change taken back and put back.
  const edited = await inEditor(
    ws,
    `(async () => {
      const L = window.__lumen
      await L.session.newProject({})
      await new Promise((r) => setTimeout(r, 500))
      const project = () => L.editor.getState().project
      const track = project().tracks.find((t) => t.kind === 'video' && t.role !== 'main').id
      const main = project().tracks.find((t) => t.role === 'main').id
      let failed = 0
      for (let i = 0; i < 400; i++) if (!L.dispatch('clip.add', { id: 'smoke' + i, trackId: i % 4 ? track : main, kind: 'text', start: i * 30, duration: 30 }).ok) failed++
      const clips = Object.keys(project().clips).length
      const packed = Object.values(project().clips).filter((c) => c.trackId === main).sort((a, b) => a.start - b.start)
      const edgeToEdge = packed.every((c, i) => c.start === i * 30)
      const t = performance.now()
      for (let i = 0; i < 40; i++) L.dispatch('clip.update', { ids: ['smoke201'], patch: { transform: { opacity: 0.5 + i / 100 } } }, { coalesce: 'smoke' })
      const stepMs = (performance.now() - t) / 40
      const changed = project().clips.smoke201.transform.opacity
      L.editor.getState().undo()
      const undone = project().clips.smoke201.transform.opacity
      L.editor.getState().redo()
      const redone = project().clips.smoke201.transform.opacity
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return { failed, clips, mainClips: packed.length, edgeToEdge, stepMs: Math.round(stepMs * 100) / 100, changed, undone, redone, home: L.session.useSession.getState().home, domNodes: document.querySelectorAll('*').length }
    })()`,
  )
  report.editing = edited
  check('a new project opens in the editor', edited.home === false)
  check('400 clips are added', edited.failed === 0 && edited.clips === 400, `${edited.clips} clips, ${edited.failed} refused`)
  check('the main track stays packed edge to edge', edited.edgeToEdge && edited.mainClips === 100, `${edited.mainClips} clips on it`)
  const near = (value, wanted) => Math.abs(value - wanted) < 1e-9
  check('an edit is made, undone and redone', near(edited.changed, 0.89) && edited.undone === 1 && near(edited.redone, 0.89), `opacity ${edited.changed} → ${edited.undone} → ${edited.redone}`)
  // Generous on purpose: a regression to "every edit costs as much as the project is large" is ten times this.
  check(`a step of a slider at 400 clips stays quick (${edited.stepMs} ms)`, edited.stepMs < 25)
  ws.close()
} catch (err) {
  check('the run got to its end', false, err instanceof Error ? err.message : String(err))
} finally {
  child.kill()
  for (let i = 0; i < 30 && !exited; i++) await sleep(100)
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // Still held for a moment by a process on its way out; it is in the temp folder.
  }
}

console.log(JSON.stringify(report))
if (failures.length) {
  console.error(`smoke: ${failures.length} check${failures.length === 1 ? '' : 's'} failed`)
  process.exit(1)
}
console.log('smoke: the build starts, speaks the computer’s language and edits')
