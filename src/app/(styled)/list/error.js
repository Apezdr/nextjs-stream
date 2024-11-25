'use client'
import { useEffect } from 'react'

export default function Error({ error, reset }) {
  useEffect(() => {
    console.error(error) // Log the error
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-between xl:p-24">
      <div className="h-auto flex flex-col gap-8 items-center justify-center py-32 lg:py-0 px-4 xl:px-0 sm:mt-20">
        <h2>Something went wrong!</h2>
        <button
          className="rounded bg-gray-500 hover:bg-gray-700 transition-colors px-2 py-1 text-base font-semibold text-white shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={() => reset()}
        >
          Try again
        </button>
      </div>
    </div>
  )
}
