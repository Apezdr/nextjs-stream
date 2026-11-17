/**
 * @jest-environment node
 *
 * The Watch History date strip, without a browser: the arithmetic between a
 * place on the strip, a date and a position in the list (timeline.js), and the
 * rule for when a drag may ask the server for cards (blockLoader.js).
 *
 * The strip's promise is that dragging to a month shows that month, and that a
 * drag costs the server a handful of requests. Both are decided here.
 */

const {
  buildTimeline,
  monthIndexAt,
  dayAt,
  positionAtFraction,
  fractionAtPosition,
  positionOfDaysAgo,
  adjacentMonthPosition,
  describeRange,
  monthNames,
  dateKey,
} = require('@src/components/MediaScroll/scrubber/timeline')
const { BlockLoader, pageFromBlocks, BLOCK_SIZE } = require('@src/components/MediaScroll/scrubber/blockLoader')

// 16 November 2026, late evening
const TODAY = new Date(2026, 10, 16, 22, 6)
// Newest first. Nothing in October; September is the oldest month.
const DAYS = [
  ['2026-11-16', 3], // positions 0-2
  ['2026-11-15', 1], // 3
  ['2026-11-02', 4], // 4-7
  ['2026-09-30', 2], // 8-9
  ['2026-09-01', 6], // 10-15
]
const timeline = () => buildTimeline(DAYS, 16, TODAY)
const plain = (text) => text.replace(/[   ]/g, ' ')

describe('the months', () => {
  it('runs from this month back to the oldest, empty months included', () => {
    expect(timeline().months.map((m) => [m.key, m.count, m.start])).toEqual([
      ['2026-11', 8, 0],
      ['2026-10', 0, 8],
      ['2026-09', 8, 8],
    ])
  })

  it('starts at this month even when nothing was watched in it', () => {
    const quiet = buildTimeline([['2026-08-20', 2]], 2, TODAY)

    expect(quiet.months.map((m) => [m.key, m.count])).toEqual([['2026-11', 0], ['2026-10', 0], ['2026-09', 0], ['2026-08', 2]])
  })

  it('crosses a year boundary', () => {
    const years = buildTimeline([['2026-01-03', 1], ['2025-11-30', 1]], 2, new Date(2026, 1, 10))

    expect(years.months.map((m) => m.key)).toEqual(['2026-02', '2026-01', '2025-12', '2025-11'])
  })

  it('is one empty month for an account with no history', () => {
    const empty = buildTimeline([], 0, TODAY)

    expect(empty.months).toEqual([{ key: '2026-11', year: 2026, month: 10, count: 0, start: 0, days: [] }])
    expect(positionAtFraction(empty, 0.5)).toBe(0)
    expect(dayAt(empty, 0)).toBeNull()
    expect(describeRange(empty, 0, 7, { today: TODAY })).toBe('')
  })
})

describe('a place on the strip and a position in the list', () => {
  it('gives every month the same width, and runs newest to oldest inside one', () => {
    const t = timeline()

    expect(positionAtFraction(t, 0)).toBe(0) // the left edge is the most recent title
    expect(positionAtFraction(t, 0.33)).toBe(7) // the far side of November is its oldest title
    expect(positionAtFraction(t, 0.7)).toBe(8) // into September
    expect(positionAtFraction(t, 1)).toBe(15) // the right edge is the first title ever
  })

  it('lands an empty month on the first title older than it', () => {
    expect(positionAtFraction(timeline(), 0.5)).toBe(8)
  })

  it('puts the handle back where the page is', () => {
    const t = timeline()

    expect(fractionAtPosition(t, 0)).toBe(0)
    expect(fractionAtPosition(t, 4)).toBeCloseTo((0 + 4 / 8) / 3)
    expect(fractionAtPosition(t, 8)).toBeCloseTo(2 / 3) // September, never the empty October
    for (const position of [0, 3, 7, 8, 12, 15]) {
      expect(positionAtFraction(t, fractionAtPosition(t, position))).toBe(position)
    }
  })

  it('knows the month and the day of a position', () => {
    const t = timeline()

    expect(monthIndexAt(t, 7)).toBe(0)
    expect(monthIndexAt(t, 8)).toBe(2)
    expect(monthIndexAt(t, 400)).toBe(2) // past the end: the oldest month
    expect(dayAt(t, 0).date).toBe('2026-11-16')
    expect(dayAt(t, 3).date).toBe('2026-11-15')
    expect(dayAt(t, 9).date).toBe('2026-09-30')
    expect(dayAt(t, 400).date).toBe('2026-09-01')
  })

  it('finds the first title from so many days ago', () => {
    const t = timeline()

    expect(positionOfDaysAgo(t, 0, TODAY)).toBe(0)
    expect(positionOfDaysAgo(t, 1, TODAY)).toBe(3)
    expect(positionOfDaysAgo(t, 7, TODAY)).toBe(4) // nothing on the 9th: the next older day
    expect(positionOfDaysAgo(t, 365, TODAY)).toBe(15) // older than everything: the last title
  })

  it('steps a month at a time over the empty ones', () => {
    const t = timeline()

    expect(adjacentMonthPosition(t, 0, true)).toBe(8) // November → September
    expect(adjacentMonthPosition(t, 8, true)).toBe(15) // nothing older: the last title
    expect(adjacentMonthPosition(t, 12, false)).toBe(8) // back to September's start first
    expect(adjacentMonthPosition(t, 8, false)).toBe(0)
    expect(adjacentMonthPosition(t, 0, false)).toBe(0)
  })
})

describe('the date beside the title', () => {
  const say = (first, last) => plain(describeRange(timeline(), first, last, { today: TODAY, locale: 'en-US' }))

  it('says a page inside one day by that day', () => {
    expect(say(0, 2)).toBe('Today')
    expect(say(3, 3)).toBe('Yesterday')
    expect(say(4, 7)).toBe('Nov 2, 2026')
  })

  it('says a page across days as a range, oldest first', () => {
    expect(say(0, 7)).toBe('Nov 2 – 16, 2026')
    expect(say(4, 9)).toBe('Sep 30 – Nov 2, 2026')
  })

  it('names months and dates in local time', () => {
    expect(monthNames('en-US')).toHaveLength(12)
    expect(monthNames('en-US')[10]).toBe('Nov')
    expect(monthNames('en-US', 'long')[1]).toBe('February')
    expect(dateKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
  })
})

describe('when a drag may ask the server for cards', () => {
  const cardsOf = (block) =>
    Array.from({ length: BLOCK_SIZE }, (_, i) => ({ id: `card-${block * BLOCK_SIZE + i}`, listPosition: block * BLOCK_SIZE + i }))
  const settle = async () => { for (let i = 0; i < 6; i++) await Promise.resolve() }

  let pending
  let fetchBlock
  let onChange
  let loader
  const answer = async (block, cards = cardsOf(block)) => { pending.get(block).resolve(cards); await settle() }

  beforeEach(() => {
    jest.useFakeTimers()
    pending = new Map()
    fetchBlock = jest.fn((block) => new Promise((resolve, reject) => pending.set(block, { resolve, reject })))
    onChange = jest.fn()
    loader = new BlockLoader({ fetchBlock, onChange })
  })
  afterEach(() => jest.useRealTimers())

  it('asks at once when nobody is dragging', async () => {
    loader.aim({ lead: 3, wanted: [3], paced: false })
    await settle()

    expect(fetchBlock).toHaveBeenCalledWith(3)
  })

  it('asks for nothing while the handle sweeps across blocks', async () => {
    for (const block of [1, 2, 3, 4, 5, 6]) {
      loader.aim({ lead: block, wanted: [block], paced: true })
      jest.advanceTimersByTime(40)
    }
    await settle()

    expect(fetchBlock).not.toHaveBeenCalled()
  })

  it('asks for a block once the handle has stayed on it', async () => {
    loader.aim({ lead: 5, wanted: [5], paced: true })
    jest.advanceTimersByTime(60)
    loader.aim({ lead: 5, wanted: [5], paced: true }) // still on it: the wait does not start over
    jest.advanceTimersByTime(40)
    await settle()

    expect(fetchBlock).toHaveBeenCalledTimes(1)
    expect(fetchBlock).toHaveBeenCalledWith(5)
  })

  it('has one request out at a time, and the next is for where the handle is now', async () => {
    loader.aim({ lead: 5, wanted: [5], paced: true })
    jest.advanceTimersByTime(100)
    await settle()
    // The handle moves on while block 5 is on its way, and rests on 9
    loader.aim({ lead: 7, wanted: [7], paced: true })
    loader.aim({ lead: 9, wanted: [9], paced: true })
    jest.advanceTimersByTime(100)
    await settle()
    expect(fetchBlock).toHaveBeenCalledTimes(1)

    await answer(5)

    expect(fetchBlock.mock.calls.map(([block]) => block)).toEqual([5, 9]) // never 7
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('keeps a block it has, and fetches the one ahead in the direction of travel', async () => {
    loader.aim({ lead: 5, wanted: [5], ahead: 6, paced: true })
    jest.advanceTimersByTime(100)
    await settle()
    await answer(5)

    expect(fetchBlock.mock.calls.map(([block]) => block)).toEqual([5, 6])
    await answer(6)

    // Going back over ground already covered costs nothing
    loader.aim({ lead: 6, wanted: [6], ahead: 5, paced: true })
    jest.advanceTimersByTime(100)
    await settle()
    expect(fetchBlock).toHaveBeenCalledTimes(2)
    expect(loader.requests).toBe(2)
  })

  it('stops wanting anything when the drag ends before the wait is over', async () => {
    loader.aim({ lead: 5, wanted: [5], paced: true })
    loader.release()
    jest.advanceTimersByTime(500)
    await settle()

    expect(fetchBlock).not.toHaveBeenCalled()
  })

  it('leaves a block that failed alone for a while, then tries again', async () => {
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {})
    loader.aim({ lead: 2, wanted: [2], paced: false })
    await settle()
    pending.get(2).reject(new Error('502'))
    await settle()

    expect(loader.loaded.has(2)).toBe(false)
    expect(onChange).toHaveBeenCalledTimes(1)
    loader.aim({ lead: 2, wanted: [2], paced: false })
    await settle()
    expect(fetchBlock).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(5000)
    loader.aim({ lead: 2, wanted: [2], paced: false })
    await settle()
    expect(fetchBlock).toHaveBeenCalledTimes(2)
    quiet.mockRestore()
  })

  it('drops an answer that arrives after the list changed', async () => {
    loader.aim({ lead: 1, wanted: [1], paced: false })
    await settle()
    loader.clear()
    await answer(1)

    expect(loader.cards.size).toBe(0)
    expect(loader.loaded.size).toBe(0)
    expect(onChange).not.toHaveBeenCalled()
  })

  it('puts a page together from blocks, without the titles the library no longer holds', async () => {
    loader.aim({ lead: 0, wanted: [0, 1], paced: false })
    await settle()
    // Position 46 is gone from the library: the block arrives without it
    await answer(0, cardsOf(0).filter((card) => card.listPosition !== 46))
    expect(pageFromBlocks(loader, 44, 4, 200)).toBeNull() // its next neighbour is in block 1

    await answer(1)
    const page = pageFromBlocks(loader, 44, 4, 200)

    expect(page.currentItems.map((card) => card.listPosition)).toEqual([44, 45, 47])
    expect(page.previousItem.listPosition).toBe(43)
    expect(page.nextItem.listPosition).toBe(48)
    expect(page.playlist).toBeNull()
  })

  it('gives the first and the last page no neighbour beyond the list', async () => {
    loader.aim({ lead: 0, wanted: [0], paced: false })
    await settle()
    await answer(0, cardsOf(0).slice(0, 10))

    expect(pageFromBlocks(loader, 0, 4, 10).previousItem).toBeNull()
    expect(pageFromBlocks(loader, 8, 4, 10)).toMatchObject({ nextItem: null })
    expect(pageFromBlocks(loader, 8, 4, 10).currentItems).toHaveLength(2)
    expect(pageFromBlocks(loader, 12, 4, 10)).toBeNull()
  })
})
