/**
 * The hover popup's hero stacks thumbnail over backdrop over poster. When one
 * fails for good, the next one down shows instead; only the last one standing
 * shows its blurhash or the frosted glass, on a dark base. A failure also
 * lets the clip start, which otherwise waits on an image load.
 *
 * RetryImage is stubbed: its own states are covered in retryImage.test.js.
 * Here each layer reports `whenFailed` and fails on demand.
 */

import { render, screen, fireEvent } from '@testing-library/react'

jest.mock('@components/RetryImage', () => ({
  __esModule: true,
  default: ({ src, alt, whenFailed = 'frost', onError, onLoad }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} data-when-failed={whenFailed} onError={onError} onLoad={onLoad} />
  ),
}))

const MediaHero = require('@src/components/MediaScroll/PopupCard/MediaHero').default

const POSTER = 'https://files.test/poster.jpg'
const BACKDROP = 'https://files.test/backdrop.jpg'
const THUMB = 'https://files.test/thumb.jpg'

function renderHero({ thumbnail = null, backdrop = BACKDROP, poster = POSTER } = {}) {
  const handleImageLoad = jest.fn()
  const imageConfig = {
    logoSrc: null,
    posterSrc: poster,
    backdropSrc: backdrop,
    thumbnailSrc: thumbnail,
    hasLogo: false,
    hasPoster: Boolean(poster),
    hasBackdrop: Boolean(backdrop),
    hasThumbnail: Boolean(thumbnail),
  }
  // What useMediaAssets gives before anything has loaded, with no clip playing
  const visibilityFlags = {
    shouldShowPoster: Boolean(poster) && !backdrop && !thumbnail,
    shouldShowBackdrop: Boolean(backdrop),
    shouldShowThumbnail: Boolean(thumbnail),
  }
  const utils = render(
    <MediaHero
      title="A Title"
      imagePosition={{ height: 300, expandedWidth: 500 }}
      imageConfig={imageConfig}
      visibilityFlags={visibilityFlags}
      playbackState={{ afterVideo: false, playingVideo: false }}
      videoURL={null}
      shouldPlay={false}
      onVideoReady={jest.fn()}
      dispatch={jest.fn()}
      handleImageLoad={handleImageLoad}
      isLoading={false}
    />
  )
  return { ...utils, handleImageLoad }
}

const layer = (src) => document.querySelector(`img[src="${src}"]`)

test('the hero sits on a dark base, so glass and blur never read as white', () => {
  const { container } = renderHero()
  expect(container.firstChild).toHaveClass('bg-[#0f1633]')
})

test('a failed backdrop gives way to the poster, which it would otherwise cover', () => {
  const { handleImageLoad } = renderHero()
  expect(layer(POSTER)).toBeNull()
  expect(layer(BACKDROP)).toHaveAttribute('data-when-failed', 'hide')

  fireEvent.error(layer(BACKDROP))

  expect(layer(POSTER)).not.toBeNull()
  expect(layer(POSTER)).toHaveAttribute('data-when-failed', 'frost')
  // The clip is no longer held back by an image that will never load
  expect(handleImageLoad).toHaveBeenCalledTimes(1)
})

test('a failed episode still steps aside for the backdrop under it', () => {
  renderHero({ thumbnail: THUMB })
  expect(layer(THUMB)).toHaveAttribute('data-when-failed', 'hide')

  fireEvent.error(layer(THUMB))

  expect(layer(BACKDROP)).not.toBeNull()
  expect(layer(POSTER)).toBeNull()
})

test('when every layer fails, the last one shows its blurhash or the glass', () => {
  renderHero({ thumbnail: THUMB })

  fireEvent.error(layer(THUMB))
  fireEvent.error(layer(BACKDROP))
  fireEvent.error(layer(POSTER))

  expect(layer(POSTER)).toHaveAttribute('data-when-failed', 'frost')
  // Nothing working is left under the backdrop, so it shows its own stand-in on top
  expect(layer(BACKDROP)).toHaveAttribute('data-when-failed', 'frost')
})

test('with nothing under it, a lone backdrop shows its own stand-in', () => {
  renderHero({ poster: null })
  expect(layer(BACKDROP)).toHaveAttribute('data-when-failed', 'frost')
})
