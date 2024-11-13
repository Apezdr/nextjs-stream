'use client'
import { useEffect, useState } from 'react';
import SkeletonCard from './SkeletonCard';

const SkeletonList = ({ numberOfItems, itemsPerPage, numberOfPeeks }) => {
  const skeletonCount = Math.min(numberOfItems, itemsPerPage + numberOfPeeks);
  const [isClient, setIsClient] = useState(false)
 
  useEffect(() => {
    setIsClient(true)
  }, [])
  return (
    isClient ? 
    Array.from({ length: skeletonCount }).map((_, index) => (
        <SkeletonCard key={`skeleton-${index}`} />
    ))
    : null
  );
};

export default SkeletonList;