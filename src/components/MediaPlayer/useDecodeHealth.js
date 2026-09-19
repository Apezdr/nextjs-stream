'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Player } from './videojs'
import { isManifestSource } from './PlayerMedia'
import {
  decodeHealthVerdict,
  hadHevcBefore,
  isChromium,
  probeGpuLiveness,
  probeHevc,
  readDismissedTier,
  readHevcBaseline,
  recordHevcBaseline,
  serverDismissedTier,
  subscribeDismissed,
  summarizeAdvertised,
  writeDismissedTier,
} from './decodeHealth'

/**
 * Whether this browser is quietly playing a lesser version of the title.
 *
 * Two halves of one ladder. The master's full variant list arrives on hls.js's
 * `MANIFEST_LOADED`, before any codec filtering; the survivors are the store's
 * `videoRenditionList`. The gap between their tallest rungs is the entire
 * trigger — see decodeHealth.js for why a capability probe cannot be one.
 *
 * The verdict is DERIVED at render, never latched in an effect. hls.js removes
 * levels a second time during ABR (asynchronously, seconds after the quality
 * menu is populated), and a cast session ending changes nothing about the
 * ladder but everything about whether the ladder is what the viewer is
 * watching. A one-shot "run once at playback start" reading would miss both.
 *
 * @param {string} videoURL
 * @param {boolean} isCasting  the television is decoding, not this browser
 * @returns {{verdict: object|null, dismissedTier: string|null, dismiss: () => void}}
 */
export default function useDecodeHealth(videoURL, isCasting) {
  const media = Player.useMedia()

  // Everything the master offered, captured once per source load.
  const [advertised, setAdvertised] = useState(null)

  // Capability signals, gathered off the playback-start path. Null until the
  // deferred pass has run, which is also what keeps the server render and the
  // first client render identical — both produce no verdict.
  const [signals, setSignals] = useState(null)

  // Read through the module's store rather than an effect: the server snapshot
  // is null so the first client render matches, and a dismissal survives the
  // unmount/remount that navigating away and back puts the player through.
  const dismissedTier = useSyncExternalStore(
    subscribeDismissed,
    readDismissedTier,
    serverDismissedTier
  )

  // The surviving ladder, reduced to primitives. `usePlayer` caches the
  // selected value behind `shallowEqual`, and the quality feature rebuilds
  // every rendition object on each sync — so selecting the array itself would
  // fail that compare and re-render on every ABR switch. A flat object of
  // primitives passes it, and only changes when the ceiling actually moves.
  const kept = Player.usePlayer((state) => {
    let keptMax = 0
    let keptTopCodec = ''
    for (const rendition of state.videoRenditionList ?? []) {
      const height = rendition.height ?? 0
      if (height > keptMax) {
        keptMax = height
        keptTopCodec = rendition.codec ?? ''
      }
    }
    return { keptMax, keptTopCodec }
  })

  // Bind to the hls.js engine off the host's synthetic `loadstart`, which
  // HlsJsMedia dispatches after constructing its delegate and before handing it
  // the source — so registration is guaranteed to precede the manifest request
  // with no timing assumption. `media.engine` is the framework's documented
  // escape hatch and is null on every native-HLS and progressive path, which is
  // the structural version of the "skip on native HLS" rule (branching on the
  // browser would be wrong here: PlayerMedia routes on the .m3u8 extension, so
  // Safari gets hls.js exactly like everything else).
  useEffect(() => {
    if (!media || !isManifestSource(videoURL)) return undefined

    let cancelled = false
    let engine = null

    const onManifestLoaded = (_event, data) => {
      const snapshot = summarizeAdvertised(data?.levels, videoURL)
      if (!cancelled && snapshot) setAdvertised(snapshot)
    }

    const bind = () => {
      const next = media.engine ?? null
      if (next === engine) return
      engine?.off('hlsManifestLoaded', onManifestLoaded)
      engine = next
      engine?.on('hlsManifestLoaded', onManifestLoaded)
    }

    bind()
    media.addEventListener('loadstart', bind)

    return () => {
      cancelled = true
      media.removeEventListener('loadstart', bind)
      engine?.off('hlsManifestLoaded', onManifestLoaded)
    }
  }, [media, videoURL])

  // The wording signals, deferred to idle. Creating a WebGL context can block
  // the main thread while ANGLE initialises, and the worst possible moment for
  // that is the first frame — none of this is needed until there is something
  // to say, and nothing here changes during a session.
  useEffect(() => {
    let cancelled = false

    const run = () => {
      if (cancelled) return
      const hevcNow = probeHevc()
      // Read the baseline BEFORE recording, or this playback overwrites the
      // history it is about to be judged against.
      const baseline = readHevcBaseline()
      recordHevcBaseline(hevcNow)
      const chromium = isChromium()
      setSignals({
        hevcNow,
        hadHevc: hadHevcBefore(baseline),
        chromium,
        // Only consulted for the Chromium tier, so only paid for there.
        webgl: hevcNow === false && chromium ? probeGpuLiveness() : null,
      })
    }

    const idle = globalThis.requestIdleCallback
    if (typeof idle === 'function') {
      const handle = idle(run, { timeout: 3000 })
      return () => {
        cancelled = true
        globalThis.cancelIdleCallback?.(handle)
      }
    }
    const timer = setTimeout(run, 1200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [])

  const verdict = useMemo(() => {
    // The television is doing the decoding. The local engine keeps filtering
    // levels throughout a session, so `kept` is genuinely degraded and
    // genuinely irrelevant — and the badges paint above the casting banner.
    if (isCasting) return null
    if (!signals) return null
    if (!advertised || advertised.src !== videoURL) return null
    return decodeHealthVerdict({
      offeredMax: advertised.offeredMax,
      rungs: advertised.rungs,
      keptMax: kept.keptMax,
      keptTopCodec: kept.keptTopCodec,
      ...signals,
    })
  }, [isCasting, signals, advertised, videoURL, kept.keptMax, kept.keptTopCodec])

  const tier = verdict?.tier ?? null
  const dismiss = useCallback(() => {
    if (tier) writeDismissedTier(tier)
  }, [tier])

  return { verdict, dismissedTier, dismiss }
}
