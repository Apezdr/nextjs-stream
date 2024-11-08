'use client'
import { memo } from 'react'

const Logo = memo(function Logo({ siteTitle }) {
  return (
    <svg
      className="hidden h-6 text-zinc-950 sm:block dark:text-white"
      fill="currentColor"
      viewBox="0 0 27 22"
      title={siteTitle}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M6.99906 0.5L6.57031 0.742752L0.570312 10.7428V11.2572L6.57031 21.2572L6.99906 21.5H18.9991L19.3526 20.6464L16.8526 18.1464L16.4991 18H9.27424L4.8409 11L9.27424 4H16.4991L16.8526 3.85355L19.3526 1.35355L18.9991 0.5H6.99906Z"
      ></path>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M20.7927 4.21875L18.3657 6.64575L18.2969 7.2668L20.6605 10.9993L18.2969 14.7318L18.3657 15.3529L20.7927 17.7799L21.5751 17.6835L25.4311 11.2565V10.7421L21.5751 4.31507L20.7927 4.21875Z"
      ></path>
    </svg>
  )
})

Logo.displayName = 'Logo'

export default Logo
