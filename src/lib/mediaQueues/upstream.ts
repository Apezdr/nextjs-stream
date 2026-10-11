// src/lib/mediaQueues/upstream.ts
// Fetches each queue from its service and hands the payload to normalize.ts.
// Every outcome is a MediaQueueResult: this module never throws, so one
// service being down cannot fail the others.
import 'server-only'
import axios from 'axios'
import { createLogger } from '@src/lib/logger'
import {
  ITEM_LIMIT,
  InvalidResponseError,
  normalizeArrQueue,
  normalizeSabnzbdQueue,
  normalizeTdarr,
} from './normalize'
import type { MediaQueueOk, MediaQueueResult, MediaQueueService, UnreachableReason } from './types'

// Requests go through axios (node:http), not fetch, on purpose: the app's
// @vercel/otel 'fetch' instrumentation records every fetch URL in its trace
// spans, and SABnzbd only accepts its API key in the query string. Nothing
// here may log a request URL or an axios error either — both carry the key.

const log = createLogger('MediaQueues')

/**
 * Hard deadline per upstream request, connect included. axios's own `timeout`
 * is a socket-idle timer and never fires on a server that trickles bytes; the
 * abort signal bounds the whole request. The dashboard polls, so a slow
 * service shows as timed out and the next poll tries again.
 */
export const UPSTREAM_TIMEOUT_MS = 4_000

/** Arr records fetched per poll: enough to rank problems and active downloads first. */
const ARR_PAGE_SIZE = 20

/** Ceiling on one upstream body. A 20-record Arr page is tens of KB, get-nodes ~8 KB. */
const MAX_BODY_BYTES = 2 * 1024 * 1024

interface ServiceEnv {
  url: string
  apiKey: string
  /** Tdarr checks keys only when its own auth is on (off by default). */
  keyRequired: boolean
}

const SERVICE_ENV: Record<MediaQueueService, ServiceEnv> = {
  sabnzbd: { url: 'SABNZBD_URL', apiKey: 'SABNZBD_API_KEY', keyRequired: true },
  radarr: { url: 'RADARR_URL', apiKey: 'RADARR_API_KEY', keyRequired: true },
  sonarr: { url: 'SONARR_URL', apiKey: 'SONARR_API_KEY', keyRequired: true },
  tdarr: { url: 'TDARR_URL', apiKey: 'TDARR_API_KEY', keyRequired: false },
}

interface ServiceConfig {
  baseUrl: string
  apiKey: string | null
}

/** Read at call time, not import time, so configuration is what the process has now. */
function readConfig(service: MediaQueueService): { config: ServiceConfig } | { missing: string[] } {
  const env = SERVICE_ENV[service]
  const baseUrl = process.env[env.url]?.trim().replace(/\/+$/, '') || null
  const apiKey = process.env[env.apiKey]?.trim() || null
  const missing: string[] = []
  if (!baseUrl) missing.push(env.url)
  if (env.keyRequired && !apiKey) missing.push(env.apiKey)
  if (missing.length > 0 || !baseUrl) return { missing }
  return { config: { baseUrl, apiKey } }
}

class UpstreamError extends Error {
  constructor(
    readonly reason: UnreachableReason,
    readonly httpStatus: number | null = null
  ) {
    super(httpStatus ? `${reason} (HTTP ${httpStatus})` : reason)
    this.name = 'UpstreamError'
  }
}

function toUpstreamError(error: unknown): UpstreamError {
  if (error instanceof UpstreamError) return error
  if (error instanceof InvalidResponseError) return new UpstreamError('invalid_response')
  // The deadline signal is the only thing that aborts these requests.
  if (axios.isCancel(error)) return new UpstreamError('timeout')
  // axios parses the URL inside its adapter and rejects with Node's own
  // TypeError, unwrapped, when the configured URL is malformed.
  if ((error as { code?: unknown } | null)?.code === 'ERR_INVALID_URL') return new UpstreamError('bad_url')
  // Anything else that is not an axios error is a bug in this module.
  if (!axios.isAxiosError(error)) return new UpstreamError('invalid_response')

  const status = error.response?.status
  if (status === 401 || status === 403) return new UpstreamError('unauthorized', status)
  if (status) return new UpstreamError('http_error', status)
  switch (error.code) {
    case 'ECONNABORTED':
    case 'ETIMEDOUT':
      return new UpstreamError('timeout')
    case 'ECONNREFUSED':
      return new UpstreamError('refused')
    case 'ERR_BAD_REQUEST': // no response: the configured URL's protocol is unsupported
      return new UpstreamError('bad_url')
    case 'ERR_BAD_RESPONSE': // e.g. body over maxContentLength
      return new UpstreamError('invalid_response')
    default:
      return new UpstreamError('network')
  }
}

interface RequestOptions {
  headers?: Record<string, string>
  params?: Record<string, string | number | boolean>
  data?: unknown
}

async function requestJson(method: 'GET' | 'POST', url: string, options: RequestOptions = {}): Promise<unknown> {
  let body: unknown
  try {
    const response = await axios.request<string>({
      method,
      url,
      headers: options.headers,
      params: options.params,
      data: options.data,
      // Parsed below, so a non-JSON answer (an HTML login page, SABnzbd's
      // plain-text errors) is an invalid response rather than a string that
      // silently passes for data.
      responseType: 'text',
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      maxContentLength: MAX_BODY_BYTES,
    })
    body = response.data
  } catch (error) {
    throw toUpstreamError(error)
  }
  if (typeof body !== 'string') throw new UpstreamError('invalid_response')
  try {
    return JSON.parse(body)
  } catch {
    throw new UpstreamError('invalid_response')
  }
}

// Last logged outcome per key. The dashboard polls every few seconds, so a
// service that stays down would otherwise log on every poll; this logs the
// change into and out of each failure instead.
const lastOutcome = new Map<string, string>()

function noteOutcome(key: string, failure: UpstreamError | null) {
  const outcome = failure ? failure.message : 'ok'
  const previous = lastOutcome.get(key)
  if (previous === outcome) return
  lastOutcome.set(key, outcome)
  if (failure) {
    log.warn({ queue: key, reason: failure.reason, httpStatus: failure.httpStatus }, 'Media queue request failed')
  } else if (previous) {
    log.info({ queue: key }, 'Media queue request recovered')
  }
}

/** A secondary request (queue health, library counts) whose loss only drops detail. */
function settledValue(key: string, settled: PromiseSettledResult<unknown>): unknown | null {
  if (settled.status === 'fulfilled') {
    noteOutcome(key, null)
    return settled.value
  }
  noteOutcome(key, toUpstreamError(settled.reason))
  return null
}

async function loadArr(service: 'radarr' | 'sonarr', { baseUrl, apiKey }: ServiceConfig): Promise<MediaQueueOk> {
  // Header rather than ?apikey=, which keeps the key out of proxy access logs.
  const headers = { 'X-Api-Key': apiKey as string }
  const includeUnknown = service === 'radarr' ? 'includeUnknownMovieItems' : 'includeUnknownSeriesItems'
  const [page, status] = await Promise.allSettled([
    requestJson('GET', `${baseUrl}/api/v3/queue`, {
      headers,
      // Unknown items are downloads the client has that Radarr/Sonarr could
      // not match; /queue/status counts them, so the list includes them too.
      params: { page: 1, pageSize: ARR_PAGE_SIZE, [includeUnknown]: true },
    }),
    requestJson('GET', `${baseUrl}/api/v3/queue/status`, { headers }),
  ])
  if (page.status === 'rejected') throw page.reason
  return normalizeArrQueue(service, page.value, settledValue(`${service}:status`, status))
}

async function loadSabnzbd({ baseUrl, apiKey }: ServiceConfig): Promise<MediaQueueOk> {
  // SABnzbd reads its key only from the query string: 5.x answers a
  // header-only request with 403 "API Key Required".
  const body = await requestJson('GET', `${baseUrl}/api`, {
    params: { mode: 'queue', output: 'json', start: 0, limit: ITEM_LIMIT, apikey: apiKey as string },
  })
  // 5.x answers a wrong key with HTTP 403; older versions with HTTP 200 and
  // { status: false, error: "API Key Incorrect" }.
  if (typeof body === 'object' && body !== null && (body as { status?: unknown }).status === false) {
    const message = String((body as { error?: unknown }).error ?? '')
    throw new UpstreamError(/api key/i.test(message) ? 'unauthorized' : 'invalid_response')
  }
  return normalizeSabnzbdQueue(body)
}

async function loadTdarr({ baseUrl, apiKey }: ServiceConfig): Promise<MediaQueueOk> {
  const headers: Record<string, string> = apiKey ? { 'x-api-key': apiKey } : {}
  const [nodes, statistics] = await Promise.allSettled([
    requestJson('GET', `${baseUrl}/api/v2/get-nodes`, { headers }),
    // A read despite the POST: Tdarr's database API takes the query in the body.
    requestJson('POST', `${baseUrl}/api/v2/cruddb`, {
      headers,
      data: { data: { collection: 'StatisticsJSONDB', mode: 'getById', docID: 'statistics' } },
    }),
  ])
  if (nodes.status === 'rejected') throw nodes.reason
  return normalizeTdarr(nodes.value, settledValue('tdarr:statistics', statistics))
}

const LOADERS: Record<MediaQueueService, (config: ServiceConfig) => Promise<MediaQueueOk>> = {
  sabnzbd: loadSabnzbd,
  radarr: (config) => loadArr('radarr', config),
  sonarr: (config) => loadArr('sonarr', config),
  tdarr: loadTdarr,
}

/** One service's queue, normalized. Resolves for every outcome; never rejects. */
export async function loadMediaQueue(service: MediaQueueService): Promise<MediaQueueResult> {
  const resolved = readConfig(service)
  if ('missing' in resolved) return { service, state: 'not_configured', missing: resolved.missing }

  try {
    const result = await LOADERS[service](resolved.config)
    noteOutcome(service, null)
    return result
  } catch (error) {
    if (!(error instanceof UpstreamError) && !(error instanceof InvalidResponseError)) {
      // A bug in this module, not the service. Neither type above can carry a
      // URL, and axios errors never reach here (requestJson converts them).
      log.error({ err: error, queue: service }, 'Media queue processing failed')
    }
    const failure = toUpstreamError(error)
    noteOutcome(service, failure)
    return { service, state: 'unreachable', reason: failure.reason, httpStatus: failure.httpStatus }
  }
}
