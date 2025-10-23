'use client'

import { useRef, useState, useEffect } from 'react'
import { secondsToTime } from '../utils/subtitleParser'

export default function SubtitleTimeline({
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
  height = '150px',
  currentSubtitleId,
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
  // Use a scaled approach for better zoom control over long duration content
  const secondWidth = Math.max(2, Math.min(100 * zoomLevel, 200)) // Min 2px, max 200px per second
  
  // Get the total timeline width
  const totalWidth = Math.max(timelineWidth, duration * secondWidth)
  
  // Convert time in seconds to X position
  const timeToPosition = (time) => {
    return time * secondWidth
  }
  
  // Convert X position to time in seconds
  const positionToTime = (x) => {
    return x / secondWidth
  }

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
            
            // Clear current selected subtitles state
            // and then set all new selected subtitles at once
            let newSelections = [...boxSelectedIds];
            setSelectedSubtitles(newSelections);
            
            // Actually update the parent component's selection
            // with a single call rather than multiple calls
            // Select the first subtitle normally, which will clear previous selections
            if (newSelections.length > 0) {
              onSelectSubtitle(newSelections[0], false);
              
              // Then add the rest with multi-select enabled
              for (let i = 1; i < newSelections.length; i++) {
                onSelectSubtitle(newSelections[i], true); // true = multi-select
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
      className="relative overflow-x-auto overflow-y-hidden bg-gray-900 border border-gray-700 rounded"
      style={{ height }}
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
          {Array.from({ length: Math.ceil(duration) + 1 }).map((_, i) => (
            <div 
              key={i} 
              className={`absolute top-0 h-full ${i % 60 === 0 ? 'border-l border-gray-500' : 'border-l border-gray-700'} text-xs`}
              style={{ left: `${i * secondWidth}px` }}
            >
              {i % 10 === 0 && (
                <span className="ml-1">{formatTime(i)}</span>
              )}
            </div>
          ))}
        </div>

        {/* Subtitle blocks */}
        <div className="absolute top-6 left-0 w-full h-[calc(100%-24px)] py-1">
          {subtitles.map((subtitle, index) => {
            const left = timeToPosition(subtitle.startTime)
            const width = timeToPosition(subtitle.endTime - subtitle.startTime)
            const isSelected = selectedSubtitles.includes(subtitle.id)
            const row = index % 3 // Distribute across 3 rows to avoid overlap
            
            return (
              <div
                key={subtitle.id}
                className={`absolute h-8 rounded-md flex items-center px-1 text-xs whitespace-nowrap overflow-hidden transition-all ${
                  isSelected ? 'bg-blue-500 text-white z-30' : 
                  subtitle.id === currentSubtitleId ? 'bg-yellow-500 text-white z-25' : 
                  searchResults.includes(subtitle.id) ? 'bg-purple-500 text-white z-22' :
                  'bg-green-500 text-white z-20'
                } ${
                  subtitle.id === currentSearchIndex ? 'ring-2 ring-white ring-opacity-70' : ''
                } ${isDragging && dragSubtitle?.id === subtitle.id ? 'opacity-70' : 'opacity-100'}`}
                style={{
                  left: `${left}px`,
                  width: `${Math.max(width, Math.min(50, 30 / zoomLevel))}px`,
                  top: `${row * 30 + 4}px`,
                  border: isSelected ? '2px solid white' : 
                         subtitle.id === currentSubtitleId ? '2px solid yellow' : 'none',
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
                title={`${secondsToTime(subtitle.startTime)} - ${secondsToTime(subtitle.endTime)}\n${subtitle.text}`}
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
