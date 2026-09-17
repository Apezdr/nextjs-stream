import RetryImage from '@components/RetryImage'
import { classNames } from '@src/utils'

/**
 * The poster in the hero: ~120 px beside the title on phones, 220 px on a
 * desktop, with the stored blurhash as its placeholder. A page with another
 * layout (the show page's 230 px poster on the right, the season page's
 * fixed 120 px) passes its own `widthClassName` and the matching `sizes`.
 *
 * @param {Object} props
 * @param {string|null} props.src
 * @param {string} props.alt
 * @param {string|null} [props.blurhash] - raw base64 PNG; the data URL is built here
 * @param {string} [props.className]
 * @param {string} [props.widthClassName] - the responsive width classes
 * @param {string} [props.sizes] - the `sizes` hint matching those widths
 * @param {boolean} [props.priority]
 */
export default function HeroPoster({
  src,
  alt,
  blurhash = null,
  className = '',
  widthClassName = 'w-[120px] sm:w-[170px] lg:w-[220px]',
  sizes = '(max-width: 640px) 120px, (max-width: 1024px) 170px, 220px',
  priority = true,
}) {
  const placeholder = blurhash ? { placeholder: 'blur', blurDataURL: `data:image/png;base64,${blurhash}` } : {}
  return (
    <div
      className={classNames(
        'relative aspect-[2/3] shrink-0 overflow-hidden rounded-lg bg-white/10 shadow-2xl shadow-black/60 ring-1 ring-white/10',
        widthClassName,
        className
      )}
    >
      <RetryImage
        src={src || '/sorry-image-not-available.jpg'}
        alt={alt}
        fill
        sizes={sizes}
        quality={90}
        priority={priority}
        className="object-cover"
        {...placeholder}
      />
    </div>
  )
}
