'use client'

import { useState } from 'react'
import { MaterialCard, MaterialCardHeader, MaterialCardContent, MaterialButton, StatusBadge } from './BaseComponents'

/**
 * Enhanced Queue Dashboard component with Material Design styling
 */
const EnhancedQueueDashboard = ({ 
  sabnzbdQueue, 
  radarrQueue, 
  sonarrQueue, 
  tdarrQueue,
  unsupportedQueues = []
}) => {
  const [showDetailedTdarr, setShowDetailedTdarr] = useState(false)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Media Processing Queues</h2>
        <StatusBadge status="info" size="small">
          Live Monitoring
        </StatusBadge>
      </div>

      {/* Queue cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {/* SABNZBD Download Status */}
        {sabnzbdQueue && (
          <QueueCard
            title="Download Status"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
              </svg>
            }
            status={sabnzbdQueue?.queue?.status}
            data={sabnzbdQueue.queue}
            type="download"
          />
        )}
        
        {/* Radarr Queue */}
        {radarrQueue && (
          <QueueCard
            title="Radarr Queue"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4V2a1 1 0 011-1h8a1 1 0 011 1v2m-9 0h10l1 14H6L7 4z" />
              </svg>
            }
            data={radarrQueue}
            type="radarr"
          />
        )}
        
        {/* Sonarr Queue */}
        {sonarrQueue && (
          <QueueCard
            title="Sonarr Queue"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
            }
            data={sonarrQueue}
            type="sonarr"
          />
        )}
        
        {/* Tdarr Queue */}
        {tdarrQueue && (
          <QueueCard
            title="Tdarr Queue"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
            data={tdarrQueue}
            type="tdarr"
            onToggleDetailed={() => setShowDetailedTdarr(!showDetailedTdarr)}
            showDetailed={showDetailedTdarr}
          />
        )}
      </div>

      {/* Detailed Tdarr view when toggled */}
      {tdarrQueue && showDetailedTdarr && (
        <MaterialCard elevation="medium">
          <MaterialCardHeader
            title="Tdarr Detailed View"
            subtitle="Complete transcoding queue information"
            action={
              <MaterialButton
                variant="outlined"
                size="small"
                onClick={() => setShowDetailedTdarr(false)}
              >
                Collapse
              </MaterialButton>
            }
          />
          <MaterialCardContent>
            <div className="text-sm text-gray-600">
              Detailed Tdarr information would be rendered here...
            </div>
          </MaterialCardContent>
        </MaterialCard>
      )}
    </div>
  )
}

/**
 * Individual Queue Card Component
 */
const QueueCard = ({ title, icon, status, data, type, onToggleDetailed, showDetailed }) => {
  const getQueueStatus = () => {
    if (type === 'download') {
      return data?.status?.toLowerCase() === 'paused' ? 'warning' : 'success'
    }
    if (type === 'radarr' || type === 'sonarr') {
      return data?.length > 0 ? 'warning' : 'success'
    }
    if (type === 'tdarr') {
      return data?.fileArr?.length > 0 ? 'info' : 'success'
    }
    return 'neutral'
  }

  const getQueueCount = () => {
    if (type === 'download') {
      return data?.jobs?.length || 0
    }
    if (type === 'radarr' || type === 'sonarr') {
      return data?.length || 0
    }
    if (type === 'tdarr') {
      return data?.fileArr?.length || 0
    }
    return 0
  }

  const queueStatus = getQueueStatus()
  const queueCount = getQueueCount()

  return (
    <MaterialCard elevation="low" className="h-full">
      <MaterialCardHeader
        title={title}
        icon={icon}
        action={
          <div className="flex items-center space-x-2">
            <StatusBadge
              status={queueStatus}
              size="small"
              variant="soft"
            >
              {queueCount}
            </StatusBadge>
            {type === 'tdarr' && onToggleDetailed && (
              <MaterialButton
                variant="text"
                size="small"
                onClick={onToggleDetailed}
              >
                {showDetailed ? 'Less' : 'More'}
              </MaterialButton>
            )}
          </div>
        }
      />
      <MaterialCardContent>
        {type === 'download' && (
          <DownloadQueueContent data={data} />
        )}
        {(type === 'radarr' || type === 'sonarr') && (
          <ArrQueueContent data={data} type={type} />
        )}
        {type === 'tdarr' && (
          <TdarrQueueContent data={data} />
        )}
      </MaterialCardContent>
    </MaterialCard>
  )
}

/**
 * Download Queue Content
 */
const DownloadQueueContent = ({ data }) => {
  if (!data?.jobs?.length) {
    return (
      <div className="text-center py-4">
        <div className="text-gray-400 text-sm">No active downloads</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {data.jobs.slice(0, 3).map((job, index) => (
        <div key={index} className="bg-gray-50 rounded-md p-3">
          <div className="font-medium text-sm text-gray-900 truncate">
            {job.filename || 'Unknown'}
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-gray-500">
              {job.percentage}% complete
            </span>
            <span className="text-xs text-gray-500">
              {job.size}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1 mt-2">
            <div 
              className="bg-blue-500 h-1 rounded-full transition-all duration-300"
              style={{ width: `${job.percentage || 0}%` }}
            />
          </div>
        </div>
      ))}
      {data.jobs.length > 3 && (
        <div className="text-center text-xs text-gray-500">
          +{data.jobs.length - 3} more items
        </div>
      )}
    </div>
  )
}

/**
 * Arr Queue Content (Radarr/Sonarr)
 */
const ArrQueueContent = ({ data, type }) => {
  if (!data?.length) {
    return (
      <div className="text-center py-4">
        <div className="text-gray-400 text-sm">No active downloads</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {data.slice(0, 3).map((item, index) => (
        <div key={index} className="bg-gray-50 rounded-md p-3">
          <div className="font-medium text-sm text-gray-900 truncate">
            {item.title || 'Unknown'}
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-xs text-gray-500">
              {item.status || 'Processing'}
            </span>
            {item.estimatedCompletionTime && (
              <span className="text-xs text-gray-500">
                ETA: {new Date(item.estimatedCompletionTime).toLocaleTimeString()}
              </span>
            )}
          </div>
          {item.progress !== undefined && (
            <div className="w-full bg-gray-200 rounded-full h-1 mt-2">
              <div 
                className="bg-orange-500 h-1 rounded-full transition-all duration-300"
                style={{ width: `${item.progress || 0}%` }}
              />
            </div>
          )}
        </div>
      ))}
      {data.length > 3 && (
        <div className="text-center text-xs text-gray-500">
          +{data.length - 3} more items
        </div>
      )}
    </div>
  )
}

/**
 * Tdarr Queue Content
 */
const TdarrQueueContent = ({ data }) => {
  if (!data?.fileArr?.length) {
    return (
      <div className="text-center py-4">
        <div className="text-gray-400 text-sm">No files in queue</div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-gray-500">Files:</span>
          <span className="ml-2 font-medium">{data.fileArr.length}</span>
        </div>
        <div>
          <span className="text-gray-500">Health:</span>
          <span className="ml-2 font-medium">{data.healthCheck || 'Good'}</span>
        </div>
      </div>
      
      {data.fileArr.slice(0, 2).map((file, index) => (
        <div key={index} className="bg-gray-50 rounded-md p-3">
          <div className="font-medium text-sm text-gray-900 truncate">
            {file.fileName || 'Unknown'}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {file.container || 'Unknown format'} • {file.fileSize || 'Unknown size'}
          </div>
        </div>
      ))}
      
      {data.fileArr.length > 2 && (
        <div className="text-center text-xs text-gray-500">
          +{data.fileArr.length - 2} more files
        </div>
      )}
    </div>
  )
}

export default EnhancedQueueDashboard