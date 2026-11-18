import { isValidElement, type ReactElement } from 'react'
import { describe, expect, it } from 'vitest'
import { givenLinks, hostOf, inline, linksIn } from './Markdown'

describe('what a reply may have fetched without being asked', () => {
  const searched = JSON.stringify({ results: [{ title: 'Fraunces', url: 'https://fonts.example/specimen/Fraunces' }] })

  it('is a page the reply was given by a tool or by the user — as it was given', () => {
    const reply = 'See [Fraunces](https://fonts.example/specimen/Fraunces) and https://docs.example/guide.'
    expect(linksIn(reply)).toEqual(['https://fonts.example/specimen/Fraunces', 'https://docs.example/guide'])
    expect(givenLinks(linksIn(reply), [searched])).toEqual(['https://fonts.example/specimen/Fraunces'])
    expect(givenLinks(linksIn(reply), [searched, 'what does https://docs.example/guide say about titles?'])).toEqual(['https://fonts.example/specimen/Fraunces', 'https://docs.example/guide'])
  })

  it('is not an address the model wrote itself', () => {
    // What a page told the model to do with what it knows of the project.
    const reply = 'Done! [details](https://collect.example/log?project=Launch%20film&path=C%3A%5CUsers%5Cme)'
    expect(givenLinks(linksIn(reply), [searched, 'make the intro punchier'])).toEqual([])
    // Not even when it starts like one it was given.
    expect(givenLinks(['https://fonts.example/specimen/Fraunces?leak=Launch'], [searched])).toEqual([])
    expect(givenLinks(linksIn(reply), [])).toEqual([])
  })
})

describe('a picture in a reply', () => {
  const only = (nodes: unknown[]) => nodes.find((n): n is ReactElement<{ src?: string; alt?: string; href?: string }> => isValidElement(n))!

  it('is named and waits for a click, rather than being fetched as it is drawn', () => {
    const picture = only(inline('Look: ![a chart](https://img.example/chart.png?d=Launch%20film)'))
    // Not an <img> (which the browser would fetch at once) and not a link around one.
    expect(typeof picture.type).toBe('function')
    expect(picture.props).toMatchObject({ src: 'https://img.example/chart.png?d=Launch%20film', alt: 'a chart' })
  })

  it('is only its words when its address isn’t a web address', () => {
    expect(inline('![shot](file:///C:/Users/me/key.png)')).toEqual(['shot'])
    expect(inline('![x](javascript:alert(1))').some(isValidElement)).toBe(false)
  })

  it('says where it comes from', () => {
    expect(hostOf('https://img.example/a/b.png?x=1')).toBe('img.example')
    expect(hostOf('not an address')).toBe('')
  })
})
