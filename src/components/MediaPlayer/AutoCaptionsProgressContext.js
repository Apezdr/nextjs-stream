'use client'

import { createContext, useCallback, useContext, useState } from 'react'

const NOOP_VALUE = Object.freeze({
  progress: Object.freeze({}),
  update: () => {},
  clear: () => {},
})

const AutoCaptionsProgressCtx = createContext(NOOP_VALUE)

export function AutoCaptionsProgressProvider({ children }) {
  const [progress, setProgress] = useState({})

  const update = useCallback((label, partial) => {
    setProgress((prev) => ({
      ...prev,
      [label]: { ...prev[label], ...partial },
    }))
  }, [])

  const clear = useCallback((label) => {
    setProgress((prev) => {
      if (!(label in prev)) return prev
      const next = { ...prev }
      delete next[label]
      return next
    })
  }, [])

  return (
    <AutoCaptionsProgressCtx.Provider value={{ progress, update, clear }}>
      {children}
    </AutoCaptionsProgressCtx.Provider>
  )
}

export function useAutoCaptionsProgress() {
  return useContext(AutoCaptionsProgressCtx)
}
