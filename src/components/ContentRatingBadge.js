import { InformationCircleIcon } from '@heroicons/react/20/solid'
import { classNames } from '@src/utils'
import { normalizeContentRating } from '@src/utils/contentRating'

function RatingMark({ contentRating, label, variant, labelled = true }) {
  return (
    <span
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? label : undefined}
      aria-hidden={labelled ? undefined : true}
      className={classNames(
        'inline-flex h-7 min-w-11 items-center justify-center rounded border border-white/80 bg-neutral-950 px-2 font-sans font-bold text-white shadow-[0_0_0_1px_rgba(0,0,0,0.75)]',
        variant === 'player' ? 'text-sm' : 'text-xs'
      )}
    >
      {contentRating}
    </span>
  )
}

export default function ContentRatingBadge({
  rating,
  mediaType = null,
  variant = 'default',
  className = '',
}) {
  const normalized = normalizeContentRating(rating, mediaType)
  if (!normalized) return null

  const { contentRating, descriptors, reason } = normalized
  const label = `Rated ${contentRating}`
  const hasDetails = descriptors.length > 0 || Boolean(reason)

  if (!hasDetails) {
    return (
      <span className={className} data-content-rating={contentRating}>
        <RatingMark
          contentRating={contentRating}
          label={label}
          variant={variant}
        />
      </span>
    )
  }

  return (
    <details
      className={classNames('group/content-rating inline-block max-w-full font-sans', className)}
      data-content-rating={contentRating}
    >
      <summary
        aria-label={`${label}. Show rating details`}
        className="inline-flex min-h-11 min-w-11 cursor-pointer list-none items-center gap-2 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <RatingMark
          contentRating={contentRating}
          label={label}
          variant={variant}
          labelled={false}
        />
        <InformationCircleIcon aria-hidden="true" className="size-5 text-gray-300" />
      </summary>
      <div className="mt-2 w-max max-w-[calc(100vw-2rem)] rounded border border-white/20 bg-neutral-950 p-3 text-left text-sm text-gray-100 shadow-xl">
        <p className="font-semibold">{label}</p>
        {descriptors.length > 0 ? (
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {descriptors.map((descriptor) => (
              <li key={descriptor}>{descriptor}</li>
            ))}
          </ul>
        ) : null}
        {reason ? <p className="mt-2">{reason}</p> : null}
      </div>
    </details>
  )
}
