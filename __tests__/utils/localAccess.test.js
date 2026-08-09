import {
  DEFAULT_ALLOWED_NETWORKS,
  DENY_REASONS,
  LOCAL_ACCESS_ASSERTION_HEADER,
  LOCAL_ACCESS_CLIENT_IP_HEADER,
  evaluateLocalAccess,
  ipMatchesNetworks,
  parseAllowedNetworks,
  parseIpAddress,
} from '@src/utils/localAccess'

const SECRET = 'f'.repeat(64)

function req(headerMap = {}) {
  const lower = new Map(Object.entries(headerMap).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name) => lower.get(String(name).toLowerCase()) ?? null }
}

function grant(overrides = {}) {
  return evaluateLocalAccess({
    headers: req({
      [LOCAL_ACCESS_ASSERTION_HEADER]: SECRET,
      [LOCAL_ACCESS_CLIENT_IP_HEADER]: '127.0.0.1',
    }),
    enabled: true,
    assertionSecret: SECRET,
    allowedNetworks: DEFAULT_ALLOWED_NETWORKS,
    ...overrides,
  })
}

describe('parseIpAddress', () => {
  test('collapses IPv4-mapped IPv6 so one loopback rule covers both families', () => {
    expect(parseIpAddress('::ffff:127.0.0.1')).toEqual(parseIpAddress('127.0.0.1'))
  })

  test('rejects the shorthand and numeric forms that bypass naive string checks', () => {
    for (const value of ['127.1', '2130706433', '0177.0.0.1', '127.0.0.01', '127.0.0.1.', '']) {
      expect(parseIpAddress(value)).toBeNull()
    }
  })

  test('rejects non-strings', () => {
    for (const value of [null, undefined, 127, {}, ['127.0.0.1']]) {
      expect(parseIpAddress(value)).toBeNull()
    }
  })
})

describe('parseAllowedNetworks', () => {
  test('drops malformed entries instead of widening the rule', () => {
    expect(parseAllowedNetworks('127.0.0.1/33')).toHaveLength(0)
    expect(parseAllowedNetworks('not-an-ip/8')).toHaveLength(0)
    expect(parseAllowedNetworks('127.0.0.1/abc')).toHaveLength(0)
    expect(parseAllowedNetworks('')).toHaveLength(0)
  })

  test('treats a bare address as a single host', () => {
    const networks = parseAllowedNetworks('10.1.2.3')
    expect(ipMatchesNetworks('10.1.2.3', networks)).toBe(true)
    expect(ipMatchesNetworks('10.1.2.4', networks)).toBe(false)
  })

  test('matches inside a CIDR block and not outside it', () => {
    const networks = parseAllowedNetworks('192.168.1.0/24, 172.16.0.0/12')
    expect(ipMatchesNetworks('192.168.1.255', networks)).toBe(true)
    expect(ipMatchesNetworks('192.168.2.1', networks)).toBe(false)
    expect(ipMatchesNetworks('172.20.5.5', networks)).toBe(true)
    expect(ipMatchesNetworks('172.32.0.1', networks)).toBe(false)
  })

  test('does not match an IPv4 address against an IPv6 rule', () => {
    expect(ipMatchesNetworks('127.0.0.1', parseAllowedNetworks('::1/128'))).toBe(false)
    expect(ipMatchesNetworks('::1', parseAllowedNetworks('127.0.0.1/32'))).toBe(false)
  })
})

describe('evaluateLocalAccess', () => {
  test('grants when the setting, the proxy assertion and the network all agree', () => {
    expect(grant()).toEqual({ allowed: true, reason: null, clientIp: '127.0.0.1' })
  })

  test('denies while the setting is off, whatever the request claims', () => {
    expect(grant({ enabled: false }).allowed).toBe(false)
    expect(grant({ enabled: false }).reason).toBe(DENY_REASONS.DISABLED)
    for (const enabled of [undefined, null, 'true', 1]) {
      expect(grant({ enabled }).allowed).toBe(false)
    }
  })

  test('denies when no proxy secret is configured, so the default deployment is inert', () => {
    expect(grant({ assertionSecret: undefined }).reason).toBe(DENY_REASONS.NO_SECRET)
    expect(grant({ assertionSecret: '' }).reason).toBe(DENY_REASONS.NO_SECRET)
    // Too short to be a secret.
    expect(grant({ assertionSecret: 'short' }).reason).toBe(DENY_REASONS.NO_SECRET)
  })

  test('denies a forged client IP that is not accompanied by the proxy assertion', () => {
    // The whole attack: anyone who can reach the published port directly can
    // send these headers. Without the secret they buy nothing.
    for (const forged of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const result = evaluateLocalAccess({
        headers: req({ [LOCAL_ACCESS_CLIENT_IP_HEADER]: forged }),
        enabled: true,
        assertionSecret: SECRET,
        allowedNetworks: DEFAULT_ALLOWED_NETWORKS,
      })
      expect(result.allowed).toBe(false)
      expect(result.reason).toBe(DENY_REASONS.BAD_ASSERTION)
    }
  })

  test('denies a wrong or near-miss assertion', () => {
    const almost = `${SECRET.slice(0, -1)}e`
    expect(grant({ headers: req({ [LOCAL_ACCESS_ASSERTION_HEADER]: almost, [LOCAL_ACCESS_CLIENT_IP_HEADER]: '127.0.0.1' }) }).reason)
      .toBe(DENY_REASONS.BAD_ASSERTION)
    expect(grant({ headers: req({ [LOCAL_ACCESS_ASSERTION_HEADER]: SECRET.slice(0, 32), [LOCAL_ACCESS_CLIENT_IP_HEADER]: '127.0.0.1' }) }).reason)
      .toBe(DENY_REASONS.BAD_ASSERTION)
  })

  test('ignores X-Forwarded-For entirely, because nginx appends to it', () => {
    const result = evaluateLocalAccess({
      headers: req({
        [LOCAL_ACCESS_ASSERTION_HEADER]: SECRET,
        'x-forwarded-for': '127.0.0.1, 203.0.113.9',
        [LOCAL_ACCESS_CLIENT_IP_HEADER]: '203.0.113.9',
      }),
      enabled: true,
      assertionSecret: SECRET,
      allowedNetworks: DEFAULT_ALLOWED_NETWORKS,
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe(DENY_REASONS.IP_NOT_ALLOWED)
  })

  test('denies a remote address that arrived through the trusted proxy', () => {
    const result = grant({
      headers: req({
        [LOCAL_ACCESS_ASSERTION_HEADER]: SECRET,
        [LOCAL_ACCESS_CLIENT_IP_HEADER]: '203.0.113.9',
      }),
    })
    expect(result.allowed).toBe(false)
    expect(result.reason).toBe(DENY_REASONS.IP_NOT_ALLOWED)
  })

  test('denies when the allowlist is empty or unparseable', () => {
    expect(grant({ allowedNetworks: '' }).reason).toBe(DENY_REASONS.NO_NETWORKS)
    expect(grant({ allowedNetworks: 'garbage' }).reason).toBe(DENY_REASONS.NO_NETWORKS)
  })

  test('denies when the proxy sent no client address', () => {
    const result = grant({ headers: req({ [LOCAL_ACCESS_ASSERTION_HEADER]: SECRET }) })
    expect(result.reason).toBe(DENY_REASONS.NO_CLIENT_IP)
  })

  test('never returns a client IP on a denial', () => {
    for (const overrides of [
      { enabled: false },
      { assertionSecret: 'short' },
      { allowedNetworks: '' },
      { headers: req({ [LOCAL_ACCESS_CLIENT_IP_HEADER]: '127.0.0.1' }) },
    ]) {
      expect(grant(overrides).clientIp).toBeNull()
    }
  })

  test('survives a headers object that is missing or malformed', () => {
    expect(evaluateLocalAccess({ headers: undefined, enabled: true, assertionSecret: SECRET, allowedNetworks: DEFAULT_ALLOWED_NETWORKS }).allowed).toBe(false)
    expect(evaluateLocalAccess({}).allowed).toBe(false)
    expect(evaluateLocalAccess({ enabled: true }).allowed).toBe(false)
  })

  test('an operator widening the list to a LAN range still excludes the internet', () => {
    const networks = '127.0.0.1/32, ::1/128, 192.168.0.0/16'
    expect(grant({ allowedNetworks: networks, headers: req({ [LOCAL_ACCESS_ASSERTION_HEADER]: SECRET, [LOCAL_ACCESS_CLIENT_IP_HEADER]: '192.168.0.42' }) }).allowed).toBe(true)
    expect(grant({ allowedNetworks: networks, headers: req({ [LOCAL_ACCESS_ASSERTION_HEADER]: SECRET, [LOCAL_ACCESS_CLIENT_IP_HEADER]: '8.8.8.8' }) }).allowed).toBe(false)
  })
})
