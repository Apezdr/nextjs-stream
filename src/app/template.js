'use client'
import { motion } from 'framer-motion'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css';

const variants = {
  hidden: { opacity: 0, x: 0, y: 0 },
  enter: { opacity: 1, x: 0, y: 0 },
}

export default function Template({ children }) {
  return (
    <motion.main
      variants={variants}
      initial="hidden"
      exit="hidden"
      animate="enter"
      transition={{ type: 'linear', duration: 0.25 }}
      key="LandingPage"
      className='!will-change-[unset]'
    >
      <ToastContainer stacked />
      {children}
    </motion.main>
  )
}
