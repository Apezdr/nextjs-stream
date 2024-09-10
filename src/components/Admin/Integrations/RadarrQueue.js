const RadarrQueue = ({ data }) => {
  return (
    <div className="flex flex-col my-3">
      {data?.records?.map((record, index) => {
        const percentage = 100 - (record.sizeleft / record.size) * 100
        const progressColor = percentage > 66 ? '#22c55e' : percentage > 33 ? '#f97316' : '#ef4444'

        return (
          <div key={index} className="bg-slate-500 border border-gray-200 rounded-lg shadow-sm p-4">
            <h3 className="text-lg font-semibold mb-2 truncate" title={record.title}>
              {record.title}
            </h3>
            <div className="mb-2">
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full"
                  style={{ width: `${percentage}%`, backgroundColor: progressColor }}
                ></div>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span>{percentage.toFixed(2)}%</span>
                <span>
                  {((record.size - record.sizeleft) / (1024 * 1024 * 1024)).toFixed(2)} GB /{' '}
                  {(record.size / (1024 * 1024 * 1024)).toFixed(2)} GB
                </span>
              </div>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span>Status: {record.trackedDownloadState}</span>
              <span>Source: {record.indexer}</span>
            </div>
            <div className="flex justify-between">
              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-black">
                {record.status}
              </span>
              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-black">
                Quality: {record.quality.quality.name}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default RadarrQueue
