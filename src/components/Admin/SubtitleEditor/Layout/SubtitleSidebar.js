'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { secondsToTimeCached } from '../utils/timeFormat'

export default function SubtitleSidebar({
  subtitles,
  selectedSubtitles,
  onSelectSubtitle,
  currentSubtitle,
  currentTime,
  onSeek,
  searchResults,
  currentSearchIndex,
  mediaType = '',
  mediaTitle = '',
  seasonNumber = null,
  episodeNumber = null
}) {
  const [episodes, setEpisodes] = useState([])
  const [loadingEpisodes, setLoadingEpisodes] = useState(false)
  const [selectedEpisode, setSelectedEpisode] = useState(episodeNumber)

  // Fetch episodes for TV shows
  useEffect(() => {
    const fetchEpisodes = async () => {
      if (mediaType !== 'tv' || !mediaTitle || !seasonNumber) {
        setEpisodes([])
        return
      }

      setLoadingEpisodes(true)
      try {
        const encodedTitle = encodeURIComponent(mediaTitle)
        const response = await fetch(`/api/authenticated/episode-picker?title=${encodedTitle}&season=${seasonNumber}`)

        if (!response.ok) {
          throw new Error('Failed to fetch episode data')
        }

        const data = await response.json()

        if (data && data.episodes && Array.isArray(data.episodes)) {
          // Sort episodes by episode number
          const sortedEpisodes = [...data.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber)
          setEpisodes(sortedEpisodes)
        } else {
          setEpisodes([])
        }
      } catch (error) {
        console.error('Error fetching episodes:', error)
        setEpisodes([])
      } finally {
        setLoadingEpisodes(false)
      }
    }

    fetchEpisodes()
  }, [mediaType, mediaTitle, seasonNumber])

  // Update selected episode when episodeNumber prop changes
  useEffect(() => {
    setSelectedEpisode(episodeNumber)
  }, [episodeNumber])

  // Handle episode selection
  const handleEpisodeChange = (newEpisodeNumber) => {
    if (newEpisodeNumber && newEpisodeNumber !== selectedEpisode) {
      // Navigate to the new episode
      const newUrl = `/list/tv/${mediaTitle}/${seasonNumber}/${newEpisodeNumber}/play`
      window.location.href = newUrl
    }
  }

  // Precompute Maps/Sets for fast lookups
  const selectedSet = useMemo(() => new Set(selectedSubtitles), [selectedSubtitles]);
  const searchSet = useMemo(() => new Set(searchResults), [searchResults]);
  const cueIndexById = useMemo(() => {
    const m = new Map();
    for (let i = 0; i < subtitles.length; i++) m.set(subtitles[i].id, i);
    return m;
  }, [subtitles]);

  // Stabilize handlers
  const onClickSubtitle = useCallback((id, startTime) => {
    onSelectSubtitle(id, false);
    onSeek(startTime);
  }, [onSelectSubtitle, onSeek]);
  
  // Function to format subtitle for display
  const formatSubtitleText = (text) => {
    // Truncate long text
    return text.length > 40 ? text.substring(0, 40) + '...' : text;
  };

  return (
    <div className="w-64 bg-gray-900 border-r border-gray-700 flex flex-col overflow-hidden">
      {/* Header - Show Episodes section only for TV shows */}
      {mediaType === 'tv' && (
        <div className="bg-gray-800 p-3 border-b border-gray-700">
          <h3 className="text-white font-semibold text-sm">Episodes</h3>
          <div className="flex items-center mt-2">
            {loadingEpisodes ? (
              <div className="text-xs text-gray-400">Loading episodes...</div>
            ) : episodes.length > 0 ? (
              <select
                className="bg-gray-700 text-white text-xs rounded px-2 py-1 w-full"
                value={selectedEpisode || ''}
                onChange={(e) => handleEpisodeChange(parseInt(e.target.value))}
              >
                {episodes.map((episode) => (
                  <option key={episode.episodeNumber} value={episode.episodeNumber}>
                    Episode {episode.episodeNumber}: {episode.title || `Episode ${episode.episodeNumber}`}
                  </option>
                ))}
              </select>
            ) : (
              <div className="text-xs text-gray-400">No episodes available</div>
            )}
          </div>
        </div>
      )}
      
      {/* Subtitle count and stats */}
      <div className="bg-gray-800 p-3 border-b border-gray-700">
        <div className="flex justify-between items-center mb-2">
          <div className="text-xs text-gray-400">
            {subtitles.length} Subtitles
          </div>
          <div className="text-xs text-gray-400">
            {mediaType === 'tv' ? (
              selectedEpisode ? `Episode ${selectedEpisode}` : 'Current episode'
            ) : (
              'Movie'
            )}
          </div>
        </div>
        <div className="text-xs text-gray-400">
          {currentSubtitle ? (
            <span>
              Current: <button
                className="text-blue-400 hover:text-blue-300 underline cursor-pointer"
                onClick={() => {
                  onSelectSubtitle(currentSubtitle.id, false);
                  onSeek(currentSubtitle.startTime);
                  // Scroll to the current subtitle in the list
                  const element = document.querySelector(`[data-subtitle-id="${currentSubtitle.id}"]`);
                  if (element) {
                    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  }
                }}
              >
                Cue #{(() => {
                  const index = cueIndexById.get(currentSubtitle.id);
                  return index !== undefined ? index + 1 : '?';
                })()}
              </button>
            </span>
          ) : (
            'No current subtitle'
          )}
        </div>
      </div>
      
      {/* Subtitle list */}
      <div className="flex-1 overflow-y-auto">
        {subtitles.map(subtitle => {
          const isSelected = selectedSet.has(subtitle.id);
          const isCurrent = currentSubtitle?.id === subtitle.id;
          const isSearchResult = searchSet.has(subtitle.id);
          const isCurrentSearchResult = subtitle.id === searchResults[currentSearchIndex];
          
          return (
            <div
              key={subtitle.id}
              data-subtitle-id={subtitle.id}
              className={`p-2 border-b border-gray-800 cursor-pointer transition-colors ${
                isSelected ? 'bg-blue-800 bg-opacity-40' :
                isCurrent ? 'bg-yellow-800 bg-opacity-30' :
                isSearchResult ? 'bg-purple-800 bg-opacity-30' :
                'hover:bg-gray-800'
              } ${isCurrentSearchResult ? 'ring-2 ring-purple-500' : ''}`}
              onClick={() => onClickSubtitle(subtitle.id, subtitle.startTime)}
            >
              <div className="flex justify-between items-center mb-1">
                <span className="text-gray-300 text-xs font-mono">
                  {secondsToTimeCached(subtitle.startTime)}
                </span>
                <span className="text-gray-400 text-xs">
                  {Math.round((subtitle.endTime - subtitle.startTime) * 10) / 10}s
                </span>
              </div>
              <p className={`text-sm ${isSelected || isCurrent ? 'text-white' : 'text-gray-400'}`}>
                {formatSubtitleText(subtitle.text)}
              </p>
            </div>
          );
        })}
      </div>
      
      {/* Footer with current position */}
      <div className="bg-gray-800 p-3 border-t border-gray-700">
        <div className="text-xs text-gray-400 font-mono">
          Current Position: {secondsToTimeCached(currentTime)}
        </div>
      </div>
    </div>
  );
}
