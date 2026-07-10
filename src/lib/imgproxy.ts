import { createHmac } from 'node:crypto'

/**
 * Optional imgproxy offload for next/image optimization.
 *
 * When IMGPROXY_URL is set, /_next/image requests for remote sources are
 * served by imgproxy instead of the built-in sharp optimizer, moving the
 * CPU-heavy resize/encode work off the Next.js container. Everything is read
 * from process.env at request time so a single prebuilt standalone image can
 * be configured per deployment (same runtime-env convention as
 * FILE_SERVER_URL and friends). Leave IMGPROXY_URL unset to keep the
 * built-in optimizer.
 */

export type ImgproxyMode = 'proxy' | 'redirect'

interface ImgproxyConfig {
  baseUrl: string
  mode: ImgproxyMode
  key?: string
  salt?: string
}

interface ImgproxyTarget {
  url: string
  mode: ImgproxyMode
}

const HEX_RE = /^(?:[0-9a-f]{2})+$/i

let warnedInvalidConfig = false

function warnOnce(message: string) {
  if (!warnedInvalidConfig) {
    console.error(`[imgproxy] ${message} — falling back to the built-in image optimizer`)
    warnedInvalidConfig = true
  }
}

export function getImgproxyConfig(): ImgproxyConfig | null {
  const baseUrl = process.env.IMGPROXY_URL?.trim().replace(/\/+$/, '')
  if (!baseUrl) return null

  const key = process.env.IMGPROXY_KEY?.trim()
  const salt = process.env.IMGPROXY_SALT?.trim()

  // A half-configured or malformed signing pair would make imgproxy reject
  // every generated URL with a 403, breaking all images. Fail safe to the
  // built-in optimizer and tell the operator why.
  if (Boolean(key) !== Boolean(salt)) {
    warnOnce('IMGPROXY_KEY and IMGPROXY_SALT must be set together')
    return null
  }
  if (key && salt && (!HEX_RE.test(key) || !HEX_RE.test(salt))) {
    warnOnce('IMGPROXY_KEY and IMGPROXY_SALT must be hex-encoded strings')
    return null
  }

  const mode: ImgproxyMode =
    process.env.IMGPROXY_REQUEST_MODE?.trim().toLowerCase() === 'redirect' ? 'redirect' : 'proxy'

  return { baseUrl, mode, key, salt }
}

// imgproxy signature: base64url(HMAC-SHA256(key, salt || path)), key/salt hex-decoded.
// https://docs.imgproxy.net/usage/signing_url
export function signImgproxyPath(path: string, keyHex: string, saltHex: string): string {
  return createHmac('sha256', Buffer.from(keyHex, 'hex'))
    .update(Buffer.from(saltHex, 'hex'))
    .update(path)
    .digest('base64url')
}

/**
 * Build the imgproxy target for a /_next/image request, or null when the
 * request should fall through to the built-in optimizer (imgproxy not
 * configured, relative/local source, or malformed params).
 */
export function buildImgproxyTarget(searchParams: URLSearchParams): ImgproxyTarget | null {
  const config = getImgproxyConfig()
  if (!config) return null

  const src = searchParams.get('url')
  const width = Number(searchParams.get('w'))
  const quality = Number(searchParams.get('q'))

  // Only absolute remote sources are offloaded — imgproxy cannot resolve
  // app-relative /public paths, and those are a negligible share of image
  // traffic compared to posters/backdrops from the file servers and TMDB.
  if (!src || !/^https?:\/\//i.test(src)) return null
  if (!Number.isInteger(width) || width <= 0) return null
  if (!Number.isInteger(quality) || quality <= 0 || quality > 100) return null

  // rs:fit keeps aspect ratio and never upscales — the same contract as the
  // built-in optimizer. The source URL is base64url-encoded to survive query
  // strings and special characters. Output format is left to imgproxy's
  // Accept-header detection (enable IMGPROXY_ENABLE_WEBP_DETECTION /
  // IMGPROXY_ENABLE_AVIF_DETECTION on the imgproxy container).
  const path = `/rs:fit:${width}:0/q:${quality}/${Buffer.from(src).toString('base64url')}`
  const signature =
    config.key && config.salt ? signImgproxyPath(path, config.key, config.salt) : 'insecure'

  return { url: `${config.baseUrl}/${signature}${path}`, mode: config.mode }
}
