/**
 * Not Found Content Component
 * 
 * Displays error message and call-to-action button for not found pages.
 * Reusable component for all types of media not found errors.
 */

import Link from 'next/link'

/**
 * NotFoundContent - Display error message and back button
 * 
 * @param {Object} props
 * @param {string} props.errorMessage - User-friendly error message
 * @param {string} props.backHref - URL to navigate back to
 * @param {string} props.backText - Text for the back button
 */
export default function NotFoundContent({ errorMessage, backHref, backText }) {
  return (
    <div className="text-center">
      <h2 className="text-lg text-white my-2 max-w-2xl mx-auto">{errorMessage}</h2>
      <Link
        href={backHref}
        className="inline-flex items-center rounded text-center bg-indigo-600 px-4 py-2 text-base font-semibold text-white shadow-sm hover:bg-indigo-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 transition-colors"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
          className="w-4 h-4 mr-2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
          />
        </svg>
        {backText}
      </Link>
    </div>
  )
}