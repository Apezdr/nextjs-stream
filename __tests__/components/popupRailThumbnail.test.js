/**
 * The hover popup for a Watch History episode opens on the thumbnail the card
 * already shows, with the card's blurhash, instead of the show's backdrop
 * while its own fetch is in flight.
 */

import { renderHook } from '@testing-library/react'
import { useMediaAssets, railThumbnailOf } from '@src/components/MediaScroll/PopupCard/hooks/useMediaAssets'

const THUMB = 'https://files.test/tv/Show/Season 1/01 - Thumbnail.jpg'
const BACKDROP = 'https://files.test/tv/Show/show_backdrop.jpg'
const playback = { shouldPlay: false, isThumbnailLoaded: false, showBackdrop: false, delayBackdropHide: false }
const episodeCard = { posterURL: THUMB, posterBlurhash: 'THUMB-BLUR', thumbnail: THUMB, backdrop: BACKDROP, backdropBlurhash: 'BACKDROP-BLUR' }

test('before its fetch lands, the popup shows the episode thumbnail and its blurhash, over the backdrop', () => {
  const { result } = renderHook(() => useMediaAssets(undefined, episodeCard, playback))

  expect(result.current.imageConfig.thumbnailSrc).toBe(THUMB)
  expect(result.current.imageConfig.thumbnailBlur).toBe('THUMB-BLUR')
  expect(result.current.visibilityFlags.shouldShowThumbnail).toBe(true)
})

test('the fetch landing keeps the same image', () => {
  const data = { thumbnail: THUMB, thumbnailBlurhash: 'THUMB-BLUR' }
  const { result } = renderHook(() => useMediaAssets(data, episodeCard, playback))
  expect(result.current.imageConfig.thumbnailSrc).toBe(THUMB)
})

test("a card whose poster is not that thumbnail, or a trailer card, waits for the popup's fetch", () => {
  expect(railThumbnailOf({ ...episodeCard, posterURL: 'https://files.test/tv/Show/show_poster.jpg' })).toBeNull()
  expect(railThumbnailOf({ ...episodeCard, isTrailer: true })).toBeNull()
  expect(railThumbnailOf({ posterURL: THUMB })).toBeNull()

  const { result } = renderHook(() => useMediaAssets(undefined, { ...episodeCard, isTrailer: true }, playback))
  expect(result.current.imageConfig.thumbnailSrc).toBeUndefined()
  expect(result.current.visibilityFlags.shouldShowBackdrop).toBe(true)
})
