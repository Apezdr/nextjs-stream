'use client'
import Image from 'next/image'
import { motion } from 'framer-motion'

export default function GeneralFullScreenBackdrop({ url }) {
  const backdropVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 0.04 },
  }

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      exit="hidden"
      variants={backdropVariants}
      transition={{ duration: 0.5 }}
      className="fixed top-0 left-0 h-screen w-full overflow-hidden z-[-1]"
      id="backdrop-general"
    >
      <div
        id="backdrop-general-cover"
        className="w-full h-screen backdrop-blur-sm absolute top-0 left-0 z-[-1]"
      />
      <div
        className="w-full h-full !bg-[length:110%]"
        style={{
          backgroundImage: `url(${url})`,
          backgroundRepeat: 'repeat',
          backgroundSize: 'cover',
          //animation: 'scrollBackground 200s linear infinite',
        }}
      ></div>
    </motion.div>
  )
}
