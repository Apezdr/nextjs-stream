'use client'

import { useRef, useState, useEffect } from 'react'
import { secondsToTime } from '../utils/subtitleParser'

export default function SubtitleTimelineArea({
  subtitles = [],
  currentTime = 0,
  localTime = null, // Mini player position
  duration = 0,
  selectedSubtitles = [],
  searchResults = [],
  currentSearchIndex = null,
  onSelectSubtitle,
  onUpdateTiming,
  zoomLevel = 1,
  onSeek,
  editMode = 'select' // 'select', 'move', 'resize-start', 'resize-end'
}) {
  const timelineRef = useRef(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStartPosition, setDragStartPosition] = useState(null)
  const [dragType, setDragType] = useState(null) // 'move', 'start', 'end'
  const [dragSubtitle, setDragSubtitle] = useState(null)
  const [selectionBox, setSelectionBox] = useState(null)
  const [timelineWidth, setTimelineWidth] = useState(0)
  
  // Calculate the width of a second in pixels based on zoom level
  // In SubtitleEditorLayout.js, zoomLevel is actually the number of seconds to display
  // (e.g., 300 for 5 minutes)
  // We need to calculate a proper pixel-per-second value based on the container width
  const pixelsPerSecond = timelineWidth / zoomLevel; // How many pixels should represent 1 second
  
  // For regular zoom levels, we'll have constraints on the min/max pixels per second
  // But for "Fit All" (which is signaled by zoomLevel === duration), we'll allow any value
  let secondWidth;
  
  // Check if we're in "Fit All" mode
  const isFitAllMode = Math.abs(zoomLevel - duration) < 0.1;
  
  if (isFitAllMode) {
    // In "Fit All" mode, force the timeline to exactly fit the container width
    secondWidth = timelineWidth / duration;
  } else {
    // In normal zoom modes, apply reasonable constraints
    // But with looser minimum constraint to allow better zooming out
    secondWidth = Math.max(0.5, Math.min(pixelsPerSecond, 30)); 
  }
  
  // Calculate visible time range based on current scroll position
  const visibleTimeEnd = Math.min(duration, zoomLevel);
  
  // Calculate the total width needed
  const totalWidth = Math.min(duration * secondWidth, 100000); // Cap at 100,000px for performance
  
  // Convert time in seconds to X position
  const timeToPosition = (time) => {
    return time * secondWidth
  }
  
  // Convert X position to time in seconds
  const positionToTime = (x) => {
    return x / secondWidth
  }
  
  // Calculate row assignments based on actual overlaps and identify overlapping subtitles
  const calculateRowsAndOverlaps = (subtitles) => {
    // Sort subtitles by start time for optimal track assignment
    const sortedSubtitles = [...subtitles].sort((a, b) => a.startTime - b.startTime);
    
    const rowAssignments = {};
    const tracks = []; // Each track holds non-overlapping subtitles
    const overlappingIds = new Set(); // Track overlapping subtitle IDs
    const overlapDetails = {}; // Track which subtitles overlap with which
    
    // Find direct overlaps in the timeline
    for (let i = 0; i < sortedSubtitles.length - 1; i++) {
      for (let j = i + 1; j < sortedSubtitles.length; j++) {
        const current = sortedSubtitles[i];
        const next = sortedSubtitles[j];
        
        // Check if these subtitles overlap in time
        if (current.endTime > next.startTime) {
          overlappingIds.add(current.id);
          overlappingIds.add(next.id);
          
          // Record overlap details for tooltips
          if (!overlapDetails[current.id]) {
            overlapDetails[current.id] = [];
          }
          if (!overlapDetails[next.id]) {
            overlapDetails[next.id] = [];
          }
          
          overlapDetails[current.id].push({
            id: next.id,
            text: next.text,
            time: `${secondsToTime(next.startTime)} - ${secondsToTime(next.endTime)}`
          });
          
          overlapDetails[next.id].push({
            id: current.id,
            text: current.text,
            time: `${secondsToTime(current.startTime)} - ${secondsToTime(current.endTime)}`
          });
        } else {
          // Since the array is sorted by start time, if we don't overlap
          // with this subtitle, we won't overlap with any later ones
          break;
        }
      }
    }
    
    sortedSubtitles.forEach(subtitle => {
      // Find first track where this subtitle doesn't overlap with existing subtitles
      let trackIndex = tracks.findIndex(track => {
        const lastInTrack = track[track.length - 1];
        return lastInTrack.endTime <= subtitle.startTime;
      });
      
      if (trackIndex === -1) {
        // Need a new track - no existing track has space for this subtitle
        trackIndex = tracks.length;
        tracks[trackIndex] = [];
      }
      
      // Add subtitle to the track
      tracks[trackIndex].push(subtitle);
      
      // Assign the row for this subtitle ID
      rowAssignments[subtitle.id] = trackIndex;
    });
    
    return { 
      rowAssignments, 
      overlappingIds: Array.from(overlappingIds),
      overlapDetails 
    };
  };
  
  // Get row assignments, overlapping subtitle IDs, and overlap details
  const { rowAssignments, overlappingIds, overlapDetails } = calculateRowsAndOverlaps(subtitles);

  // Update timeline width on resize
  useEffect(() => {
    const updateWidth = () => {
      if (timelineRef.current) {
        setTimelineWidth(timelineRef.current.clientWidth)
      }
    }
    
    updateWidth()
    window.addEventListener('resize', updateWidth)
    
    return () => {
      window.removeEventListener('resize', updateWidth)
    }
  }, [])

  // Handle click on the timeline to seek
  const handleTimelineClick = (e) => {
    if (onSeek && !isDragging && dragType === null) {
      const rect = timelineRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const time = positionToTime(x)
      
      if (time >= 0 && time <= duration) {
        onSeek(time)
      }
    }
  }
  
  // Start of box selection
  const handleMouseDown = (e) => {
    // Only start box selection on the timeline itself, not on subtitle blocks
    if (e.target === timelineRef.current) {
      const rect = timelineRef.current.getBoundingClientRect()
      const startX = e.clientX - rect.left
      const startY = e.clientY - rect.top
      
      setSelectionBox({
        startX,
        startY,
        width: 0,
        height: 0
      })
    }
  }
  
  // Update selection box during mouse move
  const handleMouseMove = (e) => {
    if (selectionBox) {
      const rect = timelineRef.current.getBoundingClientRect()
      const currentX = e.clientX - rect.left
      const currentY = e.clientY - rect.top
      
      setSelectionBox(prev => ({
        ...prev,
        width: currentX - prev.startX,
        height: currentY - prev.startY
      }))
    }
    
    // Handle dragging of subtitle blocks
    if (isDragging && dragSubtitle && dragType) {
      e.preventDefault()
      const rect = timelineRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left
      const deltaX = x - dragStartPosition.x
      
      const timeDelta = positionToTime(deltaX)
      
      if (dragType === 'move') {
        // Move the entire subtitle (both start and end times)
        onUpdateTiming(dragSubtitle.id, timeDelta, timeDelta)
      } else if (dragType === 'start') {
        // Only adjust the start time
        onUpdateTiming(dragSubtitle.id, timeDelta, 0)
      } else if (dragType === 'end') {
        // Only adjust the end time
        onUpdateTiming(dragSubtitle.id, 0, timeDelta)
      }
      
      // Update drag start position for continuous dragging
      setDragStartPosition({ x, subtitle: dragSubtitle })
    }
  }
  
  // End box selection and select all subtitles inside the box
  const handleMouseUp = (e) => {
    if (selectionBox) {
      // Only process selection if we have an actual box (minimum size)
      if (Math.abs(selectionBox.width) > 5 && Math.abs(selectionBox.height) > 5) {
        // Calculate box boundaries, handling negative width/height properly
        const boxLeft = Math.min(selectionBox.startX, selectionBox.startX + selectionBox.width);
        const boxRight = Math.max(selectionBox.startX, selectionBox.startX + selectionBox.width);
        const startTime = positionToTime(boxLeft);
        const endTime = positionToTime(boxRight);
        
        // Find all subtitles that overlap with the selection box
        const boxSelectedIds = subtitles
          .filter(sub => {
            const subLeft = timeToPosition(sub.startTime);
            const subRight = timeToPosition(sub.endTime);
            
            // Check if any part of the subtitle overlaps with the selection
            return (
              (subLeft >= boxLeft && subLeft <= boxRight) || // Start is in box
              (subRight >= boxLeft && subRight <= boxRight) || // End is in box
              (subLeft <= boxLeft && subRight >= boxRight) // Spans the entire box
            );
          })
          .map(sub => sub.id);
        
        // Select all subtitles in box
        if (boxSelectedIds.length > 0 && onSelectSubtitle) {
          const isMultiSelect = e.ctrlKey || e.metaKey || e.shiftKey;
          
          if (!isMultiSelect) {
            // If not doing multi-select, clear previous selections first
            // but don't call onSelectSubtitle for each item as that causes selection issues
            
            // Select the first subtitle normally, which will clear previous selections
            if (boxSelectedIds.length > 0) {
              onSelectSubtitle(boxSelectedIds[0], false);
              
              // Then add the rest with multi-select enabled
              for (let i = 1; i < boxSelectedIds.length; i++) {
                onSelectSubtitle(boxSelectedIds[i], true); // true = multi-select
              }
            }
          } else {
            // In multi-select mode (Ctrl/Cmd/Shift is pressed)
            // Toggle the selection state for each subtitle in the box
            boxSelectedIds.forEach(id => {
              onSelectSubtitle(id, true); // true = multi-select
            });
          }
        }
      }
      
      setSelectionBox(null);
    }
    
    // End subtitle block dragging
    if (isDragging) {
      setIsDragging(false)
      setDragType(null)
      setDragSubtitle(null)
      setDragStartPosition(null)
    }
  }
  
  // Start dragging a subtitle block
  const startDrag = (e, subtitle, type) => {
    e.stopPropagation()
    
    // In select mode, just select the subtitle without starting a drag
    if (editMode === 'select') {
      if (onSelectSubtitle && !selectedSubtitles.includes(subtitle.id)) {
        onSelectSubtitle(subtitle.id, e.ctrlKey || e.metaKey)
      }
      return;
    }
    
    // Handle specific edit modes - only allow the operation if mode matches
    if ((editMode === 'resize-start' && type !== 'start') || 
        (editMode === 'resize-end' && type !== 'end') ||
        (editMode === 'move' && type !== 'move')) {
      return;
    }
    
    setIsDragging(true)
    setDragType(type)
    setDragSubtitle(subtitle)
    
    const rect = timelineRef.current.getBoundingClientRect()
    setDragStartPosition({
      x: e.clientX - rect.left,
      subtitle
    })
    
    // Also select this subtitle if it's not already selected
    if (onSelectSubtitle && !selectedSubtitles.includes(subtitle.id)) {
      onSelectSubtitle(subtitle.id, e.ctrlKey || e.metaKey)
    }
  }

  return (
    <div 
      className="relative overflow-x-auto overflow-y-hidden bg-gray-900 border border-gray-700 rounded h-full"
    >
      <div
        ref={timelineRef}
        className="relative h-full select-none"
        style={{
          width: `${totalWidth}px`,
          minWidth: '100%'
        }}
        onClick={handleTimelineClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {/* Time markers */}
        <div className="absolute top-0 left-0 w-full h-6 border-b border-gray-700 text-gray-400">
          {(() => {
            // Get tick configuration based on current zoom level
            const { 
              majorTickInterval, 
              minorTickInterval, 
              microTickInterval, 
              labelInterval 
            } = getTickConfiguration(zoomLevel);
            
            // Generate all ticks for the full duration
            const ticks = [];
            
            // Major ticks (with labels) - full height
            for (let t = 0; t <= duration; t += majorTickInterval) {
              ticks.push({
                second: t,
                type: 'major',
                showLabel: t % labelInterval === 0
              });
            }
            
            // Minor ticks - medium height
            if (minorTickInterval > 0) {
              for (let t = 0; t <= duration; t += minorTickInterval) {
                // Skip if this position already has a major tick
                if (t % majorTickInterval !== 0) {
                  ticks.push({
                    second: t,
                    type: 'minor',
                    showLabel: false
                  });
                }
              }
            }
            
            // Micro ticks - smallest height
            if (microTickInterval > 0) {
              for (let t = 0; t <= duration; t += microTickInterval) {
                // Skip if this position already has a major or minor tick
                if (t % majorTickInterval !== 0 && t % minorTickInterval !== 0) {
                  ticks.push({
                    second: t,
                    type: 'micro',
                    showLabel: false
                  });
                }
              }
            }
            
            // Sort ticks by time
            ticks.sort((a, b) => a.second - b.second);
            
            // Render all ticks
            return ticks.map((tick, i) => {
              const height = tick.type === 'major' ? 'h-full' : 
                          tick.type === 'minor' ? 'h-2/3' : 'h-1/3';
              
              const borderColor = tick.type === 'major' ? 'border-gray-400' : 
                               tick.type === 'minor' ? 'border-gray-600' : 'border-gray-700';
              
              return (
                <div 
                  key={i} 
                  className={`absolute top-0 ${height} ${borderColor} border-l text-xs`}
                  style={{ left: `${tick.second * secondWidth}px` }}
                >
                  {tick.showLabel && (
                    <span className="ml-1 text-gray-300">{formatTime(tick.second)}</span>
                  )}
                </div>
              );
            });
          })()}
        </div>

        {/* Subtitle blocks */}
        <div className="absolute top-6 left-0 w-full h-[calc(100%-24px)] py-1">
          {subtitles.map((subtitle, index) => {
            const left = timeToPosition(subtitle.startTime)
            const width = timeToPosition(subtitle.endTime - subtitle.startTime)
            const isSelected = selectedSubtitles.includes(subtitle.id)
            const isCurrent = subtitle.id === currentTime // Current subtitle based on playhead
            const isSearchResult = searchResults.includes(subtitle.id)
            const isCurrentSearchResult = subtitle.id === currentSearchIndex
            
            // Get row assignment based on overlap analysis
            const row = rowAssignments[subtitle.id] || 0;
            
            // Check if this subtitle overlaps with another
            const isOverlapping = overlappingIds.includes(subtitle.id);
            
            // Determine block color based on status
            let blockColorClass = isOverlapping ? 'bg-red-500 text-white' : 'bg-green-500 text-white'
            if (isSelected) {
              blockColorClass = 'bg-blue-500 text-white'
            } else if (isCurrent) {
              blockColorClass = 'bg-yellow-500 text-white'
            } else if (isSearchResult) {
              blockColorClass = 'bg-purple-500 text-white'
            }
            
            return (
              <div
                key={subtitle.id}
                className={`absolute h-8 rounded-md flex items-center px-1 text-xs whitespace-nowrap overflow-hidden transition-all ${
                  blockColorClass
                } ${
                  isCurrentSearchResult ? 'ring-2 ring-white ring-opacity-70' : ''
                } ${isDragging && dragSubtitle?.id === subtitle.id ? 'opacity-70' : 'opacity-100'}`}
                style={{
                  left: `${left}px`,
                  width: `${Math.max(width, Math.min(50, 30 / zoomLevel))}px`,
                  top: `${row * 32 + 4}px`, // Increased spacing between rows
                  border: isSelected ? '2px solid white' : 
                         isCurrent ? '2px solid yellow' : 
                         isOverlapping ? '2px solid red' : 'none',
                  cursor: editMode === 'select' ? 'pointer' : 'move'
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onSelectSubtitle) {
                    // Always use multi-select when modifier keys are pressed
                    const isMultiSelect = e.ctrlKey || e.metaKey || e.shiftKey;
                    onSelectSubtitle(subtitle.id, isMultiSelect);
                  }
                }}
                onMouseDown={(e) => startDrag(e, subtitle, 'move')}
                title={
                  isOverlapping 
                    ? `⚠️ OVERLAPPING SUBTITLE ⚠️\n${secondsToTime(subtitle.startTime)} - ${secondsToTime(subtitle.endTime)}\n${subtitle.text}\n\nOverlaps with:\n${overlapDetails[subtitle.id]?.map(overlap => `• "${overlap.text}" (${overlap.time})`).join('\n') || 'Unknown'}`
                    : `${secondsToTime(subtitle.startTime)} - ${secondsToTime(subtitle.endTime)}\n${subtitle.text}`
                }
              >
                {/* Resize handle - left */}
                <div
                  className={`absolute left-0 top-0 h-full w-2 ${editMode === 'select' || editMode === 'resize-start' ? 'cursor-w-resize' : 'cursor-not-allowed'}`}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    startDrag(e, subtitle, 'start')
                  }}
                />
                
                {/* Text content */}
                <div className="w-full overflow-hidden text-ellipsis">
                  {subtitle.text}
                </div>
                
                {/* Resize handle - right */}
                <div
                  className={`absolute right-0 top-0 h-full w-2 ${editMode === 'select' || editMode === 'resize-end' ? 'cursor-e-resize' : 'cursor-not-allowed'}`}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    startDrag(e, subtitle, 'end')
                  }}
                />
              </div>
            )
          })}
        </div>

        {/* Main video Playhead indicator */}
        <div 
          className="absolute top-0 h-full w-0.5 bg-red-500 z-40 pointer-events-none"
          style={{ left: `${timeToPosition(currentTime)}px` }}
        >
          <div className="w-3 h-3 rounded-full bg-red-500 -ml-1.5 -mt-1"></div>
        </div>

        {/* Mini player Playhead indicator (only shown if localTime differs from currentTime) */}
        {localTime !== null && Math.abs(localTime - currentTime) > 0.1 && (
          <div 
            className="absolute top-0 h-full w-0.5 bg-blue-500 z-40 pointer-events-none"
            style={{ left: `${timeToPosition(localTime)}px` }}
          >
            <div className="w-3 h-3 rounded-full bg-blue-500 -ml-1.5 -mt-1"></div>
          </div>
        )}

        {/* Selection box */}
        {selectionBox && (
          <div
            className="absolute border border-blue-500 bg-blue-200 bg-opacity-30 pointer-events-none z-50"
            style={{
              left: `${selectionBox.startX}px`,
              top: `${selectionBox.startY}px`,
              width: `${selectionBox.width}px`,
              height: `${selectionBox.height}px`
            }}
          />
        )}
        
        {/* Timeline ruler - bottom part */}
        <div className="absolute bottom-0 left-0 w-full h-6 border-t border-gray-700 flex items-center">
          <div className="text-xs text-gray-500 ml-2">
            {duration > 0 ? `Total: ${secondsToTime(duration)}` : 'No duration data'}
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper function to format time as MM:SS
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * Get tick configuration based on zoom level
 * Returns intervals for major, minor, and micro ticks, plus label interval
 */
function getTickConfiguration(zoomLevel) {
  // Default configuration - will be overridden based on zoom level
  let config = {
    majorTickInterval: 60,   // Every minute
    minorTickInterval: 10,   // Every 10 seconds
    microTickInterval: 0,    // No micro ticks
    labelInterval: 60        // Labels every minute
  };
  
  // ≤30s zoom: Major every 5s, minor every 1s, micro every 0.1s
  if (zoomLevel <= 30) {
    config = {
      majorTickInterval: 5,     // Every 5 seconds
      minorTickInterval: 1,     // Every second
      microTickInterval: 0.1,   // Every 100ms (frame-level precision)
      labelInterval: 5          // Labels every 5 seconds
    };
  }
  // 30s-2m zoom: Major every 30s, minor every 10s
  else if (zoomLevel <= 120) {
    config = {
      majorTickInterval: 30,    // Every 30 seconds
      minorTickInterval: 10,    // Every 10 seconds
      microTickInterval: 5,     // Every 5 seconds
      labelInterval: 30         // Labels every 30 seconds
    };
  }
  // 2-5m zoom: Major every 1min, minor every 30s, micro every 10s
  else if (zoomLevel <= 300) {
    config = {
      majorTickInterval: 60,    // Every minute
      minorTickInterval: 30,    // Every 30 seconds
      microTickInterval: 10,    // Every 10 seconds
      labelInterval: 60         // Labels every minute
    };
  }
  // 5-15m zoom: Major every 5min, minor every 1min
  else if (zoomLevel <= 900) {
    config = {
      majorTickInterval: 300,   // Every 5 minutes
      minorTickInterval: 60,    // Every minute
      microTickInterval: 30,    // Every 30 seconds
      labelInterval: 300        // Labels every 5 minutes
    };
  }
  // 15m+ zoom: Major every 15min, minor every 5min
  else if (zoomLevel <= 3600) {
    config = {
      majorTickInterval: 900,   // Every 15 minutes
      minorTickInterval: 300,   // Every 5 minutes
      microTickInterval: 60,    // Every minute
      labelInterval: 900        // Labels every 15 minutes
    };
  }
  // 1h+ zoom: Major every 30min, minor every 10min
  else {
    config = {
      majorTickInterval: 1800,  // Every 30 minutes
      minorTickInterval: 600,   // Every 10 minutes
      microTickInterval: 300,   // Every 5 minutes
      labelInterval: 1800       // Labels every 30 minutes
    };
  }
  
  return config;
}
