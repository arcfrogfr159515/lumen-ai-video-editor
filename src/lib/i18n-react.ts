import { createElement, Fragment, type ReactNode } from 'react'
import { translation } from './i18n'

/**
 * A sentence with something drawn in it — a name in bold, a key cap, a count: `ttx('Press {0} to split', <Kbd/>)`.
 * Like `tt`, but what goes where `{0}`, `{1}`… stand can be anything React draws.
 */
export function ttx(text: string, ...args: ReactNode[]): ReactNode {
  const parts = translation(text)
    .split(/(\{\d+\})/)
    .map((part) => {
      const place = /^\{(\d+)\}$/.exec(part)
      return place && Number(place[1]) < args.length ? args[Number(place[1])] : part
    })
  return createElement(Fragment, null, ...parts)
}
