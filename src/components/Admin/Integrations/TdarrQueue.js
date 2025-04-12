'use client'
import React, { useState } from 'react'
import DashboardCard from './DashboardCard'

// Helper function to format bytes to human-readable form
const formatBytes = (bytes, decimals = 2) => {
  if (bytes === 0) return '0 Bytes'
  
  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB']
  
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

// Convert GB to bytes
const gbToBytes = (gb) => gb * 1024 * 1024 * 1024

// Format as GB
const formatGB = (gb, decimals = 2) => {
  if (!gb) return '0 GB'
  return `${parseFloat(gb).toFixed(decimals)} GB`
}

// Function to determine status color
const getStatusColor = (status) => {
  if (!status) return 'gray-500'
  
  const statusLower = status.toLowerCase()
  
  if (statusLower.includes('error') || statusLower.includes('fail')) {
    return 'red-500'
  } else if (statusLower.includes('transcode') || statusLower.includes('convert')) {
    return 'blue-500'
  } else if (statusLower.includes('health')) {
    return 'green-500'
  } else if (statusLower.includes('web') || statusLower.includes('fast start')) {
    return 'purple-500'
  } else if (statusLower.includes('subtitle') || statusLower.includes('caption')) {
    return 'yellow-500'
  } else if (statusLower.includes('audio')) {
    return 'pink-500'
  } else {
    return 'blue-500' // Default color
  }
}

// Function to determine worker type color
const getWorkerTypeColor = (type) => {
  if (!type) return 'bg-gray-600'
  
  if (type.includes('gpu')) {
    return 'bg-green-600'
  } else if (type.includes('cpu')) {
    return 'bg-blue-600'
  } else {
    return 'bg-gray-600'
  }
}

// Worker badge component
const WorkerTypeBadge = ({ workerType }) => {
  return (
    <span className={`${getWorkerTypeColor(workerType)} text-white text-xs font-medium px-2 py-1 rounded-full mr-2`}>
      {workerType?.replace('transcode', 'Trans.').replace('healthcheck', 'Health')}
    </span>
  )
}

// Component for file size comparison
const FileSizeComparison = ({ sourceSize, outputSize, estSize }) => {
  // If we don't have enough data, don't render
  if (!sourceSize) return null
  
  const sourceSizeBytes = gbToBytes(sourceSize)
  const outputSizeBytes = gbToBytes(outputSize || 0)
  const estSizeBytes = gbToBytes(estSize || sourceSize)
  
  // Calculate compression percentage if we have both sizes
  const compressionPerc = outputSize && sourceSize 
    ? ((1 - (outputSize / sourceSize)) * 100).toFixed(1)
    : null
    
  return (
    <div className="flex flex-col sm:flex-row text-xs text-gray-200 mt-1 mb-2 justify-between">
      <div className="flex items-center">
        <span className="inline-block w-3 h-3 bg-blue-500 mr-1 rounded-sm"></span>
        <span>Source: {formatGB(sourceSize)}</span>
      </div>
      
      {outputSize > 0 && (
        <div className="flex items-center">
          <span className="inline-block w-3 h-3 bg-green-500 mr-1 rounded-sm"></span>
          <span>Current: {formatGB(outputSize)}</span>
        </div>
      )}
      
      {estSize && (
        <div className="flex items-center">
          <span className="inline-block w-3 h-3 bg-yellow-500 mr-1 rounded-sm"></span>
          <span>Est. Final: {formatGB(estSize)}</span>
        </div>
      )}
      
      {compressionPerc && (
        <div className="flex items-center">
          <span className={`font-semibold ${parseFloat(compressionPerc) > 0 ? 'text-green-400' : 'text-red-400'}`}>
            {parseFloat(compressionPerc) > 0 ? '↓' : '↑'} {Math.abs(parseFloat(compressionPerc))}%
          </span>
        </div>
      )}
    </div>
  )
}

// ResourceMeter component for displaying CPU/Memory usage
const ResourceMeter = ({ label, percentage, total, used }) => {
  const formattedPerc = parseFloat(percentage).toFixed(1)
  
  return (
    <div className="mr-4">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-200">{label}</span>
        <span className="text-xs font-medium text-gray-300">{formattedPerc}%</span>
      </div>
      <div className="w-full bg-gray-700 rounded-full h-1.5">
        <div 
          className={`h-1.5 rounded-full ${parseFloat(formattedPerc) > 80 ? 'bg-red-500' : parseFloat(formattedPerc) > 50 ? 'bg-yellow-500' : 'bg-green-500'}`}
          style={{ width: `${formattedPerc}%` }}
        ></div>
      </div>
      {total && (
        <div className="text-xs text-gray-400 mt-0.5">
          {used} / {total}
        </div>
      )}
    </div>
  )
}

// Component for individual worker task
const WorkerProgressBar = ({ worker, nodeName }) => {
  const { _id, file, percentage, status, workerType, fps, job, ETA, sourcefileSizeInGbytes, outputFileSizeInGbytes, estSize, originalfileSizeInGbytes, startTime, preset, CLIType } = worker
  const fileName = file.split('/').pop()
  const progressPercentage = Math.min(Math.max(percentage || 0, 0), 100)
  const statusColor = getStatusColor(status)
  
  // Calculate elapsed time
  const elapsedTime = startTime ? Math.floor((Date.now() - startTime) / 1000) : 0
  const hours = Math.floor(elapsedTime / 3600)
  const minutes = Math.floor((elapsedTime % 3600) / 60)
  const seconds = elapsedTime % 60
  const elapsedFormatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
  
  // Get estimated CLI command for tooltip
  const cliCommand = preset ? preset.split(' ').slice(0, 6).join(' ') + '...' : 'N/A'
  
  const [showDetails, setShowDetails] = useState(false)

  return (
    <div className="mb-6 last:mb-0 bg-slate-600 p-4 rounded-lg shadow-md">
      <div className="flex flex-wrap justify-between items-center mb-2">
        <div className="flex items-center">
          <WorkerTypeBadge workerType={workerType} />
          <h2
            className="text-sm sm:text-base font-semibold text-white cursor-pointer hover:underline"
            onClick={() => setShowDetails(!showDetails)}
            title={`Worker ID: ${_id}\nFile: ${file}\nNode: ${nodeName}\nJob type: ${job?.type || 'Unknown'}`}
          >
            <span className="block overflow-hidden overflow-ellipsis max-w-[250px] sm:max-w-[400px] md:max-w-[600px]">
              {fileName}
            </span>
          </h2>
        </div>
        <div className="text-right text-sm font-semibold text-white mt-1 sm:mt-0">
          {progressPercentage.toFixed(1)}%
        </div>
      </div>

      <div className="mb-2 text-sm text-gray-200 font-medium">
        <span className={`text-${statusColor}`}>
          {status || 'Processing'}
        </span>
      </div>

      <FileSizeComparison 
        sourceSize={sourcefileSizeInGbytes} 
        outputSize={outputFileSizeInGbytes} 
        estSize={estSize} 
      />

      <div className="flex flex-wrap justify-between mb-2 text-xs text-gray-300">
        <div className="flex items-center mr-4 mb-1">
          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"></path>
          </svg>
          Running: {elapsedFormatted}
        </div>
        {fps && (
          <div className="flex items-center mr-4 mb-1">
            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" d="M5 2a1 1 0 011 1v1h1a1 1 0 010 2H6v1a1 1 0 01-2 0V6H3a1 1 0 010-2h1V3a1 1 0 011-1zm0 10a1 1 0 011 1v1h1a1 1 0 110 2H6v1a1 1 0 11-2 0v-1H3a1 1 0 110-2h1v-1a1 1 0 011-1zM12 2a1 1 0 01.967.744L14.146 7.2 17.5 9.134a1 1 0 010 1.732l-3.354 1.935-1.18 4.455a1 1 0 01-1.933 0L9.854 12.8 6.5 10.866a1 1 0 010-1.732l3.354-1.935 1.18-4.455A1 1 0 0112 2z" clipRule="evenodd"></path>
            </svg>
            {fps} FPS
          </div>
        )}
        {ETA && (
          <div className="flex items-center mb-1">
            <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"></path>
            </svg>
            ETA: {ETA}
          </div>
        )}
      </div>

      {/* Progress bar */}
      <div className="relative">
        <div className="overflow-hidden h-2 mb-2 text-xs flex rounded-full bg-gray-700">
          <div
            style={{ width: `${progressPercentage}%` }}
            className={`shadow-none flex flex-col text-center whitespace-nowrap text-white justify-center bg-${statusColor} transition-all duration-300 ease-in-out`}
          ></div>
        </div>
      </div>

      {/* Detailed info (expandable) */}
      {showDetails && (
        <div className="mt-4 text-xs text-gray-300 bg-slate-700 p-2 rounded">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            <div>
              <div className="font-semibold mb-1">Worker Details</div>
              <div className="mb-1">ID: {_id}</div>
              <div className="mb-1">Type: {workerType}</div>
              <div className="mb-1">CLI: {CLIType || 'N/A'}</div>
            </div>
            <div>
              <div className="font-semibold mb-1">Job Details</div>
              <div className="mb-1">Job ID: {job?.jobId || 'N/A'}</div>
              <div className="mb-1">Start Time: {new Date(startTime).toLocaleString()}</div>
              <div className="mb-1">Type: {job?.type || 'N/A'}</div>
            </div>
            <div className="col-span-2 md:col-span-1">
              <div className="font-semibold mb-1">Command Preview</div>
              <div className="mb-1 truncate" title={preset}>
                {cliCommand}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Schedule Hour component to visualize hourly schedules
const ScheduleHour = ({ hour, data }) => {
  const { healthcheckcpu, healthcheckgpu, transcodecpu, transcodegpu } = data;
  const total = healthcheckcpu + healthcheckgpu + transcodecpu + transcodegpu;
  const isActive = total > 0;
  
  return (
    <div 
      className={`h-6 w-6 flex items-center justify-center text-[8px] rounded ${
        isActive ? 'bg-blue-700 text-white font-medium' : 'bg-gray-700 text-gray-500'
      }`}
      title={`${hour}:00 - ${parseInt(hour)+1}:00
CPU Transcode: ${transcodecpu}
GPU Transcode: ${transcodegpu}
CPU Health: ${healthcheckcpu}
GPU Health: ${healthcheckgpu}`}
    >
      {isActive ? total : ''}
    </div>
  );
};

// Schedule visualization component
const ScheduleVisualizer = ({ schedule }) => {
  if (!schedule || !schedule.length) return null;
  
  // Create an array of hours (00-23)
  const hours = Array.from({length: 24}, (_, i) => i.toString().padStart(2, '0'));
  
  // Create a mapping of hour ranges to schedule items
  const scheduleMap = {};
  schedule.forEach(item => {
    const hourRange = item._id;
    const [start] = hourRange.split('-');
    scheduleMap[start] = item;
  });
  
  return (
    <div className="mb-4 bg-slate-700 p-3 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">Schedule (24h)</h3>
        <div className="flex items-center text-xs text-gray-400">
          <span className="w-3 h-3 inline-block bg-blue-700 rounded mr-1"></span>
          <span className="mr-3">Active</span>
          <span className="w-3 h-3 inline-block bg-gray-700 rounded mr-1"></span>
          <span>Inactive</span>
        </div>
      </div>
      <div className="grid grid-cols-12 sm:grid-cols-24 gap-1">
        {hours.map(hour => (
          <ScheduleHour 
            key={hour} 
            hour={hour} 
            data={scheduleMap[hour] || { healthcheckcpu: 0, healthcheckgpu: 0, transcodecpu: 0, transcodegpu: 0 }}
          />
        ))}
      </div>
    </div>
  );
};

// Node card component
const NodeCard = ({ nodeId, nodeData }) => {
  const [expanded, setExpanded] = useState(false)
  const [showSchedule, setShowSchedule] = useState(false) // Keep schedule hidden by default
  const { 
    nodeName, config, workerLimits, workers = {}, 
    resStats, scheduleEnabled, nodePaused, 
    schedule, nodeTags, gpuSelect, allowGpuDoCpu
  } = nodeData
  
  // Get workers and count them by type
  const workersList = Object.values(workers)
  const workerCount = workersList.length
  
  const typeCount = {
    transcodecpu: workersList.filter(w => w.workerType === 'transcodecpu').length,
    transcodegpu: workersList.filter(w => w.workerType === 'transcodegpu').length,
    healthcheckcpu: workersList.filter(w => w.workerType === 'healthcheckcpu').length,
    healthcheckgpu: workersList.filter(w => w.workerType === 'healthcheckgpu').length,
  }
  
  // Group workers by type for easier UI organization
  const workersByType = {
    transcodecpu: workersList.filter(w => w.workerType === 'transcodecpu'),
    transcodegpu: workersList.filter(w => w.workerType === 'transcodegpu'),
    healthcheckcpu: workersList.filter(w => w.workerType === 'healthcheckcpu'),
    healthcheckgpu: workersList.filter(w => w.workerType === 'healthcheckgpu'),
  }
  
  // Order types by priority for display
  const orderedTypes = [
    'transcodegpu',
    'transcodecpu',
    'healthcheckgpu',
    'healthcheckcpu'
  ].filter(type => workersByType[type].length > 0)

  return (
    <div className="mb-6 bg-slate-800 rounded-lg shadow-lg overflow-hidden">
      {/* Node header */}
      <div 
        className={`p-4 flex items-center justify-between cursor-pointer ${nodePaused ? 'bg-red-900' : 'bg-slate-700'}`}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center">
          <svg 
            className={`w-5 h-5 mr-2 transform ${expanded ? 'rotate-0' : '-rotate-90'} transition-transform duration-200`}
            fill="none" 
            stroke="currentColor" 
            viewBox="0 0 24 24" 
            xmlns="http://www.w3.org/2000/svg"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
          </svg>
          <h2 className="text-lg font-bold text-white">{nodeName || 'Unnamed Node'}</h2>
          {nodePaused && <span className="ml-2 px-2 py-0.5 bg-red-700 text-white text-xs rounded-full">PAUSED</span>}
          {scheduleEnabled && <span className="ml-2 px-2 py-0.5 bg-blue-700 text-white text-xs rounded-full">SCHEDULED</span>}
        </div>
        
        <div className="flex items-center">
          {workerCount > 0 && (
            <div className="flex mr-4">
              {typeCount.transcodecpu > 0 && <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full mr-1">{typeCount.transcodecpu} CPU</span>}
              {typeCount.transcodegpu > 0 && <span className="bg-green-600 text-white text-xs px-2 py-1 rounded-full mr-1">{typeCount.transcodegpu} GPU</span>}
              {typeCount.healthcheckcpu > 0 && <span className="bg-yellow-600 text-white text-xs px-2 py-1 rounded-full mr-1">{typeCount.healthcheckcpu} HC</span>}
            </div>
          )}
          <span className="text-sm font-semibold text-gray-300">{nodeId}</span>
        </div>
      </div>
      
      {/* Node details */}
      {expanded && (
        <div className="p-4">
          {/* System resources */}
          {resStats && (
            <div className="mb-4 bg-slate-700 p-3 rounded-lg">
              <h3 className="text-sm font-semibold text-gray-300 mb-2">System Resources</h3>
              <div className="flex flex-wrap">
                {resStats.os && (
                  <>
                    <ResourceMeter 
                      label="CPU" 
                      percentage={resStats.os.cpuPerc} 
                    />
                    <ResourceMeter 
                      label="Memory" 
                      percentage={(resStats.os.memUsedGB / resStats.os.memTotalGB) * 100} 
                      used={`${parseFloat(resStats.os.memUsedGB).toFixed(1)} GB`}
                      total={`${parseFloat(resStats.os.memTotalGB).toFixed(1)} GB`}
                    />
                  </>
                )}
                {resStats.process && (
                  <div className="flex items-center text-xs text-gray-300">
                    <span className="mr-3">
                      <span className="font-medium">Uptime:</span> {Math.floor(resStats.process.uptime / 60 / 60)}h {Math.floor((resStats.process.uptime / 60) % 60)}m
                    </span>
                    <span>
                      <span className="font-medium">Heap:</span> {resStats.process.heapUsedMB}/{resStats.process.heapTotalMB} MB
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}
          
          {/* Node Configuration & Worker limits */}
          <div className="flex flex-wrap mb-4 gap-2">
            {workerLimits && (
              <div className="mb-2 bg-slate-700 p-3 rounded-lg flex-1 min-w-[280px]">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-gray-300">Worker Limits</h3>
                  {gpuSelect && gpuSelect !== "-" && (
                    <div className="px-2 py-0.5 bg-purple-700 text-white text-xs rounded-full">
                      GPU: {gpuSelect}
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="bg-blue-900 p-2 rounded">
                    <div className="text-xs text-gray-300">CPU Transcode</div>
                    <div className="text-lg font-bold text-white">{workerLimits.transcodecpu}</div>
                  </div>
                  <div className="bg-green-900 p-2 rounded">
                    <div className="text-xs text-gray-300">GPU Transcode</div>
                    <div className="text-lg font-bold text-white">{workerLimits.transcodegpu}</div>
                  </div>
                  <div className="bg-yellow-900 p-2 rounded">
                    <div className="text-xs text-gray-300">CPU Health</div>
                    <div className="text-lg font-bold text-white">{workerLimits.healthcheckcpu}</div>
                  </div>
                  <div className="bg-orange-900 p-2 rounded">
                    <div className="text-xs text-gray-300">GPU Health</div>
                    <div className="text-lg font-bold text-white">{workerLimits.healthcheckgpu}</div>
                  </div>
                </div>
                
                <div className="mt-2 flex flex-wrap gap-2">
                  {allowGpuDoCpu && (
                    <span className="text-xs text-gray-300 bg-gray-800 px-2 py-1 rounded">
                      GPU can process CPU tasks
                    </span>
                  )}
                  {nodeTags && (
                    <span className="text-xs text-gray-300 bg-gray-800 px-2 py-1 rounded" title="Node Tags">
                      Tags: {nodeTags || "None"}
                    </span>
                  )}
                </div>
              </div>
            )}
            
            {/* Schedule button and toggle */}
            {schedule && schedule.length > 0 && (
              <div className="flex-1 min-w-[280px]">
                <button
                  className="mb-2 bg-slate-700 hover:bg-slate-600 text-gray-300 text-sm font-medium py-2 px-4 rounded-lg focus:outline-none flex items-center w-full justify-between"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowSchedule(!showSchedule);
                  }}
                >
                  <span className="flex items-center">
                    <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd"></path>
                    </svg>
                    Node Schedule
                  </span>
                  <svg 
                    className={`w-4 h-4 transform transition-transform duration-200 ${showSchedule ? 'rotate-180' : ''}`}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24" 
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                  </svg>
                </button>
                
                {/* Schedule visualizer */}
                {showSchedule && <ScheduleVisualizer schedule={schedule} />}
              </div>
            )}
          </div>
          
          {/* Active workers */}
          {workerCount > 0 ? (
            <div>
              <h3 className="text-sm font-semibold text-gray-300 mb-2">Active Workers ({workerCount})</h3>
              
              {orderedTypes.map(type => (
                <div key={type} className="mb-4">
                  <h4 className="text-xs font-medium text-gray-400 mb-2 uppercase">
                    {type.replace('transcode', 'Transcode ').replace('healthcheck', 'Health Check ')}
                    ({workersByType[type].length})
                  </h4>
                  
                  {workersByType[type].map(worker => (
                    <WorkerProgressBar 
                      key={worker._id} 
                      worker={worker} 
                      nodeName={nodeName}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-gray-400 py-4">No active workers</div>
          )}
        </div>
      )}
    </div>
  )
}

const TdarrQueue = ({ data, onViewChange }) => {
  if (!data || Object.keys(data).length === 0) {
    return (
      <DashboardCard 
        title="Tdarr Queue" 
        icon={
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" />
          </svg>
        } 
        count={0}
      >
        <div className="flex items-center justify-center h-24 text-gray-500 dark:text-gray-400">
          No active transcoding jobs
        </div>
      </DashboardCard>
    )
  }
  
  // Get all nodes
  const nodeIds = Object.keys(data)
  const activeNodeCount = nodeIds.filter(id => 
    data[id].workers && Object.keys(data[id].workers).length > 0
  ).length
  
  // Count total active workers across all nodes
  const totalWorkers = nodeIds.reduce((total, id) => {
    return total + (data[id].workers ? Object.keys(data[id].workers).length : 0)
  }, 0)
  
  // Sort nodes by priority
  const sortedNodeIds = [...nodeIds].sort((a, b) => {
    // First sort by whether they have workers (nodes with workers come first)
    const aHasWorkers = data[a].workers && Object.keys(data[a].workers).length > 0
    const bHasWorkers = data[b].workers && Object.keys(data[b].workers).length > 0
    
    if (aHasWorkers && !bHasWorkers) return -1
    if (!aHasWorkers && bHasWorkers) return 1
    
    // Then sort by priority
    return (data[a].priority || 0) - (data[b].priority || 0)
  })

  return (
    <DashboardCard 
      title="Tdarr Queue" 
      icon={
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M3 5a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2h-2.22l.123.489.804.804A1 1 0 0113 18H7a1 1 0 01-.707-1.707l.804-.804L7.22 15H5a2 2 0 01-2-2V5zm5.771 7H5V5h10v7H8.771z" clipRule="evenodd" />
        </svg>
      } 
      count={totalWorkers}
      status={
        <div className="flex items-center space-x-3">
          <span>{activeNodeCount}/{nodeIds.length} Nodes</span>
          {onViewChange && (
            <button 
              onClick={onViewChange}
              className="bg-blue-500 hover:bg-blue-600 text-white text-xs px-2 py-0.5 rounded inline-flex items-center ml-3"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 mr-1" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
              </svg>
              Simple View
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-6">
        <div>
          {sortedNodeIds.map(nodeId => (
            <NodeCard 
              key={nodeId} 
              nodeId={nodeId}
              nodeData={data[nodeId]} 
            />
          ))}
        </div>
        
        {/* System summary */}
        <div className="mt-6 bg-slate-700 p-4 rounded-lg shadow-md">
          <h3 className="text-sm font-semibold text-white mb-2">System Summary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Transcode Status */}
            <div className="bg-slate-800 p-3 rounded-lg">
              <div className="text-xs text-gray-400 mb-1">Active Transcodes</div>
              <div className="text-xl font-bold text-white">{totalWorkers}</div>
              <div className="mt-2 text-xs text-gray-300">
                {Object.values(data).reduce((count, node) => {
                  const transcodeCpu = Object.values(node.workers || {}).filter(w => w.workerType === 'transcodecpu').length;
                  return count + transcodeCpu;
                }, 0)} CPU &nbsp;|&nbsp; 
                {Object.values(data).reduce((count, node) => {
                  const transcodeGpu = Object.values(node.workers || {}).filter(w => w.workerType === 'transcodegpu').length;
                  return count + transcodeGpu;
                }, 0)} GPU
              </div>
            </div>
            
            {/* Processing Stats */}
            <div className="bg-slate-800 p-3 rounded-lg">
              <div className="text-xs text-gray-400 mb-1">Processing</div>
              <div className="text-sm text-white">
                {Object.values(data).reduce((totalSize, node) => {
                  const workerSizes = Object.values(node.workers || {}).reduce((size, worker) => {
                    return size + (worker.sourcefileSizeInGbytes || 0);
                  }, 0);
                  return totalSize + workerSizes;
                }, 0).toFixed(1)} GB being processed
              </div>
              <div className="mt-2 text-xs text-gray-300">
                Average FPS: {(() => {
                  const fpsValues = [];
                  Object.values(data).forEach(node => {
                    Object.values(node.workers || {}).forEach(worker => {
                      if (worker.fps) fpsValues.push(parseInt(worker.fps));
                    });
                  });
                  return fpsValues.length > 0 
                    ? (fpsValues.reduce((sum, fps) => sum + fps, 0) / fpsValues.length).toFixed(1)
                    : 'N/A';
                })()}
              </div>
            </div>
            
            {/* Queue Summary */}
            <div className="bg-slate-800 p-3 rounded-lg">
              <div className="text-xs text-gray-400 mb-1">Queue Status</div>
              <div className="text-sm text-white">
                {Object.values(data).reduce((total, node) => {
                  const queueItems = node.queueLengths 
                    ? Object.values(node.queueLengths).reduce((sum, count) => sum + count, 0)
                    : 0;
                  return total + queueItems;
                }, 0)} items in queue
              </div>
              <div className="mt-2 text-xs text-gray-300">
                {Object.values(data).filter(node => node.nodePaused).length} paused nodes
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardCard>
  )
}

export default TdarrQueue
