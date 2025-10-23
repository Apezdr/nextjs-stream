'use client'

import { useState, useEffect } from 'react'

// Helper function to format time range for display
function formatTimeRange(seconds) {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  } else if (seconds < 3600) {
    return `${Math.round(seconds / 60)}m`
  } else {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.round((seconds % 3600) / 60)
    return `${hours}h ${mins}m`
  }
}

export default function SubtitleControls({
  zoomLevel,
  setZoomLevel,
  selectedCount,
  onShiftAll,
  onShiftSelected,
  onShiftRelative,
  duration,
  onSetZoomForTimeRange
}) {
  const [globalOffset, setGlobalOffset] = useState('')
  const [selectedOffset, setSelectedOffset] = useState('')
  const [relativeOffset, setRelativeOffset] = useState('')
  const [direction, setDirection] = useState('after')
  const [inclusion, setInclusion] = useState('including')

  // In our new system, zoomLevel is seconds to display (not a multiplier)
  const handleZoomIn = () => {
    // Zoom in = decrease the visible time range by 25%
    setZoomLevel(prev => Math.max(prev * 0.75, 10)) // Minimum 10 seconds
  }

  const handleZoomOut = () => {
    // Zoom out = increase the visible time range by 33%
    setZoomLevel(prev => Math.min(prev * 1.33, duration || 7200)) // Maximum is duration or 2 hours
  }

  const handleFitAll = () => {
    // We need to calculate the right zoom level that will make the entire timeline visible
    // without scrolling. This will depend on the container width.
    
    // Get the container element
    const timelineContainer = document.querySelector('[class*="overflow-x-auto"]');
    if (!timelineContainer || !duration) {
      // Fallback to default value if we can't determine container width
      setZoomLevel(duration || 300);
      return;
    }
    
    // Get the available width in pixels
    const containerWidth = timelineContainer.clientWidth;
    
    // In SubtitleTimelineArea, we calculate:
    // pixelsPerSecond = containerWidth / zoomLevel
    // We want to set zoomLevel so that duration * pixelsPerSecond = containerWidth
    // This means: zoomLevel = duration (containerWidth / containerWidth) = duration
    
    // But there's a constraint in SubtitleTimelineArea:
    // secondWidth = Math.max(2, Math.min(pixelsPerSecond, 30))
    // For very long videos, pixelsPerSecond might be < 2, causing the minimum to kick in
    
    // Calculate the minimum zoomLevel needed to fit the full duration
    // If containerWidth / zoomLevel < 2, then secondWidth will be 2
    // In that case, we need total timeline width = duration * 2 = containerWidth
    // So zoomLevel = containerWidth / 2
    
    // Desired pixels per second to fit perfectly
    const desiredPixelsPerSecond = containerWidth / duration;
    
    if (desiredPixelsPerSecond < 2) {
      // If the desired pixelsPerSecond is below 2, we need to adjust zoomLevel
      // to avoid the minimum constraint causing overflow
      setZoomLevel(containerWidth / 2);
    } else if (desiredPixelsPerSecond > 30) {
      // If the desired pixelsPerSecond is above 30, we need to adjust zoomLevel
      // to avoid the maximum constraint causing underflow
      setZoomLevel(containerWidth / 30);
    } else {
      // In this case, setting zoomLevel = duration will work perfectly
      setZoomLevel(duration);
    }
  }

  const handleGlobalShift = () => {
    if (globalOffset && onShiftAll) {
      onShiftAll(parseFloat(globalOffset))
      setGlobalOffset('')
    }
  }

  const handleSelectedShift = () => {
    if (selectedOffset && onShiftSelected) {
      onShiftSelected(parseFloat(selectedOffset))
      setSelectedOffset('')
    }
  }
  
  const handleRelativeShift = () => {
    if (relativeOffset && onShiftRelative) {
      onShiftRelative(parseFloat(relativeOffset), direction, inclusion)
      setRelativeOffset('')
    }
  }

  // Preset time adjustments in seconds
  const presets = [
    { label: '-1s', value: -1 },
    { label: '-500ms', value: -0.5 },
    { label: '-100ms', value: -0.1 },
    { label: '+100ms', value: 0.1 },
    { label: '+500ms', value: 0.5 },
    { label: '+1s', value: 1 }
  ]

  return (
    <div className="bg-gray-800 p-4 rounded text-white">
      <div className="flex flex-wrap gap-4">
        {/* Zoom Controls */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Zoom:</span>
          <button 
            onClick={handleZoomOut}
            className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
            disabled={zoomLevel >= duration} // Can't zoom out further than full duration
          >
            <span className="text-lg">−</span>
          </button>
          
          <div className="text-sm min-w-[80px] text-center">
            {formatTimeRange(zoomLevel)}
          </div>
          
          <button 
            onClick={handleZoomIn}
            className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded"
            disabled={zoomLevel <= 10} // Can't zoom in further than 10 seconds
          >
            <span className="text-lg">+</span>
          </button>
          
          <button 
            onClick={() => onSetZoomForTimeRange('fit')}
            className="bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded text-sm ml-2"
          >
            Fit All
          </button>
          
          {/* Time range presets */}
          <div className="flex gap-1 ml-2">
            
            <button 
              onClick={() => onSetZoomForTimeRange(0.3)}
              className="bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded text-xs"
              title="Show 30 seconds"
            >
              30s
            </button>
            <button 
              onClick={() => onSetZoomForTimeRange(1)}
              className="bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded text-xs"
              title="Show 1 minute"
            >
              1m
            </button>
            <button 
              onClick={() => onSetZoomForTimeRange(2)}
              className="bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded text-xs"
              title="Show 2 minutes"
            >
              2m
            </button>
            <button 
              onClick={() => onSetZoomForTimeRange(5)}
              className="bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded text-xs"
              title="Show 5 minutes"
            >
              5m
            </button>
            <button 
              onClick={() => onSetZoomForTimeRange(15)}
              className="bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded text-xs"
              title="Show 15 minutes"
            >
              15m
            </button>
            <button 
              onClick={() => onSetZoomForTimeRange(30)}
              className="bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded text-xs"
              title="Show 30 minutes"
            >
              30m
            </button>
            <button 
              onClick={() => onSetZoomForTimeRange(60)}
              className="bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded text-xs"
              title="Show 1 hour"
            >
              1h
            </button>
            <button 
              onClick={() => onSetZoomForTimeRange(120)}
              className="bg-indigo-600 hover:bg-indigo-700 px-2 py-1 rounded text-xs"
              title="Show 2 hours"
            >
              2h
            </button>
          </div>
        </div>

        <div className="h-6 border-l border-gray-600 mx-2"></div>

        {/* Global Shift Controls */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-400">Shift All:</span>
          <div className="flex gap-1">
            {presets.map(preset => (
              <button
                key={preset.label}
                onClick={() => onShiftAll(preset.value)}
                className={`px-2 py-1 rounded text-xs ${
                  preset.value < 0 ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input
            type="number"
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 w-20 text-sm"
            placeholder="seconds"
            value={globalOffset}
            onChange={(e) => setGlobalOffset(e.target.value)}
            step="0.1"
          />
          <button
            onClick={handleGlobalShift}
            className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
            disabled={!globalOffset}
          >
            Apply
          </button>
        </div>
      </div>

      {/* Selected Subtitles Controls */}
      {selectedCount > 0 && (
        <div className="mt-4 flex items-center gap-2">
          <span className="text-sm text-gray-400">Selected ({selectedCount}):</span>
          <div className="flex gap-1">
            {presets.map(preset => (
              <button
                key={`selected-${preset.label}`}
                onClick={() => onShiftSelected(preset.value)}
                className={`px-2 py-1 rounded text-xs ${
                  preset.value < 0 ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input
            type="number"
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 w-20 text-sm"
            placeholder="seconds"
            value={selectedOffset}
            onChange={(e) => setSelectedOffset(e.target.value)}
            step="0.1"
          />
          <button
            onClick={handleSelectedShift}
            className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
            disabled={!selectedOffset}
          >
            Apply
          </button>
        </div>
      )}
      
      {/* Relative Shifting Controls (before/after selected) */}
      {selectedCount > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-400">Shift cues:</span>
          
          <div className="flex items-center gap-2">
            <select 
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
            >
              <option value="before">Before</option>
              <option value="after">After</option>
            </select>
            
            <select 
              className="bg-gray-700 border border-gray-600 rounded px-2 py-1 text-sm"
              value={inclusion}
              onChange={(e) => setInclusion(e.target.value)}
            >
              <option value="including">Including</option>
              <option value="excluding">Excluding</option>
            </select>
            
            <span className="text-sm text-gray-400">selected:</span>
          </div>
          
          <div className="flex gap-1">
            {presets.map(preset => (
              <button
                key={`relative-${preset.label}`}
                onClick={() => onShiftRelative(preset.value, direction, inclusion)}
                className={`px-2 py-1 rounded text-xs ${
                  preset.value < 0 ? 'bg-yellow-600 hover:bg-yellow-700' : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <input
            type="number"
            className="bg-gray-700 border border-gray-600 rounded px-2 py-1 w-20 text-sm"
            placeholder="seconds"
            value={relativeOffset}
            onChange={(e) => setRelativeOffset(e.target.value)}
            step="0.1"
          />
          <button
            onClick={handleRelativeShift}
            className="bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded text-sm"
            disabled={!relativeOffset}
          >
            Apply
          </button>
        </div>
      )}
    </div>
  )
}
