import Link from 'next/link'
import { ArrowLeftIcon } from '@heroicons/react/24/outline'

/**
 * The look the account-deletion pages share. The app is dark whatever the
 * device's theme is, so nothing here, or in the components that use these,
 * has a `dark:` variant: Tailwind's default ties those to the device's
 * theme, and on a device set to light the pages showed dark text on the dark
 * page and pale panels with pale text.
 */
export const CARD = 'rounded-2xl bg-slate-900/80 p-6 shadow-xl ring-1 ring-white/10 sm:p-8'

export const FOCUS_RING =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-300'

export const FIELD =
  'block w-full rounded-xl border-0 bg-slate-950/60 px-3 py-2.5 text-sm text-white ring-1 ring-inset ring-white/15 placeholder:text-slate-500 focus:ring-2 focus:ring-inset focus:ring-indigo-400 disabled:opacity-60'

export const SECONDARY_BUTTON = `inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 ${FOCUS_RING}`

export const TEXT_LINK = `rounded font-medium text-indigo-300 underline underline-offset-2 transition hover:text-indigo-200 ${FOCUS_RING}`

/**
 * The frame of the two pages where an account's deletion is asked for
 * (/account/delete, signed in; /privacy/delete-account, by email address):
 * one readable column with a way back, a title and what the page is for.
 *
 * @param {{ backHref: string, backLabel: string, title: string, lead?: import('react').ReactNode, children: import('react').ReactNode }} props
 */
export default function DeletionPageShell({ backHref, backLabel, title, lead = null, children }) {
  return (
    <div className="min-h-screen bg-[#060916e8] px-4 pb-20 pt-24 sm:px-6">
      <div className="mx-auto w-full max-w-2xl">
        <Link
          href={backHref}
          className={`inline-flex items-center gap-2 rounded text-sm font-medium text-slate-300 transition hover:text-white ${FOCUS_RING}`}
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
          {backLabel}
        </Link>

        <header className="mt-6">
          <h1 className="text-3xl font-semibold tracking-tight text-white">{title}</h1>
          {lead && <div className="mt-3 text-base leading-relaxed text-slate-300">{lead}</div>}
        </header>

        <div className="mt-8 space-y-6">{children}</div>
      </div>
    </div>
  )
}
