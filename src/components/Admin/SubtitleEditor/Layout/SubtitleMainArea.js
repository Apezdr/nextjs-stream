'use client'

import React from 'react'
import { secondsToTimeCached } from '../utils/timeFormat'
import SubtitleTimelineArea from './SubtitleTimelineArea'
import SubtitleControls from '../SubtitleControls/SubtitleControls'

export default function SubtitleMainArea({
  subtitles,
  selectedSubtitles,
  currentSubtitle,
  videoSource,
  localCurrentTime,
  duration,
  isPlaying,
  handlePlayPause,
  handleSeek,
  zoomLevel,
  setZoomLevel,
  onSelectSubtitle,
  onUpdateTiming,
  currentTime,
  searchResults,
  currentSearchIndex,
  editMode,
  onShiftAll,
  onShiftSelected,
  onShiftRelative,
  onSetZoomForTimeRange,
  children, // Video element passed as children
}) {
  return (
    <div className="flex-1 bg-gray-900 flex flex-col overflow-hidden">
      {/* Video Preview */}
      <div className="p-3">
        <div className="bg-gray-800 rounded-lg overflow-hidden">
          <div className="p-3 border-b border-gray-700 flex justify-between items-center">
            <h3 className="text-gray-300 font-semibold">Video Preview</h3>
            <span className="text-gray-400 text-xs font-mono">
              {secondsToTimeCached(localCurrentTime)} / {secondsToTimeCached(duration)}
            </span>
          </div>
          
          <div className="p-4">
                <div className="aspect-video bg-black relative rounded overflow-hidden">
                  {/* Render video element from children */}
                  {children}
                  
                  {/* Show message when no source */}
                  {!videoSource && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <p className="text-gray-400">No video source available</p>
                    </div>
                  )}
                  
                  {/* Show subtitle when available */}
                  {videoSource && currentSubtitle && (
                    <div className="absolute bottom-8 left-0 right-0 p-3 flex justify-center">
                      <div className="bg-black bg-opacity-70 px-4 py-2 rounded text-white max-w-[80%] text-center">
                        {currentSubtitle.text}
                      </div>
                    </div>
                  )}
                  
                  {/* Play/pause overlay - only show when we have a source */}
                  {videoSource && (
                    <button
                      className="absolute inset-0 w-full h-full flex items-center justify-center bg-black bg-opacity-0 hover:bg-opacity-20 transition-opacity"
                      onClick={handlePlayPause}
                    >
                      {isPlaying ? (
                        <div className="w-16 h-16 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                          <span className="text-white text-xl">⏸</span>
                        </div>
                      ) : (
                        <div className="w-16 h-16 bg-black bg-opacity-50 rounded-full flex items-center justify-center">
                          <span className="text-white text-xl">▶</span>
                        </div>
                      )}
                    </button>
                  )}
                </div>
            
            {/* Custom Video Controls */}
            <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 bg-gray-700 h-1 rounded-full overflow-hidden">
            <div 
              className="bg-blue-500 h-full origin-left" 
              style={{ transform: `scaleX(${Math.min(100, Math.max(0, (localCurrentTime / duration) * 100)) / 100})` }}
            ></div>
          </div>
              
              <div className="flex gap-1">
                <button
                  onClick={() => handleSeek(Math.max(0, localCurrentTime - 0.1))}
                  className="bg-gray-700 hover:bg-gray-600 w-8 h-8 rounded flex items-center justify-center text-white"
                  title="Back 0.1 seconds"
                >
                  <span className="text-xs">-0.1</span>
                </button>
                <button
                  onClick={handlePlayPause}
                  className="bg-blue-600 hover:bg-blue-700 w-8 h-8 rounded flex items-center justify-center text-white"
                >
                  {isPlaying ? '⏸' : '▶'}
                </button>
                <button
                  onClick={() => handleSeek(Math.min(duration, localCurrentTime + 0.1))}
                  className="bg-gray-700 hover:bg-gray-600 w-8 h-8 rounded flex items-center justify-center text-white"
                  title="Forward 0.1 seconds"
                >
                  <span className="text-xs">+0.1</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Timeline Controls */}
      <div className="px-3 mb-2">
        <SubtitleControls 
          zoomLevel={zoomLevel}
          setZoomLevel={setZoomLevel}
          selectedCount={selectedSubtitles.length}
          onShiftAll={onShiftAll}
          onShiftSelected={onShiftSelected}
          onShiftRelative={onShiftRelative}
          duration={duration}
          onSetZoomForTimeRange={onSetZoomForTimeRange}
        />
      </div>
      
      {/* Timeline Area */}
      <div className="flex-1 min-h-0 px-3 pb-3">
        <div className="bg-gray-800 h-full rounded p-2 overflow-hidden">
          <div className="h-full">
            <SubtitleTimelineArea 
              subtitles={subtitles}
              currentTime={currentTime}
              localTime={localCurrentTime}
              duration={duration}
              selectedSubtitles={selectedSubtitles}
              searchResults={searchResults}
              currentSearchIndex={searchResults.length > 0 ? searchResults[currentSearchIndex] : null}
              onSelectSubtitle={onSelectSubtitle}
              onUpdateTiming={onUpdateTiming}
              zoomLevel={zoomLevel}
              onSeek={handleSeek}
              editMode={editMode}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
