// src/lib/arr/errors.ts
// A request the arr code refuses before (or instead of) asking the service,
// with the HTTP status and code the routes answer with.
import type { ArrFailureReason, ArrService } from './types'

export const SERVICE_NAMES: Record<ArrService, string> = { radarr: 'Radarr', sonarr: 'Sonarr' }

export class ArrRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message)
    this.name = 'ArrRequestError'
  }
}

export const forbidden = (message: string) => new ArrRequestError(403, 'forbidden', message)

/** Why a service failed, as a phrase: "Radarr didn’t answer: it timed out." */
export const REASON_TEXT: Record<ArrFailureReason, string> = {
  timeout: 'it timed out',
  unauthorized: 'its API key was refused',
  refused: 'the connection was refused',
  network: 'a network error',
  bad_url: 'check its URL',
  http_error: 'it returned an error',
  invalid_response: 'an unexpected answer',
  not_found: 'not found',
  rejected: 'it refused the request',
}
