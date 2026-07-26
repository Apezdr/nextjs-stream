import { resolveMediaId, resolveDeliveryFacts } from '@src/utils/sync/core/deliveryFacts'

const FULL = (url) => `https://server.example${url}`

// Shape mirrors the media-processor's publishableSources() output.
const source = (overrides = {}) => ({
  url: '/movies/Dune%20(2021)/Dune.2021.mkv',
  filename: 'Dune.2021.mkv',
  container: 'mkv',
  formatName: 'matroska,webm',
  size: 1234,
  length: 9000,
  dimensions: '3840x2160',
  videoCodec: 'hevc',
  pixFmt: 'yuv420p10le',
  fieldOrder: null,
  hdr: 'HDR10',
  audioTrackCount: 1,
  audioLanguages: ['eng'],
  mediaLastModified: '2026-07-01T00:00:00.000Z',
  uuid: 'abc',
  isPrimary: false,
  jitEligible: true,
  jitReason: null,
  jitKey: 'bW92aWVz',
  jitUrl: 'https://transcoder.example/stream/bW92aWVz/master.m3u8',
  ...overrides,
})

describe('resolveMediaId', () => {
  it('accepts a well-formed mid: identity', () => {
    expect(resolveMediaId({ id: 'mid:a91c04f7e2b6d558', scheme: 'mid' })).toBe(
      'mid:a91c04f7e2b6d558'
    )
  })

  it('accepts the episode coordinate form', () => {
    expect(resolveMediaId({ id: 'mid:3e88b1049fc7a2d1:s01e03', scheme: 'mid' })).toBe(
      'mid:3e88b1049fc7a2d1:s01e03'
    )
  })

  it('returns null for an unresolved identity (never clears a stored value)', () => {
    expect(resolveMediaId(null)).toBeNull()
    expect(resolveMediaId(undefined)).toBeNull()
    expect(resolveMediaId({})).toBeNull()
    expect(resolveMediaId({ id: null })).toBeNull()
  })

  it('rejects an id that is not in the mid: scheme', () => {
    // Guards against a future scheme change silently writing foreign ids into
    // the field watch history joins on.
    expect(resolveMediaId({ id: '507f1f77bcf86cd799439011' })).toBeNull()
    expect(resolveMediaId({ id: 42 })).toBeNull()
  })
})

describe('resolveDeliveryFacts', () => {
  it('maps source urls through the caller transform and preserves order', () => {
    const facts = resolveDeliveryFacts(
      {
        sources: [
          source({ filename: 'a.mp4', container: 'mp4', url: '/movies/X/a.mp4', isPrimary: true }),
          source({ filename: 'b.mkv', container: 'mkv', url: '/movies/X/b.mkv' }),
        ],
        jitEligible: true,
        jitUrl: 'https://transcoder.example/stream/KEY/master.m3u8',
      },
      FULL
    )

    expect(facts.sources.map((s) => s.filename)).toEqual(['a.mp4', 'b.mkv'])
    expect(facts.sources[0].url).toBe('https://server.example/movies/X/a.mp4')
    expect(facts.sources[1].url).toBe('https://server.example/movies/X/b.mkv')
    // Every other field survives verbatim.
    expect(facts.sources[1].audioLanguages).toEqual(['eng'])
    expect(facts.sources[1].jitKey).toBe('bW92aWVz')
  })

  it('finds the primary container by flag, not by position', () => {
    const facts = resolveDeliveryFacts(
      {
        sources: [
          source({ container: 'mkv', isPrimary: false }),
          source({ container: 'mp4', isPrimary: true }),
        ],
      },
      FULL
    )
    expect(facts.primaryContainer).toBe('mp4')
  })

  it('mirrors absence: a payload with no jit fields clears them', () => {
    // This is the durable JIT off-switch — an operator disabling JIT on the
    // owning host must make these fall back to false/null on the next sync.
    const facts = resolveDeliveryFacts({ sources: [source({ isPrimary: true })] }, FULL)
    expect(facts.jitEligible).toBe(false)
    expect(facts.jitUrl).toBeNull()
  })

  it('treats an omitted jitUrl (movies) and an explicit null (episodes) identically', () => {
    const omitted = resolveDeliveryFacts({ jitEligible: true }, FULL)
    const explicitNull = resolveDeliveryFacts({ jitEligible: true, jitUrl: null }, FULL)
    expect(omitted.jitUrl).toBeNull()
    expect(explicitNull.jitUrl).toBeNull()
  })

  it('keeps jitEligible true with a null jitUrl (eligible host, no transcoder URL configured)', () => {
    // Eligibility and reachability are independent in the backend; visibility
    // downstream must key on the URL, not the flag.
    const facts = resolveDeliveryFacts({ jitEligible: true, jitUrl: null }, FULL)
    expect(facts.jitEligible).toBe(true)
    expect(facts.jitUrl).toBeNull()
  })

  it('returns null sources (not []) when the payload has none', () => {
    const facts = resolveDeliveryFacts({}, FULL)
    expect(facts.sources).toBeNull()
    expect(facts.primaryContainer).toBeNull()
  })

  it('yields a null primaryContainer when no entry is flagged primary', () => {
    const facts = resolveDeliveryFacts({ sources: [source({ isPrimary: false })] }, FULL)
    expect(facts.primaryContainer).toBeNull()
  })

  it('coerces a non-boolean jitEligible to false rather than trusting it', () => {
    expect(resolveDeliveryFacts({ jitEligible: 'yes' }, FULL).jitEligible).toBe(false)
    expect(resolveDeliveryFacts({ jitEligible: 1 }, FULL).jitEligible).toBe(false)
  })

  it('ignores an empty-string jitUrl', () => {
    expect(resolveDeliveryFacts({ jitUrl: '' }, FULL).jitUrl).toBeNull()
  })

  it('leaves a non-string source url untouched instead of mapping it', () => {
    const facts = resolveDeliveryFacts({ sources: [source({ url: null })] }, FULL)
    expect(facts.sources[0].url).toBeNull()
  })
})
