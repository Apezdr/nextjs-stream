'use client'

import React, { useMemo } from 'react'
import { secondsToTimeCached } from '../utils/timeFormat'

export default function SubtitleInspector({
  subtitles,
  selectedSubtitles,
  onSelectSubtitle,
  setSelectedSubtitles,
  updateSubtitleText,
  updateSubtitleTiming,
  currentTime,
  onDeleteSubtitle,
  onSplitSubtitle,
  onAddSubtitle
}) {
  // If no subtitle is selected, or multiple are selected, show a different UI
  if (selectedSubtitles.length === 0) {
    return (
      <div className="w-72 bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden">
        <div className="bg-gray-800 p-3 border-b border-gray-700">
          <h3 className="text-white font-semibold text-sm">Inspector</h3>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center p-4 text-center">
          <p className="text-gray-400 mb-4">
            Select a subtitle to edit its properties
          </p>
          <button
            className="bg-green-600 hover:bg-green-700 text-white text-sm py-2 px-4 rounded flex items-center gap-2"
            onClick={() => onAddSubtitle && onAddSubtitle(currentTime)}
            title="Add a new subtitle at the current playback position"
          >
            <span>+</span>
            Add at Marker
          </button>
          <div className="text-xs text-gray-500 mt-2">
            Position: {secondsToTimeCached(currentTime)}
          </div>
        </div>
      </div>
    );
  }

  // If multiple subtitles are selected, show a multi-select UI
  if (selectedSubtitles.length > 1) {
    return (
      <div className="w-72 bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden">
        <div className="bg-gray-800 p-3 border-b border-gray-700 flex justify-between items-center">
          <h3 className="text-white font-semibold text-sm">Multiple Selection</h3>
          <div className="text-xs text-blue-300 font-mono">
            {selectedSubtitles.length} items
          </div>
        </div>
        <div className="p-4">
          <div className="bg-gray-800 rounded p-3 mb-3">
            <div className="text-xs text-gray-400 mb-1">Batch Operations</div>
            <div className="flex flex-col gap-2">
              <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm py-1.5 px-3 rounded">
                Shift Selected Subtitles
              </button>
              <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm py-1.5 px-3 rounded">
                Delete Selected
              </button>
            </div>
          </div>
          
          <div className="text-xs text-gray-400 mb-2">Selected Subtitles</div>
          <div className="bg-gray-800 rounded p-1 max-h-60 overflow-y-auto">
            {selectedSubtitles.map(id => {
              const subtitle = subtitles.find(sub => sub.id === id);
              if (!subtitle) return null;
              
              return (
                <div key={id} className="text-sm text-white p-2 hover:bg-gray-700 rounded">
                  <div className="text-xs text-gray-400 font-mono">
                    {secondsToTimeCached(subtitle.startTime)} - {secondsToTimeCached(subtitle.endTime)}
                  </div>
                  <div className="truncate">
                    {subtitle.text}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // Precompute Maps for fast lookups
  const subtitleById = useMemo(() => 
    new Map(subtitles.map(s => [s.id, s])),
    [subtitles]
  );
  
  // Single subtitle editing UI
  const subtitle = subtitleById.get(selectedSubtitles[0]);
  if (!subtitle) return null;
  
  const duration = subtitle.endTime - subtitle.startTime;
  const durationLabel = useMemo(() => 
    (Math.round(duration * 10) / 10).toFixed(1) + 's', 
    [duration]
  );

  // Precompute range for the progress bars
  const range = useMemo(() => 
    Math.max(1, currentTime + 60),
    [currentTime]
  );
  
  return (
    <div className="w-72 bg-gray-900 border-l border-gray-700 flex flex-col overflow-hidden">
      <div className="bg-gray-800 p-3 border-b border-gray-700 flex justify-between items-center">
        <h3 className="text-white font-semibold text-sm">Inspector</h3>
        <button 
          className="bg-gray-700 hover:bg-gray-600 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
          onClick={() => setSelectedSubtitles([])}
          title="Close inspector"
        >
          ×
        </button>
      </div>
      
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          {/* Time Controls */}
          <div className="bg-gray-800 rounded-lg p-3 mb-4">
            <h4 className="text-white text-sm font-semibold mb-3">Timing</h4>
            
            {/* Start Time */}
            <div className="mb-3">
              <div className="flex justify-between items-center mb-1">
                <label className="text-gray-400 text-xs">Start Time</label>
                <div className="text-gray-300 text-xs font-mono">
                  {secondsToTimeCached(subtitle.startTime)}
                </div>
              </div>
              <div className="flex gap-1 items-center">
                <button 
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs py-1 px-2 rounded"
                  onClick={() => updateSubtitleTiming(subtitle.id, -0.1, 0)}
                >
                  -0.1s
                </button>
                <div className="flex-1 bg-gray-700 h-1 rounded-full">
                <div className="bg-blue-500 h-full origin-left rounded-full" style={{ transform: `scaleX(${Math.min(100, (subtitle.startTime / range) * 100) / 100})` }}></div>
                </div>
                <button 
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs py-1 px-2 rounded"
                  onClick={() => updateSubtitleTiming(subtitle.id, 0.1, 0)}
                >
                  +0.1s
                </button>
              </div>
            </div>
            
            {/* End Time */}
            <div className="mb-3">
              <div className="flex justify-between items-center mb-1">
                <label className="text-gray-400 text-xs">End Time</label>
                <div className="text-gray-300 text-xs font-mono">
                  {secondsToTimeCached(subtitle.endTime)}
                </div>
              </div>
              <div className="flex gap-1 items-center">
                <button 
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs py-1 px-2 rounded"
                  onClick={() => updateSubtitleTiming(subtitle.id, 0, -0.1)}
                >
                  -0.1s
                </button>
                <div className="flex-1 bg-gray-700 h-1 rounded-full">
                  <div className="bg-blue-500 h-full origin-left rounded-full" style={{ transform: `scaleX(${Math.min(100, (subtitle.endTime / range) * 100) / 100})` }}></div>
                </div>
                <button 
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs py-1 px-2 rounded"
                  onClick={() => updateSubtitleTiming(subtitle.id, 0, 0.1)}
                >
                  +0.1s
                </button>
              </div>
            </div>
            
            {/* Duration */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-gray-400 text-xs">Duration</label>
                <div className="text-gray-300 text-xs font-mono">
                  {durationLabel}
                </div>
              </div>
              <div className="bg-gray-700 h-1 rounded-full">
                <div 
                  className={`h-full origin-left rounded-full ${duration < 1 ? 'bg-red-500' : duration > 5 ? 'bg-yellow-500' : 'bg-green-500'}`} 
                  style={{ transform: `scaleX(${Math.min(100, (duration / 5) * 100) / 100})` }}
                ></div>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-xs text-gray-500">Too short</span>
                <span className="text-xs text-gray-500">Optimal</span>
                <span className="text-xs text-gray-500">Too long</span>
              </div>
            </div>
          </div>
          
          {/* Text Editing */}
          <div className="bg-gray-800 rounded-lg p-3 mb-4">
            <h4 className="text-white text-sm font-semibold mb-2">Text</h4>
            <textarea 
              className="w-full bg-gray-700 text-white border border-gray-600 rounded p-2 text-sm"
              value={subtitle.text}
              onChange={(e) => updateSubtitleText(subtitle.id, e.target.value)}
              rows={4}
              placeholder="Subtitle text..."
            />
            <div className="mt-2 flex justify-between text-xs text-gray-400">
              <span>{subtitle.text.length} characters</span>
              <span>{subtitle.text.split(' ').length} words</span>
            </div>
          </div>
          
          {/* Advanced Options */}
          <div className="bg-gray-800 rounded-lg p-3">
            <h4 className="text-white text-sm font-semibold mb-2">Advanced</h4>
            
            <div className="flex gap-2 mb-3">
              <button
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs py-1.5 px-3 rounded flex-1"
                onClick={() => onSplitSubtitle && onSplitSubtitle(subtitle.id)}
                title="Split this subtitle at the middle point"
              >
                Split Subtitle
              </button>
              <button
                className="bg-red-600 hover:bg-red-700 text-white text-xs py-1.5 px-3 rounded flex-1"
                onClick={() => {
                  if (window.confirm('Are you sure you want to delete this subtitle?')) {
                    onDeleteSubtitle && onDeleteSubtitle(subtitle.id);
                  }
                }}
                title="Delete this subtitle"
              >
                Delete
              </button>
            </div>

            <div className="mb-3">
              <button
                className="bg-green-600 hover:bg-green-700 text-white text-xs py-1.5 px-3 rounded w-full"
                onClick={() => onAddSubtitle && onAddSubtitle(currentTime)}
                title="Add a new subtitle at the current playback position"
              >
                + Add at Marker ({secondsToTimeCached(currentTime)})
              </button>
            </div>
            
            {/* Styling Preview */}
            <div className="mt-4">
              <div className="text-xs text-gray-400 mb-1">Preview</div>
              <div className="bg-black bg-opacity-80 p-2 rounded text-center">
                <p className="text-white text-sm">{subtitle.text}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
