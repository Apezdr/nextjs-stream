'use client'

import { useState, useEffect, useRef, useCallback, startTransition } from 'react'
import { parseVTT, exportToVTT } from '../utils/subtitleParser'
import SubtitleMainArea from './SubtitleMainArea'
import SubtitleInspector from './SubtitleInspector'
import SubtitleSidebar from './SubtitleSidebar'
import SubtitleToolbar from './SubtitleToolbar'
import EditorVideoPlayer from './EditorVideoPlayer'

export default function SubtitleEditorLayout({
  isOpen,
  onClose,
  videoRef,
  subtitleUrl,
  onSave,
  currentTime,
  duration,
  videoURL,
  initialTime = 0,
  availableSubtitles = {},
  selectedSubtitleLanguage = '',
  mediaType = '',
  mediaTitle = '',
  seasonNumber = null,
  episodeNumber = null
}) {
  const [subtitles, setSubtitles] = useState([])
  const [selectedSubtitles, setSelectedSubtitles] = useState([])
  const [originalSubtitles, setOriginalSubtitles] = useState([]) // For undo/reset
  const [isLoading, setIsLoading] = useState(true)
  const [zoomLevel, setZoomLevel] = useState(5 * 60)
  const [hasChanges, setHasChanges] = useState(false)
  const [isZoomInitialized, setIsZoomInitialized] = useState(false)
  const [userSetZoom, setUserSetZoom] = useState(false)
  const editorRef = useRef(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [localCurrentTime, setLocalCurrentTime] = useState(currentTime || 0)
  const [currentSubtitle, setCurrentSubtitle] = useState(null)
  const [editMode, setEditMode] = useState('select') // 'select', 'move', 'resize-start', 'resize-end'
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [currentSearchIndex, setCurrentSearchIndex] = useState(0)
  // Get the video source from props or reference
  const [videoSource, setVideoSource] = useState(null)
  // Track the current subtitle language
  const [currentSubtitleLanguage, setCurrentSubtitleLanguage] = useState(selectedSubtitleLanguage)
  const [currentSubtitleUrl, setCurrentSubtitleUrl] = useState(subtitleUrl)

  // Handle subtitle language change
  const handleSubtitleLanguageChange = (language) => {
    setCurrentSubtitleLanguage(language)

    // Update the subtitle URL to match the new language
    if (availableSubtitles[language]) {
      setCurrentSubtitleUrl(availableSubtitles[language].url)
    }
  }

  // EditorVideoPlayer ref for high-performance video control
  const editorVideoRef = useRef(null)

  // Helper function to set zoom level for showing a specific time range
  const setZoomForTimeRange = (minutes, isUserAction = true) => {
    // Special case: if minutes is 'fit', set zoom level to match the full duration
    if (minutes === 'fit') {
      // Always set zoomLevel to exactly match the duration when using "Fit All"
      // The SubtitleTimelineArea component will handle the proper display
      setZoomLevel(duration);
    } else {
      // Regular case: convert minutes to seconds for the zoom level
      const secondsToShow = minutes * 60;
      setZoomLevel(secondsToShow);
    }

    // Track if this was a user action (not automatic initialization)
    if (isUserAction) {
      setUserSetZoom(true);
    }

    // Mark zoom as initialized
    setIsZoomInitialized(true);
  };

  // Initialize subtitle language when editor opens
  useEffect(() => {
    if (isOpen && selectedSubtitleLanguage && selectedSubtitleLanguage !== currentSubtitleLanguage) {
      setCurrentSubtitleLanguage(selectedSubtitleLanguage)
      if (availableSubtitles[selectedSubtitleLanguage]) {
        setCurrentSubtitleUrl(availableSubtitles[selectedSubtitleLanguage].url)
      }
    }
  }, [isOpen, selectedSubtitleLanguage, availableSubtitles])

  // Load subtitles when component mounts or URL changes
  useEffect(() => {
    if (!currentSubtitleUrl) return

    const fetchSubtitles = async () => {
      setIsLoading(true)
      try {
        const response = await fetch(currentSubtitleUrl)
        const subtitleContent = await response.text()
        const parsedSubtitles = parseVTT(subtitleContent)
        setSubtitles(parsedSubtitles)
        setOriginalSubtitles(JSON.parse(JSON.stringify(parsedSubtitles))) // Deep copy
        setHasChanges(false)
      } catch (error) {
        console.error('Error loading subtitles:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchSubtitles()
  }, [currentSubtitleUrl])
  
  // Set default zoom level when component is mounted (only once)
  useEffect(() => {
    if (!isLoading && subtitles.length > 0 && !isZoomInitialized) {
      // Default to "fit all" view to show all subtitles (only on initial load)
      setZoomForTimeRange('fit', false); // false = not a user action
    }
  }, [isLoading, isZoomInitialized]); // Removed 'subtitles' dependency to prevent resets

  // Reset zoom initialization flags when editor opens with new content
  useEffect(() => {
    if (isOpen) {
      setIsZoomInitialized(false);
      setUserSetZoom(false);
    }
  }, [isOpen, currentSubtitleUrl]); // Reset when opening editor or changing subtitle language

  // React 19 optimized helper with startTransition
  const ensureZoomInitialized = useCallback(() => {
    if (!isZoomInitialized) {
      startTransition(() => {
        setIsZoomInitialized(true);
      });
    }
  }, [isZoomInitialized]);

  // Handle subtitle selection
  const handleSelectSubtitle = (id, isMultiSelect = false) => {
    if (isMultiSelect) {
      // For ctrl+click: toggle selection
      setSelectedSubtitles(prev => 
        prev.includes(id) 
          ? prev.filter(subId => subId !== id) 
          : [...prev, id]
      )
    } else {
      // For normal click: select only this subtitle
      setSelectedSubtitles([id])
    }
  }

  // Update subtitle timing (for drag operations)
  const updateSubtitleTiming = (id, startDelta, endDelta = startDelta) => {
    // Only apply changes if we're not in select mode
    if (editMode === 'select' && startDelta !== 0 && endDelta !== 0) return;
    
    // Store current playback position to prevent seeking to beginning
    const currentPlaybackTime = localCurrentTime;

    // Only allow start time changes in resize-start mode
    // Only allow end time changes in resize-end mode
    // Allow both in move mode
    const effectiveStartDelta = (editMode === 'resize-end') ? 0 : startDelta;
    const effectiveEndDelta = (editMode === 'resize-start') ? 0 : endDelta;

    setSubtitles(prev => {
      const updated = prev.map(sub => {
        // Apply changes to the selected subtitle or all selected subtitles
        if (sub.id === id || (selectedSubtitles.includes(id) && selectedSubtitles.includes(sub.id))) {
          return {
            ...sub,
            startTime: Math.max(0, sub.startTime + effectiveStartDelta),
            endTime: Math.max(0, sub.endTime + effectiveEndDelta)
          }
        }
        return sub
      })
      
      // Sort by start time
      return updated.sort((a, b) => a.startTime - b.startTime)
    })
    setHasChanges(true)
    
    // Ensure playback position is maintained using EditorVideoPlayer
    if (editorVideoRef.current) {
      editorVideoRef.current.seek(currentPlaybackTime);
    }
  }

  // Shift all subtitles by a specified number of seconds
  const shiftAllSubtitles = (seconds) => {
    // Store current playback position to prevent seeking to beginning
    const currentPlaybackTime = localCurrentTime;

    // Ensure zoom doesn't get reset
    ensureZoomInitialized();

    setSubtitles(prev => {
      const updated = prev.map(sub => ({
        ...sub,
        startTime: Math.max(0, sub.startTime + seconds),
        endTime: Math.max(0, sub.endTime + seconds)
      }))

      // Sort by start time
      return updated.sort((a, b) => a.startTime - b.startTime)
    })
    setHasChanges(true)

    // Ensure playback position is maintained using EditorVideoPlayer
    if (editorVideoRef.current) {
      editorVideoRef.current.seek(currentPlaybackTime);
    }
  }

  // Shift only selected subtitles
  const shiftSelectedSubtitles = (seconds) => {
    if (selectedSubtitles.length === 0) return

    // Store current playback position to prevent seeking to beginning
    const currentPlaybackTime = localCurrentTime;

    // Ensure zoom doesn't get reset
    ensureZoomInitialized();

    setSubtitles(prev => {
      const updated = prev.map(sub => {
        if (selectedSubtitles.includes(sub.id)) {
          return {
            ...sub,
            startTime: Math.max(0, sub.startTime + seconds),
            endTime: Math.max(0, sub.endTime + seconds)
          }
        }
        return sub
      })

      // Sort by start time
      return updated.sort((a, b) => a.startTime - b.startTime)
    })
    setHasChanges(true)

    // Ensure playback position is maintained using EditorVideoPlayer
    if (editorVideoRef.current) {
      editorVideoRef.current.seek(currentPlaybackTime);
    }
  }
  
  // Shift subtitles before/after a reference subtitle
  const shiftSubtitlesRelative = (seconds, direction, inclusion) => {
    if (selectedSubtitles.length === 0) return;

    // Get the reference subtitle (just use the first selected one)
    const referenceId = selectedSubtitles[0];
    const referenceSubtitle = subtitles.find(sub => sub.id === referenceId);

    if (!referenceSubtitle) return;

    // Store current playback position to prevent seeking to beginning
    const currentPlaybackTime = localCurrentTime;

    // Ensure zoom doesn't get reset
    ensureZoomInitialized();

    setSubtitles(prev => {
      const updated = prev.map(sub => {
        // For "before", shift subtitles that have start time less than reference's start time
        // For "after", shift subtitles that have start time greater than reference's start time
        const shouldShiftBefore = direction === 'before' &&
          (inclusion === 'excluding' ? sub.startTime < referenceSubtitle.startTime : sub.startTime <= referenceSubtitle.startTime);

        const shouldShiftAfter = direction === 'after' &&
          (inclusion === 'excluding' ? sub.startTime > referenceSubtitle.startTime : sub.startTime >= referenceSubtitle.startTime);

        if (shouldShiftBefore || shouldShiftAfter) {
          return {
            ...sub,
            startTime: Math.max(0, sub.startTime + seconds),
            endTime: Math.max(0, sub.endTime + seconds)
          }
        }
        return sub;
      });

      // Sort by start time
      return updated.sort((a, b) => a.startTime - b.startTime);
    });

    setHasChanges(true);

    // Ensure playback position is maintained using EditorVideoPlayer
    if (editorVideoRef.current) {
      editorVideoRef.current.seek(currentPlaybackTime);
    }
  }

  // React 19 optimized subtitle text update
  const updateSubtitleText = useCallback((id, newText) => {
    // Use startTransition for non-urgent text updates
    startTransition(() => {
      setSubtitles(prev =>
        prev.map(sub => {
          if (sub.id === id) {
            return { ...sub, text: newText }
          }
          return sub
        })
      );
      setHasChanges(true);
    });
  }, []);

  // Add a new subtitle at a specific time
  const addSubtitle = (startTime) => {
    // Store current playback position to prevent seeking to beginning
    const currentPlaybackTime = localCurrentTime;

    // Ensure zoom doesn't get reset
    ensureZoomInitialized();

    const newSubtitle = {
      id: Date.now() + Math.random(), // Simple unique ID generation
      startTime: startTime,
      endTime: startTime + 3, // Default 3-second duration
      text: 'New subtitle text'
    }

    setSubtitles(prev => {
      const updated = [...prev, newSubtitle]
      // Sort by start time
      return updated.sort((a, b) => a.startTime - b.startTime)
    })

    // Select the new subtitle
    setSelectedSubtitles([newSubtitle.id])
    setHasChanges(true)

    // Ensure playback position is maintained using EditorVideoPlayer
    if (editorVideoRef.current) {
      editorVideoRef.current.seek(currentPlaybackTime);
    }
  }

  // Delete a subtitle
  const deleteSubtitle = (id) => {
    // Store current playback position to prevent seeking to beginning
    const currentPlaybackTime = localCurrentTime;

    // Ensure zoom doesn't get reset
    ensureZoomInitialized();

    setSubtitles(prev => prev.filter(sub => sub.id !== id))
    setSelectedSubtitles(prev => prev.filter(subId => subId !== id))
    setHasChanges(true)

    // Ensure playback position is maintained using EditorVideoPlayer
    if (editorVideoRef.current) {
      editorVideoRef.current.seek(currentPlaybackTime);
    }
  }

  // Split a subtitle at its midpoint
  const splitSubtitle = (id) => {
    // Store current playback position to prevent seeking to beginning
    const currentPlaybackTime = localCurrentTime;

    // Ensure zoom doesn't get reset
    ensureZoomInitialized();

    setSubtitles(prev => {
      const subtitleToSplit = prev.find(sub => sub.id === id)
      if (!subtitleToSplit) return prev

      const midpoint = (subtitleToSplit.startTime + subtitleToSplit.endTime) / 2
      const firstHalf = {
        ...subtitleToSplit,
        endTime: midpoint,
        text: subtitleToSplit.text.substring(0, Math.floor(subtitleToSplit.text.length / 2))
      }
      const secondHalf = {
        ...subtitleToSplit,
        id: Date.now() + Math.random(), // New unique ID
        startTime: midpoint,
        text: subtitleToSplit.text.substring(Math.floor(subtitleToSplit.text.length / 2))
      }

      const updated = prev.map(sub => sub.id === id ? firstHalf : sub)
      updated.push(secondHalf)

      // Sort by start time
      return updated.sort((a, b) => a.startTime - b.startTime)
    })

    setHasChanges(true)

    // Ensure playback position is maintained using EditorVideoPlayer
    if (editorVideoRef.current) {
      editorVideoRef.current.seek(currentPlaybackTime);
    }
  }

  // EditorVideoPlayer event handlers following the example pattern
  const handleTimeUpdate = (time) => {
    setLocalCurrentTime(prev => {
      if (Math.abs(prev - time) > 0.002) { // ~2ms threshold
        return time
      }
      return prev
    })
  };

  const handlePlayingChange = useCallback((playing) => {
    console.log('Playing state changed:', playing);
    setIsPlaying(playing);
  }, []);

  // React 19 optimized seek handler using EditorVideoPlayer
  const handleSeek = useCallback((time) => {
    // Update video time immediately using EditorVideoPlayer API
    if (videoRef && videoRef.current) {
      videoRef.current.currentTime = time;
    }

    if (editorVideoRef.current) {
      editorVideoRef.current.seek(time);
    }

    // Update UI state with startTransition (non-urgent)  
    startTransition(() => {
      setLocalCurrentTime(time);
    });
  }, [videoRef]);
  
  // React 19 optimized play/pause handler using EditorVideoPlayer
  const handlePlayPause = useCallback(async () => {
    if (editorVideoRef.current) {
      await editorVideoRef.current.togglePlayPause();
    }
  }, []);
  
  // Only set the initial time value once when the component mounts
  useEffect(() => {
    if (isOpen) {
      // Use current time from main player (initialTime will already have the correct value)
      const timeToUse = currentTime || initialTime || 0;
      setLocalCurrentTime(timeToUse);
    }
  }, [isOpen]) // Only run once when opening the editor
  
  // Find the current subtitle based on the localCurrentTime
  useEffect(() => {
    if (subtitles.length > 0) {
      const current = subtitles.find(sub => 
        localCurrentTime >= sub.startTime && localCurrentTime <= sub.endTime
      );
      setCurrentSubtitle(current || null);
    }
  }, [localCurrentTime, subtitles]) // Only depend on localCurrentTime and subtitles
  
  // Search functionality
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      return
    }
    
    const query = searchQuery.toLowerCase()
    const results = subtitles
      .filter(sub => sub.text.toLowerCase().includes(query))
      .map(sub => sub.id)
    
    setSearchResults(results)
    
    // Reset current index if results change
    if (results.length > 0) {
      setCurrentSearchIndex(0)
    }
  }, [searchQuery, subtitles])
  
  // Go to next search result
  const goToNextSearchResult = () => {
    if (searchResults.length === 0) return
    
    const nextIndex = (currentSearchIndex + 1) % searchResults.length
    setCurrentSearchIndex(nextIndex)
    
    // Find and select the subtitle
    const subtitleId = searchResults[nextIndex]
    if (subtitleId) {
      handleSelectSubtitle(subtitleId, false)
      
      // Find the subtitle object to get its time
      const subtitle = subtitles.find(sub => sub.id === subtitleId)
      if (subtitle) {
        handleSeek(subtitle.startTime)
      }
    }
  }
  
  // Go to previous search result
  const goToPrevSearchResult = () => {
    if (searchResults.length === 0) return
    
    const prevIndex = (currentSearchIndex - 1 + searchResults.length) % searchResults.length
    setCurrentSearchIndex(prevIndex)
    
    // Find and select the subtitle
    const subtitleId = searchResults[prevIndex]
    if (subtitleId) {
      handleSelectSubtitle(subtitleId, false)
      
      // Find the subtitle object to get its time
      const subtitle = subtitles.find(sub => sub.id === subtitleId)
      if (subtitle) {
        handleSeek(subtitle.startTime)
      }
    }
  }
  
  // Detect the video source when component mounts or props change
  useEffect(() => {
    // First try to use the explicit videoURL prop
    if (videoURL) {
      setVideoSource(videoURL);
    }
    // Then try to get URL from the videoRef if available
    else if (videoRef?.current?.src) {
      setVideoSource(videoRef.current.src);
    }
  }, [videoURL, videoRef]);

  // Create EditorVideoPlayer element
  const videoElement = videoSource ? (
    <EditorVideoPlayer
      ref={editorVideoRef}
      src={videoSource}
      onTimeUpdate={handleTimeUpdate}
      onPlayingChange={handlePlayingChange}
      controls={false}
      startTime={currentTime || initialTime || 0}
      throttleMs={0} // ~120fps for smooth updates
      videoClassName="w-auto h-full max-h-[60vh] sm:max-h-[30vh] mx-auto"
      noContainer={true} // No extra container
    />
  ) : null;

  // Save changes
  const handleSave = async () => {
    if (onSave) {
      const vttContent = exportToVTT(subtitles)
      await onSave(vttContent)
      setHasChanges(false)
    }
  }

  // Reset to original
  const handleReset = () => {
    // Ensure zoom doesn't get reset
    ensureZoomInitialized();

    setSubtitles(JSON.parse(JSON.stringify(originalSubtitles))) // Deep copy
    setHasChanges(false)
  }

  return (
    <div 
      ref={editorRef}
      className="fixed inset-0 z-50 bg-black bg-opacity-80 flex flex-col overflow-hidden"
      style={{ backdropFilter: 'blur(4px)' }}
    >
      {/* Toolbar */}
      <SubtitleToolbar
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        searchResults={searchResults}
        currentSearchIndex={currentSearchIndex}
        goToNextSearchResult={goToNextSearchResult}
        goToPrevSearchResult={goToPrevSearchResult}
        hasChanges={hasChanges}
        handleSave={handleSave}
        handleReset={handleReset}
        onClose={onClose}
        editMode={editMode}
        setEditMode={setEditMode}
        // Add video playback props
        isPlaying={isPlaying}
        handlePlayPause={handlePlayPause}
        handleSeek={handleSeek}
        localCurrentTime={localCurrentTime}
        duration={duration}
        zoomLevel={zoomLevel}
        setZoomLevel={setZoomLevel}
        // Subtitle language props
        availableSubtitles={availableSubtitles}
        selectedSubtitleLanguage={currentSubtitleLanguage}
        onSubtitleLanguageChange={handleSubtitleLanguageChange}
      />
      
      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="bg-gray-800 rounded-lg p-6 shadow-2xl">
            <div className="flex items-center space-x-3">
              <div className="animate-spin h-6 w-6 border-t-2 border-blue-500 border-r-2 border-t-blue-500 border-r-transparent rounded-full"></div>
              <p className="text-white">Loading subtitles...</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar */}
          <SubtitleSidebar
            subtitles={subtitles}
            selectedSubtitles={selectedSubtitles}
            onSelectSubtitle={handleSelectSubtitle}
            currentSubtitle={currentSubtitle}
            currentTime={localCurrentTime}
            onSeek={handleSeek}
            searchResults={searchResults}
            currentSearchIndex={currentSearchIndex}
            mediaType={mediaType}
            mediaTitle={mediaTitle}
            seasonNumber={seasonNumber}
            episodeNumber={episodeNumber}
          />
          
          {/* Main Area with Video and Timeline */}
          {/* TestPlayer (dev) - isolated native video + RAF timestamp for comparison */}
          {/* <div className="px-3 mb-2 w-full">
            <TestPlayer videoURL={videoSource || videoURL} />
          </div> */}

          <SubtitleMainArea
            subtitles={subtitles}
            selectedSubtitles={selectedSubtitles}
            currentSubtitle={currentSubtitle}
            videoSource={videoSource}
            localCurrentTime={localCurrentTime}
            duration={duration}
            isPlaying={isPlaying}
            handlePlayPause={handlePlayPause}
            handleSeek={handleSeek}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            onSelectSubtitle={handleSelectSubtitle}
            onUpdateTiming={updateSubtitleTiming}
            currentTime={currentTime}
            searchResults={searchResults}
            currentSearchIndex={currentSearchIndex}
            editMode={editMode}
            onShiftAll={shiftAllSubtitles}
            onShiftSelected={shiftSelectedSubtitles}
            onShiftRelative={shiftSubtitlesRelative}
            onSetZoomForTimeRange={setZoomForTimeRange}
          >
            {videoElement}
          </SubtitleMainArea>
          
          {/* Right Inspector Panel */}
          <SubtitleInspector
            subtitles={subtitles}
            selectedSubtitles={selectedSubtitles}
            setSelectedSubtitles={setSelectedSubtitles}
            onSelectSubtitle={handleSelectSubtitle}
            updateSubtitleText={updateSubtitleText}
            updateSubtitleTiming={updateSubtitleTiming}
            currentTime={localCurrentTime}
            onDeleteSubtitle={deleteSubtitle}
            onSplitSubtitle={splitSubtitle}
            onAddSubtitle={addSubtitle}
          />
        </div>
      )}
    </div>
  )
}
