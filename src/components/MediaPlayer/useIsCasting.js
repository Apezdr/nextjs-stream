'use client'

import { Player } from './videojs'
import { useCastAdoption } from '@components/Cast/useCastSession'

/**
 * Whether this player's title is on a Cast device right now.
 *
 * There are two ways to be casting and both count. The player store knows about
 * a session THIS player started, through the framework's provider. It knows
 * nothing about one that was already running when the page mounted — adoption
 * there is event-driven and never re-checked — so that case is read from the
 * Cast SDK directly, which is the only thing that survives navigation.
 *
 * Shared rather than recomputed per consumer: the casting overlay and the video
 * element fade in opposite directions at the same moment, and two slightly
 * different answers would show up as the two halves of that transition
 * disagreeing.
 *
 * @param {string} videoURL
 * @returns {{ isCasting: boolean, connecting: boolean, deviceName: string|null }}
 */
export default function useIsCasting(videoURL) {
  const remoteState = Player.usePlayer((s) => s.remotePlaybackState)
  const { adopted, connecting, ending, deviceName } = useCastAdoption(videoURL)

  // A session being torn down is not a session. The store cannot tell the
  // difference on its own: the provider sets remotePlaybackState to
  // 'connecting' whenever the SDK's cast state is CONNECTING, and the SDK uses
  // that same value for SESSION_ENDING. Left alone, stopping a cast flashed
  // "Connecting…" over the title on the way out. The SDK's session state is
  // the only thing that separates the two, so it wins here.
  if (ending) {
    return { isCasting: false, connecting: false, deviceName }
  }

  return {
    isCasting: remoteState === 'connected' || remoteState === 'connecting' || adopted,
    // 'connecting' from the store means this player is starting a session;
    // from the SDK it can also mean a session is being resumed elsewhere, which
    // only counts once it is not already adopted.
    connecting: remoteState === 'connecting' || (connecting && !adopted),
    deviceName,
  }
}
