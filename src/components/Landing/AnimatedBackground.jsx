'use client'

import { motion } from 'framer-motion'

const backgroundVariants = {
  hidden: { 
    scale: 0.8, 
    opacity: 0.5,
    rotate: -5
  },
  enter: { 
    scale: 1, 
    opacity: 0.7,
    rotate: 0,
    transition: { 
      duration: 1.5, 
      ease: "easeOut" 
    } 
  },
  exit: { 
    scale: 1.2, 
    opacity: 0,
    rotate: 5,
    transition: { 
      duration: 0.8, 
      ease: "easeIn" 
    } 
  }
};

const pulseAnimation = {
  scale: [1, 1.05, 1],
  opacity: [0.7, 0.8, 0.7],
  transition: {
    duration: 8,
    repeat: Infinity,
    repeatType: "reverse",
    ease: "easeInOut"
  }
};

function AnimatedBackground() {
  return (
    <motion.svg
      viewBox="0 0 1024 1024"
      className="absolute sm:-left-1/4 -left-1/2 top-0 -z-10 h-[64rem] w-[64rem] -translate-x-1/2 -translate-y-1/2 [mask-image:radial-gradient(closest-side,white,transparent)]"
      aria-hidden="true"
      initial="hidden"
      animate={["enter", pulseAnimation]}
      exit="exit"
      variants={backgroundVariants}
      style={{ pointerEvents: 'none' }}
    >
      <motion.circle
        cx={512}
        cy={512}
        r={512}
        fill="url(#827591b1-ce8c-4110-b064-7cb85a0b1217)"
        fillOpacity="0.7"
      />
      <defs>
        <radialGradient id="827591b1-ce8c-4110-b064-7cb85a0b1217">
          <stop stopColor="#7775D6" />
          <stop offset={1} stopColor="#E935C1" />
        </radialGradient>
      </defs>
    </motion.svg>
  )
}
export default AnimatedBackground
