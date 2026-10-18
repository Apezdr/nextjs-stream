/**
 * core/resources: what a builder reads, and the needs it records for what it
 * was not handed.
 */

const { Resources, sameRequest } = require('@src/utils/sync/core/resources')

const metadata = { kind: 'metadata', serverId: 'A', path: '/m.json' }
const blurhash = { kind: 'blurhash', serverId: 'A', path: '/p.blurhash' }

describe('Resources', () => {
  it('records each file read and not handed as a need, once, in the order first read', () => {
    const resources = new Resources()
    expect(resources.read(blurhash)).toBeUndefined()
    expect(resources.read(metadata)).toBeUndefined()
    expect(resources.read({ ...blurhash })).toBeUndefined()
    expect(resources.needs).toEqual([blurhash, metadata])
  })

  it('hands back a fetched file without recording a need, and its data only when the fetch worked', () => {
    const resources = new Resources([
      { ...metadata, ok: true, data: { name: 'n' } },
      { ...blurhash, ok: false, error: 'down' },
    ])
    expect(resources.data(metadata)).toEqual({ name: 'n' })
    expect(resources.data(blurhash)).toBeNull()
    expect(resources.read(blurhash)).toEqual({ ...blurhash, ok: false, error: 'down' })
    expect(resources.needs).toEqual([])
  })

  it('reads a file not handed yet as a failed fetch', () => {
    expect(new Resources().data(metadata)).toBeNull()
  })

  it('tells a direct read from a read through the cache', () => {
    expect(sameRequest(blurhash, { ...blurhash, direct: true })).toBe(false)
    expect(sameRequest(blurhash, { ...blurhash, direct: false })).toBe(true)
    expect(sameRequest(blurhash, { ...blurhash, serverId: 'B' })).toBe(false)
  })
})
