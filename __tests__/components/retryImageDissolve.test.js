/**
 * RetryImage's dissolve: a loaded fill image waits under its blur for its
 * mask, then the blur dissolves off it; with no mask in time it fades instead.
 * The mask builder is stubbed (jsdom has no OffscreenCanvas); its own
 * behaviour is in imageDissolve.test.js.
 */

import { render, fireEvent, act } from '@testing-library/react'

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt, fill, priority, quality, placeholder, blurDataURL, sizes, ...rest }) => <img src={src} alt={alt} {...rest} />,
}))

const mockBuild = jest.fn()
jest.mock('@components/imageDissolve', () => ({
  ...jest.requireActual('@components/imageDissolve'),
  canDissolve: () => true,
  buildDissolveMask: (...args) => mockBuild(...args),
}))

const { default: RetryImage, FADE_MS } = require('@components/RetryImage')
const { DISSOLVE_MS, FRAMES } = require('@components/imageDissolve')

const BLUR = 'data:image/png;base64,AAAA'
const SRC = 'https://img.test/poster.jpg'

beforeEach(() => {
  jest.useFakeTimers()
  mockBuild.mockReset()
  URL.revokeObjectURL = jest.fn()
})
afterEach(() => jest.useRealTimers())

function renderPoster() {
  const utils = render(<RetryImage src={SRC} alt="Poster" fill placeholder="blur" blurDataURL={BLUR} className="object-cover" />)
  const blurLayer = () => utils.container.querySelector('span[aria-hidden="true"]')
  const img = () => utils.container.querySelector('img')
  return { ...utils, blurLayer, img }
}

test('the blur waits over the loaded image for its mask, then dissolves off it along it', async () => {
  let resolve
  mockBuild.mockReturnValue(new Promise((r) => (resolve = r)))
  const { blurLayer, img } = renderPoster()

  fireEvent.load(img())
  // Seeded by the image's URL, shaped by its blurhash
  expect(mockBuild).toHaveBeenCalledWith(SRC, BLUR)
  // Still whole while the mask is made
  expect(blurLayer().style.opacity).toBe('')
  expect(blurLayer().style.maskImage).toBe('')

  await act(async () => resolve({ url: 'blob:mask', size: '100% 2450%', from: '0.0866%', to: '99.9134%' }))

  expect(blurLayer().style.maskImage).toContain('blob:mask')
  expect(blurLayer().style.animation).toContain('image-dissolve')
  // One position per frame: steps(n, jump-none) holds n positions
  expect(blurLayer().style.animation).toContain(`steps(${FRAMES}, jump-none)`)
  // Where the strip sits, for the keyframes
  expect(blurLayer().style.getPropertyValue('--dissolve-from')).toBe('0.0866%')
  expect(blurLayer().style.getPropertyValue('--dissolve-to')).toBe('99.9134%')

  act(() => jest.advanceTimersByTime(DISSOLVE_MS))
  expect(blurLayer()).toBeNull()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mask')
})

test('a mask that is late gives way to the plain fade, and is thrown away when it comes', async () => {
  let resolve
  mockBuild.mockReturnValue(new Promise((r) => (resolve = r)))
  const { blurLayer, img } = renderPoster()

  fireEvent.load(img())
  act(() => jest.advanceTimersByTime(200))

  expect(blurLayer().style.opacity).toBe('0')
  expect(blurLayer().style.maskImage).toBe('')

  await act(async () => resolve({ url: 'blob:late', size: '100% 2450%', from: '0%', to: '100%' }))
  expect(blurLayer().style.maskImage).toBe('')
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late')

  act(() => jest.advanceTimersByTime(FADE_MS))
  expect(blurLayer()).toBeNull()
})

test('a mask that cannot be made gives way to the plain fade', async () => {
  mockBuild.mockRejectedValue(new Error('no canvas'))
  const { blurLayer, img } = renderPoster()

  fireEvent.load(img())
  await act(async () => {})

  expect(blurLayer().style.opacity).toBe('0')
})
