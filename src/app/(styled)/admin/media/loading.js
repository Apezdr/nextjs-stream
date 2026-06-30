export default function MediaLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="h-8 w-48 animate-pulse rounded bg-gray-200" />
      <div className="mt-6 h-10 w-full animate-pulse rounded bg-gray-100" />
      <div className="mt-4 space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 w-full animate-pulse rounded bg-gray-100" />
        ))}
      </div>
    </div>
  )
}
