'use client'

import { Time } from './videojs'

export function TimeGroup() {
  return (
    <div className="z-20 relative ml-1.5 flex min-w-[110px] items-center justify-center text-sm font-medium">
      <Time.Value className="time" type="current" />
      <div className="mx-1 text-white/80">/</div>
      <Time.Value className="time" type="duration" />
    </div>
  )
}
