const DownloadStatus = ({ data }) => {
  return (
    <div className="flex flex-col my-3">
      {data?.slots?.map((slot, index) => {
        const percentage = parseInt(slot.percentage)
        const progressColor = percentage > 66 ? '#22c55e' : percentage > 33 ? '#f97316' : '#ef4444'

        return (
          <div key={index} className="bg-slate-500 border border-gray-200 rounded-lg shadow-sm p-4">
            <h3 className="text-lg font-semibold mb-2 truncate" title={slot.filename}>
              {slot.filename}
            </h3>
            <div className="mb-2">
              <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                  className="h-2.5 rounded-full"
                  style={{ width: `${percentage}%`, backgroundColor: progressColor }}
                ></div>
              </div>
              <div className="flex justify-between text-sm mt-1">
                <span>{percentage}%</span>
                <span>
                  {(parseFloat(slot.size) - parseFloat(slot.sizeleft)).toFixed(2)} / {slot.size}
                </span>
              </div>
            </div>
            <div className="flex justify-between text-sm mb-2">
              <span>Time left: {slot.timeleft}</span>
              <span>
                Category:{' '}
                {slot.cat
                  .split(' ')
                  .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                  .join(' ')}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-black">
                {data.status === 'Paused' ? data.status : slot.status}
              </span>
              <span className="px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-black">
                Priority: {slot.priority}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default DownloadStatus
