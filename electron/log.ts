import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { inspect } from 'node:util'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { mt } from './i18n'

/**
 * Lumen's log: what went wrong, kept where it can be read afterwards.
 *
 * An installed app has no console. An exception nothing caught, a promise nothing handled, a warning from this
 * process or from the editor's page, an editor whose process died: each was said to a console nobody has open,
 * and the last left a blank window. They are written to userData/logs/lumen.log — when, how bad, from where,
 * what — and the two a user has to know about are also said in a dialog that names the file.
 *
 * The file stays small. Past its limit it becomes lumen.1.log, in place of the one before, and a new one is
 * started; a line said over and over is written once and counted; a minute holds only so many lines.
 */

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogOptions {
  dir: string
  /** Bytes the file may reach before the next line starts a new one. */
  limit?: number
  /** Lines one minute may hold. What is past that is counted, not written. */
  perMinute?: number
  now?: () => number
}

const LIMIT = 1024 * 1024
const PER_MINUTE = 240
/** A line is cut here: a stack is a few hundred characters, a project printed by mistake is megabytes. */
const LONGEST = 6000

const said = (what: unknown) => (typeof what === 'string' ? what : what instanceof Error ? (what.stack ?? `${what.name}: ${what.message}`) : inspect(what, { depth: 3, breakLength: Infinity }))

export function openLog({ dir, limit = LIMIT, perMinute = PER_MINUTE, now = Date.now }: LogOptions) {
  const file = path.join(dir, 'lumen.log')
  let size = -1
  let last = ''
  let repeats = 0
  let minute = -1
  let lines = 0
  let dropped = 0

  const put = (level: LogLevel, source: string, text: string) => {
    if (size < 0) {
      fs.mkdirSync(dir, { recursive: true })
      size = fs.existsSync(file) ? fs.statSync(file).size : 0
    }
    if (size >= limit) {
      fs.renameSync(file, path.join(dir, 'lumen.1.log'))
      size = 0
    }
    const line = Buffer.from(`${new Date(now()).toISOString()} ${level.toUpperCase().padEnd(5)} ${source}: ${text}\n`)
    fs.appendFileSync(file, line)
    size += line.length
  }

  const flush = () => {
    try {
      if (repeats) put('info', 'log', `The line above was said ${repeats} more time${repeats === 1 ? '' : 's'}.`)
      if (dropped) put('warn', 'log', `${dropped} more line${dropped === 1 ? ' was' : 's were'} left out of that minute.`)
    } catch {
      // Counted or not, there is nowhere to say so.
    }
    repeats = 0
    dropped = 0
  }

  return {
    file,
    flush,
    write(level: LogLevel, source: string, ...what: unknown[]) {
      // A log that can't be written must not be one more thing that goes wrong.
      try {
        const text = what.map(said).join(' ').slice(0, LONGEST)
        const key = `${level} ${source} ${text}`
        if (key === last) {
          repeats++
          return
        }
        const at = Math.floor(now() / 60_000)
        if (at !== minute) {
          flush()
          minute = at
          lines = 0
        }
        if (lines >= perMinute) {
          dropped++
          return
        }
        flush()
        last = key
        lines++
        put(level, source, text)
      } catch {
        // Nowhere to say it.
      }
    },
  }
}

let log: ReturnType<typeof openLog> | undefined
const current = () => (log ??= openLog({ dir: path.join(app.getPath('userData'), 'logs') }))

export const logFile = () => current().file

/** Writes a line to the log. Never throws. */
export function record(level: LogLevel, source: string, ...what: unknown[]) {
  try {
    current().write(level, source, ...what)
  } catch {
    // Not even the folder could be named.
  }
}

/** Shows the log in Explorer / Finder. */
export function showLog() {
  current().flush()
  const file = logFile()
  if (fs.existsSync(file)) shell.showItemInFolder(file)
  else void shell.openPath(path.dirname(file))
}

let told = 0

/** An exception nothing caught: Lumen goes on, and the user is told once — not once for each time a timer throws. */
function tell(err: unknown) {
  if (Date.now() - told < 60_000) return
  told = Date.now()
  // An exception thrown from here would end the process.
  try {
    const what = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 600)
    dialog.showErrorBox(mt('Lumen ran into a problem'), `${what}\n\n${mt('Lumen is still running. If something looks wrong, save your project and start Lumen again.\n\nWhat happened is written in:\n{0}', logFile())}`)
  } catch {
    // It is in the log.
  }
}

/** Starts the log, and sends to it what this process would have said to a console. */
export function initLog() {
  record('info', 'main', `Lumen ${app.getVersion()} started (Electron ${process.versions.electron}, ${os.type()} ${os.release()} ${process.arch}${app.isPackaged ? '' : ', not packaged'})`)
  process.on('uncaughtException', (err) => {
    record('error', 'main', 'Nothing caught this exception:', err)
    tell(err)
  })
  process.on('unhandledRejection', (reason) => record('error', 'main', 'Nothing handled this rejection:', reason))
  for (const level of ['warn', 'error'] as const) {
    const print = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      record(level, 'main', ...args)
      print(...args)
    }
  }
  app.on('child-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') record('error', 'main', `The ${details.name ?? details.type} process stopped (${details.reason}, exit code ${details.exitCode}).`)
  })
  app.on('quit', () => log?.flush())
}

/** The page's own files are named by what they are, not by where this copy of Lumen is installed. */
const fileOf = (url: string) => url.split(/[?#]/)[0].split('/').pop() || url

/**
 * The editor's window. What its page warns of and fails at is logged, and a page whose process died is offered
 * again rather than left as a blank window: the project comes back from its recovery copy.
 */
export function watchEditor(win: BrowserWindow, close: (win: BrowserWindow) => void) {
  const page = win.webContents
  page.on('console-message', (e) => {
    if (e.level !== 'warning' && e.level !== 'error') return
    record(e.level === 'error' ? 'error' : 'warn', 'editor', e.sourceId ? `${e.message} (${fileOf(e.sourceId)}:${e.lineNumber})` : e.message)
  })
  page.on('preload-error', (_e, file, err) => record('error', 'editor', `The preload script ${path.basename(file)} failed:`, err))
  page.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    // -3 is a load that was given up for another one (a reload), not one that failed.
    if (isMainFrame && code !== -3) record('error', 'editor', `The editor’s page didn’t load (${code} ${description}): ${url}`)
  })
  win.on('unresponsive', () => record('warn', 'editor', 'The editor stopped responding.'))
  win.on('responsive', () => record('info', 'editor', 'The editor is responding again.'))
  page.on('render-process-gone', (_e, details) => {
    if (details.reason === 'clean-exit') return
    record('error', 'editor', `The editor’s process stopped (${details.reason}, exit code ${details.exitCode}).`)
    void (async () => {
      if (win.isDestroyed()) return
      const { response } = await dialog.showMessageBox(win, {
        type: 'error',
        buttons: [mt('Reopen the editor'), mt('Close Lumen')],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        title: 'Lumen',
        message: mt('Lumen’s editor stopped working'),
        detail: mt('Reopen it to carry on: the changes you hadn’t saved are offered back from the recovery copy.\n\nWhat happened is written in:\n{0}', logFile()),
      })
      if (win.isDestroyed()) return
      if (response === 0) page.reload()
      else close(win)
    })()
  })
}
