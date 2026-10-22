/**
 * Where, and with which key, the app calls each file server's transcoder admin API
 * (jit-transcoder `GET /admin/sessions`). Pure: reads only the env object it is given.
 *
 * Per file server, with that server's usual suffix ('default' → none, 'server2' → `_2`):
 *
 *   JIT_TRANSCODER_WEBHOOK_ID[_N]    optional; a key used only for that server's transcoder
 *   WEBHOOK_ID[_N]                   otherwise; the key the app already shares with that server
 *   JIT_TRANSCODER_INTERNAL_URL[_N]  optional; a private address for the transcoder (e.g. the
 *                                    Docker DNS name). Otherwise the app calls the base players
 *                                    use, read from that server's titles' `jitUrl`.
 *
 * The transcoder side is `WEBHOOK_ID_1..N` (README "Admin API" there): one key per reading app,
 * so a sysadmin can share one key across the stack or give each reader its own.
 *
 * A key is never borrowed from another server's variables: with servers run by different
 * people, that would hand one server's key to another server's transcoder.
 */

/** 'default' → '', 'server3' → '_3'. Any other id is a caller bug. */
export function serverEnvSuffix(serverId) {
  if (serverId === 'default') return ''
  const match = /^server(\d+)$/.exec(serverId ?? '')
  if (!match) throw new Error(`unknown file server id: ${serverId}`)
  return `_${match[1]}`
}

/**
 * The key to send to `serverId`'s transcoder, and the variable it came from (so every failure
 * can name what to fix). The value itself is never part of a reason.
 *
 * @returns {{ok: true, key: string, variable: string} | {ok: false, variable: string, reason: string}}
 */
export function resolveTranscoderKey(serverId, env = process.env) {
  const suffix = serverEnvSuffix(serverId)
  const dedicated = `JIT_TRANSCODER_WEBHOOK_ID${suffix}`
  const shared = `WEBHOOK_ID${suffix}`
  for (const variable of [dedicated, shared]) {
    const raw = env[variable]
    if (typeof raw !== 'string' || raw.trim() === '') continue
    const key = raw.trim()
    // The transcoder accepts 16-512 visible-ASCII characters with no commas (its WEBHOOK_ID_n
    // values are comma-separated lists). Refuse here what it would refuse there, with our name.
    if (!/^[\x21-\x7e]+$/.test(key) || key.includes(',')) {
      return { ok: false, variable, reason: `${variable} is not a single header-safe key` }
    }
    if (key.length < 16 || key.length > 512) {
      return { ok: false, variable, reason: `${variable} must be 16-512 characters to be a transcoder admin key` }
    }
    return { ok: true, key, variable }
  }
  return {
    ok: false,
    variable: dedicated,
    reason: `no key for this server's transcoder: set ${dedicated}, or ${shared} to share that server's key`,
  }
}

/**
 * The optional private base for `serverId`'s transcoder admin calls.
 *
 * @returns {{ok: true, base: string|null, variable: string} | {ok: false, variable: string, reason: string}}
 */
export function resolveInternalBase(serverId, env = process.env) {
  const variable = `JIT_TRANSCODER_INTERNAL_URL${serverEnvSuffix(serverId)}`
  const raw = env[variable]
  if (typeof raw !== 'string' || raw.trim() === '') return { ok: true, base: null, variable }
  let url
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, variable, reason: `${variable} is not a URL` }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, variable, reason: `${variable} must be an http(s) URL` }
  }
  if (url.search || url.hash || url.username || url.password) {
    return { ok: false, variable, reason: `${variable} must be a plain base URL (no query, fragment or credentials)` }
  }
  return { ok: true, base: `${url.origin}${url.pathname.replace(/\/+$/, '')}`, variable }
}

/**
 * The transcoder base a `jitUrl` was minted from: everything before `/stream/`, so a
 * transcoder published under a path prefix keeps it. Null for anything else.
 */
export function transcoderBaseFromJitUrl(jitUrl) {
  if (typeof jitUrl !== 'string' || !jitUrl) return null
  let url
  try {
    url = new URL(jitUrl)
  } catch {
    return null
  }
  const at = url.pathname.indexOf('/stream/')
  if (at < 0) return null
  return `${url.origin}${url.pathname.slice(0, at)}`
}
