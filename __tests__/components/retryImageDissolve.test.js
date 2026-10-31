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
afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

/** A slow image: it loads well after the blur went over it, so the blur was seen. */
function loadAfterBlurSeen(img) {
  act(() => jest.advanceTimersByTime(300))
  fireEvent.load(img())
}

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

  loadAfterBlurSeen(img)
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

  loadAfterBlurSeen(img)
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

  loadAfterBlurSeen(img)
  await act(async () => {})

  expect(blurLayer().style.opacity).toBe('0')
})

describe('only when the blur was seen', () => {
  const order = (container) => Array.from(container.firstChild ? container.childNodes : []).map((n) => n.tagName)

  test('the server HTML puts the blur behind the image, so a cached image paints over it before any script runs', () => {
    const { renderToString } = require('react-dom/server')
    const html = renderToString(<RetryImage src={SRC} alt="Poster" fill placeholder="blur" blurDataURL={BLUR} />)
    expect(html.indexOf('<span')).toBeGreaterThanOrEqual(0)
    expect(html.indexOf('<span')).toBeLessThan(html.indexOf('<img'))
  })

  test('an image already there when it mounts shows at once: no crossfade, no mask', () => {
    jest.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true)
    jest.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(400)
    const { container, blurLayer, img } = renderPoster()

    // The blur stays behind the image, which covers it
    expect(order(container)).toEqual(['SPAN', 'IMG'])

    fireEvent.load(img())
    expect(blurLayer()).toBeNull()
    expect(mockBuild).not.toHaveBeenCalled()
  })

  test('an image still loading after a moment gets the blur over it, without remounting the image', () => {
    const { container, img } = renderPoster()
    const image = img()
    // Behind at first: a quick image paints straight over it
    expect(order(container)).toEqual(['SPAN', 'IMG'])

    act(() => jest.advanceTimersByTime(150))

    expect(order(container)).toEqual(['IMG', 'SPAN'])
    expect(img()).toBe(image)
  })

  test('a load while the blur is still behind drops it at once, never covering the image', () => {
    const { blurLayer, img } = renderPoster()
    act(() => jest.advanceTimersByTime(50))

    fireEvent.load(img())

    expect(blurLayer()).toBeNull()
    expect(mockBuild).not.toHaveBeenCalled()
  })
})
