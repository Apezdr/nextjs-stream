/**
 * The Watch History row with its date strip, in a browser-like DOM.
 *
 * A long history gets the strip where the page dots were, and the date beside
 * its title. Dragging the strip shows the titles under the handle, and what it
 * may cost the server is the point of the design: nothing while the handle
 * sweeps, one block of 48 once it stays put, and no request at all for the
 * page it settles on, which is put together from that block.
 */

import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

jest.mock('framer-motion', () => {
  const React = require('react')
  const Div = React.forwardRef(function MotionDiv({ children, className, style }, ref) {
    return (
      <div ref={ref} className={className} style={style}>
        {children}
      </div>
    )
  })
  return { motion: { div: Div }, AnimatePresence: ({ children }) => <>{children}</> }
})

jest.mock('@src/components/MediaScroll/Card', () => ({
  __esModule: true,
  default: ({ title, isPeek }) => <div className={isPeek ? 'card peek' : 'card'}>{title}</div>,
}))

jest.mock('@src/contexts/LandingPagePopupContext', () => ({
  useLandingPagePopup: () => ({ expandedCardId: null, expandCard: jest.fn(), collapseCard: jest.fn() }),
}))

const HorizontalScroll = require('@src/components/MediaScroll/HorizontalScroll').default
const { dateKey } = require('@src/components/MediaScroll/scrubber/timeline')

// jsdom's 1024 px window fits 3 desktop cards per page
const PER_PAGE = 3
const TOTAL = 400

// 4 titles on each of the last 100 days: positions 0-3 today, 4-7 yesterday…
const today = new Date()
const DAYS = Array.from({ length: TOTAL / 4 }, (_, i) => [
  dateKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - i, 12)),
  4,
])

const cardAt = (position, withPosition) =>
  position < 0 || position >= TOTAL
    ? null
    : { id: `id-${position}`, title: `Title ${position}`, type: 'movie', ...(withPosition ? { listPosition: position } : {}) }

const answer = (body) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body })

let requests
function serve(url) {
  requests.push(url)
  const query = new URL(url, 'https://app.example').searchParams
  if (url.includes('/horizontal-list/timeline')) {
    return answer({ timeZone: query.get('tz'), total: TOTAL, days: DAYS })
  }
  const limit = Number(query.get('limit'))
  const start = Number(query.get('page')) * limit
  const withPosition = query.get('positions') === 'true'
  return answer({
    previousItem: cardAt(start - 1, withPosition),
    currentItems: Array.from({ length: limit }, (_, i) => cardAt(start + i, withPosition)).filter(Boolean),
    nextItem: cardAt(start + limit, withPosition),
    playlist: null,
  })
}
const blockRequests = () => requests.filter((url) => url.includes('positions=true'))
const pageRequests = (page) => requests.filter((url) => url.includes(`limit=${PER_PAGE}&`) && url.endsWith(`page=${page}&includeWatchHistory=true`))

let container
let root
let headSlot

async function show(props) {
  await act(async () => {
    root.render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <HorizontalScroll sort="id" sortOrder="desc" {...props} />
      </SWRConfig>
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}
const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
// The real cards on show. While the handle is over another page they are hidden
// (.invisible) behind the lightweight ones.
const titles = () =>
  [...container.querySelectorAll('.cards-row:not(.invisible) .card:not(.peek)')].map((card) => card.textContent)

beforeEach(() => {
  expect(window.innerWidth).toBe(1024)
  requests = []
  global.fetch = jest.fn(async (url) => serve(String(url)))
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  // jsdom has no PointerEvent: without one a pointer event carries no position
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, init = {}) {
      super(type, init)
      this.pointerId = init.pointerId
      this.pointerType = init.pointerType
    }
  }
  jest.spyOn(console, 'log').mockImplementation(() => {})

  headSlot = document.createElement('div')
  headSlot.id = 'rail-head-recentlyWatched'
  container = document.createElement('div')
  document.body.append(headSlot, container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  headSlot.remove()
  container.remove()
  jest.restoreAllMocks()
})

describe('which rows get the strip', () => {
  it('a long Watch History trades its dots for the strip and gets a date beside its title', async () => {
    await show({ numberOfItems: TOTAL, listType: 'recentlyWatched' })

    await waitFor(() => expect(container.querySelector('[role="slider"]')).not.toBeNull())
    expect(container.querySelector('[aria-label^="Go to page"]')).toBeNull()
    expect(requests.find((url) => url.includes('/timeline'))).toContain(
      `tz=${encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)}`
    )
    // Positions 0-2 were all watched today
    expect(headSlot.textContent).toContain('Today')
    expect(container.querySelector('[role="slider"]').getAttribute('aria-valuetext')).toBe('Today')
    expect(headSlot.textContent).not.toContain('Back to today')
  })

  it('a short Watch History keeps its dots and asks for no counts', async () => {
    await show({ numberOfItems: 20, listType: 'recentlyWatched' })

    expect(container.querySelector('[role="slider"]')).toBeNull()
    expect(container.querySelectorAll('[aria-label^="Go to page"]')).toHaveLength(7)
    expect(requests.some((url) => url.includes('/timeline'))).toBe(false)
    expect(headSlot.textContent).toBe('')
  })

  it('another row stays as it was, however long', async () => {
    await show({ numberOfItems: TOTAL, listType: 'movie' })

    expect(container.querySelector('[role="slider"]')).toBeNull()
    expect(requests.some((url) => url.includes('/timeline'))).toBe(false)
    expect(blockRequests()).toHaveLength(0)
  })
})

describe('dragging the strip', () => {
  let slider
  const at = (fraction) => ({ clientX: fraction * 700, pointerId: 1, pointerType: 'mouse', button: 0 })

  beforeEach(async () => {
    await show({ numberOfItems: TOTAL, listType: 'recentlyWatched' })
    await waitFor(() => expect(container.querySelector('[role="slider"]')).not.toBeNull())
    slider = container.querySelector('[role="slider"]')
    slider.setPointerCapture = jest.fn()
    slider.firstChild.getBoundingClientRect = () => ({ left: 0, top: 0, width: 700, height: 40, right: 700, bottom: 40 })
    requests.length = 0
  })

  it('asks for nothing while the handle sweeps, then one block where it stays', async () => {
    await act(async () => fireEvent.pointerDown(slider, at(0.1)))
    for (const fraction of [0.2, 0.35, 0.5, 0.65, 0.8]) {
      await act(async () => fireEvent.pointerMove(slider, at(fraction)))
    }
    expect(blockRequests()).toHaveLength(0)
    // Placeholders stand in for cards that have not been asked for
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0)

    await wait(130)

    expect(blockRequests().length).toBeGreaterThanOrEqual(1)
    expect(blockRequests().length).toBeLessThanOrEqual(2)
    expect(blockRequests()[0]).toContain('limit=48')
    expect(blockRequests()[0]).toContain('type=recentlyWatched')
    expect(blockRequests()[0]).toContain('includeWatchHistory=true')
  })

  it('shows the titles under the handle without letting go, and settles with no request for the page', async () => {
    await act(async () => fireEvent.pointerDown(slider, at(0.5)))
    await act(async () => fireEvent.pointerMove(slider, at(0.52)))
    // Moving: the page's real cards are not shown yet
    expect(titles()).toEqual([])

    // The block arrives and the handle has rested: the page's real cards are in
    await waitFor(() => expect(titles().length).toBe(PER_PAGE), { timeout: 2000 })
    const first = Number(titles()[0].replace('Title ', ''))
    const page = first / PER_PAGE
    expect(Number.isInteger(page)).toBe(true)
    expect(page).toBeGreaterThan(10)
    expect(titles()).toEqual([`Title ${first}`, `Title ${first + 1}`, `Title ${first + 2}`])

    await act(async () => fireEvent.pointerUp(slider, at(0.52)))
    await wait(50)

    expect(slider.getAttribute('aria-valuenow')).toBe(String(page + 1))
    expect(titles()[0]).toBe(`Title ${first}`)
    // The page came from the block, not from a request of its own
    expect(pageRequests(page)).toHaveLength(0)
    expect(blockRequests().length).toBeLessThanOrEqual(3)
    expect(headSlot.textContent).toContain('Back to today')
  })

  it('a click on the strip goes there: the row fetches that page itself', async () => {
    await act(async () => fireEvent.pointerDown(slider, at(0.9)))
    await act(async () => fireEvent.pointerUp(slider, at(0.9)))

    await waitFor(() => expect(titles().length).toBe(PER_PAGE))
    const page = Number(titles()[0].replace('Title ', '')) / PER_PAGE
    expect(page).toBeGreaterThan(60)
    expect(pageRequests(page)).toHaveLength(1)
    expect(blockRequests()).toHaveLength(0)
  })

  it('a finger that lands on the strip while the page scrolls changes nothing', async () => {
    const touch = (fraction) => ({ ...at(fraction), pointerType: 'touch' })
    await act(async () => fireEvent.pointerDown(slider, touch(0.6)))
    await act(async () => fireEvent.pointerCancel(slider, touch(0.6)))
    await wait(200)

    expect(slider.getAttribute('aria-valuenow')).toBe('1')
    expect(requests).toHaveLength(0)
  })

  it('the keyboard pages, and jumps a month with Shift', async () => {
    await act(async () => fireEvent.keyDown(slider, { key: 'ArrowRight' }))
    expect(slider.getAttribute('aria-valuenow')).toBe('2')

    await act(async () => fireEvent.keyDown(slider, { key: 'End' }))
    expect(slider.getAttribute('aria-valuenow')).toBe(String(Math.ceil(TOTAL / PER_PAGE)))

    await act(async () => fireEvent.keyDown(slider, { key: 'Home' }))
    expect(slider.getAttribute('aria-valuenow')).toBe('1')
  })
})
