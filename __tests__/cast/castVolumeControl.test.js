/**
 * @jest-environment jsdom
 *
 * The cast volume buttons.
 *
 * What matters: a press is exactly one step; holding repeats only after a
 * pause and stops on release; a mouse click never steps twice (its press
 * already did) while a keyboard click steps once; and the buttons stop at
 * the ends.
 */

import { render, screen, fireEvent, act } from '@testing-library/react'

const mockState = { volume: 7 / 15, muted: false }
const mockStore = {
  get volume() {
    return mockState.volume
  },
  setVolume: jest.fn((v) => {
    mockState.volume = v
  }),
}

jest.mock('@src/components/MediaPlayer/videojs', () => ({
  __esModule: true,
  Player: { usePlayer: (selector) => (selector ? selector(mockState) : mockStore) },
  usePlayerContext: () => ({}),
}))
jest.mock('@components/Cast/useCastSession', () => ({
  __esModule: true,
  useCastAdoption: () => ({ adopted: true }),
}))
jest.mock('@components/Cast/castSdk', () => ({
  __esModule: true,
  getContext: () => ({
    getCurrentSession: () => ({
      getSessionObj: () => ({ receiver: { volume: { stepInterval: 1 / 15 } } }),
    }),
  }),
  getRemote: () => null,
}))

import { CastVolumeControl } from '@src/components/MediaPlayer/CastVolumeControl'

const steps = () => Math.round(mockState.volume * 15)

beforeEach(() => {
  jest.useFakeTimers()
  mockState.volume = 7 / 15
  mockState.muted = false
  mockStore.setVolume.mockClear()
})
afterEach(() => jest.useRealTimers())

it('shows the receiver steps on the meter', () => {
  render(<CastVolumeControl />)
  const meter = screen.getByRole('meter', { name: 'Volume' })
  expect(meter.getAttribute('aria-valuenow')).toBe('7')
  expect(meter.getAttribute('aria-valuemax')).toBe('15')
})

it('steps once per press, and a mouse click after the press does not step again', () => {
  render(<CastVolumeControl />)
  const up = screen.getByRole('button', { name: 'Volume up' })
  fireEvent.pointerDown(up, { pointerType: 'mouse', button: 0 })
  fireEvent.pointerUp(up)
  fireEvent.click(up, { detail: 1 })
  expect(steps()).toBe(8)
})

it('repeats while held, after a pause, and stops on release', () => {
  render(<CastVolumeControl />)
  const down = screen.getByRole('button', { name: 'Volume down' })
  fireEvent.pointerDown(down, { pointerType: 'mouse', button: 0 })
  expect(steps()).toBe(6)
  act(() => jest.advanceTimersByTime(399))
  expect(steps()).toBe(6) // no repeat before the hold delay
  act(() => jest.advanceTimersByTime(1 + 200 * 3))
  expect(steps()).toBe(3) // three repeats
  fireEvent.pointerUp(down)
  act(() => jest.advanceTimersByTime(2000))
  expect(steps()).toBe(3)
})

it('stops repeating when the pointer leaves the button', () => {
  render(<CastVolumeControl />)
  const up = screen.getByRole('button', { name: 'Volume up' })
  fireEvent.pointerDown(up, { pointerType: 'mouse', button: 0 })
  fireEvent.pointerLeave(up)
  act(() => jest.advanceTimersByTime(2000))
  expect(steps()).toBe(8)
})

it('steps once for a keyboard click', () => {
  render(<CastVolumeControl />)
  fireEvent.click(screen.getByRole('button', { name: 'Volume up' }), { detail: 0 })
  expect(steps()).toBe(8)
})

it('stops at the ends', () => {
  mockState.volume = 0
  const { unmount } = render(<CastVolumeControl />)
  expect(screen.getByRole('button', { name: 'Volume down' }).disabled).toBe(true)
  unmount()
  mockState.volume = 1
  render(<CastVolumeControl />)
  expect(screen.getByRole('button', { name: 'Volume up' }).disabled).toBe(true)
})
