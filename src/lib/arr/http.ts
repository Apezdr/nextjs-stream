// src/lib/arr/http.ts
// Requests to Radarr and Sonarr, under the same rules as lib/mediaQueues/upstream.ts:
// axios (node:http) rather than fetch, because the app's @vercel/otel 'fetch'
// instrumentation records every fetch URL in its trace spans; the key travels
// in the X-Api-Key header, never the query string; and nothing here logs a
// request URL or an axios error, both of which can carry it.
import 'server-only'
import axios from 'axios'
import type { ArrFailureReason, ArrService } from './types'

const SERVICE_ENV: Record<ArrService, { url: string; apiKey: string }> = {
  radarr: { url: 'RADARR_URL', apiKey: 'RADARR_API_KEY' },
  sonarr: { url: 'SONARR_URL', apiKey: 'SONARR_API_KEY' },
}

export interface ArrConfig {
  service: ArrService
  baseUrl: string
  apiKey: string
}

/** Read at call time, not import time, so configuration is what the process has now. */
export function readArrConfig(service: ArrService): { config: ArrConfig } | { missing: string[] } {
  const env = SERVICE_ENV[service]
  const baseUrl = process.env[env.url]?.trim().replace(/\/+$/, '') || null
  const apiKey = process.env[env.apiKey]?.trim() || null
  if (!baseUrl || !apiKey) {
    const missing: string[] = []
    if (!baseUrl) missing.push(env.url)
    if (!apiKey) missing.push(env.apiKey)
    return { missing }
  }
  return { config: { service, baseUrl, apiKey } }
}

export class ArrError extends Error {
  constructor(
    readonly reason: ArrFailureReason,
    readonly httpStatus: number | null = null,
    /** The service's own validation messages, for `rejected`. */
    readonly messages: string[] = []
  ) {
    super(httpStatus ? `${reason} (HTTP ${httpStatus})` : reason)
    this.name = 'ArrError'
  }
}

/** Lookups and lists. Sonarr's lookup asks its metadata server, which can take seconds. */
export const READ_TIMEOUT_MS = 15_000
/** An add saves the title and queues its refresh; a command is only queued. */
export const WRITE_TIMEOUT_MS = 20_000

/** Ceiling on one body: Radarr's whole movie list is ~5 MB at ~900 titles. */
const MAX_BODY_BYTES = 32 * 1024 * 1024

/**
 * Radarr and Sonarr refuse a write with HTTP 400 and a list of validation
 * failures ({ propertyName, errorMessage, ... }), and fail other ways with
 * { message }. Only the messages are kept.
 */
function serviceMessages(body: unknown): string[] {
  let parsed = body
  if (typeof body === 'string') {
    try {
      parsed = JSON.parse(body)
    } catch {
      return []
    }
  }
  const entries = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' ? [parsed] : []
  return entries
    .map((entry) => {
      const { errorMessage, message } = (entry ?? {}) as { errorMessage?: unknown; message?: unknown }
      const text = typeof errorMessage === 'string' ? errorMessage : typeof message === 'string' ? message : ''
      return text.trim().slice(0, 300)
    })
    .filter(Boolean)
    .slice(0, 5)
}

function toArrError(error: unknown): ArrError {
  if (error instanceof ArrError) return error
  // The deadline signal is the only thing that aborts these requests.
  if (axios.isCancel(error)) return new ArrError('timeout')
  // axios rejects with Node's own TypeError, unwrapped, for a malformed URL.
  if ((error as { code?: unknown } | null)?.code === 'ERR_INVALID_URL') return new ArrError('bad_url')
  if (!axios.isAxiosError(error)) return new ArrError('invalid_response')

  const status = error.response?.status
  if (status === 401 || status === 403) return new ArrError('unauthorized', status)
  if (status === 404) return new ArrError('not_found', status)
  if (status === 400 || status === 409 || status === 422) {
    return new ArrError('rejected', status, serviceMessages(error.response?.data))
  }
  if (status) return new ArrError('http_error', status)
  switch (error.code) {
    case 'ECONNABORTED':
    case 'ETIMEDOUT':
      return new ArrError('timeout')
    case 'ECONNREFUSED':
      return new ArrError('refused')
    case 'ERR_BAD_REQUEST': // no response: the configured URL's protocol is unsupported
      return new ArrError('bad_url')
    case 'ERR_BAD_RESPONSE': // e.g. a body over maxContentLength
      return new ArrError('invalid_response')
    default:
      return new ArrError('network')
  }
}

export interface ArrRequestOptions {
  params?: Record<string, string | number | boolean>
  data?: unknown
  timeoutMs?: number
}

/**
 * One request, parsed as JSON. Every failure is an ArrError; an empty body
 * (a 202 with nothing in it) resolves to null.
 */
export async function arrRequest<T = unknown>(
  config: ArrConfig,
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  { params, data, timeoutMs }: ArrRequestOptions = {}
): Promise<T> {
  let body: unknown
  try {
    const response = await axios.request<string>({
      method,
      url: `${config.baseUrl}${path}`,
      // Header rather than ?apikey=, which keeps the key out of proxy access logs.
      headers: { 'X-Api-Key': config.apiKey, Accept: 'application/json' },
      params,
      data,
      // Parsed below, so a non-JSON answer (an HTML login page from a reverse
      // proxy) is an invalid response rather than a string passing for data.
      responseType: 'text',
      signal: AbortSignal.timeout(timeoutMs ?? (method === 'GET' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS)),
      maxContentLength: MAX_BODY_BYTES,
    })
    body = response.data
  } catch (error) {
    throw toArrError(error)
  }
  if (body === undefined || body === null || body === '') return null as T
  if (typeof body !== 'string') throw new ArrError('invalid_response')
  try {
    return JSON.parse(body) as T
  } catch {
    throw new ArrError('invalid_response')
  }
}
