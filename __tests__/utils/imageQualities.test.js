import {
  IMAGE_QUALITIES,
  DEFAULT_IMAGE_QUALITY,
  isAllowedQuality,
  nearestAllowedQuality,
} from '@src/utils/imageQualities'
import { buildNextOptimizedImageUrl } from '@src/utils'

// The whole point of the module is that these three agree. A test that only
// exercised the helpers would still pass while the config silently drifted.
describe('the allow-list is actually the one Next is given', () => {
  it('matches images.qualities in next.config.js', () => {
    const nextConfig = require('../../next.config.js')
    expect(nextConfig.images.qualities).toEqual(IMAGE_QUALITIES)
  })

  it('includes the default, so a caller passing nothing gets a servable value', () => {
    expect(IMAGE_QUALITIES).toContain(DEFAULT_IMAGE_QUALITY)
  })
})

describe('isAllowedQuality', () => {
  it('accepts every configured value', () => {
    for (const quality of IMAGE_QUALITIES) {
      expect(isAllowedQuality(quality)).toBe(true)
    }
  })

  it('accepts the string form a query parameter arrives as', () => {
    expect(isAllowedQuality('75')).toBe(true)
  })

  it('rejects an in-range value that is simply not on the list', () => {
    // The exact case that took episode thumbnails out of the optimizer.
    expect(isAllowedQuality(80)).toBe(false)
  })

  it('rejects fractions, out-of-range values, and garbage', () => {
    expect(isAllowedQuality(75.5)).toBe(false)
    expect(isAllowedQuality(0)).toBe(false)
    expect(isAllowedQuality(101)).toBe(false)
    expect(isAllowedQuality(-75)).toBe(false)
    expect(isAllowedQuality('abc')).toBe(false)
    expect(isAllowedQuality(null)).toBe(false)
    expect(isAllowedQuality(undefined)).toBe(false)
    expect(isAllowedQuality(Infinity)).toBe(false)
  })
})

describe('nearestAllowedQuality', () => {
  it('leaves an already-allowed value alone', () => {
    for (const quality of IMAGE_QUALITIES) {
      expect(nearestAllowedQuality(quality)).toBe(quality)
    }
  })

  it('snaps an off-list value to its nearest neighbour', () => {
    expect(nearestAllowedQuality(80)).toBe(75)
    expect(nearestAllowedQuality(88)).toBe(90)
    expect(nearestAllowedQuality(30)).toBe(25)
    expect(nearestAllowedQuality(60)).toBe(50)
  })

  it('resolves a tie upward — a bigger file beats a softer picture', () => {
    // 82.5 is equidistant from 75 and 90.
    expect(nearestAllowedQuality(82.5)).toBe(90)
  })

  it('clamps past both ends rather than emitting something unservable', () => {
    expect(nearestAllowedQuality(1)).toBe(25)
    expect(nearestAllowedQuality(1000)).toBe(100)
  })

  it('falls back to the default instead of throwing on nonsense', () => {
    expect(nearestAllowedQuality(undefined)).toBe(DEFAULT_IMAGE_QUALITY)
    expect(nearestAllowedQuality('abc')).toBe(DEFAULT_IMAGE_QUALITY)
    expect(nearestAllowedQuality(NaN)).toBe(DEFAULT_IMAGE_QUALITY)
  })

  // Number(null) and Number('') are 0, not NaN — so a "no quality supplied"
  // caller would snap to the LOWEST allowed value if this only checked
  // isFinite. Nothing here should ever resolve to 25 by accident.
  it('reads an absent quality as the default, not as zero', () => {
    expect(nearestAllowedQuality(null)).toBe(DEFAULT_IMAGE_QUALITY)
    expect(nearestAllowedQuality('')).toBe(DEFAULT_IMAGE_QUALITY)
    expect(nearestAllowedQuality(0)).toBe(DEFAULT_IMAGE_QUALITY)
    expect(nearestAllowedQuality(-40)).toBe(DEFAULT_IMAGE_QUALITY)
  })

  it('always returns something the optimizer will serve', () => {
    for (const input of [0, 1, 37, 80, 82.5, 99, 1000, -5, NaN, undefined, 'x']) {
      expect(isAllowedQuality(nearestAllowedQuality(input))).toBe(true)
    }
  })
})

describe('buildNextOptimizedImageUrl', () => {
  const src = 'https://image.tmdb.org/t/p/original/poster.jpg'

  it('emits an allowed q for a quality the caller got wrong', () => {
    // Previously emitted q=80, which the optimizer refuses — silently, since
    // this URL is used for a preload link.
    expect(buildNextOptimizedImageUrl(src, 640, 80)).toBe(
      `/_next/image?url=${encodeURIComponent(src)}&w=640&q=75`
    )
  })

  it('passes an allowed quality through untouched', () => {
    expect(buildNextOptimizedImageUrl(src, 1920, 100)).toBe(
      `/_next/image?url=${encodeURIComponent(src)}&w=1920&q=100`
    )
  })

  it('defaults to a servable quality when none is given', () => {
    expect(buildNextOptimizedImageUrl(src, 640)).toContain(`&q=${DEFAULT_IMAGE_QUALITY}`)
  })

  it('still returns null without a src or width', () => {
    expect(buildNextOptimizedImageUrl(null, 640, 75)).toBeNull()
    expect(buildNextOptimizedImageUrl(src, 0, 75)).toBeNull()
  })
})
