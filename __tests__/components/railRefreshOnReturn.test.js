/**
 * A rail on a page the viewer comes back to.
 *
 * Next keeps the page a viewer navigates away from (cacheComponents: the route
 * sits in a hidden <Activity>) and shows it again on Back, state and all. While
 * it is hidden its effects are stopped, the rail's 10 s poll among them, and
 * nothing asked the server as it came back. So the home page returned with the
 * cards it left with: a title just watched was missing from Watch History
 * until the poll came round again, ten seconds later.
 */

import React, { act, Activity, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { waitFor } from '@testing-library/react'
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

// jsdom's 1024 px window fits 3 desktop cards per page
const PER_PAGE = 3

// The list on the server, most recent first
let list
const card = (title) => (title ? { id: title, title, type: 'movie' } : null)
const answer = (body) => ({ status: 200, ok: true, headers: { get: () => null }, json: async () => body })

let requests
function serve(url) {
  const query = new URL(url, 'https://app.example').searchParams
  const limit = Number(query.get('limit'))
  const page = Number(query.get('page'))
  requests.push({ page, limit })
  const start = page * limit
  return answer({
    previousItem: card(list[start - 1]),
    currentItems: list.slice(start, start + limit).map(card),
    nextItem: card(list[start + limit]),
    playlist: null,
  })
}
// Requests for the page on show (not the look-ahead at its neighbour)
const asked = (page = 0) => requests.filter((request) => request.page === page && request.limit === PER_PAGE).length

let container
let root
let cache

const wait = (ms) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) })
const titles = () => [...container.querySelectorAll('.card:not(.peek)')].map((node) => node.textContent)

// The page as the router holds it: on show, or kept while the viewer is elsewhere
async function page(props, { away = false, strict = false } = {}) {
  const tree = (
    <SWRConfig value={{ provider: () => cache }}>
      <Activity mode={away ? 'hidden' : 'visible'}>
        <HorizontalScroll sort="id" sortOrder="desc" {...props} />
      </Activity>
    </SWRConfig>
  )
  await act(async () => {
    root.render(strict ? <StrictMode>{tree}</StrictMode> : tree)
  })
  await wait(20)
}

beforeEach(() => {
  expect(window.innerWidth).toBe(1024)
  requests = []
  cache = new Map()
  list = Array.from({ length: 20 }, (_, i) => `Title ${i}`)
  global.fetch = jest.fn(async (url) => serve(String(url)))
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  }
  jest.spyOn(console, 'log').mockImplementation(() => {})

  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  jest.restoreAllMocks()
})

describe.each(['recentlyWatched', 'movie'])('a %s rail on a page the viewer comes back to', (listType) => {
  const props = { numberOfItems: 20, listType }

  it('asks for its page again as it comes back, and shows what changed while it was away', async () => {
    await page(props)
    await waitFor(() => expect(titles()).toEqual(['Title 0', 'Title 1', 'Title 2']))

    // The viewer goes to another page and watches something
    await page(props, { away: true })
    requests.length = 0
    list.unshift('Just watched')
    await wait(1100)
    // A page nobody is looking at asks for nothing
    expect(requests).toHaveLength(0)

    // Back
    await page(props)

    // Long before the 10 s poll would have come round
    await waitFor(() => expect(titles()).toEqual(['Just watched', 'Title 0', 'Title 1']), { timeout: 1000 })
    expect(asked()).toBe(1)
  })

  it('asks once when it first appears', async () => {
    await page(props)
    await waitFor(() => expect(titles()).toHaveLength(PER_PAGE))
    await wait(100)

    expect(asked()).toBe(1)
  })

  it('asks once in development too, where React runs every effect twice in a row', async () => {
    await page(props, { strict: true })
    await waitFor(() => expect(titles()).toHaveLength(PER_PAGE))
    await wait(100)

    expect(asked()).toBe(1)
  })
})
