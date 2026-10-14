'use client'

import { ArrowDownTrayIcon } from '@heroicons/react/20/solid'
import { authClient } from '@src/lib/auth-client'
import { classNames } from '@src/utils'
import { arrServiceName, canUseArr, isArrMediaType } from './arrApi'

/**
 * The Radarr/Sonarr button in a title's popup card, for users who may use
 * them. The popup is a hover card that unmounts the moment it collapses, so
 * this only asks: the card that owns the popup closes it and opens the dialog
 * itself. Client-only (the popup never renders on the server), so the session
 * check needs no hydration gate.
 */
export default function ArrPopupButton({ mediaType, tmdbId, title, onOpen, className = '' }) {
  const { data: session } = authClient.useSession()
  const id = Number(tmdbId)
  if (!onOpen || !canUseArr(session?.user) || !isArrMediaType(mediaType) || !Number.isSafeInteger(id) || id <= 0) {
    return null
  }
  const service = arrServiceName(mediaType)
  return (
    <button
      type="button"
      onClick={() => onOpen({ mediaType, tmdbId: id, title })}
      title={`Send to ${service}, or manage it there`}
      className={classNames(
        'inline-flex items-center gap-2 rounded-full bg-gray-800 text-white transition hover:bg-gray-700',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500',
        className
      )}
    >
      <ArrowDownTrayIcon className="size-5" aria-hidden="true" />
      <span className="hidden sm:inline">{service}…</span>
      <span className="sr-only sm:hidden">{service}</span>
    </button>
  )
}
