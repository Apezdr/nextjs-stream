'use client'

import { useState, useEffect, useCallback } from 'react';
import throttle from 'lodash.throttle';

const useScroll = (threshold = 0, throttleMs = 600) => {
  const [isScrolled, setIsScrolled] = useState(false);

  const handleScroll = useCallback(
    throttle(() => {
      const scrolled = window.scrollY > threshold;
      setIsScrolled(scrolled);
    }, throttleMs),
    [threshold, throttleMs]
  );

  useEffect(() => {
    // Initial check
    handleScroll();

    window.addEventListener('scroll', handleScroll);

    // Cleanup
    return () => {
      window.removeEventListener('scroll', handleScroll);
      handleScroll.cancel(); // Cancel any pending throttled calls
    };
  }, [handleScroll]);

  return isScrolled;
};

export default useScroll;