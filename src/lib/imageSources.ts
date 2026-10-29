import { getAllServers } from '@src/utils/config'

/**
 * Which images the optimizer (/_next/image) will fetch.
 *
 * src/proxy.ts checks every /_next/image source here before it hands the
 * request to imgproxy or to Next's built-in optimizer, so one rule holds for
 * every deployment: with or without imgproxy, with or without a reverse proxy
 * in front. It can't live in next.config.js's images.remotePatterns: a
 * standalone build freezes that config at build time, while file servers are
 * configured per deployment at runtime (FILE_SERVER_URL, FILE_SERVER_URL_N).
 *
 * Allowed sources:
 * - app-relative paths (/public files and static imports)
 * - each configured file server's origin, in the scheme it was configured with
 * - each configured processor's /frame/ endpoint (chapter-menu thumbnails)
 * - the fixed hosts the app and its clients draw from (FIXED_RULES)
 * - the origins an operator lists in REMOTE_PATTERNS
 *
 * Anything else answers 400, as Next does for a source outside remotePatterns.
 * The built-in optimizer still applies its own checks after this one
 * (https-only remotePatterns, no private IPs); imgproxy applies none, which is
 * why the host check can't be left to Next.
 */

interface SourceRule {
  /** In URL.protocol form: 'https:' */
  protocol: string
  hostname: string | RegExp
  /** '' for the scheme's default port, as URL.port reports it */
  port: string
  pathPrefix: string
}

const FIXED_RULES: SourceRule[] = [
  // TMDB artwork: library fallbacks, cast photos, collection and watchlist art
  { protocol: 'https:', hostname: 'image.tmdb.org', port: '', pathPrefix: '/t/p/' },
  // Google sign-in avatars (user.image is the ID token's picture claim). Only
  // the avatar paths: the same hosts serve anyone's public Drive and Photos files.
  { protocol: 'https:', hostname: /^lh\d*\.googleusercontent\.com$/, port: '', pathPrefix: '/a/' },
  { protocol: 'https:', hostname: /^lh\d*\.googleusercontent\.com$/, port: '', pathPrefix: '/a-/' },
  // Discord sign-in avatars, custom and default
  { protocol: 'https:', hostname: 'cdn.discordapp.com', port: '', pathPrefix: '/avatars/' },
  { protocol: 'https:', hostname: 'cdn.discordapp.com', port: '', pathPrefix: '/embed/avatars/' },
  // Trailer thumbnails the TV app sends through the optimizer
  { protocol: 'https:', hostname: 'img.youtube.com', port: '', pathPrefix: '/vi/' },
  // Sonarr's remote art on the admin Title matching page
  { protocol: 'https:', hostname: 'artworks.thetvdb.com', port: '', pathPrefix: '/banners/' },
]

// An entry's optional scheme and *. (or Next-style **.) wildcard; the rest is
// parsed as a URL, so it takes whatever a FILE_SERVER_URL could hold.
const REMOTE_PATTERN_RE = /^(?:([a-z][a-z0-9+.-]*):\/\/)?(\*{1,2}\.)?(.+)$/i

const warned = new Set<string>()

function warnOnce(message: string) {
  if (warned.has(message)) return
  warned.add(message)
  console.warn(`[image-sources] ${message}`)
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function configuredRule(
  name: string,
  value: string | undefined,
  pathFor: (basePath: string) => string,
): SourceRule | null {
  if (!value) return null
  let url: URL
  try {
    url = new URL(value)
  } catch {
    warnOnce(`${name} "${value}" is not a URL; its images can't go through the optimizer`)
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return {
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    pathPrefix: pathFor(url.pathname.replace(/\/+$/, '')),
  }
}

function serverRules(): SourceRule[] {
  const rules: SourceRule[] = []
  for (const server of getAllServers()) {
    // Synced artwork is the file server's baseURL plus a path (fileServerUrl)
    const files = configuredRule(`File server baseURL for ${server.id}`, server.baseURL, () => '/')
    // Chapter-menu frames are `${syncEndpoint}/frame/...` (MediaPlayer.js)
    const frames = configuredRule(`Sync endpoint for ${server.id}`, server.syncEndpoint, (path) => `${path}/frame/`)
    if (files) rules.push(files)
    if (frames) rules.push(frames)
  }
  return rules
}

function remotePatternRules(raw: string): SourceRule[] {
  const rules: SourceRule[] = []
  for (const entry of raw.split(',').map((part) => part.trim()).filter(Boolean)) {
    const rule = remotePatternRule(entry)
    if (!rule) {
      warnOnce(`REMOTE_PATTERNS entry "${entry}" is not an origin such as https://images.example.com; it is ignored`)
      continue
    }
    // Next's built-in optimizer (no IMGPROXY_URL) still applies its own
    // remotePatterns afterwards: https on the default port only.
    if (!process.env.IMGPROXY_URL && (rule.protocol === 'http:' || rule.port)) {
      warnOnce(
        `REMOTE_PATTERNS entry "${entry}" is http or uses a non-default port; Next's built-in optimizer refuses those, so it only takes effect with imgproxy (IMGPROXY_URL)`,
      )
    }
    rules.push(rule)
  }
  return rules
}

function remotePatternRule(entry: string): SourceRule | null {
  const match = REMOTE_PATTERN_RE.exec(entry)
  if (!match) return null
  const [, scheme = 'https', wildcard, rest] = match
  if (!/^https?$/i.test(scheme)) return null

  let url: URL
  try {
    // A wildcard entry is parsed with a stand-in first label, then matched on
    // the suffix after it.
    url = new URL(`${scheme}://${wildcard ? 'x.' : ''}${rest}`)
  } catch {
    return null
  }
  if (url.username || url.password || url.search || url.hash) return null

  const pathname = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`
  return {
    protocol: url.protocol,
    hostname: wildcard ? new RegExp(`^(?:[^.]+\\.)+${escapeRegExp(url.hostname.slice(2))}$`) : url.hostname,
    port: url.port,
    pathPrefix: pathname,
  }
}

function matchesRule(rule: SourceRule, url: URL): boolean {
  if (url.protocol !== rule.protocol || url.port !== rule.port) return false
  const hostMatches =
    typeof rule.hostname === 'string' ? url.hostname === rule.hostname : rule.hostname.test(url.hostname)
  return hostMatches && url.pathname.startsWith(rule.pathPrefix)
}

/**
 * Whether the optimizer may fetch `src` (the url= parameter of a /_next/image
 * request). The server list is the one src/utils/config.js read from the
 * environment when the process started; REMOTE_PATTERNS is read on each call.
 */
export function isAllowedImageSource(src: string): boolean {
  // App-relative: a /public file or a static import, served by the app itself.
  // '//host' is protocol-relative and '/\host' parses as it, so neither counts.
  if (src.startsWith('/') && !src.startsWith('//') && !src.startsWith('/\\')) return true

  let url: URL
  try {
    url = new URL(src)
  } catch {
    return false
  }
  // Pathnames are compared after URL parsing, which resolves dot segments
  // (encoded ones included), so '/t/p/../x' can't step outside a prefix.
  if (url.username || url.password) return false

  const rules = [...FIXED_RULES, ...serverRules(), ...remotePatternRules(process.env.REMOTE_PATTERNS ?? '')]
  return rules.some((rule) => matchesRule(rule, url))
}

const MAX_REPORTED_HOSTS = 100
const reportedHosts = new Set<string>()

/**
 * Log a refused source once per host, so an operator can tell which origin to
 * add to REMOTE_PATTERNS. Only the host is logged: a full URL can carry tokens.
 */
export function reportRefusedImageSource(src: string): void {
  let host = '(not a URL)'
  try {
    host = new URL(src).host || host
  } catch {
    // keep the placeholder
  }
  if (reportedHosts.has(host) || reportedHosts.size >= MAX_REPORTED_HOSTS) return
  reportedHosts.add(host)
  console.warn(
    `[image-sources] refused a /_next/image source on ${host}; add its origin to REMOTE_PATTERNS if it should be allowed`,
  )
}
