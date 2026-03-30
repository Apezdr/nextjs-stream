'use client'

import { useRouter } from 'next/navigation'
import { authClient } from '@src/lib/auth-client'
import { classNames } from '../utils'

const SignOutButton = ({
  className = 'bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600',
  fontcolorClass = 'text-white',
}) => {
  const router = useRouter()

  const handleSignOut = async () => {
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => {
          router.push('/')
        },
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
