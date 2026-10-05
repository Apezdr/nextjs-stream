/**
 * AV1 preview clips: which clip URLs get an AV1 version, and when a browser is
 * offered it.
 *
 * The gate has to answer synchronously (a <video> mounts with its final source
 * list), so everything but an explicit "supported and smooth" from the browser
 * must read as no, including "has not answered yet".
 */

import {
  AV1_CLIP_SOURCE_TYPE,
  deriveAv1ClipUrl,
  isAv1ClipSource,
  startAv1DecodeCheck,
  canOfferAv1Clips,
  markAv1PlaybackFailed,
  _resetAv1ClipStateForTests,
} from '@src/components/VideoPreview/av1Clip'

const hadMediaCapabilities = 'mediaCapabilities' in navigator
const originalMediaCapabilities = navigator.mediaCapabilities

function setMediaCapabilities(value) {
  Object.defineProperty(navigator, 'mediaCapabilities', { configurable: true, writable: true, value })
}

beforeEach(() => {
  _resetAv1ClipStateForTests()
})

afterAll(() => {
  if (hadMediaCapabilities) setMediaCapabilities(originalMediaCapabilities)
  else delete navigator.mediaCapabilities
  _resetAv1ClipStateForTests()
})

describe('deriveAv1ClipUrl', () => {
  it('adds codec=av1 to a movie clip and keeps its start and end', () => {
    expect(deriveAv1ClipUrl('https://media.example.com/videoClip/movie/Logan?start=3200&end=3250')).toBe(
      'https://media.example.com/videoClip/movie/Logan?start=3200&end=3250&codec=av1'
    )
  })

  it('adds codec=av1 to an episode clip', () => {
    expect(deriveAv1ClipUrl('https://media.example.com/videoClip/tv/Futurama/1/2?start=400&end=450')).toBe(
      'https://media.example.com/videoClip/tv/Futurama/1/2?start=400&end=450&codec=av1'
    )
  })

  it('leaves the other parameters exactly as they were written', () => {
    expect(
      deriveAv1ClipUrl('https://media.example.com/videoClip/movie/Logan?start=3200&end=3250&quality=low&note=a%20b')
    ).toBe('https://media.example.com/videoClip/movie/Logan?start=3200&end=3250&quality=low&note=a%20b&codec=av1')
  })

  it('handles a clip URL with no query, a path prefix and a port', () => {
    expect(deriveAv1ClipUrl('http://10.0.0.5:3000/node/videoClip/movie/Logan')).toBe(
      'http://10.0.0.5:3000/node/videoClip/movie/Logan?codec=av1'
    )
  })

  it('keeps an encoded title as it is written', () => {
    // generateClipVideoURL percent-encodes the folder name ("The End?")
    const plain = 'https://media.example.com/videoClip/movie/The%20End%3F?start=3200&end=3250'
    const av1 = deriveAv1ClipUrl(plain)
    expect(av1).toBe('https://media.example.com/videoClip/movie/The%20End%3F?start=3200&end=3250&codec=av1')
    expect(new URL(av1).pathname).toBe(new URL(plain).pathname)
  })

  it('requests the same title the plain URL does when the title is not percent-encoded', () => {
    // What generateClipVideoURL wrote before it encoded the title; an API
    // response cached from then can still carry one
    const plain = 'https://media.example.com/videoClip/movie/The Matrix (1999)?start=3200&end=3250'
    const av1 = deriveAv1ClipUrl(plain)
    expect(av1).toBe('https://media.example.com/videoClip/movie/The%20Matrix%20(1999)?start=3200&end=3250&codec=av1')
    expect(new URL(av1).pathname).toBe(new URL(plain).pathname)
  })

  it('has no AV1 version for a clip that already names a codec', () => {
    expect(deriveAv1ClipUrl('https://media.example.com/videoClip/movie/Logan?start=1&end=2&codec=h264')).toBeNull()
    expect(deriveAv1ClipUrl('https://media.example.com/videoClip/movie/Logan?start=1&end=2&codec=av1')).toBeNull()
  })

  it('has no AV1 version for the stream copy the TV app asks for', () => {
    expect(
      deriveAv1ClipUrl('https://media.example.com/videoClip/movie/Logan?start=1&end=2&useOriginalVideo=true')
    ).toBeNull()
  })

  it('has no AV1 version for anything that is not a processor clip', () => {
    expect(deriveAv1ClipUrl('https://media.example.com/movies/Logan/Logan.mp4')).toBeNull()
    expect(deriveAv1ClipUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull()
    // "/videoClip/" in the query is not the clip route
    expect(deriveAv1ClipUrl('https://media.example.com/stream?from=/videoClip/movie/Logan')).toBeNull()
  })

  it('has no AV1 version for a URL that does not parse, or is not a string', () => {
    expect(deriveAv1ClipUrl('/videoClip/movie/Logan?start=1&end=2')).toBeNull()
    expect(deriveAv1ClipUrl('http://[bad/videoClip/movie/Logan')).toBeNull()
    expect(deriveAv1ClipUrl('')).toBeNull()
    expect(deriveAv1ClipUrl(null)).toBeNull()
    expect(deriveAv1ClipUrl(undefined)).toBeNull()
  })
})

describe('isAv1ClipSource', () => {
  it('recognises the URL deriveAv1ClipUrl produces and nothing else', () => {
    const plain = 'https://media.example.com/videoClip/movie/Logan?start=3200&end=3250'
    expect(isAv1ClipSource(deriveAv1ClipUrl(plain))).toBe(true)
    expect(isAv1ClipSource(plain)).toBe(false)
    expect(isAv1ClipSource('')).toBe(false)
    expect(isAv1ClipSource(undefined)).toBe(false)
  })
})

describe('the capability gate', () => {
  it('says no until the browser has answered, then yes for supported and smooth', async () => {
    let answer
    const decodingInfo = jest.fn(() => new Promise((resolve) => (answer = resolve)))
    setMediaCapabilities({ decodingInfo })

    expect(canOfferAv1Clips()).toBe(false)
    const check = startAv1DecodeCheck()
    expect(canOfferAv1Clips()).toBe(false)

    // powerEfficient is not required: software decoding that is smooth is enough
    answer({ supported: true, smooth: true, powerEfficient: false })
    await expect(check).resolves.toBe(true)
    expect(canOfferAv1Clips()).toBe(true)
  })

  it('asks about an AV1 file at clip size', async () => {
    const decodingInfo = jest.fn().mockResolvedValue({ supported: true, smooth: true })
    setMediaCapabilities({ decodingInfo })

    await startAv1DecodeCheck()

    expect(decodingInfo).toHaveBeenCalledWith({
      type: 'file',
      video: {
        contentType: 'video/mp4; codecs="av01.0.05M.08"',
        width: 1280,
        height: 720,
        bitrate: 2000000,
        framerate: 24,
      },
    })
    expect(AV1_CLIP_SOURCE_TYPE).toBe('video/mp4; codecs="av01.0.05M.08, mp4a.40.2"')
  })

  it('asks once however often it is started', async () => {
    const decodingInfo = jest.fn().mockResolvedValue({ supported: true, smooth: true })
    setMediaCapabilities({ decodingInfo })

    const first = startAv1DecodeCheck()
    const second = startAv1DecodeCheck()
    await first
    startAv1DecodeCheck()

    expect(second).toBe(first)
    expect(decodingInfo).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['unsupported', { supported: false, smooth: false, powerEfficient: false }],
    ['supported but not smooth', { supported: true, smooth: false, powerEfficient: false }],
    ['nothing at all', undefined],
  ])('says no when the browser reports %s', async (_label, info) => {
    setMediaCapabilities({ decodingInfo: jest.fn().mockResolvedValue(info) })

    await expect(startAv1DecodeCheck()).resolves.toBe(false)
    expect(canOfferAv1Clips()).toBe(false)
  })

  it('says no when the browser has no Media Capabilities API', async () => {
    setMediaCapabilities(undefined)
    await expect(startAv1DecodeCheck()).resolves.toBe(false)
    expect(canOfferAv1Clips()).toBe(false)

    _resetAv1ClipStateForTests()
    setMediaCapabilities({})
    await expect(startAv1DecodeCheck()).resolves.toBe(false)
    expect(canOfferAv1Clips()).toBe(false)
  })

  it('says no when the check rejects', async () => {
    setMediaCapabilities({ decodingInfo: jest.fn().mockRejectedValue(new TypeError('bad configuration')) })

    await expect(startAv1DecodeCheck()).resolves.toBe(false)
    expect(canOfferAv1Clips()).toBe(false)
  })

  it('says no when the check throws instead of rejecting', async () => {
    setMediaCapabilities({
      decodingInfo: jest.fn(() => {
        throw new TypeError('bad configuration')
      }),
    })

    await expect(startAv1DecodeCheck()).resolves.toBe(false)
    expect(canOfferAv1Clips()).toBe(false)
  })

  it('stops offering AV1 for the rest of the page once playback has failed', async () => {
    setMediaCapabilities({ decodingInfo: jest.fn().mockResolvedValue({ supported: true, smooth: true }) })
    await startAv1DecodeCheck()
    expect(canOfferAv1Clips()).toBe(true)

    markAv1PlaybackFailed()

    expect(canOfferAv1Clips()).toBe(false)
    await startAv1DecodeCheck()
    expect(canOfferAv1Clips()).toBe(false)
  })
})
