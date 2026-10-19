/**
 * The Logs page's pure parts: which sources a selection shows
 * (src/components/Admin/Logs/logSources.js) and the copy/download formats
 * (logExport.js).
 */

import {
  ALL_SOURCES,
  areaState,
  describeSelection,
  groupSources,
  isShown,
  onlyArea,
  selectionParams,
  setAreaShown,
  setCategoryShown,
} from '@components/Admin/Logs/logSources'
import { formatLine, splitMeta, toMarkdown, toText } from '@components/Admin/Logs/logExport'

const AREAS = [
  { id: 'scan', label: 'Library scan' },
  { id: 'discord', label: 'Discord & notifications' },
  { id: 'other', label: 'Other' },
]
const FACETS = [
  { name: 'movie-scanner', area: 'scan', count: 300 },
  { name: 'tv-scanner', area: 'scan', count: 90 },
  { name: 'discordBot', area: 'discord', count: 5 },
  { name: null, area: 'other', count: 2 },
]
const [scan, discord, other] = groupSources(AREAS, FACETS)

describe('log source selection', () => {
  it('groups the counted categories by area, keeping uncategorized lines in the area total only', () => {
    expect(scan).toMatchObject({ id: 'scan', count: 390 })
    expect(scan.categories.map((category) => category.name)).toEqual(['movie-scanner', 'tv-scanner'])
    expect(other).toMatchObject({ count: 2, categories: [] })
  })

  it('hides a whole area, and shows one category of it again by listing the rest', () => {
    const hidden = setAreaShown(ALL_SOURCES, scan, false)
    expect(hidden).toEqual({ mode: 'all', tokens: ['area:scan'] })
    expect(areaState(hidden, scan)).toBe('none')
    expect(describeSelection(hidden, AREAS)).toBe('Hiding Library scan')
    expect(selectionParams(hidden)).toEqual({ hide: 'area:scan' })

    const oneBack = setCategoryShown(hidden, scan, 'movie-scanner', true)
    expect(oneBack).toEqual({ mode: 'all', tokens: ['tv-scanner'] })
    expect(areaState(oneBack, scan)).toBe('some')
    expect(isShown(oneBack, 'movie-scanner', 'scan')).toBe(true)
  })

  it('isolates an area, adds a category to it, and goes back to everything when the last one is removed', () => {
    const only = onlyArea(discord)
    expect(isShown(only, 'movie-scanner', 'scan')).toBe(false)
    expect(isShown(only, 'discordBot:ready', 'discord')).toBe(true)
    expect(describeSelection(only, AREAS)).toBe('Only Discord & notifications')

    const more = setCategoryShown(only, scan, 'tv-scanner', true)
    expect(selectionParams(more)).toEqual({ only: 'area:discord,tv-scanner' })
    expect(describeSelection(more, AREAS)).toBe('Only 2 sources')

    const backToAll = setAreaShown(setCategoryShown(more, scan, 'tv-scanner', false), discord, false)
    expect(backToAll).toBe(ALL_SOURCES)
    expect(describeSelection(backToAll, AREAS)).toBe('All sources')
    expect(selectionParams(backToAll)).toEqual({})
  })
})

describe('log export formats', () => {
  const entry = {
    id: 'x',
    time: '2026-10-19T22:28:00.000Z',
    level: 'warn',
    category: 'auth-middleware',
    message: 'No credentials on GET /api/logs',
    meta: { status: 401, trace_id: 'abc123', span_id: 'def', trace_flags: 1 },
  }

  it('keeps the trace fields apart from a line\'s own fields', () => {
    expect(splitMeta(entry.meta)).toEqual({ fields: { status: 401 }, traceId: 'abc123' })
    expect(splitMeta({ trace_id: 'abc123', span_id: 'def', trace_flags: 1 })).toEqual({ fields: null, traceId: 'abc123' })
  })

  it('writes one readable line per entry, with its own fields', () => {
    expect(formatLine(entry)).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} WARN {2}\[auth-middleware\] No credentials on GET \/api\/logs \{"status":401\}$/
    )
    expect(toText([entry, entry]).split('\n')).toHaveLength(3)
  })

  it('wraps Markdown in a fence the lines cannot close, under a heading naming the filters', () => {
    const markdown = toMarkdown([{ ...entry, message: 'a ``` inside' }], {
      server: 'Default',
      sources: 'Hiding Library scan',
      level: 'Warnings and errors',
      search: 'credentials',
      range: 'Last hour',
      timeZone: 'America/New_York',
    })
    expect(markdown).toContain('### Processor log: Default')
    expect(markdown).toContain('Sources: Hiding Library scan · Level: Warnings and errors · Time: Last hour · Search: "credentials"')
    expect(markdown).toContain('````text\n')
    expect(markdown.trimEnd().endsWith('````')).toBe(true)
  })
})
