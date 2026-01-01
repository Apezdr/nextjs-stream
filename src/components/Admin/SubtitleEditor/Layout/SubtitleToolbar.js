'use client'

export default function SubtitleToolbar({
  hasChanges,
  handleSave,
  handleReset,
  onClose,
  searchQuery,
  setSearchQuery,
  searchResults,
  currentSearchIndex,
  goToNextSearchResult,
  goToPrevSearchResult,
  editMode,
  setEditMode,
  // Video playback props
  isPlaying,
  handlePlayPause,
  handleSeek,
  localCurrentTime,
  duration,
  zoomLevel,
  setZoomLevel,
  // Subtitle language props
  availableSubtitles = {},
  selectedSubtitleLanguage = '',
  onSubtitleLanguageChange = () => {}
}) {
  // Helper to ensure time stays within bounds
  const seekWithinBounds = (seconds) => {
    const newTime = Math.max(0, Math.min(duration, localCurrentTime + seconds));
    handleSeek(newTime);
  }

  // Helper to ensure time stays within bounds only
  // Removed zoom level conversion logic as we're removing the zoom slider
  return (
    <div className="bg-gray-900 border-b border-gray-700 p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left Side - Title and Language */}
        <div className="flex items-center gap-4">
          <h2 className="text-xl font-bold text-white">Subtitle Editor</h2>
          {/* Subtitle languages dropdown */}
          <div className="flex items-center">
            <select
              className="bg-gray-800 text-white border border-gray-700 rounded px-3 py-1.5 text-sm"
              value={selectedSubtitleLanguage}
              onChange={(e) => onSubtitleLanguageChange(e.target.value)}
            >
              {Object.keys(availableSubtitles).length > 0 ? (
                Object.entries(availableSubtitles).map(([language, data]) => (
                  <option key={language} value={language}>
                    {language} (VTT)
                  </option>
                ))
              ) : (
                <option value="">No subtitles available</option>
              )}
            </select>
          </div>
        </div>
        
        {/* Center - Playback Controls */}
        <div className="flex items-center gap-1">
          <button 
            className="bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded text-white text-sm"
            title="Jump back 2 seconds"
            onClick={() => seekWithinBounds(-2)}
          >
            -2s
          </button>
          <button 
            className="bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded text-white text-sm"
            title="Jump back 0.5 seconds"
            onClick={() => seekWithinBounds(-0.5)}
          >
            -0.5s
          </button>
          <button 
            className="bg-blue-600 hover:bg-blue-700 px-4 py-1.5 rounded text-white flex items-center justify-center w-12"
            title="Play/Pause"
            onClick={handlePlayPause}
          >
            <span className="text-sm">{isPlaying ? 'Pause ⏸' : 'Play ▶'}</span>
          </button>
          <button 
            className="bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded text-white text-sm"
            title="Jump forward 0.5 seconds"
            onClick={() => seekWithinBounds(0.5)}
          >
            +0.5s
          </button>
          <button 
            className="bg-gray-800 hover:bg-gray-700 px-3 py-1.5 rounded text-white text-sm"
            title="Jump forward 2 seconds"
            onClick={() => seekWithinBounds(2)}
          >
            +2s
          </button>
        </div>
        
        {/* Removed Zoom Control - now handled by SubtitleControls component */}
        
        {/* Snap Dropdown */}
        <div className="flex items-center">
          <select className="bg-gray-800 text-white border border-gray-700 rounded px-3 py-1.5 text-sm">
            <option>Audio Peaks ▼</option>
          </select>
        </div>
        
        {/* Right Side - Actions */}
        <div className="flex items-center gap-2">
          <button 
            className="bg-gray-700 px-4 py-1.5 rounded text-gray-400 text-sm cursor-not-allowed"
            title="Import VTT file (not implemented yet)"
            disabled={true}
          >
            Import .vtt
          </button>
          <button 
            className="bg-gray-700 px-4 py-1.5 rounded text-gray-400 text-sm cursor-not-allowed"
            title="Export VTT file (not implemented yet)"
            disabled={true}
          >
            Export
          </button>
          <button 
            className={`px-4 py-1.5 rounded text-white text-sm ${hasChanges ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-700 cursor-not-allowed'}`}
            onClick={handleSave}
            disabled={!hasChanges}
          >
            Save Changes
          </button>
          <button 
            className={`px-4 py-1.5 rounded text-white text-sm ${hasChanges ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-gray-700 cursor-not-allowed'}`}
            onClick={handleReset}
            disabled={!hasChanges}
          >
            Reset
          </button>
        </div>
      </div>
      
      {/* Second Row - Search and Edit Mode */}
      <div className="flex justify-between mt-3">
        {/* Search */}
        <div className="flex items-center gap-2 w-2/5">
          <input
            type="text"
            placeholder="Search subtitle text..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-gray-800 text-white border border-gray-700 rounded px-3 py-1.5 text-sm w-full"
          />
          
          {searchResults.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={goToPrevSearchResult}
                className="bg-gray-800 hover:bg-gray-700 px-2 py-1.5 rounded text-white text-sm"
                title="Previous result"
              >
                ←
              </button>
              <span className="text-gray-400 text-sm">
                {currentSearchIndex + 1}/{searchResults.length}
              </span>
              <button
                onClick={goToNextSearchResult}
                className="bg-gray-800 hover:bg-gray-700 px-2 py-1.5 rounded text-white text-sm"
                title="Next result"
              >
                →
              </button>
            </div>
          )}
        </div>
        
        {/* Edit Mode */}
        <div className="flex items-center">
          <div className="bg-gray-800 rounded flex">
            <button
              className={`px-3 py-1.5 text-sm ${editMode === 'select' ? 'bg-blue-600 text-white' : 'text-gray-300'}`}
              onClick={() => setEditMode('select')}
            >
              Select
            </button>
            <button
              className={`px-3 py-1.5 text-sm ${editMode === 'move' ? 'bg-blue-600 text-white' : 'text-gray-300'}`}
              onClick={() => setEditMode('move')}
            >
              Move
            </button>
            <button
              className={`px-3 py-1.5 text-sm ${editMode === 'resize-start' ? 'bg-blue-600 text-white' : 'text-gray-300'}`}
              onClick={() => setEditMode('resize-start')}
            >
              Start
            </button>
            <button
              className={`px-3 py-1.5 text-sm ${editMode === 'resize-end' ? 'bg-blue-600 text-white' : 'text-gray-300'}`}
              onClick={() => setEditMode('resize-end')}
            >
              End
            </button>
          </div>
        </div>
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="bg-red-600 hover:bg-red-700 px-4 py-1.5 rounded text-white text-sm"
        >
          Close
        </button>
      </div>
    </div>
  );
}
