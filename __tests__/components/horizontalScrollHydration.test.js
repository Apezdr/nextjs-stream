/**
 * A hard load of /list hydrates every rail. useItemsPerPage reports its
 * server fallback (2) during hydration and the real count right after, and
 * the rails used to fetch in between: every rail requested limit=2 (plus a
 * limit=2 page-1 prefetch) and threw it away. Production traces showed both
 * on every hard load. A rail now waits for the real page size.
 */

import React, { act } from 'react'
import { renderToString } from 'react-dom/server'
import { hydrateRoot } from 'react-dom/client'
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
  default: ({ title }) => <div className="card">{title}</div>,
}))

jest.mock('@src/contexts/LandingPagePopupContext', () => ({
  useLandingPagePopup: () => ({ expandedCardId: null, expandCard: jest.fn(), collapseCard: jest.fn() }),
}))

const HorizontalScroll = require('@src/components/MediaScroll/HorizontalScroll').default

const emptyPage = {
  status: 200,
  ok: true,
  headers: { get: () => null },
  json: async () => ({ currentItems: [], previousItem: null, nextItem: null }),
}

beforeEach(() => {
  global.fetch = jest.fn(async () => emptyPage)
})

it('fetches only at the real page size after a hydrated load', async () => {
  // jsdom's 1024 px window fits 3 desktop cards per page
  expect(window.innerWidth).toBe(1024)
  const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {})

  const rail = (
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <HorizontalScroll numberOfItems={20} listType="movie" sort="id" sortOrder="asc" />
    </SWRConfig>
  )
  const container = document.createElement('div')
  container.innerHTML = renderToString(rail)
  document.body.appendChild(container)

  // Nothing is fetched while the server markup is on screen
  expect(fetch).not.toHaveBeenCalled()

  await act(async () => {
    hydrateRoot(container, rail)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

  const urls = fetch.mock.calls.map(([url]) => url)
  expect(urls.filter((url) => url.includes('limit=2'))).toEqual([])
  expect(urls).toContain('/api/authenticated/horizontal-list?type=movie&sort=id&limit=3&sortOrder=asc&page=0')
  expect(urls).toContain('/api/authenticated/horizontal-list?type=movie&sort=id&limit=3&sortOrder=asc&page=1')

  // The hydration render still matched the server's (skeleton in both)
  const hydrationErrors = consoleError.mock.calls.filter((args) =>
    /hydrat|did not match/i.test(args.map(String).join(' '))
  )
  expect(hydrationErrors).toEqual([])
  consoleError.mockRestore()
  document.body.removeChild(container)
})
