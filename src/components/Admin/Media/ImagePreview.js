'use client'

/**
 * Live image preview for a URL field (poster / backdrop / logo / thumbnail).
 * Renders nothing when there is no URL; hides itself on load error.
 */
export default function ImagePreview({ url, alt = 'Preview', className = '' }) {
  if (!url) return null
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
      className={`rounded-md border border-gray-200 bg-gray-50 object-contain ${className}`}
    />
  )
}
