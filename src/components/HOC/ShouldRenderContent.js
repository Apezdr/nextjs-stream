'use client'
import { usePathname } from 'next/navigation'
import { Suspense } from 'react'

const ShouldRenderContent = ({ children, allowedPaths, suspenseSkeleton = null }) => {
  const location = usePathname()

  if (!allowedPaths || allowedPaths.includes(location)) {
    return <Suspense fallback={suspenseSkeleton}>{children}</Suspense>
  }

  return null
}

export default ShouldRenderContent
