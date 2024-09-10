'use client'

import { signOut } from 'next-auth/react'
import { classNames } from '../utils'

const SignOutButton = ({
  className = 'bg-indigo-600 hover:bg-indigo-500 focus-visible:outline-indigo-600',
  fontcolorClass = 'text-white',
  signoutProps,
}) => (
  <button
    onClick={() => signOut(signoutProps)}
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

export default SignOutButton
