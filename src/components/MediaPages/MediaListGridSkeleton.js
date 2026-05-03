const SKELETON_CARD_COUNT = 20

export default function MediaListGridSkeleton() {
  return (
    <>
      <li className="col-span-full mb-6 border-b border-gray-700 pb-6">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div className="h-9 w-40 bg-gray-800 rounded animate-pulse" />
          <div className="flex flex-col gap-3 w-full md:w-auto">
            <div className="flex flex-wrap gap-2 max-w-3xl">
              {Array.from({ length: 8 }, (_, i) => (
                <div
                  key={i}
                  className="h-6 w-16 bg-gray-700 rounded-full animate-pulse"
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-2 max-w-3xl">
              {Array.from({ length: 4 }, (_, i) => (
                <div
                  key={i}
                  className="h-6 w-20 bg-gray-700 rounded-full animate-pulse"
                />
              ))}
            </div>
          </div>
        </div>
      </li>
      {Array.from({ length: SKELETON_CARD_COUNT }, (_, i) => (
        <li
          key={i}
          className="relative min-w-[250px] max-w-sm"
          style={{ contentVisibility: 'auto', containIntrinsicSize: '760px' }}
        >
          <div className="w-full h-[582px] bg-gray-800 rounded-lg animate-pulse" />
          <div className="mt-2 h-4 w-24 mx-auto bg-gray-800 rounded animate-pulse" />
          <div className="mt-2 h-4 w-32 mx-auto bg-gray-800 rounded animate-pulse" />
          <div className="mt-2 h-4 w-40 mx-auto bg-gray-800 rounded animate-pulse" />
          <div className="mt-2 space-y-1.5">
            <div className="h-3 w-full bg-gray-800 rounded animate-pulse" />
            <div className="h-3 w-11/12 bg-gray-800 rounded animate-pulse" />
            <div className="h-3 w-10/12 bg-gray-800 rounded animate-pulse" />
            <div className="h-3 w-9/12 bg-gray-800 rounded animate-pulse" />
          </div>
        </li>
      ))}
    </>
  )
}
