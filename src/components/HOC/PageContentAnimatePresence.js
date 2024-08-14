'use client'

import { usePathname } from 'next/navigation'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import { memo, useRef } from 'react'

const PageContentAnimatePresence = ({ children, variants, transition, _key = '' }) => {
  const pathname = usePathname()
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, amount: 0 })

  return (
    <AnimatePresence mode="wait">
      <motion.div
        ref={ref}
        variants={variants}
        initial="hidden"
        exit="hidden"
        animate={isInView ? 'enter' : 'hidden'}
        transition={transition}
        key={pathname + _key}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  )
}

export default memo(PageContentAnimatePresence)
