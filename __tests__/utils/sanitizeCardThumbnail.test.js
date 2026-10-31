/**
 * @jest-environment node
 *
 * Rail cards keep an episode card's `thumbnail` (it used to be popup-only), so
 * the popup the card opens can start on the image the card shows. The card's
 * blurhash is that image's.
 */

const { sanitizeCardData } = require('@src/utils/auth_utils')

const THUMB = 'https://files.test/tv/Show/Season 1/01 - Thumbnail.jpg'

test('a rail episode card keeps its thumbnail, with its poster pair intact', () => {
  const card = sanitizeCardData({
    id: 'e1',
    type: 'tv',
    title: 'Show',
    posterURL: THUMB,
    posterBlurhash: 'THUMB-BLUR',
    thumbnail: THUMB,
    thumbnailBlurhash: 'THUMB-BLUR',
    episodeNumber: 1,
    seasonNumber: 1,
  })

  expect(card.thumbnail).toBe(THUMB)
  expect(card.posterURL).toBe(THUMB)
  expect(card.posterBlurhash).toBe('THUMB-BLUR')
  // The blurhash travels once, as the poster's; the popup reads it from there
  expect(card.thumbnailBlurhash).toBeUndefined()
})

test('a card with no episode image carries no thumbnail', () => {
  const card = sanitizeCardData({ id: 'm1', type: 'movie', title: 'Film', posterURL: 'https://files.test/movies/Film/poster.jpg' })
  expect(card.thumbnail).toBeUndefined()
})
