/**
 * Cast Playback Token (CPT)
 *
 * A short-lived capability that lets a Cast receiver — a television we do not
 * control, on the far side of a Cast channel — write back exactly one thing:
 * the resume position of one title, for one user.
 *
 * Why a new token instead of reusing what exists:
 *
 *  - A better-auth session token would work (the bearer plugin accepts a raw
 *    session token), but sessions last 30 days and authorize every
 *    /api/authenticated/* route, admin included. Handing that to a TV, where
 *    the debug overlay and the Cast Developer Console can both read it, trades
 *    a resume position for an account.
 *  - The one-time-token plugin mints a full session on verify. Same problem,
 *    shorter fuse.
 *  - The webhook shared secret authenticates a server, not a person, so it
 *    cannot key a WatchHistory row at all.
 *
 * The whole authority granted here is "set this user's position for this title,
 * for at most 24 hours". It reads nothing. The scope is what makes shipping it
 * through a television acceptable.
 *
 * Only node:crypto is imported, deliberately: this module must stay outside the
 * import chain that opens a Mongo client, so a Route Handler can verify a token
 * before deciding whether it wants a database at all.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'

const VERSION = 'cpt1'

/** One token's life. Long enough to outlast a film plus an interrupted evening. */
const TTL_MS = 12 * 60 * 60 * 1000
/** Absolute ceiling across refreshes, measured from the ORIGINAL issue time. */
const MAX_CHAIN_MS = 24 * 60 * 60 * 1000
/** Roll the token when this little of its life remains. */
const REFRESH_WITHIN_MS = 60 * 60 * 1000

export interface CastTokenMediaClaims {
  /** 'movie' | 'tv' */
  t: string | null
  /** showId, for episodes */
  s: string | null
  /** season number */
  sn: number | null
  /** episode number */
  en: number | null
}

export interface CastTokenClaims {
  /** user _id, 24-hex */
  u: string
  /** normalizedVideoId — the identity of the one title this token can write */
  n: string
  /** media metadata, carried IN the signature so a caller can never supply it */
  m: CastTokenMediaClaims
  /** original issue time (ms); preserved across refreshes */
  iat: number
  /** expiry (ms) */
  exp: number
}

export type CastTokenFailure =
  | 'CAST_TOKEN_INVALID'
  | 'CAST_TOKEN_EXPIRED'

export type CastTokenVerification =
  | { ok: true; claims: CastTokenClaims }
  | { ok: false; code: CastTokenFailure }

/**
 * The signing key.
 *
 * Derived from BETTER_AUTH_SECRET through a labelled HMAC rather than used
 * directly, so a cast token is never signed with the same key as a session:
 * the two live in different threat models and must not be interchangeable.
 * No new env var is needed, and every deployment already has the base secret.
 * Set CAST_TOKEN_SECRET to rotate cast tokens without invalidating sessions.
 */
function castKey(): Buffer {
  const override = process.env.CAST_TOKEN_SECRET
  if (override) return Buffer.from(override, 'utf8')
  const base = process.env.BETTER_AUTH_SECRET
  if (!base) throw new Error('castPlaybackToken: no signing secret available')
  return createHmac('sha256', base).update('cast-playback-token.v1').digest()
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromB64url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function sign(payloadB64: string): string {
  return b64url(createHmac('sha256', castKey()).update(`${VERSION}.${payloadB64}`).digest())
}

function encode(claims: CastTokenClaims): string {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(claims), 'utf8'))
  return `${VERSION}.${payloadB64}.${sign(payloadB64)}`
}

/** Season and episode numbers reach here as strings often enough to coerce. */
function asInt(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

/**
 * Mint a token for one user and one title.
 *
 * Called during a page render the user already authenticated, from a Server
 * Component that has the session in hand — there is no mint endpoint, because
 * an endpoint would be one more thing to authorize.
 */
export function mintCastPlaybackToken({
  userId,
  normalizedVideoId,
  metadata,
}: {
  userId: string
  normalizedVideoId: string
  metadata?: {
    mediaType?: string | null
    showId?: string | null
    seasonNumber?: number | null
    episodeNumber?: number | null
  }
}): string | null {
  if (!userId || !/^[0-9a-f]{24}$/i.test(String(userId))) return null
  if (!normalizedVideoId || typeof normalizedVideoId !== 'string') return null

  const now = Date.now()
  return encode({
    u: String(userId),
    n: normalizedVideoId,
    m: {
      t: metadata?.mediaType ?? null,
      s: metadata?.showId ? String(metadata.showId) : null,
      sn: asInt(metadata?.seasonNumber),
      en: asInt(metadata?.episodeNumber),
    },
    iat: now,
    exp: now + TTL_MS,
  })
}

/**
 * Verify a token. Stateless — no database round trip, by design: this runs on
 * every heartbeat from every casting device.
 */
export function verifyCastPlaybackToken(token: unknown): CastTokenVerification {
  if (typeof token !== 'string' || token.length > 4096) {
    return { ok: false, code: 'CAST_TOKEN_INVALID' }
  }

  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) {
    return { ok: false, code: 'CAST_TOKEN_INVALID' }
  }
  const [, payloadB64, sigB64] = parts

  // Constant-time compare. The signature is the only thing standing between a
  // guessed token and someone else's watch history, so it must not leak how
  // much of a candidate was correct through timing.
  let expected: Buffer
  try {
    expected = fromB64url(sign(payloadB64))
  } catch {
    return { ok: false, code: 'CAST_TOKEN_INVALID' }
  }
  const provided = fromB64url(sigB64)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, code: 'CAST_TOKEN_INVALID' }
  }

  let claims: CastTokenClaims
  try {
    claims = JSON.parse(fromB64url(payloadB64).toString('utf8'))
  } catch {
    return { ok: false, code: 'CAST_TOKEN_INVALID' }
  }

  if (
    !claims ||
    typeof claims.u !== 'string' ||
    !/^[0-9a-f]{24}$/i.test(claims.u) ||
    typeof claims.n !== 'string' ||
    !claims.n ||
    typeof claims.iat !== 'number' ||
    typeof claims.exp !== 'number'
  ) {
    return { ok: false, code: 'CAST_TOKEN_INVALID' }
  }

  const now = Date.now()
  if (now >= claims.exp) return { ok: false, code: 'CAST_TOKEN_EXPIRED' }
  // The chain cap is measured from the FIRST issue, so refreshing cannot walk a
  // token forward indefinitely.
  if (now >= claims.iat + MAX_CHAIN_MS) return { ok: false, code: 'CAST_TOKEN_EXPIRED' }

  return { ok: true, claims }
}

/**
 * A replacement token when the current one is close to expiring, or null when
 * it is not yet due — or when refreshing it would cross the 24 h chain cap, in
 * which case reporting simply stops and the receiver falls silent.
 */
export function refreshIfDue(claims: CastTokenClaims): string | null {
  const now = Date.now()
  if (claims.exp - now > REFRESH_WITHIN_MS) return null

  const nextExp = Math.min(now + TTL_MS, claims.iat + MAX_CHAIN_MS)
  if (nextExp - now < 60_000) return null // not worth rolling for under a minute

  return encode({ ...claims, exp: nextExp })
}

export const CAST_TOKEN_TTL_MS = TTL_MS
export const CAST_TOKEN_MAX_CHAIN_MS = MAX_CHAIN_MS
