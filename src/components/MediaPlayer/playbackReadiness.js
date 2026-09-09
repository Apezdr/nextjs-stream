/**
 * Playback readiness — the two questions resume and watch-history actually
 * ask, answered from the media element instead of the store's `canPlay`.
 *
 * `canPlay` is `readyState >= HAVE_ENOUGH_DATA` (4) sampled on exactly four
 * events (canplay / canplaythrough / loadstart / emptied). Against the JIT
 * transcoder, whose segment requests block for the full encode, readyState 4
 * ("can play through without stalling") is a race the client does not
 * control: if the sample never lands, the saved position is never applied
 * and no progress is ever written. Nothing is erased — nothing is used.
 *
 * Neither consumer needs 4:
 *
 *   canSeek  — a seek needs metadata and a finite duration. That is
 *              HAVE_METADATA (1). hls.js handles seeking into an unbuffered
 *              range itself.
 *   canTrack — a heartbeat needs a meaningful currentTime, which exists from
 *              HAVE_METADATA onward; the MIN_PERSISTED_POSITION_S floor in the
 *              tracker already guards against writing a spurious ~0.
 *
 * Both are live readiness, not one-shots: they fall on `emptied` (a source
 * swap) and rise again when metadata returns, which `canPlay` never did.
 *
 * Cast: while a receiver has this title (`castAdopted`), readiness is false
 * outright. The transport bridge used to enforce that by capping the HOST's
 * readyState at 3 so `canPlay` could never flip; reading the raw element
 * bypasses that cap, so the invariant is restated here explicitly. The
 * tracker's own `castAdopted` guards stay in place as well — this is the
 * second line, not the only one.
 */

const HAVE_METADATA = 1

// Exactly three states exist (canSeek implies canTrack), and they are frozen
// singletons on purpose: `useSyncExternalStore` compares snapshots by
// reference, so a fresh object per read would re-render on every tick.
export const NOT_READY = Object.freeze({ canSeek: false, canTrack: false })
export const TRACK_ONLY = Object.freeze({ canSeek: false, canTrack: true })
export const READY = Object.freeze({ canSeek: true, canTrack: true })

/**
 * Every element event after which either answer can change. Deliberately
 * wider than the store's list: `loadedmetadata` and `durationchange` are the
 * rising edges that matter, `emptied`/`loadstart` are the falling edges.
 */
export const READINESS_EVENTS = Object.freeze([
  'loadstart',
  'loadedmetadata',
  'loadeddata',
  'durationchange',
  'canplay',
  'canplaythrough',
  'play',
  'playing',
  'waiting',
  'stalled',
  'seeking',
  'seeked',
  'progress',
  'emptied',
  'error',
])

/**
 * @param {{readyState?: number, duration?: number}|null|undefined} el
 *   The raw media element (or a snapshot of it). Never the framework host.
 * @param {{castAdopted?: boolean}} [opts]
 * @returns {{canSeek: boolean, canTrack: boolean}}
 */
export function readinessFrom(el, { castAdopted = false } = {}) {
  if (castAdopted || !el) return NOT_READY

  const readyState = typeof el.readyState === 'number' ? el.readyState : 0
  const hasMetadata = readyState >= HAVE_METADATA
  if (!hasMetadata) return NOT_READY

  const duration = el.duration
  const durationKnown = Number.isFinite(duration) && duration > 0

  return durationKnown ? READY : TRACK_ONLY
}
