import { resolveEffectiveVideoUrl } from '@src/utils/sync/core/videoIdentityWrite'
import { generateNormalizedVideoId } from '@src/utils/videoIdentity'

// The two path shapes that produced the real fork: the same movie on two
// servers, one of which mounts its library under a `/media` prefix.
const OWNER_URL = 'https://cinema-local.example.com/media/movies/Wolfs/Wolfs.2024.2160p.mp4'
const OTHER_URL = 'https://personalserver.example.com/movies/Wolfs/Wolfs.2024.2160p.mp4'

describe('resolveEffectiveVideoUrl', () => {
  it('takes the incoming URL when this server owns the field and changed it', () => {
    expect(
      resolveEffectiveVideoUrl({
        currentVideoUrl: null,
        updates: { videoURL: OWNER_URL },
        isVideoUrlLocked: false,
      })
    ).toBe(OWNER_URL)
  })

  it('keeps the stored URL when the field is not in the update set', () => {
    // A non-owning server reaches this point with its own URL in hand, but
    // nothing in `updates` — its URL is not what the document will hold.
    expect(
      resolveEffectiveVideoUrl({
        currentVideoUrl: OWNER_URL,
        updates: {},
        isVideoUrlLocked: false,
      })
    ).toBe(OWNER_URL)
  })

  it('keeps the stored URL when the field is admin-locked, even if an update is staged', () => {
    expect(
      resolveEffectiveVideoUrl({
        currentVideoUrl: OWNER_URL,
        updates: { videoURL: OTHER_URL },
        isVideoUrlLocked: true,
      })
    ).toBe(OWNER_URL)
  })

  it('returns null when there is no URL on either side', () => {
    expect(
      resolveEffectiveVideoUrl({ currentVideoUrl: null, updates: {}, isVideoUrlLocked: false })
    ).toBeNull()
    expect(
      resolveEffectiveVideoUrl({ updates: {}, isVideoUrlLocked: false })
    ).toBeNull()
  })

  it('propagates an explicit clear, rather than resurrecting the stored URL', () => {
    expect(
      resolveEffectiveVideoUrl({
        currentVideoUrl: OWNER_URL,
        updates: { videoURL: null },
        isVideoUrlLocked: false,
      })
    ).toBeNull()
  })
})

describe('the identity fork this rule prevents', () => {
  it('two servers with different path shapes hash to different ids', () => {
    // Pre-condition for the bug: the hash is pathname-derived, so a `/media`
    // prefix alone is enough to fork identity for the same file.
    expect(generateNormalizedVideoId(OWNER_URL)).not.toBe(generateNormalizedVideoId(OTHER_URL))
  })

  it("a non-owning server's pass keys the document to the URL clients are served", () => {
    // The exact production shape: cinema-local owns videoURL; personalserver
    // syncs the same title, is denied the videoURL write, and must NOT re-key
    // the document to its own path.
    const effective = resolveEffectiveVideoUrl({
      currentVideoUrl: OWNER_URL,
      updates: {}, // priority denied the write
      isVideoUrlLocked: false,
    })

    expect(generateNormalizedVideoId(effective)).toBe(generateNormalizedVideoId(OWNER_URL))
  })

  it('a drifted document is repaired by any pass, not just the owner’s', () => {
    // Document already carries the wrong id; the next pass recomputes from
    // the stored URL and produces the value the watch-history rows use.
    const stored = { videoURL: OWNER_URL, normalizedVideoId: generateNormalizedVideoId(OTHER_URL) }
    const effective = resolveEffectiveVideoUrl({
      currentVideoUrl: stored.videoURL,
      updates: {},
      isVideoUrlLocked: false,
    })
    const repaired = generateNormalizedVideoId(effective)

    expect(repaired).not.toBe(stored.normalizedVideoId)
    expect(repaired).toBe(generateNormalizedVideoId(OWNER_URL))
  })

  it('a locked JIT URL keys to the same id as the raw source URL', () => {
    // Transport invariance still holds through this rule: the canonicalizer
    // maps a /stream/<b64>/ URL back to its source pathname.
    const raw = 'https://personalserver.example.com/movies/Wolfs/Wolfs.2024.2160p.mp4'
    const key = Buffer.from('movies/Wolfs/Wolfs.2024.2160p.mp4').toString('base64url')
    const jit = `https://transcoder.example.com/stream/${key}/master.m3u8`

    const effective = resolveEffectiveVideoUrl({
      currentVideoUrl: jit,
      updates: { videoURL: raw },
      isVideoUrlLocked: true,
    })

    expect(effective).toBe(jit)
    expect(generateNormalizedVideoId(effective)).toBe(generateNormalizedVideoId(raw))
  })
})
