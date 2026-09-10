import RetryImage from '@components/RetryImage'
import { classNames } from '@src/utils'

/**
 * The poster in the hero: ~120 px beside the title on phones, 220 px on a
 * desktop, with the stored blurhash as its placeholder.
 *
 * @param {{ src: string|null, alt: string, blurhash?: string|null, className?: string }} props
 */
export default function HeroPoster({ src, alt, blurhash = null, className = '' }) {
  const placeholder = blurhash ? { placeholder: 'blur', blurDataURL: `data:image/png;base64,${blurhash}` } : {}
  return (
    <div
      className={classNames(
        'relative aspect-[2/3] w-[120px] shrink-0 overflow-hidden rounded-lg bg-white/10 shadow-2xl shadow-black/60 ring-1 ring-white/10 sm:w-[170px] lg:w-[220px]',
        className
      )}
    >
      <RetryImage
        src={src || '/sorry-image-not-available.jpg'}
        alt={alt}
        fill
        sizes="(max-width: 640px) 120px, (max-width: 1024px) 170px, 220px"
        quality={90}
        priority
        className="object-cover"
        {...placeholder}
      />
    </div>
  )
}
