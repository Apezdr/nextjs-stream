import {
  generateContentRatingSvg,
  getContentRatingBadgeDimensions,
} from '@src/utils/contentRatingSvg'
import { SUPPORTED_CONTENT_RATINGS } from '@src/utils/contentRating'

describe('content-rating SVG generator', () => {
  test.each(SUPPORTED_CONTENT_RATINGS)('generates a deterministic, valid, compact %s badge', (rating) => {
    const first = generateContentRatingSvg(rating)
    const second = generateContentRatingSvg(rating)
    const dimensions = getContentRatingBadgeDimensions(rating)
    const document = new DOMParser().parseFromString(first, 'image/svg+xml')
    const root = document.documentElement

    expect(second).toBe(first)
    expect(root.localName).toBe('svg')
    expect(document.querySelector('parsererror')).toBeNull()
    expect(root.getAttribute('width')).toBe(String(dimensions.width))
    expect(root.getAttribute('height')).toBe(String(dimensions.height))
    expect(root.getAttribute('viewBox')).toBe(`0 0 ${dimensions.width} ${dimensions.height}`)
    expect(document.querySelector('title')?.textContent).toBe(`Rated ${rating}`)
    expect(document.querySelector('desc')?.textContent).toContain(rating)
    expect(document.querySelector('text')?.textContent).toBe(rating)
    expect(new TextEncoder().encode(first).byteLength).toBeLessThan(2048)
  })

  test.each([
    '<script>alert(1)</script>',
    '"><script>alert(1)</script>',
    '../../secret',
    '../PG-13',
    'INVALID',
    'PG-13\u0000',
    'UNRATED',
    'pg-13',
    'A'.repeat(10000),
  ])('rejects unsupported or hostile generator input %p', (value) => {
    expect(generateContentRatingSvg(value)).toBeNull()
  })

  test('emits no active content, external reference, CSS, or event handler', () => {
    const output = SUPPORTED_CONTENT_RATINGS.map(generateContentRatingSvg).join('\n')
    const references = output.replaceAll('http://www.w3.org/2000/svg', '')

    expect(references).not.toMatch(/<script|<foreignObject|\son[a-z]+\s*=|\bhref\s*=|<style|url\s*\(|https?:|data:/i)
    expect(output).not.toContain('<!DOCTYPE')
    expect(output).not.toContain('<![ENTITY')
  })
})
