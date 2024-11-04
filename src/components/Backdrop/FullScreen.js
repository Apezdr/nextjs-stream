'use client'
import Image from 'next/image'
import { getFullImageUrl } from '@src/utils'
import { motion } from 'framer-motion'

export default function FullScreenBackdrop({ media }) {
  let lowResImageUrl, highResImageUrl

  // Use the DB blurhash if it exists
  if (media.backdrop) {
    lowResImageUrl = media.backdropBlurhash
    highResImageUrl = media.backdrop
  } else if (media.metadata?.backdrop_path) {
    // fallback to TMDB image
    lowResImageUrl = getFullImageUrl(media.metadata?.backdrop_path, 'w780') // Low-resolution version
    highResImageUrl = getFullImageUrl(media.metadata?.backdrop_path, 'original') // High-resolution version
  }

  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1 },
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="hidden"
      key={highResImageUrl}
      variants={backdropVariants}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 h-screen w-full overflow-hidden z-[-1]"
      id="backdrop"
    >
      <div
        id="backdrop-cover"
        className="w-screen h-screen backdrop-blur-sm absolute top-0 left-0 z-[-1]"
      />
      <Image
        src={highResImageUrl}
        alt="Backdrop Image"
        fill
        placeholder="blur"
        blurDataURL={`data:image/png;base64,${lowResImageUrl}`}
        sizes="(max-width: 768px) 100vw, 50vw"
        className="relative z-[-2] object-cover"
      />
    </motion.div>
  )
}
