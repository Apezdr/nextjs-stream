/**
 * The hover-card preview's source list.
 *
 * A browser that decodes AV1 smoothly gets the AV1 clip listed ahead of the
 * plain one; everything else keeps the single `src` it always had. The list is
 * fixed when the <video> mounts, because changing it afterwards would restart
 * a clip that is already playing, so the capability answer has to be in before
 * the first preview: <Av1DecodeCheck> asks at page load, long before the
 * lazily loaded player exists.
 */

import { render, fireEvent, act } from '@testing-library/react'
import CardVideoPlayer from '@src/components/MediaScroll/CardVideoPlayer'
import Av1DecodeCheck from '@src/components/VideoPreview/Av1DecodeCheck'
import {
  AV1_CLIP_SOURCE_TYPE,
  canOfferAv1Clips,
  startAv1DecodeCheck,
  _resetAv1ClipStateForTests,
} from '@src/components/VideoPreview/av1Clip'

const CLIP = 'https://media.example.com/videoClip/movie/Logan?start=3200&end=3250'
const CLIP_AV1 = `${CLIP}&codec=av1`
const OTHER_CLIP = 'https://media.example.com/videoClip/tv/Futurama/1/2?start=400&end=450'
const FILE = 'https://media.example.com/movies/Logan/trailer.mp4'

const SMOOTH = { supported: true, smooth: true, powerEfficient: false }

const hadMediaCapabilities = 'mediaCapabilities' in navigator
const originalMediaCapabilities = navigator.mediaCapabilities

function setMediaCapabilities(value) {
  Object.defineProperty(navigator, 'mediaCapabilities', { configurable: true, writable: true, value })
}

/** A browser that has already answered the capability check. */
async function browserAnswers(info) {
  const decodingInfo = jest.fn().mockResolvedValue(info)
  setMediaCapabilities({ decodingInfo })
  await startAv1DecodeCheck()
  return decodingInfo
}

const getVideo = (container) => container.querySelector('video')
const sourcesOf = (video) => Array.from(video.querySelectorAll('source'))

// jsdom has no media pipeline: play/pause/load are "not implemented" stubs
// that log, and currentSrc is always ''.
const mediaPrototype = Object.getPrototypeOf(Object.getPrototypeOf(document.createElement('video')))
let play
let pause
let load

beforeEach(() => {
  _resetAv1ClipStateForTests()
  localStorage.clear()
  play = jest.spyOn(mediaPrototype, 'play').mockImplementation(() => Promise.resolve())
  pause = jest.spyOn(mediaPrototype, 'pause').mockImplementation(() => {})
  load = jest.spyOn(mediaPrototype, 'load').mockImplementation(() => {})
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
  jest.useRealTimers()
})

afterAll(() => {
  if (hadMediaCapabilities) setMediaCapabilities(originalMediaCapabilities)
  else delete navigator.mediaCapabilities
  _resetAv1ClipStateForTests()
})

describe('when AV1 is not offered', () => {
  it('plays the clip from the src attribute when the browser cannot decode AV1', async () => {
    await browserAnswers({ supported: false, smooth: false, powerEfficient: false })

    const { container } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)

    const video = getVideo(container)
    expect(video).toHaveAttribute('src', CLIP)
    expect(sourcesOf(video)).toHaveLength(0)
  })

  it('plays the clip from the src attribute when the browser has no Media Capabilities API', async () => {
    setMediaCapabilities(undefined)
    await startAv1DecodeCheck()

    const { container } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)

    expect(getVideo(container)).toHaveAttribute('src', CLIP)
    expect(sourcesOf(getVideo(container))).toHaveLength(0)
  })

  it('mounts with H.264 while the answer is unknown, and leaves that video alone when it arrives', async () => {
    let answer
    setMediaCapabilities({ decodingInfo: jest.fn(() => new Promise((resolve) => (answer = resolve))) })
    const check = startAv1DecodeCheck()

    const { container, rerender } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay={false} />)
    const video = getVideo(container)
    expect(video).toHaveAttribute('src', CLIP)

    await act(async () => {
      answer(SMOOTH)
      await check
    })
    expect(canOfferAv1Clips()).toBe(true)
    rerender(<CardVideoPlayer videoURL={CLIP} shouldPlay />)

    // Same element, same single source: nothing reloaded
    expect(getVideo(container)).toBe(video)
    expect(video).toHaveAttribute('src', CLIP)
    expect(sourcesOf(video)).toHaveLength(0)
  })
})

describe('when AV1 is offered', () => {
  it('lists the AV1 clip first with its codecs, then the plain clip, and sets no src', async () => {
    await browserAnswers(SMOOTH)

    const { container } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)

    const video = getVideo(container)
    expect(video).not.toHaveAttribute('src')
    const sources = sourcesOf(video)
    expect(sources).toHaveLength(2)
    expect(sources[0]).toHaveAttribute('src', CLIP_AV1)
    expect(sources[0]).toHaveAttribute('type', AV1_CLIP_SOURCE_TYPE)
    expect(sources[0].getAttribute('type')).toBe('video/mp4; codecs="av01.0.05M.08, mp4a.40.2"')
    expect(sources[1]).toHaveAttribute('src', CLIP)
    // The plain clip was WebM before it was H.264: its type is the response's to say
    expect(sources[1]).not.toHaveAttribute('type')
  })

  it('still mirrors play intent, mute and volume onto the element', async () => {
    await browserAnswers(SMOOTH)
    localStorage.setItem('videoMutedCard', 'false')
    localStorage.setItem('videoVolumeCard', '0.4')

    const { container, rerender } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay={false} />)
    const video = getVideo(container)
    expect(play).not.toHaveBeenCalled()
    expect(video.muted).toBe(false)
    expect(video.volume).toBeCloseTo(0.4)

    rerender(<CardVideoPlayer videoURL={CLIP} shouldPlay />)
    expect(play).toHaveBeenCalledTimes(1)
    expect(getVideo(container)).toBe(video)
  })

  it('still reports ready, playing and ended to its parent', async () => {
    await browserAnswers(SMOOTH)
    const onVideoReady = jest.fn()
    const onPlaying = jest.fn()
    const onVideoEnd = jest.fn()

    const { container } = render(
      <CardVideoPlayer
        videoURL={CLIP}
        shouldPlay
        onVideoReady={onVideoReady}
        onPlaying={onPlaying}
        onVideoEnd={onVideoEnd}
      />
    )
    const video = getVideo(container)
    fireEvent.canPlay(video)
    fireEvent.canPlay(video)
    fireEvent.playing(video)
    fireEvent.ended(video)

    expect(onVideoReady).toHaveBeenCalledTimes(1)
    expect(onVideoReady).toHaveBeenCalledWith(video)
    expect(onPlaying).toHaveBeenCalledTimes(1)
    expect(onVideoEnd).toHaveBeenCalledWith(video)
  })

  it('does nothing when the AV1 source fails to load: the browser moves on to the next source', async () => {
    await browserAnswers(SMOOTH)
    const { container } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)
    const video = getVideo(container)

    // A 400 from a processor that cannot make AV1. React also hands this to
    // the <video>'s onError, which must not take it for a playback error.
    fireEvent.error(sourcesOf(video)[0])

    expect(getVideo(container)).toBe(video)
    expect(sourcesOf(video)).toHaveLength(2)
    expect(canOfferAv1Clips()).toBe(true)
  })

  it('goes back to the src attribute when the last source fails to load too, and keeps AV1 for other previews', async () => {
    await browserAnswers(SMOOTH)
    const { container } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)
    const first = getVideo(container)

    fireEvent.error(sourcesOf(first)[0])
    fireEvent.error(sourcesOf(first)[1])

    // The failing URL is now where it always was, on `src`...
    const second = getVideo(container)
    expect(second).not.toBe(first)
    expect(second).toHaveAttribute('src', CLIP)
    expect(sourcesOf(second)).toHaveLength(0)

    // ...and gets what a failing `src` has always got: a remount per error
    fireEvent.error(second)
    const third = getVideo(container)
    expect(third).not.toBe(second)
    expect(third).toHaveAttribute('src', CLIP)
    expect(sourcesOf(third)).toHaveLength(0)

    // Nothing here said AV1 does not play
    expect(canOfferAv1Clips()).toBe(true)
  })

  it('remounts with H.264 only after an AV1 playback error, and stops offering AV1 on the page', async () => {
    await browserAnswers(SMOOTH)
    const { container } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)
    const first = getVideo(container)
    Object.defineProperty(first, 'currentSrc', { configurable: true, value: CLIP_AV1 })

    fireEvent.error(first)

    const second = getVideo(container)
    expect(second).not.toBe(first)
    expect(second).toHaveAttribute('src', CLIP)
    expect(sourcesOf(second)).toHaveLength(0)
    // The replacement is told to play: the intent is mirrored onto it too
    expect(play.mock.contexts).toContain(second)

    expect(canOfferAv1Clips()).toBe(false)
    const another = render(<CardVideoPlayer videoURL={OTHER_CLIP} shouldPlay />)
    expect(getVideo(another.container)).toHaveAttribute('src', OTHER_CLIP)
    expect(sourcesOf(getVideo(another.container))).toHaveLength(0)
  })

  it('remounts with the same two sources after an error while the plain clip is playing', async () => {
    await browserAnswers(SMOOTH)
    const { container } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)
    const first = getVideo(container)
    // The AV1 source was refused and the plain one wedged on a 416
    Object.defineProperty(first, 'currentSrc', { configurable: true, value: CLIP })

    fireEvent.error(first)

    const second = getVideo(container)
    expect(second).not.toBe(first)
    expect(sourcesOf(second).map((source) => source.getAttribute('src'))).toEqual([CLIP_AV1, CLIP])
    expect(canOfferAv1Clips()).toBe(true)
  })

  it('mounts a new element when the clip URL changes', async () => {
    await browserAnswers(SMOOTH)
    const { container, rerender } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)
    const first = getVideo(container)

    rerender(<CardVideoPlayer videoURL={OTHER_CLIP} shouldPlay />)

    // <source> children are read once, at creation: a new URL needs a new element
    const second = getVideo(container)
    expect(second).not.toBe(first)
    expect(sourcesOf(second).map((source) => source.getAttribute('src'))).toEqual([
      `${OTHER_CLIP}&codec=av1`,
      OTHER_CLIP,
    ])
    expect(play.mock.contexts).toContain(second)
  })

  it('leaves a URL that is not a processor clip on the src attribute', async () => {
    await browserAnswers(SMOOTH)

    const { container } = render(<CardVideoPlayer videoURL={FILE} shouldPlay />)

    const video = getVideo(container)
    expect(video).toHaveAttribute('src', FILE)
    expect(sourcesOf(video)).toHaveLength(0)
  })

  it('leaves a clip that already names its codec, or is the stream copy, on the src attribute', async () => {
    await browserAnswers(SMOOTH)

    for (const url of [`${CLIP}&codec=h264`, `${CLIP}&useOriginalVideo=true`]) {
      const { container, unmount } = render(<CardVideoPlayer videoURL={url} shouldPlay />)
      expect(getVideo(container)).toHaveAttribute('src', url)
      expect(sourcesOf(getVideo(container))).toHaveLength(0)
      unmount()
    }
  })
})

describe('without AV1, exactly as before', () => {
  it('remounts with the same src after an error (the 416 cure)', async () => {
    await browserAnswers({ supported: false, smooth: false })
    const { container } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)
    const first = getVideo(container)

    fireEvent.error(first)

    const second = getVideo(container)
    expect(second).not.toBe(first)
    expect(second).toHaveAttribute('src', CLIP)
    expect(sourcesOf(second)).toHaveLength(0)
  })

  it('updates src on the same element when the URL changes', async () => {
    await browserAnswers({ supported: false, smooth: false })
    const { container, rerender } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)
    const video = getVideo(container)

    rerender(<CardVideoPlayer videoURL={OTHER_CLIP} shouldPlay />)

    expect(getVideo(container)).toBe(video)
    expect(video).toHaveAttribute('src', OTHER_CLIP)
  })
})

describe('releasing a discarded element', () => {
  it('removes the <source> children before load(), or load() would start the clip again', async () => {
    await browserAnswers(SMOOTH)
    jest.useFakeTimers()
    const { container, unmount } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)
    const video = getVideo(container)
    let sourcesAtLoad = null
    load.mockImplementation(function () {
      sourcesAtLoad = this.querySelectorAll('source').length
    })

    unmount()
    jest.runOnlyPendingTimers()

    expect(pause.mock.contexts).toContain(video)
    expect(load.mock.contexts).toContain(video)
    expect(sourcesAtLoad).toBe(0)
  })

  it('releases the element a new clip URL replaced', async () => {
    await browserAnswers(SMOOTH)
    jest.useFakeTimers()
    const { container, rerender } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)
    const first = getVideo(container)

    rerender(<CardVideoPlayer videoURL={OTHER_CLIP} shouldPlay />)
    jest.runOnlyPendingTimers()

    const second = getVideo(container)
    expect(pause.mock.contexts).toContain(first)
    expect(load.mock.contexts).toContain(first)
    expect(sourcesOf(first)).toHaveLength(0)
    // The element that took its place is untouched
    expect(load.mock.contexts).not.toContain(second)
    expect(sourcesOf(second)).toHaveLength(2)
  })
})

describe('the page-load check', () => {
  it('asks the browser exactly once, however many times it mounts', async () => {
    const decodingInfo = jest.fn().mockResolvedValue(SMOOTH)
    setMediaCapabilities({ decodingInfo })

    const first = render(<Av1DecodeCheck />)
    expect(first.container).toBeEmptyDOMElement()
    first.rerender(<Av1DecodeCheck />)
    first.unmount()
    render(<Av1DecodeCheck />)

    expect(decodingInfo).toHaveBeenCalledTimes(1)
  })

  it('lets the first preview mounted after it resolves offer AV1', async () => {
    const decodingInfo = jest.fn().mockResolvedValue(SMOOTH)
    setMediaCapabilities({ decodingInfo })

    render(<Av1DecodeCheck />)
    // The check's own promise, not a second request
    await act(async () => {
      await startAv1DecodeCheck()
    })

    const { container } = render(<CardVideoPlayer videoURL={CLIP} shouldPlay />)

    expect(decodingInfo).toHaveBeenCalledTimes(1)
    expect(sourcesOf(getVideo(container)).map((source) => source.getAttribute('src'))).toEqual([CLIP_AV1, CLIP])
  })

  it('is not something the player depends on: loading the player starts the check too', () => {
    const decodingInfo = jest.fn().mockResolvedValue(SMOOTH)
    setMediaCapabilities({ decodingInfo })

    jest.isolateModules(() => {
      require('@src/components/MediaScroll/CardVideoPlayer')
    })

    expect(decodingInfo).toHaveBeenCalledTimes(1)
  })
})
