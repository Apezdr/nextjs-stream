import Link from 'next/link'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'

/**
 * Link from an admin record to its public library page.
 *
 * @param {object} props
 * @param {'movie'|'tv'} props.type
 * @param {string} props.originalTitle filesystem key the library routes on, not the display title
 * @param {string} [props.title] display title, used for the accessible name
 * @param {'icon'|'button'} [props.variant]
 */
export default function ViewInLibraryButton({ type, originalTitle, title, variant = 'button' }) {
  if (!originalTitle || !['movie', 'tv'].includes(type)) return null

  const href = `/list/${type}/${encodeURIComponent(originalTitle)}`
  const label = title ? `View ${title} in library` : 'View in library'

  if (variant === 'icon') {
    return (
      <Link href={href} title={label} className="text-gray-400 hover:text-indigo-600">
        <ArrowTopRightOnSquareIcon className="h-5 w-5" />
        <span className="sr-only">{label}</span>
      </Link>
    )
  }

  return (
    <Link
      href={href}
      title={label}
      className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
    >
      <ArrowTopRightOnSquareIcon className="h-4 w-4" />
      View in library
    </Link>
  )
}
