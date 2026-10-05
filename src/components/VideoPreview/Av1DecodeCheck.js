'use client'

import { useEffect } from 'react'
import { startAv1DecodeCheck } from './av1Clip'

/**
 * Starts the AV1 capability check when the page loads. Renders nothing.
 *
 * The check is asynchronous and a preview has to mount with its final source
 * list, so the answer must already be there when the first preview mounts.
 * The preview player is loaded lazily, on the first hover: a check started
 * from there would always be too late for that first preview, which would
 * play H.264 on every page load.
 */
export default function Av1DecodeCheck() {
  useEffect(() => {
    startAv1DecodeCheck()
  }, [])
  return null
}
