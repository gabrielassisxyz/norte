import { afterEach, describe, expect, it } from 'vitest'

import type { LibraryHeading } from './data/source'
import { currentHeadingAnchor } from './readerHeadings'

const HEADINGS: LibraryHeading[] = [
  { level: 2, text: 'A', anchor: 'a' },
  { level: 2, text: 'B', anchor: 'b' },
  { level: 2, text: 'Gone', anchor: 'gone' }
]

afterEach(() => {
  document.body.innerHTML = ''
})

/** jsdom lays nothing out, so each element reports the top the test gives it. */
function scrollerWith(tops: Record<string, number>, scrollTop: number): HTMLElement {
  const container = document.createElement('div')
  container.getBoundingClientRect = () => new DOMRect(0, 0, 100, 100)
  container.scrollTop = scrollTop
  for (const [id, top] of Object.entries(tops)) {
    const heading = document.createElement('h2')
    heading.id = id
    heading.getBoundingClientRect = () => new DOMRect(0, top - scrollTop, 100, 10)
    container.append(heading)
  }
  document.body.append(container)
  return container
}

describe('currentHeadingAnchor', () => {
  it('is undefined before the first heading', () => {
    expect(currentHeadingAnchor(scrollerWith({ a: 300, b: 600 }, 0), HEADINGS)).toBeUndefined()
  })

  it('is the heading above the top, between two', () => {
    expect(currentHeadingAnchor(scrollerWith({ a: 300, b: 600 }, 450), HEADINGS)).toBe('a')
  })

  it('is the last heading past it, skipping one the text no longer has', () => {
    expect(currentHeadingAnchor(scrollerWith({ a: 300, b: 600 }, 900), HEADINGS)).toBe('b')
  })

  it('counts a heading within the slack below the top as the one above it', () => {
    const container = scrollerWith({ a: 300, b: 600 }, 584)
    expect(currentHeadingAnchor(container, HEADINGS)).toBe('a')
    expect(currentHeadingAnchor(container, HEADINGS, 20)).toBe('b')
  })
})
