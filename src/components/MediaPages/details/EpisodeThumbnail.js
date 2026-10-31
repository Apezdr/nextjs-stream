import RetryImage from '@components/RetryImage'
import { FROSTED_GLASS, FROSTED_GLASS_STYLE } from '@components/frostedGlass'
import { classNames } from '@src/utils'

/**
 * A 16:9 episode still: in the season list's rows, the episode page's hero
 * and the previous/next cards. Without a still (no thumbnail of our own and
 * no TMDB still) the frame holds a pane of frosted glass, the same surface a
 * still that fails to load leaves (RetryImage), in the same shape so rows
 * stay aligned. Overlays (the progress bar along the bottom edge) come in as
 * children, positioned absolutely inside the frame.
 *
 * @param {Object} props
 * @param {string|null} props.src
 * @param {string|null} [props.blurDataURL] - a complete `data:` URL (callers build it), or null
 * @param {string} [props.alt]
 * @param {string} [props.className]
 * @param {string} [props.sizes]
 * @param {boolean} [props.priority]
 * @param {import('react').ReactNode} [props.children]
 */
export default function EpisodeThumbnail({
  src,
  blurDataURL = null,
  alt = '',
  className = '',
  sizes = '(max-width: 640px) 100vw, 220px',
  priority = false,
  children = null,
}) {
  const placeholder = blurDataURL ? { placeholder: 'blur', blurDataURL } : {}
  // aspect-[16/9], not aspect-video: @tailwindcss/aspect-ratio replaces the
  // core aspectRatio theme, so the named utilities (video, square) emit no
  // CSS in this project and the frame would collapse to zero height.
  return (
    <div className={classNames('relative aspect-[16/9] overflow-hidden rounded-lg bg-white/5 ring-1 ring-white/10', className)}>
      {src ? (
        <RetryImage src={src} alt={alt} fill sizes={sizes} quality={90} priority={priority} className="object-cover" {...placeholder} />
      ) : (
        <span aria-hidden="true" className={classNames('absolute inset-0 block', FROSTED_GLASS)} style={FROSTED_GLASS_STYLE} />
      )}
      {children}
    </div>
  )
}
