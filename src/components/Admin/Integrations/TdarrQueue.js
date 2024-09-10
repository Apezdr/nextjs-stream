import React from 'react'

const WorkerProgressBar = ({ worker }) => {
  const { _id, file, percentage, status, workerType, fps, job, ETA } = worker
  const fileName = file.split('/').pop()
  const progressPercentage = Math.min(Math.max(percentage, 0), 100)

  return (
    <div className="mb-6 last:mb-0">
      <h2
        className="text-xs sm:text-lg font-semibold mb-2 truncate"
        title={`Worker ID: ${_id}\nFile: ${file}\nWorker Type: ${workerType}\nJob type: ${job.type}`}
      >
        <span className="block overflow-hidden overflow-ellipsis">{fileName}</span>
      </h2>
      <div className="mb-2 text-sm text-gray-900">{status}</div>
      {fps || ETA ? (
        <div className="flex justify-between mb-2 text-sm text-gray-900">
          {fps && <div className="mb-2 text-sm text-gray-700">{fps} FPS</div>}
          {ETA && (
            <div className="mb-2 text-sm text-gray-700">
              <span className="font-bold">ETA:</span> {ETA}
            </div>
          )}
        </div>
      ) : null}
      <div className="relative pt-1">
        <div className="overflow-hidden h-2 mb-4 text-xs flex rounded bg-gray-200">
          <div
            style={{ width: `${progressPercentage}%` }}
            className="shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-blue-500 transition-all duration-300 ease-in-out"
          ></div>
        </div>
      </div>
      <div className="text-right text-sm font-semibold">{progressPercentage.toFixed(2)}%</div>
    </div>
  )
}

const TdarrProgressBar = ({ data }) => {
  const nodes = Object.values(data)
  const allWorkers = nodes.flatMap((node) =>
    Object.values(node.workers || {}).filter((worker) => worker.percentage != null)
  )

  if (allWorkers.length === 0) {
    return null
    //return <div className="text-center text-gray-600">No active workers found.</div>
  }

  return (
    <div className="max-w-[92vw] mx-auto my-8 p-6 bg-slate-500 rounded-lg shadow-md sm:max-w-full sm:px-4">
      <h1 className="text-2xl font-bold mb-6 text-center text-slate-400">Tdarr Progress</h1>
      {allWorkers.map((worker, index) => (
        <WorkerProgressBar key={index} worker={worker} />
      ))}
    </div>
  )
}

export default TdarrProgressBar
