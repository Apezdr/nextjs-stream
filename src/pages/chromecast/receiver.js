/* global cast, chrome */
'use client'

import { useEffect } from 'react'

const Receiver = () => {
  useEffect(() => {
    // Load the Cast SDK asynchronously
    const script = document.createElement('script')
    script.src = 'https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1'
    script.onload = initializeCastApi
    document.body.appendChild(script)
  }, [])

  const initializeCastApi = () => {
    window.cast.framework.CastContext.getInstance().setOptions({
      receiverApplicationId: '5F1F2E27', // Replace with your app ID
      autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
    })

    const context = cast.framework.CastReceiverContext.getInstance()
    const playerManager = context.getPlayerManager()

    // Handle messages sent from the sender app
    playerManager.setMessageInterceptor(
      cast.framework.messages.MessageType.CUSTOM,
      (customEvent) => {
        // Handle the custom message
        console.log('Received message:', customEvent)
        return true
      }
    )

    context.start()
  }

  return (
    <div>
      <h1>Chromecast Receiver</h1>
      <p>Ready to receive messages...</p>
    </div>
  )
}

export default Receiver
