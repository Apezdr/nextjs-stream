/**
 * IntentPrefetchLink asks for a link's full prefetch only once someone means to
 * follow it. A full prefetch is a server render per link, so the rule matters
 * most where there are many links: a pointer crossing a list must not count.
 */

import { render, screen, fireEvent, act } from '@testing-library/react'

// Surface the prop we care about as an attribute
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ prefetch, children, ...rest }) => (
    <a data-prefetch={String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}))

const IntentPrefetchLink = require('@components/MediaPages/IntentPrefetchLink').default

const link = () => screen.getByRole('link', { name: 'Preacher' })

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

describe('IntentPrefetchLink', () => {
  it('starts on the default prefetch (the route shell), not the full one', () => {
    render(<IntentPrefetchLink href="/list/tv/Preacher">Preacher</IntentPrefetchLink>)
    expect(link()).toHaveAttribute('data-prefetch', 'undefined')
    expect(link()).toHaveAttribute('href', '/list/tv/Preacher')
  })

  it('asks for the full prefetch once the pointer has rested on it', () => {
    render(<IntentPrefetchLink href="/list/tv/Preacher">Preacher</IntentPrefetchLink>)
    fireEvent.mouseEnter(link())
    act(() => jest.advanceTimersByTime(60))
    expect(link()).toHaveAttribute('data-prefetch', 'undefined')
    act(() => jest.advanceTimersByTime(100))
    expect(link()).toHaveAttribute('data-prefetch', 'true')
  })

  it('ignores a pointer that only passes over it', () => {
    render(<IntentPrefetchLink href="/list/tv/Preacher">Preacher</IntentPrefetchLink>)
    fireEvent.mouseEnter(link())
    act(() => jest.advanceTimersByTime(60))
    fireEvent.mouseLeave(link())
    act(() => jest.advanceTimersByTime(1000))
    expect(link()).toHaveAttribute('data-prefetch', 'undefined')
  })

  it.each([
    ['focus', (el) => fireEvent.focus(el)],
    ['touch', (el) => fireEvent.touchStart(el)],
  ])('counts %s as intent at once', (_name, trigger) => {
    render(<IntentPrefetchLink href="/list/tv/Preacher">Preacher</IntentPrefetchLink>)
    trigger(link())
    expect(link()).toHaveAttribute('data-prefetch', 'true')
  })

  it('keeps the full prefetch once asked for, and still calls the handlers it was given', () => {
    const onMouseEnter = jest.fn()
    const onMouseLeave = jest.fn()
    render(
      <IntentPrefetchLink href="/list/tv/Preacher" onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
        Preacher
      </IntentPrefetchLink>
    )
    fireEvent.mouseEnter(link())
    act(() => jest.advanceTimersByTime(200))
    fireEvent.mouseLeave(link())
    expect(link()).toHaveAttribute('data-prefetch', 'true')
    expect(onMouseEnter).toHaveBeenCalledTimes(1)
    expect(onMouseLeave).toHaveBeenCalledTimes(1)
  })
})
