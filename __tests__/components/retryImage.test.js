/**
 * RetryImage: a caller's onError must not cut the retries short, and when
 * the retries are spent the slot shows the blurhash, else frosted glass (or
 * nothing, for a logo or badge), never an "Image failed to load" box.
 */

import { render, screen, fireEvent, act } from '@testing-library/react'

jest.mock('next/image', () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: ({ src, alt, fill, priority, quality, placeholder, blurDataURL, sizes, ...rest }) => <img src={src} alt={alt} {...rest} />,
}))

const { default: RetryImage, FADE_MS } = require('@components/RetryImage')

const BLUR = 'data:image/png;base64,AAAA'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

/** The <img> itself: while it retries it is hidden behind the stand-in, so not found by role. */
const theImg = () => document.querySelector('img')

/** Fail the current attempt and let the retry delay pass. */
function failAndWait() {
  fireEvent.error(theImg())
  act(() => jest.advanceTimersByTime(10))
}

test("a caller's onError waits for the retries, which reload the image cache-busted", () => {
  const onError = jest.fn()
  render(<RetryImage src="https://img.test/poster.jpg" alt="Poster" width={100} height={150} retryCount={2} retryDelay={10} onError={onError} />)

  failAndWait()
  expect(onError).not.toHaveBeenCalled()
  expect(theImg()).toHaveAttribute('src', 'https://img.test/poster.jpg?retry=1')

  failAndWait()
  expect(onError).not.toHaveBeenCalled()
  expect(theImg()).toHaveAttribute('src', 'https://img.test/poster.jpg?retry=2')

  fireEvent.error(theImg())
  expect(onError).toHaveBeenCalledTimes(1)
})

test('the stand-in shows from the first failure, with the retrying image hidden under it, never its alt text', () => {
  render(<RetryImage src="https://img.test/poster.jpg" alt="Poster" fill placeholder="blur" blurDataURL={BLUR} retryCount={3} retryDelay={10} />)

  failAndWait()

  // Only the stand-in is exposed, carrying the blur
  const stand = screen.getByRole('img', { name: 'Poster' })
  expect(stand.tagName).toBe('SPAN')
  expect(stand.style.backgroundImage).toContain(BLUR)
  // The <img> is still there, retrying, invisible
  expect(theImg()).toHaveAttribute('aria-hidden', 'true')
  expect(theImg().style.opacity).toBe('0')
})

test('a retry that loads takes the slot back from the stand-in', () => {
  const onLoad = jest.fn()
  render(<RetryImage src="https://img.test/poster.jpg" alt="Poster" width={100} height={150} retryCount={3} retryDelay={10} onLoad={onLoad} />)

  failAndWait()
  expect(screen.getByRole('img', { name: 'Poster' }).tagName).toBe('SPAN')

  fireEvent.load(theImg())

  expect(onLoad).toHaveBeenCalledTimes(1)
  const img = screen.getByRole('img', { name: 'Poster' })
  expect(img.tagName).toBe('IMG')
  expect(img).toHaveAttribute('src', 'https://img.test/poster.jpg?retry=1')
  expect(img.style.opacity).toBe('')
})

test('a failed image with a blurhash keeps the blur, filling its box even under a position class', () => {
  // A backdrop passes `relative`: next/image's inline fill styles win over it, so the stand-in's must too
  render(<RetryImage src="https://img.test/backdrop.jpg" alt="Backdrop" fill placeholder="blur" blurDataURL={BLUR} className="relative object-cover" retryCount={0} />)

  fireEvent.error(theImg())

  const stand = screen.getByRole('img', { name: 'Backdrop' })
  expect(stand.tagName).toBe('SPAN')
  expect(stand).toHaveClass('object-cover')
  expect(stand.style.position).toBe('absolute')
  expect(stand.style.height).toBe('100%')
  expect(stand.style.backgroundImage).toContain(BLUR)
  expect(screen.queryByText(/failed/i)).toBeNull()
})

test('a failed image without a blurhash becomes a pane of frosted glass at its own size', () => {
  render(<RetryImage src="https://img.test/poster.jpg" alt="Poster" width={192} height={288} className="rounded-lg" retryCount={0} />)

  fireEvent.error(theImg())

  const pane = screen.getByRole('img', { name: 'Poster' })
  expect(pane.tagName).toBe('SPAN')
  expect(pane).toHaveClass('backdrop-blur-xl', 'rounded-lg')
  // The pane's own sheen and glows, so it reads as glass on a flat panel too
  expect(pane.style.backgroundImage).toContain('radial-gradient')
  expect(pane.style.boxShadow).toContain('inset')
  expect(pane.style.width).toBe('192px')
  expect(pane.style.aspectRatio).toBe('192 / 288')
  expect(screen.queryByText(/failed/i)).toBeNull()
})

test('a logo or badge marked hide leaves nothing, so the art under it shows', () => {
  const { container } = render(
    <div data-testid="frame">
      <RetryImage src="https://img.test/logo.png" alt="Logo" width={300} height={300} whenFailed="hide" retryCount={0} />
    </div>
  )

  fireEvent.error(theImg())

  expect(screen.queryByRole('img')).toBeNull()
  expect(container.querySelector('[data-testid="frame"]')).toBeEmptyDOMElement()
})

test('a bundled image has no URL to bust, so it gives up at once instead of throwing', () => {
  const onError = jest.fn()
  const badge = { src: '/_next/static/media/badge.png', width: 64, height: 64 }
  render(<RetryImage src={badge} alt="Rated G" whenFailed="hide" onError={onError} />)

  fireEvent.error(theImg())

  expect(onError).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('img')).toBeNull()
})

test('a fill image loads under its blurhash, which fades into it and then goes', () => {
  const { container } = render(<RetryImage src="https://img.test/poster.jpg" alt="Poster" fill placeholder="blur" blurDataURL={BLUR} className="object-cover" />)

  // The blur lies over the loading image, out of the accessibility tree: the <img> carries the alt
  const blurLayer = () => container.querySelector('span[aria-hidden="true"]')
  expect(blurLayer().style.backgroundImage).toContain(BLUR)
  expect(blurLayer().style.opacity).toBe('')
  expect(screen.getByRole('img', { name: 'Poster' })).toBe(theImg())

  // A slow image: it loads well after the blur went over it
  act(() => jest.advanceTimersByTime(300))
  fireEvent.load(theImg())
  // No OffscreenCanvas here, so no dissolve mask: the blur fades (see retryImageDissolve.test.js)
  act(() => jest.advanceTimersByTime(0))
  expect(blurLayer().style.opacity).toBe('0')
  expect(blurLayer().style.transition).toContain(`${FADE_MS}ms`)

  act(() => jest.advanceTimersByTime(FADE_MS))
  expect(blurLayer()).toBeNull()
})

test("a fixed-size image keeps next/image's own blur: no second layer in the flow", () => {
  const { container } = render(<RetryImage src="https://img.test/poster.jpg" alt="Poster" width={100} height={150} placeholder="blur" blurDataURL={BLUR} />)
  expect(container.querySelector('span')).toBeNull()
})

test('a fallbackSrc still replaces the image once the retries are spent', () => {
  render(<RetryImage src="https://img.test/still.jpg" alt="Still" width={390} height={217} retryCount={0} fallbackSrc="/sorry-image-not-available.jpg" />)

  fireEvent.error(theImg())

  expect(screen.getByRole('img', { name: 'Still' })).toHaveAttribute('src', '/sorry-image-not-available.jpg')
})
