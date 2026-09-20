'use client'

import { authClient } from '@src/lib/auth-client'
import { hardNavigate } from '@src/utils/hardNavigate'
import { classNames } from '../utils'

const SignOutButton = ({
  className = 'bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600',
  fontcolorClass = 'text-white',
}) => {
  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        // A full load, not router.push: see hardNavigate for what survives otherwise
        onSuccess: () => hardNavigate('/'),
      },
    })
  }

  return (
    <button
      onClick={handleSignOut}
      type="button"
      className={classNames(
        className,
        fontcolorClass,
        'rounded px-2 py-1 text-base font-semibold shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2'
      )}
    >
      Sign Out
    </button>
  )
}

export default SignOutButton
