import {
  serverEnvSuffix,
  resolveTranscoderKey,
  resolveInternalBase,
  transcoderBaseFromJitUrl,
} from '@src/utils/jit/transcoderAdminConfig'

const KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5'
const OTHER = 'zyxwvutsrqponmlkjihgfedcba9876'

describe('serverEnvSuffix', () => {
  test('maps the app server ids to their variable suffix', () => {
    expect(serverEnvSuffix('default')).toBe('')
    expect(serverEnvSuffix('server2')).toBe('_2')
    expect(serverEnvSuffix('server12')).toBe('_12')
  })

  test('refuses an id that names no server', () => {
    for (const id of ['', 'server', 'serverX', 'Server2', undefined]) {
      expect(() => serverEnvSuffix(id)).toThrow(/unknown file server id/)
    }
  })
})

describe('resolveTranscoderKey', () => {
  test("a dedicated key wins; otherwise the server's shared webhook key is used", () => {
    expect(resolveTranscoderKey('default', { WEBHOOK_ID: KEY })).toEqual({ ok: true, key: KEY, variable: 'WEBHOOK_ID' })
    expect(
      resolveTranscoderKey('default', { WEBHOOK_ID: KEY, JIT_TRANSCODER_WEBHOOK_ID: OTHER })
    ).toEqual({ ok: true, key: OTHER, variable: 'JIT_TRANSCODER_WEBHOOK_ID' })
    expect(resolveTranscoderKey('server2', { WEBHOOK_ID_2: ` ${KEY} ` })).toEqual({
      ok: true,
      key: KEY,
      variable: 'WEBHOOK_ID_2',
    })
  })

  test("never borrows another server's key", () => {
    const env = { WEBHOOK_ID: KEY, JIT_TRANSCODER_WEBHOOK_ID: OTHER }
    const r = resolveTranscoderKey('server2', env)
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('JIT_TRANSCODER_WEBHOOK_ID_2')
    expect(r.reason).toContain('WEBHOOK_ID_2')
  })

  test('an empty dedicated variable falls through to the shared one', () => {
    expect(resolveTranscoderKey('default', { JIT_TRANSCODER_WEBHOOK_ID: '  ', WEBHOOK_ID: KEY }).variable).toBe(
      'WEBHOOK_ID'
    )
  })

  test('refuses what the transcoder would refuse, naming the variable and never the value', () => {
    for (const bad of ['short', `${KEY},${OTHER}`, `${KEY} x`, 'ünïcödé-0123456789abc', 'x'.repeat(513)]) {
      const r = resolveTranscoderKey('default', { WEBHOOK_ID: bad })
      expect(r.ok).toBe(false)
      expect(r.variable).toBe('WEBHOOK_ID')
      expect(r.reason).not.toContain(bad)
    }
  })
})

describe('resolveInternalBase', () => {
  test('optional, normalized to a base without a trailing slash', () => {
    expect(resolveInternalBase('default', {})).toEqual({
      ok: true,
      base: null,
      variable: 'JIT_TRANSCODER_INTERNAL_URL',
    })
    expect(resolveInternalBase('default', { JIT_TRANSCODER_INTERNAL_URL: 'http://jit-transcoder:3232/' }).base).toBe(
      'http://jit-transcoder:3232'
    )
    expect(
      resolveInternalBase('server3', { JIT_TRANSCODER_INTERNAL_URL_3: 'https://gpu-box.lan/jit//' })
    ).toEqual({ ok: true, base: 'https://gpu-box.lan/jit', variable: 'JIT_TRANSCODER_INTERNAL_URL_3' })
  })

  test('refuses a value that is not a plain http(s) base', () => {
    for (const bad of ['jit-transcoder:3232', 'ftp://x', 'http://u:p@x', 'http://x/?a=1', 'not a url']) {
      const r = resolveInternalBase('default', { JIT_TRANSCODER_INTERNAL_URL: bad })
      expect(r.ok).toBe(false)
      expect(r.reason).toMatch(/^JIT_TRANSCODER_INTERNAL_URL /)
    }
  })
})

describe('transcoderBaseFromJitUrl', () => {
  test('keeps a path prefix and drops the stream address', () => {
    expect(transcoderBaseFromJitUrl('https://transcoder.example/stream/bW92aWU/master.m3u8')).toBe(
      'https://transcoder.example'
    )
    expect(transcoderBaseFromJitUrl('https://host.example/jit/stream/bW92aWU/master.m3u8')).toBe(
      'https://host.example/jit'
    )
  })

  test('null for anything that is not a transcoder stream URL', () => {
    for (const bad of [null, '', 'not a url', 'https://host.example/movies/a.mkv']) {
      expect(transcoderBaseFromJitUrl(bad)).toBeNull()
    }
  })
})
