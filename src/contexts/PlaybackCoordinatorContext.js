'use client';

import { createContext, useContext, useState } from 'react';

// Create the context
const PlaybackCoordinatorContext = createContext(null);

// Provider component that wraps parts of our app
export function PlaybackCoordinatorProvider({ children }) {
  // Track which player is currently active ('thumbnail' or null). The main
  // player consumes this as a playback suppressor via useManagedPlayback —
  // the old pause/resume bookkeeping (wasMainPlayerPaused) lives there now
  // as user intent.
  const [activePlayer, setActivePlayer] = useState(null);

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
    requestPlayback
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
