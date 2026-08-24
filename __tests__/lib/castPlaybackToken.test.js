import {
  mintCastPlaybackToken,
  verifyCastPlaybackToken,
  refreshIfDue,
  CAST_TOKEN_TTL_MS,
  CAST_TOKEN_MAX_CHAIN_MS,
} from '@src/lib/castPlaybackToken'

const USER = '507f1f77bcf86cd799439011'
const NID = 'a1b2c3d4e5f60718'

function mint(overrides = {}) {
  return mintCastPlaybackToken({
    userId: USER,
    normalizedVideoId: NID,
    metadata: { mediaType: 'tv', showId: 'show-1', seasonNumber: 2, episodeNumber: 7 },
    ...overrides,
  })
}

/** Re-sign a payload after tampering, using a DIFFERENT secret. */
function resignWithOtherSecret(token, secret) {
  const previous = process.env.CAST_TOKEN_SECRET
  process.env.CAST_TOKEN_SECRET = secret
  const forged = mint()
  if (previous === undefined) delete process.env.CAST_TOKEN_SECRET
  else process.env.CAST_TOKEN_SECRET = previous
  return forged
}

describe('castPlaybackToken', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.BETTER_AUTH_SECRET = 'test-better-auth-secret'
    delete process.env.CAST_TOKEN_SECRET
  })

  afterEach(() => {
    process.env = { ...originalEnv }
    jest.useRealTimers()
  })

  describe('mint', () => {
    it('round-trips the claims it was given', () => {
      const result = verifyCastPlaybackToken(mint())
      expect(result.ok).toBe(true)
      expect(result.claims.u).toBe(USER)
      expect(result.claims.n).toBe(NID)
      expect(result.claims.m).toEqual({ t: 'tv', s: 'show-1', sn: 2, en: 7 })
      expect(result.claims.exp - result.claims.iat).toBe(CAST_TOKEN_TTL_MS)
    })

    it('coerces season and episode numbers arriving as strings', () => {
      const token = mint({
        metadata: { mediaType: 'tv', showId: 'show-1', seasonNumber: '3', episodeNumber: '12' },
      })
      expect(verifyCastPlaybackToken(token).claims.m).toEqual({
        t: 'tv',
        s: 'show-1',
        sn: 3,
        en: 12,
      })
    })

    it('nulls metadata that is absent rather than inventing it', () => {
      const token = mint({ metadata: { mediaType: 'movie' } })
      expect(verifyCastPlaybackToken(token).claims.m).toEqual({
        t: 'movie',
        s: null,
        sn: null,
        en: null,
      })
    })

    it('refuses to mint without a well-formed user id', () => {
      expect(mint({ userId: '' })).toBeNull()
      expect(mint({ userId: 'not-an-object-id' })).toBeNull()
      expect(mint({ normalizedVideoId: '' })).toBeNull()
    })

    it('throws rather than signing with no secret at all', () => {
      delete process.env.BETTER_AUTH_SECRET
      expect(() => mint()).toThrow(/no signing secret/)
    })
  })

  describe('verify', () => {
    it('rejects a token signed with a different secret', () => {
      const forged = resignWithOtherSecret(mint(), 'some-other-secret')
      expect(verifyCastPlaybackToken(forged)).toEqual({
        ok: false,
        code: 'CAST_TOKEN_INVALID',
      })
    })

    it('rejects a payload edited to name another user', () => {
      const token = mint()
      const [version, payload, sig] = token.split('.')
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      claims.u = '507f1f77bcf86cd7994390ff'
      const tampered = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
      expect(verifyCastPlaybackToken(`${version}.${tampered}.${sig}`)).toEqual({
        ok: false,
        code: 'CAST_TOKEN_INVALID',
      })
    })

    it('rejects a payload edited to name another title', () => {
      const token = mint()
      const [version, payload, sig] = token.split('.')
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
      claims.n = '0000000000000000'
      const tampered = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
      expect(verifyCastPlaybackToken(`${version}.${tampered}.${sig}`).ok).toBe(false)
    })

    it.each([
      ['not a token at all', 'hello'],
      ['wrong version', 'cpt0.abc.def'],
      ['too few parts', 'cpt1.abc'],
      ['empty', ''],
      ['a number', 12345],
      ['null', null],
      ['undefined', undefined],
    ])('rejects %s', (_label, value) => {
      expect(verifyCastPlaybackToken(value).ok).toBe(false)
    })

    it('rejects an expired token', () => {
      const token = mint()
      jest.useFakeTimers().setSystemTime(Date.now() + CAST_TOKEN_TTL_MS + 1000)
      expect(verifyCastPlaybackToken(token)).toEqual({
        ok: false,
        code: 'CAST_TOKEN_EXPIRED',
      })
    })
  })

  describe('refresh', () => {
    it('does not roll a token that has plenty of life left', () => {
      const { claims } = verifyCastPlaybackToken(mint())
      expect(refreshIfDue(claims)).toBeNull()
    })

    it('rolls a token nearing expiry, preserving the original issue time', () => {
      const { claims } = verifyCastPlaybackToken(mint())
      const originalIat = claims.iat

      jest.useFakeTimers().setSystemTime(claims.exp - 30 * 60 * 1000)
      const rolled = refreshIfDue(claims)
      expect(rolled).toEqual(expect.any(String))

      const next = verifyCastPlaybackToken(rolled)
      expect(next.ok).toBe(true)
      expect(next.claims.iat).toBe(originalIat)
      expect(next.claims.exp).toBeGreaterThan(claims.exp)
      expect(next.claims.u).toBe(USER)
      expect(next.claims.n).toBe(NID)
    })

    it('caps the chain at 24h from first issue, however often it is rolled', () => {
      const { claims } = verifyCastPlaybackToken(mint())

      // Well into the second half of the chain: a refresh may extend, but only
      // as far as iat + MAX_CHAIN.
      jest.useFakeTimers().setSystemTime(claims.iat + CAST_TOKEN_MAX_CHAIN_MS - 2 * 60 * 60 * 1000)
      const rolled = refreshIfDue(claims)
      const next = verifyCastPlaybackToken(rolled)
      expect(next.claims.exp).toBe(claims.iat + CAST_TOKEN_MAX_CHAIN_MS)

      // Past the cap, the token is dead no matter what exp says.
      jest.setSystemTime(claims.iat + CAST_TOKEN_MAX_CHAIN_MS + 1000)
      expect(verifyCastPlaybackToken(rolled)).toEqual({
        ok: false,
        code: 'CAST_TOKEN_EXPIRED',
      })
    })

    it('declines to roll for a scrap of remaining time at the cap', () => {
      const { claims } = verifyCastPlaybackToken(mint())
      jest.useFakeTimers().setSystemTime(claims.iat + CAST_TOKEN_MAX_CHAIN_MS - 30 * 1000)
      expect(refreshIfDue(claims)).toBeNull()
    })
  })
})
