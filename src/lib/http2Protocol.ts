import http2wrapper, {
  type AutoRequestOptions,
  type ResolveProtocolConnectFunction,
  type ResolveProtocolFunction,
} from 'http2-wrapper'
import type { ClientRequest, IncomingMessage } from 'node:http'

/**
 * HTTP/2 for httpGet, with a memory of each host's protocol that can't be
 * wrong.
 *
 * got sends an `http2: true` request through http2-wrapper, which first asks
 * the host which protocol it speaks (a TLS handshake offering h2 and
 * http/1.1) and remembers the answer for the life of the process. The probe
 * runs under the request's own timeout, and a probe that timed out is
 * remembered too, as "not HTTP/2": its handshake hadn't finished, so there was
 * no protocol to read, and the library stores that before it looks at the
 * timeout.
 *
 * From then on every request to that host is written as HTTP/1.1 on a
 * connection that negotiates HTTP/2. nginx answers in HTTP/2 frames ("Parse
 * Error: Expected HTTP/"), Caddy resets the connection, and nothing recovers
 * until the process restarts. Only the first handshake after a start can do
 * it, since nothing is remembered yet: a 1.5 s status check during a busy
 * start-up was enough, and the banner then said the file server couldn't be
 * reached for as long as the container ran.
 *
 * Here a protocol is remembered only when a handshake completed and
 * negotiated one. A slow handshake costs that one attempt; the next asks
 * again.
 */

// As many hosts as the library's own cache holds. The app talks to a handful.
const MAX_REMEMBERED_HOSTS = 100

/** The protocols hosts have negotiated. Anything else offered to it is not kept. */
export class NegotiatedProtocols extends Map<string, string> {
  set(origin: string, protocol: unknown): this {
    if (typeof protocol !== 'string' || protocol === '') return this
    if (!this.has(origin) && this.size >= MAX_REMEMBERED_HOSTS) {
      const oldest = this.keys().next().value
      if (oldest !== undefined) this.delete(oldest)
    }
    return super.set(origin, protocol)
  }
}

/**
 * http2-wrapper's own protocol lookup, over that memory.
 * @param connect - How to open the probe's connection: the library's own (tls.connect) unless a test passes one
 */
export function createProtocolResolver(connect?: ResolveProtocolConnectFunction): ResolveProtocolFunction {
  return http2wrapper.auto.createResolveProtocol(new NegotiatedProtocols(), new Map(), connect)
}

const resolveProtocol = createProtocolResolver()

/**
 * got's `request` for an `http2: true` call: http2-wrapper's own, told where
 * to look up the host's protocol.
 */
export function http2Request(
  url: string | URL,
  options?: AutoRequestOptions,
  callback?: (response: IncomingMessage) => void
): Promise<ClientRequest> {
  return http2wrapper.auto(url, { ...options, resolveProtocol }, callback)
}
