'use client';

import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMediaState } from '@vidstack/react';

export default function RemoveStartParam() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canPlay = useMediaState('canPlay');
  const [hasRemovedParam, setHasRemovedParam] = useState(false);

  useEffect(() => {
    // Only remove the parameter after the video can play and if we haven't already removed it
    if (canPlay && searchParams.has('start') && !hasRemovedParam) {
      // Create a new URLSearchParams object from the current query
      const newSearchParams = new URLSearchParams(searchParams);
      
      // Remove the 'start' parameter
      newSearchParams.delete('start');
      
      // Get the new query string
      const newQuery = newSearchParams.toString();
      
      // Replace the current URL without a page refresh
      const newUrl = newQuery ? `${pathname}?${newQuery}` : pathname;
      router.replace(newUrl, { scroll: false });
      
      // Mark that we've removed the parameter
      setHasRemovedParam(true);
    }
  }, [canPlay, searchParams, pathname, router, hasRemovedParam]);

  return null;
}
