'use client';

import { createContext, useContext, useState } from 'react';

// Create the context
const PlaybackCoordinatorContext = createContext(null);

// Provider component that wraps parts of our app
export function PlaybackCoordinatorProvider({ children }) {
  // Track which player is currently active (could be 'main', 'thumbnail', or null)
  const [activePlayer, setActivePlayer] = useState(null);
  
  // Tracks if the main player was already paused before a thumbnail started
  const [wasMainPlayerPaused, setWasMainPlayerPaused] = useState(false);
  
  // Function to request playback from a specific source
  const requestPlayback = (playerType, shouldPlay) => {
    if (shouldPlay) {
      setActivePlayer(playerType);
    } else if (activePlayer === playerType) {
      setActivePlayer(null);
    }
  };
  
  // Value object passed to consumers
  const value = {
    activePlayer,
    requestPlayback,
    wasMainPlayerPaused,
    setWasMainPlayerPaused
  };
  
  return (
    <PlaybackCoordinatorContext.Provider value={value}>
      {children}
    </PlaybackCoordinatorContext.Provider>
  );
}

// Custom hook for using this context
export function usePlaybackCoordinator() {
  const context = useContext(PlaybackCoordinatorContext);
  if (context === null) {
    throw new Error('usePlaybackCoordinator must be used within a PlaybackCoordinatorProvider');
  }
  return context;
}
