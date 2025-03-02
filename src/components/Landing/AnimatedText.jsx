'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import './animated-text.css'

// CSS animation approach using stroke-dasharray and stroke-dashoffset
const AnimatedTextPath = ({ text, className = "", onAnimationComplete, delay = 0 }) => {
  const [animationComplete, setAnimationComplete] = useState(false);
  
  // Handle animation completion
  useEffect(() => {
    const timer = setTimeout(() => {
      setAnimationComplete(true);
      if (onAnimationComplete) {
        onAnimationComplete();
      }
    }, 2000); // Animation takes 2s + a little extra
    
    return () => clearTimeout(timer);
  }, [onAnimationComplete]);
  
  return (
    <div className={`mb-4 w-full ${className}`}>
      <div className="w-full overflow-visible" style={{ height: '80px' }}>
        <svg 
          className="animated-text-svg" 
          height="80" 
          stroke="white" 
          strokeWidth="2" 
          width="100%" 
          viewBox="0 0 600 80" 
          preserveAspectRatio="xMidYMid meet"
        >
          <text 
            className="text-line" 
            x="300" 
            y="50"
            textAnchor="middle" 
            fontSize="36px"
            fontWeight="bold"
          >
            {text}
          </text>
        </svg>
      </div>
    </div>
  );
};

// Component that combines both animations
const AnimatedHeading = () => {
  const [showSecondText, setShowSecondText] = useState(false);
  
  const handleFirstAnimationComplete = () => {
    setShowSecondText(true);
  };
  
  return (
    <div className="flex flex-col items-center">
      <AnimatedTextPath 
        text="Movies/TV at your fingertips."
        className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl"
        onAnimationComplete={handleFirstAnimationComplete}
      />
      
      {showSecondText && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ 
            opacity: 1, 
            y: 0,
            transition: { 
              duration: 0.5,
              //delay: 0.2
            }
          }}
          //className="mt-4"
        >
          <span>View our catalog of media.</span>
        </motion.div>
      )}
    </div>
  );
};

export { AnimatedTextPath, AnimatedHeading };
