'use client';

import { useState, useEffect } from 'react';
import Link, { useLinkStatus } from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import Loading from '@src/app/loading';
import EpisodeThumbnail from './EpisodeThumbnail';

/**
 * EpisodeListComponent - Shows a list of episodes for the current season
 * To be displayed below the MediaPlayerComponent
 */
export default function EpisodeListComponent({ mediaTitle, mediaSeason, mediaEpisode }) {
  const [episodes, setEpisodes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const router = useRouter();
  const { pending } = useLinkStatus();
  
  // Extract numeric values from the season and episode strings
  const seasonNum = parseInt(mediaSeason?.replace('Season ', '') || '0');
  const currentEpisodeNum = parseInt(mediaEpisode?.replace('Episode ', '') || '0');
  
  // Fetch episodes data
  useEffect(() => {
    const fetchEpisodes = async () => {
      if (!mediaTitle || !mediaSeason) {
        setLoading(false);
        return;
      }
      
      try {
        setLoading(true);
        const encodedTitle = encodeURIComponent(mediaTitle);
        // Fetch season data with episodes from the episode-picker endpoint
        const response = await fetch(`/api/authenticated/episode-picker?title=${encodedTitle}&season=${seasonNum}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch episode data');
        }
        
        const data = await response.json();
        
        if (data && data.episodes && Array.isArray(data.episodes)) {
          // Sort episodes by episode number
          const sortedEpisodes = [...data.episodes].sort((a, b) => a.episodeNumber - b.episodeNumber);
          setEpisodes(sortedEpisodes);
        } else {
          setEpisodes([]);
        }
      } catch (err) {
        console.error('Error fetching episode data:', err);
        setError('Failed to load episodes');
      } finally {
        setLoading(false);
      }
    };
    
    fetchEpisodes();
  }, [mediaTitle, mediaSeason, seasonNum]);
  
  // Navigate to an episode
  const navigateToEpisode = (episodeNumber) => {
    router.push(`/list/tv/${mediaTitle}/${mediaSeason}/${episodeNumber}/play`);
  };
  
  if (loading) {
    return (
      <div className="w-full p-4 bg-gray-900/50 rounded-lg">
        <div className="animate-pulse space-y-2">
          <div className="h-5 bg-gray-700 rounded w-1/4"></div>
          <div className="h-10 bg-gray-700 rounded"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-8 bg-gray-700 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className="w-full p-4 bg-gray-900/50 rounded-lg">
        <p className="text-red-500">{error}</p>
      </div>
    );
  }
  
  if (!episodes || episodes.length === 0) {
    return (
      <div className="w-full p-4 bg-gray-900/50 mt-4 rounded-lg">
        <p className="text-gray-400">No episodes found for this season.</p>
      </div>
    );
  }
  
  return (
    <div className="w-full bg-gray-900/50 p-4 rounded-lg backdrop-blur-sm">
      <h3 className="text-xl font-semibold mb-4 text-white">
        {mediaTitle} - Season {seasonNum} Episodes
      </h3>
      
      {/* Episode selection dropdown for mobile */}
      <div className="mb-4 md:hidden">
        <select
          value={currentEpisodeNum}
          onChange={(e) => navigateToEpisode(parseInt(e.target.value))}
          className="w-full p-2 bg-gray-800 text-white rounded-lg"
        >
          {episodes.map((episode) => (
            <option key={episode._id} value={episode.episodeNumber}>
              Episode {episode.episodeNumber}: {episode.title || `Untitled`}
            </option>
          ))}
        </select>
      </div>
      
      {/* Horizontal episode thumbnail grid */}
      <div className="hidden md:block overflow-x-auto pb-4 px-2 py-2">
        <div className="flex space-x-4 gap-6">
          {episodes.map((episode) => {
            const isCurrentEpisode = episode.episodeNumber === currentEpisodeNum;
            const episodeLink = `/list/tv/${mediaTitle}/${mediaSeason}/${episode.episodeNumber}/play`;
            
            return (
              <EpisodeThumbnail
                key={episode._id}
                episode={episode}
                isCurrentEpisode={isCurrentEpisode}
                mediaTitle={mediaTitle}
                mediaSeason={mediaSeason}
                episodeLink={episodeLink}
                pending={pending}
              />
            );
          })}
        </div>
      </div>
      
      {/* Navigation controls */}
      <div className="flex justify-between mt-4">
        <button
          onClick={() => {
            const prevEpisode = episodes.find(ep => ep.episodeNumber === currentEpisodeNum - 1);
            if (prevEpisode) {
              navigateToEpisode(prevEpisode.episodeNumber);
            }
          }}
          disabled={!episodes.some(ep => ep.episodeNumber === currentEpisodeNum - 1)}
          className="px-4 py-2 bg-gray-800 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-700 transition-colors"
        >
          Previous Episode
        </button>
        
        <button
          onClick={() => {
            const nextEpisode = episodes.find(ep => ep.episodeNumber === currentEpisodeNum + 1);
            if (nextEpisode) {
              navigateToEpisode(nextEpisode.episodeNumber);
            }
          }}
          disabled={!episodes.some(ep => ep.episodeNumber === currentEpisodeNum + 1)}
          className="px-4 py-2 bg-indigo-600 rounded-lg text-white disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-500 transition-colors"
        >
          Next Episode
        </button>
      </div>
    </div>
  );
}
