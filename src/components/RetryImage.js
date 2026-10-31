'use client'

import { useState, useEffect } from 'react'
import { flushSync } from 'react-dom'
import Image from 'next/image'
import { classNames } from '@src/utils'
import { DISSOLVE_MS, FRAMES, buildDissolveMask, canDissolve } from './imageDissolve'
import { FROSTED_GLASS, FROSTED_GLASS_STYLE } from './frostedGlass'

/**
 * The browser marks an <img> broken and paints it before the error event
 * reaches any script, and that frame shows its broken-image icon. Only a
 * broken <img> renders ::before (Chrome, Firefox; never a loaded one), so a
 * ::before filling the box pushes the icon out of it and shows the image's own
 * background there instead.
 */
const NO_BROKEN_ICON = "before:block before:size-full before:content-[''] before:[background:inherit]"

/** How long the blurhash takes to fade into the image once it has loaded. */
export const FADE_MS = 400
/**
 * How long a loaded image waits under its blur for its dissolve mask before
 * it fades instead. A mask takes a few milliseconds; past this the blur would
 * be holding the image back.
 */
const MASK_WAIT_MS = 200

/**
 * What stands in for the image: its blurhash, frosted glass, or nothing.
 *
 * Loading, only an image with a blurhash has one. Failing, an image without
 * one gets the glass, and `whenFailed="hide"` leaves nothing at all, for a logo
 * or badge laid over other art, where a pane would cover what is underneath.
 */
function standInKind({ blur, whenFailed, failing }) {
  if (failing && whenFailed === 'hide') return null
  if (blur) return 'blur'
  return failing ? 'frost' : null
}

/**
 * The stand-in, at the image's own size. It lies over the <img>: a `fill`
 * image is absolutely placed, so the two share one box and the stand-in can
 * fade off the loaded image; a fixed-size image that is retrying is taken out
 * of the flow (see RetryImage), leaving the box to the stand-in.
 *
 * `decorative` while it covers an image that is still loading (the <img>
 * carries the alt); otherwise it is the image, labelled with the alt. Never
 * text: every image this serves already has its title beside it.
 */
function StandIn({ kind, blur, alt, decorative = false, fading = false, mask = null, fill, width, height, className, style, ref }) {
  if (!kind) return null
  // Inline, as next/image sizes a `fill` image, so a caller's position class
  // (a backdrop's `relative`) cannot collapse it
  const box = fill
    ? { position: 'absolute', inset: 0, width: '100%', height: '100%' }
    : { width: width ? `${width}px` : undefined, maxWidth: '100%', aspectRatio: width && height ? `${width} / ${height}` : undefined }
  return (
    <span
      ref={ref}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : alt || undefined}
      aria-hidden={decorative || undefined}
      className={classNames('block', kind === 'blur' ? 'bg-cover bg-center' : FROSTED_GLASS, decorative ? 'pointer-events-none' : '', className)}
      style={{
        ...box,
        ...(kind === 'blur' ? { backgroundImage: `url("${blur}")` } : FROSTED_GLASS_STYLE),
        ...style,
        ...(mask
          ? {
              // The dissolve: the strip's frames stretched to the box, stepped
              // through one per step (image-dissolve, app/global.css)
              WebkitMaskImage: `url("${mask.url}")`,
              maskImage: `url("${mask.url}")`,
              // A greyscale strip: white shows the blur, black the image
              maskMode: 'luminance',
              WebkitMaskSize: mask.size,
              maskSize: mask.size,
              WebkitMaskRepeat: 'no-repeat',
              maskRepeat: 'no-repeat',
              '--dissolve-from': mask.from,
              '--dissolve-to': mask.to,
              // steps(n, jump-none) holds n positions, first and last
              // included: one per frame. One fewer lands between frames,
              // the bottom of one above the top of the next, a seam.
              animation: `image-dissolve ${DISSOLVE_MS}ms steps(${FRAMES}, jump-none) forwards`,
            }
          : { transition: `opacity ${FADE_MS}ms ease-out`, ...(fading ? { opacity: 0 } : null) }),
      }}
    />
  )
}

/**
 * next/image that retries a failed load before giving up: `retryCount` more
 * attempts, `retryDelay` apart, each with a cache-busting query so neither the
 * browser nor the optimizer hands back the same failure. A slow first fetch
 * (a cold optimizer, a file server waking up) loads on a retry rather than
 * leaving the slot broken. A bundled image (a static `import`, an object rather
 * than a URL) has no address to bust and is not retried.
 *
 * The stand-in (StandIn) holds the slot whenever the image cannot:
 * - A `fill` image with a blurhash loads under its blur, which dissolves away
 *   along a heightmap of the image's own once it has loaded (imageDissolve),
 *   instead of being painted over in bands as the image decodes. Where a mask
 *   cannot be made in time (MASK_WAIT_MS), or the viewer prefers less motion,
 *   the blur fades instead (FADE_MS). A fixed-size image keeps next/image's
 *   own blur: it has no box of its own to lay a second layer in.
 * - From the first failure, not the last: a failed <img> drops next/image's
 *   blur and paints its alt text, so the retries go on underneath, invisible,
 *   and a retry that loads takes the slot back.
 * - After the last attempt: `fallbackSrc` when given, otherwise the stand-in
 *   alone (`whenFailed`: 'frost', the default, or 'hide').
 *
 * The caller's `onError` fires once, when the retries are spent, not on every
 * failed attempt: it must not cut the retries short.
 */
const RetryImage = ({
  src,
  alt,
  retryCount = 15,
  retryDelay = 1000, // in milliseconds
  fallbackSrc, // Optional fallback image src
  whenFailed = 'frost',
  onError,
  onLoad,
  ...props
}) => {
  // Use a key in the parent component to reset state, or derive state from props
  const [currentSrc, setCurrentSrc] = useState(() => src)
  const [attempt, setAttempt] = useState(0)
  const [hasError, setHasError] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // The stand-in has finished fading off the loaded image and can go
  const [faded, setFaded] = useState(false)
  // The dissolve mask, once built: its object URL and where it sits (imageDissolve)
  const [mask, setMask] = useState(null)
  // No mask in time (or none possible): the blur fades instead
  const [plainFade, setPlainFade] = useState(false)
  const [lastSrc, setLastSrc] = useState(() => src)

  // Derive state reset from prop changes
  if (src !== lastSrc) {
    setLastSrc(src)
    setCurrentSrc(src)
    setAttempt(0)
    setHasError(false)
    setLoaded(false)
    setFaded(false)
    setMask(null)
    setPlainFade(false)
  }

  const blur = props.placeholder === 'blur' && props.blurDataURL ? props.blurDataURL : null
  const fill = Boolean(props.fill)
  // A fill image with a blurhash loads under its blur, and the blur goes off it
  const fadesFromBlur = fill && Boolean(blur)
  // A first-try load dissolves; a retry that loaded fades its stand-in off
  const wantsDissolve = fadesFromBlur && attempt === 0
  // How the stand-in leaves a loaded image; null while it waits for a mask
  const fadeMode = !loaded ? null : !wantsDissolve ? 'fade' : mask ? 'dissolve' : plainFade ? 'fade' : null

  useEffect(() => {
    if (attempt > 0 && attempt <= retryCount) {
      const timeout = setTimeout(() => {
        // Append a query parameter to bypass cache
        const separator = src?.includes('?') ? '&' : '?'
        setCurrentSrc(`${src}${separator}retry=${attempt}`)
      }, retryDelay)

      return () => clearTimeout(timeout)
    }
  }, [attempt, retryCount, retryDelay, src])

  // Build the dissolve mask once the image has loaded: only images that load
  // pay for one, not every lazy card on a page. Whichever comes first wins:
  // the mask, or giving up on it (at once where none can be made).
  useEffect(() => {
    if (!loaded || !wantsDissolve) return
    let settled = false
    let made = null
    const able = canDissolve()
    const giveUp = setTimeout(() => {
      settled = true
      setPlainFade(true)
    }, able ? MASK_WAIT_MS : 0)
    if (able) {
      buildDissolveMask(String(src), blur).then(
        (built) => {
          made = built.url
          if (settled) return URL.revokeObjectURL(built.url)
          settled = true
          clearTimeout(giveUp)
          setMask(built)
        },
        () => {
          if (settled) return
          settled = true
          clearTimeout(giveUp)
          setPlainFade(true)
        }
      )
    }
    return () => {
      settled = true
      clearTimeout(giveUp)
      if (made) URL.revokeObjectURL(made)
    }
  }, [loaded, wantsDissolve, src, blur])

  // Unmount the stand-in once its fade or dissolve is over. A timer rather
  // than transitionend/animationend, which never fire when the load lands
  // before the stand-in was first painted (nothing to animate from)
  useEffect(() => {
    if (!loaded || faded || fadeMode === null) return
    const timeout = setTimeout(() => setFaded(true), fadeMode === 'dissolve' ? DISSOLVE_MS : FADE_MS)
    return () => clearTimeout(timeout)
  }, [loaded, faded, fadeMode])

  // The mask is only needed while it dissolves
  useEffect(() => {
    if (faded && mask) URL.revokeObjectURL(mask.url)
  }, [faded, mask])

  const handleError = () => {
    const willRetry = typeof src === 'string' && attempt < retryCount
    // Commit the stand-in inside the error event. React runs an `error` update
    // at default priority, after the browser has had a chance to paint, and
    // that frame shows the failed <img>: the browser's broken-image icon.
    flushSync(() => {
      if (willRetry) setAttempt((prev) => prev + 1)
      else setHasError(true)
    })
    if (!willRetry) onError?.()
  }

  const handleLoad = (event) => {
    setLoaded(true)
    onLoad?.(event)
  }

  if (!src) {
    return null
  }

  if (hasError) {
    if (fallbackSrc) {
      return <Image {...props} src={fallbackSrc} alt={alt} onLoad={onLoad} />
    }
    return <StandIn {...props} kind={standInKind({ blur, whenFailed, failing: true })} blur={blur} alt={alt} />
  }

  // The <img> retries out of sight behind the stand-in until one attempt loads
  const retrying = attempt > 0 && !loaded
  // The blur covers a loading image, and a loaded one while its mask is made
  const covering = retrying || (fadesFromBlur && fadeMode === null)
  // Only a fill image fades: a fixed-size stand-in sits in the flow, and the
  // loaded <img> beside it would double the height until it went
  const fadingOut = fadeMode !== null && !faded && fill && (fadesFromBlur || attempt > 0)
  // A stand-in fading off a retry that loaded keeps the look it had while failing
  const failingLook = retrying || (fadingOut && attempt > 0)

  const { ref, style, placeholder, ...imageProps } = props
  return (
    <>
      {/* The caller's props first, so they cannot replace the retry handlers.
          Always the first child, so it is never remounted. */}
      <Image
        {...imageProps}
        // The stand-in draws the blur that fades; next/image's own would be
        // painted over by the image, not faded
        placeholder={fadesFromBlur ? 'empty' : placeholder}
        ref={retrying ? undefined : ref}
        style={retrying ? { ...style, position: 'absolute', opacity: 0, pointerEvents: 'none' } : style}
        aria-hidden={retrying || undefined}
        className={classNames(props.className, NO_BROKEN_ICON)}
        src={currentSrc}
        alt={alt}
        onError={handleError}
        onLoad={handleLoad}
      />
      {covering || fadingOut ? (
        <StandIn
          {...props}
          ref={retrying ? ref : undefined}
          kind={standInKind({ blur, whenFailed, failing: failingLook })}
          blur={blur}
          alt={alt}
          decorative={!retrying}
          fading={fadingOut && fadeMode === 'fade'}
          mask={fadingOut && fadeMode === 'dissolve' ? mask : null}
        />
      ) : null}
    </>
  )
}

export default RetryImage
