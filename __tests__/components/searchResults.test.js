/**
 * The web search modal's list has a slot for every result, so its scrollbar
 * stands for all of them (useSearchResults). The first page tells how many
 * there are; the rest are placeholders until the list asks for their page,
 * wherever the user has scrolled to. Each page is asked for once, and an
 * answer for an earlier query only fills that query's slots.
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import {
  SEARCH_PAGE_SIZE,
  SEARCH_TYPING_DELAY_MS,
  isPlaceholder,
  useSearchResults,
} from '@src/components/Search/useSearchResults'

const TOTAL = 120
const item = (query, i) => ({ _id: `${query || 'recent'}-${i}`, title: `${query} ${i}` })

let requests
let delays
let failures
beforeEach(() => {
  requests = []
  delays = {}
  failures = 0
  jest.spyOn(console, 'error').mockImplementation(() => {})
  global.fetch = jest.fn(async (url, { body }) => {
    const { query, page, limit } = JSON.parse(body)
    requests.push({ query, page, limit })
    if (delays[query]) await new Promise((resolve) => setTimeout(resolve, delays[query]))
    if (failures > 0) {
      failures--
      return { ok: false, status: 500, json: async () => ({}) }
    }
    const start = page * limit
    const count = Math.max(0, Math.min(limit, TOTAL - start))
    return {
      ok: true,
      json: async () => ({
        results: Array.from({ length: count }, (_, i) => item(query, start + i)),
        total: TOTAL,
        hasNextPage: start + limit < TOTAL,
      }),
    }
  })
})
afterEach(() => jest.restoreAllMocks())

const render = (query) => renderHook(({ q }) => useSearchResults(q), { initialProps: { q: query } })
const ids = (options) => options.map((o) => (isPlaceholder(o) ? `slot ${o.slot} (page ${o.page})` : o._id))

it('gives every result a slot once the first page arrives, the rest as placeholders', async () => {
  const { result } = render('')
  expect(result.current.isLoading).toBe(true)

  await waitFor(() => expect(result.current.options).toHaveLength(TOTAL))
  expect(SEARCH_PAGE_SIZE).toBe(50)
  expect(requests).toEqual([{ query: '', page: 0, limit: 50 }])
  expect(result.current.total).toBe(TOTAL)
  expect(result.current.options.slice(0, 50).every((o) => !isPlaceholder(o))).toBe(true)
  expect(ids(result.current.options.slice(49, 51))).toEqual(['recent-49', 'slot 50 (page 1)'])
  // The last page is short: 120 slots, not 150
  expect(result.current.options.at(-1)).toEqual({ placeholder: true, page: 2, slot: 119 })
})

it('fills whichever page is asked for, without the ones before it', async () => {
  const { result } = render('')
  await waitFor(() => expect(result.current.options).toHaveLength(TOTAL))

  act(() => result.current.requestPage(2))
  await waitFor(() => expect(isPlaceholder(result.current.options[100])).toBe(false))

  expect(result.current.options[100]._id).toBe('recent-100')
  expect(result.current.options.at(-1)._id).toBe('recent-119')
  expect(isPlaceholder(result.current.options[50])).toBe(true)
  expect(requests.map((r) => r.page)).toEqual([0, 2])
})

it('asks for each page once, however many of its rows ask', async () => {
  const { result } = render('')
  await waitFor(() => expect(result.current.options).toHaveLength(TOTAL))

  act(() => {
    result.current.requestPage(1)
    result.current.requestPage(1)
    result.current.requestPage(1)
  })
  await waitFor(() => expect(isPlaceholder(result.current.options[50])).toBe(false))
  act(() => result.current.requestPage(1))
  act(() => result.current.requestPage(0))

  expect(requests.map((r) => r.page)).toEqual([0, 1])
})

it('sends a typed query once typing pauses, and keeps each query\'s pages', async () => {
  const { result, rerender } = render('')
  await waitFor(() => expect(result.current.options).toHaveLength(TOTAL))

  rerender({ q: 'th' })
  rerender({ q: 'the' })
  await waitFor(() => expect(result.current.options[0]?._id).toBe('the-0'), { timeout: SEARCH_TYPING_DELAY_MS + 1000 })
  expect(requests.map((r) => r.query)).toEqual(['', 'the'])

  // Back to the empty box: what was loaded shows at once, nothing is asked again
  rerender({ q: '' })
  expect(result.current.options[0]._id).toBe('recent-0')
  expect(requests).toHaveLength(2)
})

it("shows Recently Added at once when the box is cleared, not the last query's results", async () => {
  const { result, rerender } = render('the')
  await waitFor(() => expect(result.current.options[0]?._id).toBe('the-0'), { timeout: SEARCH_TYPING_DELAY_MS + 1000 })

  rerender({ q: '' })
  await waitFor(() => expect(result.current.options[0]?._id).toBe('recent-0'))
  rerender({ q: 'x' })
  expect(result.current.options[0]._id).toBe('recent-0')
  await waitFor(() => expect(result.current.options[0]?._id).toBe('x-0'), { timeout: SEARCH_TYPING_DELAY_MS + 1000 })
})

it('never fills a newer query with a late answer for an earlier one', async () => {
  delays.slow = 400
  const { result, rerender } = render('slow')
  await waitFor(() => expect(requests.map((r) => r.query)).toContain('slow'), { timeout: SEARCH_TYPING_DELAY_MS + 1000 })

  rerender({ q: 'fast' })
  await waitFor(() => expect(result.current.options[0]?._id).toBe('fast-0'), { timeout: SEARCH_TYPING_DELAY_MS + 1000 })
  await new Promise((resolve) => setTimeout(resolve, 500))

  expect(result.current.options[0]._id).toBe('fast-0')
})

it('says so when the first page fails, and tries again on request', async () => {
  failures = 1
  const { result } = render('')
  await waitFor(() => expect(result.current.failed).toBe(true))
  expect(result.current.isLoading).toBe(false)
  expect(result.current.options).toHaveLength(0)

  act(() => result.current.retry())
  await waitFor(() => expect(result.current.options).toHaveLength(TOTAL))
  expect(result.current.failed).toBe(false)
})

it('asks again for a later page that failed, the next time its rows ask', async () => {
  const { result } = render('')
  await waitFor(() => expect(result.current.options).toHaveLength(TOTAL))

  failures = 1
  act(() => result.current.requestPage(1))
  await waitFor(() => expect(console.error).toHaveBeenCalled())
  act(() => result.current.requestPage(1))
  await waitFor(() => expect(isPlaceholder(result.current.options[50])).toBe(false))
  expect(requests.map((r) => r.page)).toEqual([0, 1, 1])
})
