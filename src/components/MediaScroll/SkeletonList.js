'use client'
import { useSyncExternalStore } from 'react';
import SkeletonCard from './SkeletonCard';

const SkeletonList = ({ numberOfItems, itemsPerPage, numberOfPeeks }) => {
  const skeletonCount = Math.min(numberOfItems, itemsPerPage + numberOfPeeks);
  // Use useSyncExternalStore for SSR-safe client detection
  const isClient = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  
  return (
    isClient ? 
    Array.from({ length: skeletonCount }).map((_, index) => (
        <SkeletonCard key={`skeleton-${index}`} />
    ))
    : null
  );
};

export default SkeletonList;