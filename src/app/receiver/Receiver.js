'use client'

import { buildURL } from '@src/utils'
import Script from 'next/script'
import { useEffect, useState } from 'react'

/* global dashjs, cast */

export default function ReceiverComponent() {
  const [config, setConfig] = useState(null)

  useEffect(() => {
    async function fetchConfig() {
      try {
        const response = await fetch('/api/getserverconfig', {
          headers: {
            'Content-Type': 'application/json',
          }
        })

        if (!response.ok) {
          throw new Error('Failed to fetch server configuration')
        }

        const configData = await response.json()
        setConfig(configData)
      } catch (error) {
        console.error(error)
      }
    }

    fetchConfig()
  }, [])

  if (!config) {
    return <></>
  }

  const { server: frontEndServer, defaultFileServer } = config
  const posterCollageURL = `${defaultFileServer}poster_collage.jpg`

  return (
    <>
      <style>
        {`
            cast-media-player {
            --splash-image: linear-gradient(0deg, rgba(0,0,0,0.7259278711484594) 0%, rgba(0,0,0,0.5830707282913166) 12%, rgba(255,255,255,0) 100%), url('${posterCollageURL}');
            --splash-size: cover;
            --background-image: linear-gradient(0deg, rgba(0,0,0,0.7259278711484594) 0%, rgba(0,0,0,0.5830707282913166) 12%, rgba(255,255,255,0) 100%), url('${posterCollageURL}');
            --slideshow-image-1: url('${frontEndServer}/api/random-banner?t=1');
            --slideshow-image-2: url('${frontEndServer}/api/random-banner?t=2');
            --slideshow-image-3: url('${frontEndServer}/api/random-banner?t=3');
            --slideshow-image-4: url('${frontEndServer}/api/random-banner?t=4');
            --slideshow-image-5: url('${frontEndServer}/api/random-banner?t=5');
            --slideshow-image-6: url('${frontEndServer}/api/random-banner?t=6');
            --slideshow-image-7: url('${frontEndServer}/api/random-banner?t=7');
            --slideshow-image-8: url('${frontEndServer}/api/random-banner?t=8');
            --slideshow-image-9: url('${frontEndServer}/api/random-banner?t=9');
            --slideshow-image-10: url('${frontEndServer}/api/random-banner?t=10');
            }
        `}
      </style>
      <Script src="./receiver/js/receiver.js" type="module" strategy="lazyOnload" />
      {/* Media Player Element */}
      <cast-media-player></cast-media-player>
    </>
  )
}
