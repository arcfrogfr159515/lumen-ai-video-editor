import { net } from 'electron'

/**
 * Requests that give up. A request to a service ends when the user cancels it
 * — and, with these, when the service doesn't answer: a connection that stays
 * open and says nothing would otherwise keep a job "working" until Lumen is
 * closed.
 */

const span = (ms: number) => (ms >= 120_000 ? `${Math.round(ms / 60_000)} minutes` : `${Math.round(ms / 1000)} seconds`)

/**
 * Runs a request (and the reading of its answer) with `ms` to finish. `signal`
 * is the user's cancel, when there is one; `who` names the service in the
 * error a request that ran out of time fails with.
 */
export async function within<T>(ms: number, who: string, signal: AbortSignal | null | undefined, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const clock = AbortSignal.timeout(ms)
  try {
    return await run(signal ? AbortSignal.any([signal, clock]) : clock)
  } catch (err) {
    if (clock.aborted && !signal?.aborted) throw new Error(`${who} took too long to answer (more than ${span(ms)}).`)
    throw err
  }
}

/** Statuses that come without a body: a Response for one can't be given a stream. */
const BODILESS = [101, 204, 205, 304]

/**
 * A download that gives up: `answerMs` for the server to start answering, then
 * `stallMs` between any two pieces of the body. A large file takes as long as
 * it takes — as long as it keeps coming.
 */
export async function steadyFetch(url: string, init: RequestInit = {}, opts: { answerMs?: number; stallMs?: number } = {}): Promise<Response> {
  const answerMs = opts.answerMs ?? 30_000
  const stallMs = opts.stallMs ?? 60_000
  const host = new URL(url).hostname
  const stop = new AbortController()
  const outer = init.signal ?? undefined
  let timer = setTimeout(() => stop.abort(new Error(`${host} took too long to answer.`)), answerMs)
  let res: Response
  try {
    res = await net.fetch(url, { ...init, signal: outer ? AbortSignal.any([outer, stop.signal]) : stop.signal })
  } catch (err) {
    if (stop.signal.aborted && !outer?.aborted) throw stop.signal.reason
    throw err
  } finally {
    clearTimeout(timer)
  }
  if (!res.body || BODILESS.includes(res.status)) return res
  const arm = () => {
    clearTimeout(timer)
    timer = setTimeout(() => stop.abort(new Error(`${host} stopped sending part-way.`)), stallMs)
    timer.unref?.()
  }
  arm()
  const body = res.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        arm()
        controller.enqueue(chunk)
      },
      flush: () => clearTimeout(timer),
      cancel: () => clearTimeout(timer),
    }),
  )
  return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers })
}
