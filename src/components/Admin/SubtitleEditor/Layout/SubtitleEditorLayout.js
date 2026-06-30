'use client'

import { useState, useReducer, useEffect, useMemo, useRef, useCallback, startTransition } from 'react'
import useSWR from 'swr'
import { parseVTT, exportToVTT } from '../utils/subtitleParser'
import SubtitleMainArea from './SubtitleMainArea'
import SubtitleInspector from './SubtitleInspector'
import SubtitleSidebar from './SubtitleSidebar'
import SubtitleToolbar from './SubtitleToolbar'
import EditorVideoPlayer from './EditorVideoPlayer'

// Fetch + parse a VTT subtitle file for the given URL.
const fetchAndParseSubtitles = async (url) => {
  const response = await fetch(url)
  const subtitleContent = await response.text()
  return parseVTT(subtitleContent)
}

// Related editor state is grouped into reducers (keeps the component under the
// useState-count threshold). Each action mirrors a useState setter and supports
// the value-or-updater form, so call sites read/behave exactly like before.
const resolve = (value, prev) => (typeof value === 'function' ? value(prev) : value)

// Editable subtitle document + dirty flag + immutable reset snapshot.
function docReducer(state, action) {
  switch (action.type) {
    case 'setSubtitles':
      return { ...state, subtitles: resolve(action.value, state.subtitles) }
    case 'setOriginalSubtitles':
      return { ...state, originalSubtitles: resolve(action.value, state.originalSubtitles) }
    case 'setHasChanges':
      return { ...state, hasChanges: resolve(action.value, state.hasChanges) }
    default:
      return state
  }
}

// Timeline zoom level + initialization tracking.
function zoomReducer(state, action) {
  switch (action.type) {
    case 'setZoomLevel':
      return { ...state, zoomLevel: resolve(action.value, state.zoomLevel) }
    case 'setIsZoomInitialized':
      return { ...state, isZoomInitialized: resolve(action.value, state.isZoomInitialized) }
    case 'setUserSetZoom':
      return { ...state, userSetZoom: resolve(action.value, state.userSetZoom) }
    default:
      return state
  }
}

// Video playback position/state + resolved source.
function playbackReducer(state, action) {
  switch (action.type) {
    case 'setIsPlaying':
      return { ...state, isPlaying: resolve(action.value, state.isPlaying) }
    case 'setLocalCurrentTime':
      return { ...state, localCurrentTime: resolve(action.value, state.localCurrentTime) }
    case 'setVideoSource':
      return { ...state, videoSource: resolve(action.value, state.videoSource) }
    default:
      return state
  }
}

// Search query + result cursor.
function searchReducer(state, action) {
  switch (action.type) {
    case 'setSearchQuery':
      return { ...state, searchQuery: resolve(action.value, state.searchQuery) }
    case 'setCurrentSearchIndex':
      return { ...state, currentSearchIndex: resolve(action.value, state.currentSearchIndex) }
    default:
      return state
  }
}

// Active subtitle source (language + URL) and the previous selected-language
// prop, used by the render-phase prop-sync.
function sourceReducer(state, action) {
  switch (action.type) {
    case 'setCurrentSubtitleLanguage':
      return { ...state, currentSubtitleLanguage: resolve(action.value, state.currentSubtitleLanguage) }
    case 'setCurrentSubtitleUrl':
      return { ...state, currentSubtitleUrl: resolve(action.value, state.currentSubtitleUrl) }
    case 'setPrevSelectedLanguage':
      return { ...state, prevSelectedLanguage: resolve(action.value, state.prevSelectedLanguage) }
    default:
      return state
  }
}

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
  // Editable document state (subtitles / reset snapshot / dirty flag)
  const [docState, dispatchDoc] = useReducer(docReducer, {
    subtitles: [],
    originalSubtitles: [], // For undo/reset
    hasChanges: false,
  })
  const { subtitles, originalSubtitles, hasChanges } = docState
  const setSubtitles = useCallback((value) => dispatchDoc({ type: 'setSubtitles', value }), [])
  const setOriginalSubtitles = useCallback((value) => dispatchDoc({ type: 'setOriginalSubtitles', value }), [])
  const setHasChanges = useCallback((value) => dispatchDoc({ type: 'setHasChanges', value }), [])

  // Timeline zoom state
  const [zoomState, dispatchZoom] = useReducer(zoomReducer, {
    zoomLevel: 5 * 60,
    isZoomInitialized: false,
    userSetZoom: false,
  })
  const { zoomLevel, isZoomInitialized, userSetZoom } = zoomState
  const setZoomLevel = useCallback((value) => dispatchZoom({ type: 'setZoomLevel', value }), [])
  const setIsZoomInitialized = useCallback((value) => dispatchZoom({ type: 'setIsZoomInitialized', value }), [])
  const setUserSetZoom = useCallback((value) => dispatchZoom({ type: 'setUserSetZoom', value }), [])

  // Video playback state (incl. resolved source)
  const [playbackState, dispatchPlayback] = useReducer(playbackReducer, {
    isPlaying: false,
    localCurrentTime: currentTime || 0,
    videoSource: null, // Resolved from props or video ref
  })
  const { isPlaying, localCurrentTime, videoSource } = playbackState
  const setIsPlaying = useCallback((value) => dispatchPlayback({ type: 'setIsPlaying', value }), [])
  const setLocalCurrentTime = useCallback((value) => dispatchPlayback({ type: 'setLocalCurrentTime', value }), [])
  const setVideoSource = useCallback((value) => dispatchPlayback({ type: 'setVideoSource', value }), [])

  // Search state
  const [searchState, dispatchSearch] = useReducer(searchReducer, {
    searchQuery: '',
    currentSearchIndex: 0,
  })
  const { searchQuery, currentSearchIndex } = searchState
  const setSearchQuery = useCallback((value) => dispatchSearch({ type: 'setSearchQuery', value }), [])
  const setCurrentSearchIndex = useCallback((value) => dispatchSearch({ type: 'setCurrentSearchIndex', value }), [])

  // Subtitle source: active language/URL + previous selected-language prop
  const [sourceState, dispatchSource] = useReducer(sourceReducer, undefined, () => ({
    currentSubtitleLanguage: selectedSubtitleLanguage,
    currentSubtitleUrl: subtitleUrl,
    prevSelectedLanguage: selectedSubtitleLanguage,
  }))
  const { currentSubtitleLanguage, currentSubtitleUrl, prevSelectedLanguage } = sourceState
  const setCurrentSubtitleLanguage = useCallback((value) => dispatchSource({ type: 'setCurrentSubtitleLanguage', value }), [])
  const setCurrentSubtitleUrl = useCallback((value) => dispatchSource({ type: 'setCurrentSubtitleUrl', value }), [])
  const setPrevSelectedLanguage = useCallback((value) => dispatchSource({ type: 'setPrevSelectedLanguage', value }), [])

  const [selectedSubtitles, setSelectedSubtitles] = useState([])
  const editorRef = useRef(null)
  const [editMode, setEditMode] = useState('select') // 'select', 'move', 'resize-start', 'resize-end'

  // Load + parse subtitles for the current URL via SWR. onSuccess seeds the
  // editable copy (and an immutable snapshot for reset). Revalidation is
  // disabled so user edits are never clobbered by a background refetch.
  const { isLoading } = useSWR(
    currentSubtitleUrl || null,
    fetchAndParseSubtitles,
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      revalidateOnReconnect: false,
      onSuccess: (parsedSubtitles) => {
        setSubtitles(parsedSubtitles)
        setOriginalSubtitles(JSON.parse(JSON.stringify(parsedSubtitles))) // Deep copy
        setHasChanges(false)
        // New content loaded — let the timeline re-fit to it.
        setIsZoomInitialized(false)
        setUserSetZoom(false)
      },
      onError: (error) => {
        console.error('Error loading subtitles:', error)
      },
    }
  )

  // Find the subtitle under the playhead — derived during render (no effect).
  const currentSubtitle = useMemo(() => {
    if (subtitles.length === 0) return null
    return (
      subtitles.find(
        (sub) => localCurrentTime >= sub.startTime && localCurrentTime <= sub.endTime
      ) || null
    )
  }, [subtitles, localCurrentTime])

  // Search matches — derived during render (no effect, no stored state).
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return []
    const query = searchQuery.toLowerCase()
    return subtitles.filter((sub) => sub.text.toLowerCase().includes(query)).map((sub) => sub.id)
  }, [searchQuery, subtitles])

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

  // Sync the active subtitle source to props when the editor opens with a new
  // selected language. Done during render (tracking the previous prop value via
  // the source reducer) rather than in an effect, so it doesn't chain into the
  // zoom-init effect.
  if (selectedSubtitleLanguage !== prevSelectedLanguage) {
    setPrevSelectedLanguage(selectedSubtitleLanguage)
    if (isOpen && selectedSubtitleLanguage && selectedSubtitleLanguage !== currentSubtitleLanguage) {
      setCurrentSubtitleLanguage(selectedSubtitleLanguage)
      if (availableSubtitles[selectedSubtitleLanguage]) {
        setCurrentSubtitleUrl(availableSubtitles[selectedSubtitleLanguage].url)
      }
    }
  }

  // Reset the zoom-initialization flags when the editor (re)opens so the
  // timeline re-fits to the content. Tracking the previous open state during
  // render keeps this out of an effect (avoiding an effect chain into the
  // default-zoom effect). Resets on content change happen in SWR onSuccess.
  const [prevIsOpen, setPrevIsOpen] = useState(() => isOpen)
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen)
    if (isOpen) {
      setIsZoomInitialized(false)
      setUserSetZoom(false)
    }
  }

  // Set default zoom level once content has loaded (only once per content)
  useEffect(() => {
    if (!isLoading && subtitles.length > 0 && !isZoomInitialized) {
      // Default to "fit all" view to show all subtitles (only on initial load)
      setZoomForTimeRange('fit', false); // false = not a user action
    }
  }, [isLoading, isZoomInitialized, subtitles.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // React 19 optimized helper with startTransition
  const ensureZoomInitialized = useCallback(() => {
    if (!isZoomInitialized) {
      startTransition(() => {
        setIsZoomInitialized(true);
      });
    }
  }, [isZoomInitialized, setIsZoomInitialized]);

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
  }, [setSubtitles, setHasChanges]);

  // Add a new subtitle at a specific time
  const addSubtitle = (startTime) => {
    // Store current playback position to prevent seeking to beginning
    const currentPlaybackTime = localCurrentTime;

    // Ensure zoom doesn't get reset
    ensureZoomInitialized();

    const newSubtitle = {
      id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
        id: `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  }, [setIsPlaying]);

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
  }, [videoRef, setLocalCurrentTime]);
  
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
    // Intentionally only re-runs when the editor opens/closes.
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps
  
  // Update the search query and reset the result cursor to the first match.
  // (currentSubtitle and searchResults are derived during render via useMemo.)
  const handleSearchQueryChange = (value) => {
    setSearchQuery(value)
    setCurrentSearchIndex(0)
  }

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
  }, [videoURL, videoRef, setVideoSource]);

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
        setSearchQuery={handleSearchQueryChange}
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
