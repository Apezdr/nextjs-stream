export const PLAYBACK_END_STATES = Object.freeze([
  'playing',
  'paused',
  'buffering',
  'ended',
  'error',
])

export const PLAYBACK_END_STATE_LABELS = Object.freeze({
  playing: 'Playing',
  paused: 'Paused',
  buffering: 'Buffering',
  ended: 'Finished',
  error: 'Playback error',
})

export function normalizePlaybackEndState(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  return PLAYBACK_END_STATES.includes(trimmed) ? trimmed : null
}

export function derivePlaybackEndState({
  element = null,
  hadFatalError = false,
  paused = false,
  buffering = false,
} = {}) {
  if (hadFatalError === true || element?.error != null) return 'error'
  if (element?.ended === true) return 'ended'

  const elementUsable = element != null && element.isConnected !== false
  const isPaused = elementUsable ? element.paused === true : paused === true
  if (isPaused) return 'paused'

  return buffering === true ? 'buffering' : 'playing'
}