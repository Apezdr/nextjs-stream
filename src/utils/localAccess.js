import { isIP } from 'node:net'
import { timingSafeEqual } from 'node:crypto'

/**
 * Local owner access — the Plex/Sonarr "trusted local network" pattern.
 *
 * When enabled, a request that provably originates from an allowed network is
 * treated as the server owner, so a machine sitting on the host does not have
 * to complete an OAuth round trip. Everything it does is attributed to the
 * owner account, exactly like Plex ties local playback to the server owner.
 *
 * The whole design rests on one question: can this process believe a claim
 * about where a request came from? Behind a reverse proxy the answer is no by
 * default — `X-Real-IP` and `X-Forwarded-For` are just strings any client can
 * send, and this app is also reachable on a published port that does not pass
 * through nginx at all. So a forwarded address is trusted ONLY when the request
 * also carries a secret that exists solely in the proxy's configuration. That
 * secret is what makes the address an assertion rather than a suggestion.
 *
 * Every failure path denies. There is no "assume local when unsure".
 */

/** Loopback only. Matches the default of every product that ships this feature. */
export const DEFAULT_ALLOWED_NETWORKS = Object.freeze(['127.0.0.1/32', '::1/128'])

export const LOCAL_ACCESS_ASSERTION_HEADER = 'x-local-access-assertion'
export const LOCAL_ACCESS_CLIENT_IP_HEADER = 'x-real-ip'

/** Minimum length for the proxy assertion secret; below this it is not a secret. */
const MIN_ASSERTION_SECRET_LENGTH = 32

export const DENY_REASONS = Object.freeze({
  DISABLED: 'disabled',
  NO_SECRET: 'no-proxy-secret',
  BAD_ASSERTION: 'assertion-mismatch',
  NO_CLIENT_IP: 'no-client-ip',
  IP_NOT_ALLOWED: 'ip-not-allowed',
  NO_NETWORKS: 'no-allowed-networks',
})

function ipToBigInt(address, version) {
  if (version === 4) {
    const parts = address.split('.')
    if (parts.length !== 4) return null
    let value = 0n
    for (const part of parts) {
      // Reject '01', '1e2', '+1' and anything else Number() would accept.
      if (!/^(?:0|[1-9]\d*)$/.test(part)) return null
      const octet = Number(part)
      if (octet > 255) return null
      value = (value << 8n) | BigInt(octet)
    }
    return value
  }

  // Expand :: then parse the eight groups.
  const halves = address.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : []

  // A trailing IPv4 literal (::ffff:127.0.0.1) occupies the last two groups.
  const last = tail.length ? tail[tail.length - 1] : head[head.length - 1]
  let groups = [...head, ...tail]
  if (last && last.includes('.')) {
    const embedded = ipToBigInt(last, 4)
    if (embedded === null) return null
    const replacement = [
      (embedded >> 16n).toString(16),
      (embedded & 0xffffn).toString(16),
    ]
    groups = [...groups.slice(0, -1), ...replacement]
    if (tail.length) tail.splice(-1, 1, ...replacement)
    else head.splice(-1, 1, ...replacement)
  }

  const fillCount = 8 - groups.length
  if (halves.length === 2) {
    if (fillCount < 0) return null
  } else if (groups.length !== 8) {
    return null
  }

  const expanded =
    halves.length === 2
      ? [...(halves[0] ? head : []), ...Array(fillCount).fill('0'), ...(halves[1] ? tail : [])]
      : groups

  let value = 0n
  for (const group of expanded) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null
    value = (value << 16n) | BigInt(parseInt(group, 16))
  }
  return value
}

/**
 * Normalize an address for comparison. IPv4-mapped IPv6 (`::ffff:127.0.0.1`)
 * collapses to its IPv4 form so a `127.0.0.1/32` rule matches it — otherwise
 * the same client would be allowed or denied depending on the socket family.
 *
 * @param {unknown} value
 * @returns {{ value: bigint, version: 4|6 }|null}
 */
export function parseIpAddress(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/^\[|\]$/g, '')
  if (!trimmed || trimmed.length > 64) return null
  const address = trimmed.split('%')[0]
  const version = isIP(address)
  if (!version) return null

  if (version === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)
    if (mapped) {
      const asV4 = ipToBigInt(mapped[1], 4)
      return asV4 === null ? null : { value: asV4, version: 4 }
    }
  }

  const parsed = ipToBigInt(address, version)
  return parsed === null ? null : { value: parsed, version }
}

/**
 * Parse a comma/whitespace separated CIDR list. A bare address is treated as a
 * single host. Invalid entries are dropped rather than widening the rule.
 *
 * @param {unknown} value
 * @returns {Array<{ base: bigint, mask: bigint, version: 4|6 }>}
 */
export function parseAllowedNetworks(value) {
  const entries = Array.isArray(value) ? value : String(value ?? '').split(/[,\s]+/)
  const networks = []
  for (const entry of entries) {
    const text = String(entry ?? '').trim()
    if (!text) continue
    const [addressPart, prefixPart] = text.split('/')
    const parsed = parseIpAddress(addressPart)
    if (!parsed) continue

    const bits = parsed.version === 4 ? 32 : 128
    let prefix = bits
    if (prefixPart !== undefined) {
      if (!/^\d{1,3}$/.test(prefixPart)) continue
      prefix = Number(prefixPart)
      if (prefix > bits) continue
    }
    const mask = prefix === 0 ? 0n : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix)
    networks.push({ base: parsed.value & mask, mask, version: parsed.version })
  }
  return networks
}

/**
 * @param {unknown} ip
 * @param {ReturnType<typeof parseAllowedNetworks>} networks
 * @returns {boolean}
 */
export function ipMatchesNetworks(ip, networks) {
  const parsed = parseIpAddress(ip)
  if (!parsed || !Array.isArray(networks) || networks.length === 0) return false
  return networks.some(
    (network) => network.version === parsed.version && (parsed.value & network.mask) === network.base
  )
}

function secretsMatch(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  // timingSafeEqual throws on length mismatch, so compare lengths separately.
  // The length of a rejected secret is not itself sensitive.
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * Decide whether a request qualifies for local owner access.
 *
 * @param {object} input
 * @param {Headers|{get: (name: string) => string|null}} input.headers
 * @param {boolean} input.enabled admin setting
 * @param {string} input.assertionSecret shared secret injected by the trusted proxy
 * @param {unknown} input.allowedNetworks CIDR list
 * @returns {{ allowed: boolean, reason: string|null, clientIp: string|null }}
 */
export function evaluateLocalAccess({ headers, enabled, assertionSecret, allowedNetworks }) {
  const deny = (reason) => ({ allowed: false, reason, clientIp: null })

  if (enabled !== true) return deny(DENY_REASONS.DISABLED)

  // Without a configured secret there is no way to tell a proxy-set address
  // from a client-set one, so the feature stays off no matter what else is set.
  if (typeof assertionSecret !== 'string' || assertionSecret.length < MIN_ASSERTION_SECRET_LENGTH) {
    return deny(DENY_REASONS.NO_SECRET)
  }
  if (!secretsMatch(headers?.get?.(LOCAL_ACCESS_ASSERTION_HEADER), assertionSecret)) {
    return deny(DENY_REASONS.BAD_ASSERTION)
  }

  const networks = parseAllowedNetworks(allowedNetworks)
  if (networks.length === 0) return deny(DENY_REASONS.NO_NETWORKS)

  // Only the proxy-overwritten single-value header is consulted. The
  // X-Forwarded-For chain is deliberately ignored: nginx appends to it, so its
  // leftmost entry is whatever the client sent.
  const clientIp = headers?.get?.(LOCAL_ACCESS_CLIENT_IP_HEADER)
  const parsed = parseIpAddress(clientIp)
  if (!parsed) return deny(DENY_REASONS.NO_CLIENT_IP)

  if (!ipMatchesNetworks(clientIp, networks)) return deny(DENY_REASONS.IP_NOT_ALLOWED)

  return { allowed: true, reason: null, clientIp: String(clientIp).trim() }
}
