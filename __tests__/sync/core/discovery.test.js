/**
 * The rule behind "Recently Added" (src/utils/sync/core/discovery.ts):
 * seeded once, never later, earlier wins.
 *
 * The rail used to rank on the video file's mtime, which a quality upgrade
 * bumps and a preserved download mtime buries. These tests pin the three
 * properties that make initialDiscoveryDate a real add date instead.
 */

import {
  seedDiscovery,
  pickEarlierDiscovery,
  applyFirstSeen,
  resolveFirstSeen,
  claimDiscovery,
} from '@src/utils/sync/core/discovery'

const NOW = new Date('2026-09-21T12:00:00.000Z')
const SERVER = 'server-a'

describe('seedDiscovery', () => {
  it('dates a NEW document now', () => {
    const entity = { createdAt: NOW }
    const healed = seedDiscovery(entity, null, SERVER, NOW)

    expect(entity.initialDiscoveryDate).toEqual(NOW)
    expect(entity.initialDiscoveryServer).toBe(SERVER)
    expect(healed).toEqual(['initialDiscoveryDate', 'initialDiscoveryServer'])
  })

  it('heals a document that predates the field from its createdAt, not from now', () => {
    const createdAt = new Date('2026-07-13T08:00:00.000Z')
    const existing = { createdAt }
    const entity = { ...existing }

    seedDiscovery(entity, existing, SERVER, NOW)

    expect(entity.initialDiscoveryDate).toEqual(createdAt)
  })

  it('NEVER moves a date that is already held', () => {
    const held = new Date('2026-06-20T00:00:00.000Z')
    const existing = { createdAt: held, initialDiscoveryDate: held, initialDiscoveryServer: 'server-b' }
    const entity = { ...existing }

    const healed = seedDiscovery(entity, existing, SERVER, NOW)

    expect(entity.initialDiscoveryDate).toEqual(held)
    // ...and does not re-attribute it either.
    expect(entity.initialDiscoveryServer).toBe('server-b')
    expect(healed).toEqual([])
  })

  it('fills in a missing server without touching the date', () => {
    const held = new Date('2026-06-20T00:00:00.000Z')
    const existing = { initialDiscoveryDate: held }
    const entity = { ...existing }

    expect(seedDiscovery(entity, existing, SERVER, NOW)).toEqual(['initialDiscoveryServer'])
    expect(entity.initialDiscoveryDate).toEqual(held)
    expect(entity.initialDiscoveryServer).toBe(SERVER)
  })

  it('falls back to now only when an existing document has no usable createdAt', () => {
    const existing = { createdAt: 'not a date' }
    const entity = { ...existing }

    seedDiscovery(entity, existing, SERVER, NOW)

    expect(entity.initialDiscoveryDate).toEqual(NOW)
  })
})

describe('resolveFirstSeen', () => {
  it('reads the backend sidecar date', () => {
    expect(resolveFirstSeen({ id: 'mid:abc', firstSeen: '2026-07-26T03:55:06.566Z' }, NOW)).toEqual(
      new Date('2026-07-26T03:55:06.566Z')
    )
  })

  it('treats an absent, null or malformed date as NO CLAIM — never as now', () => {
    expect(resolveFirstSeen(null, NOW)).toBeNull()
    expect(resolveFirstSeen(undefined, NOW)).toBeNull()
    expect(resolveFirstSeen({ id: 'mid:abc' }, NOW)).toBeNull()
    // The backend publishes null when the sidecar could not be written.
    expect(resolveFirstSeen({ id: 'mid:abc', firstSeen: null }, NOW)).toBeNull()
    expect(resolveFirstSeen({ firstSeen: 'soon' }, NOW)).toBeNull()
    expect(resolveFirstSeen({ firstSeen: 1753502106566 }, NOW)).toBeNull()
  })

  it('ignores a date from a broken clock instead of clamping it', () => {
    expect(resolveFirstSeen({ firstSeen: '2031-01-01T00:00:00.000Z' }, NOW)).toBeNull()
  })
})

describe('pickEarlierDiscovery', () => {
  const held = new Date('2026-06-20T00:00:00.000Z')

  it('adopts a backend date that PREDATES ours', () => {
    const earlier = new Date('2026-03-01T00:00:00.000Z')
    expect(pickEarlierDiscovery(held, earlier)).toEqual(earlier)
  })

  it('ignores a backend date that is later — the sidecar-rollout case', () => {
    // Sidecars written at the identity rollout carry the rollout date for
    // titles that were already in the library.
    expect(pickEarlierDiscovery(held, new Date('2026-07-26T00:00:00.000Z'))).toBeNull()
  })

  it('is a no-op when the dates are equal, so an unchanged title is never rewritten', () => {
    expect(pickEarlierDiscovery(held, new Date(held))).toBeNull()
  })

  it('adopts the backend date when we hold none', () => {
    const incoming = new Date('2026-07-26T00:00:00.000Z')
    expect(pickEarlierDiscovery(undefined, incoming)).toEqual(incoming)
  })

  it('makes no change when the backend makes no claim', () => {
    expect(pickEarlierDiscovery(held, null)).toBeNull()
  })
})

describe('applyFirstSeen', () => {
  it('RESTORES the original date on a re-created document', () => {
    // The orphan add/delete cycle: the episode document was deleted and
    // re-created, so seedDiscovery dated it now. The sidecar still knows.
    const entity = {}
    seedDiscovery(entity, null, SERVER, NOW)

    const moved = applyFirstSeen(
      entity,
      { id: 'mid:abc:s01e03', firstSeen: '2026-08-02T10:00:00.000Z' },
      SERVER,
      NOW
    )

    expect(moved).toBe(true)
    expect(entity.initialDiscoveryDate).toEqual(new Date('2026-08-02T10:00:00.000Z'))
  })

  it('leaves a long-held date alone when the sidecar is younger', () => {
    const held = new Date('2026-06-20T00:00:00.000Z')
    const entity = { initialDiscoveryDate: held, initialDiscoveryServer: 'server-b' }

    const moved = applyFirstSeen(entity, { firstSeen: '2026-07-26T00:00:00.000Z' }, SERVER, NOW)

    expect(moved).toBe(false)
    expect(entity.initialDiscoveryDate).toEqual(held)
    expect(entity.initialDiscoveryServer).toBe('server-b')
  })
})

// Several file servers can hold the same content, each with its own first-seen
// date. Each is heard in turn; the result must not depend on the order.
describe('claimDiscovery', () => {
  const EARLY = new Date('2023-03-01T00:00:00.000Z')
  const LATE = new Date('2025-06-01T00:00:00.000Z')
  const never = () => false
  const always = () => true

  it('claims the date when it is earlier than the one held, or none is held', () => {
    expect(claimDiscovery(LATE, 'server-b', EARLY, SERVER, never)).toBe('date')
    expect(claimDiscovery(undefined, undefined, EARLY, SERVER, never)).toBe('date')
  })

  it('claims nothing with a later date, or with no date at all', () => {
    expect(claimDiscovery(EARLY, 'server-b', LATE, SERVER, always)).toBeNull()
    expect(claimDiscovery(EARLY, 'server-b', null, SERVER, always)).toBeNull()
  })

  it('claims only the server for the same date, and only when it outranks the one on record', () => {
    expect(claimDiscovery(EARLY, 'server-b', new Date(EARLY), SERVER, always)).toBe('server')
    expect(claimDiscovery(EARLY, 'server-b', new Date(EARLY), SERVER, never)).toBeNull()
    expect(claimDiscovery(EARLY, SERVER, new Date(EARLY), SERVER, always)).toBeNull()
  })

  it('ends on the earliest date and the higher-ranked holder of it, in either order', () => {
    // server-a outranks server-b; both hold EARLY, server-c holds LATE.
    const held = { 'server-a': EARLY, 'server-b': EARLY, 'server-c': LATE }
    const rank = { 'server-a': 1, 'server-b': 2, 'server-c': 3 }
    const settle = (order) => {
      const entity = {}
      for (const serverId of order) {
        applyFirstSeen(entity, { firstSeen: held[serverId].toISOString() }, serverId, NOW, (other) => rank[serverId] < rank[other])
      }
      return entity
    }

    for (const order of [['server-a', 'server-b', 'server-c'], ['server-c', 'server-b', 'server-a'], ['server-b', 'server-c', 'server-a']]) {
      expect(settle(order)).toEqual({ initialDiscoveryDate: EARLY, initialDiscoveryServer: 'server-a' })
    }
  })
})
