'use client';

import React from 'react';
import RadarrQueue from './RadarrQueue';
import SonarrQueue from './SonarrQueue';
import TdarrProgressBar from './TdarrProgressBar';
import DashboardCard from './DashboardCard';
import DownloadStatus from './SABNZBDdownload';

/**
 * QueueDashboard component - Wrapper for all media queue components
 * @param {Object} props
 * @param {Object} props.sabnzbdQueue - SABNZBD queue data
 * @param {Object} props.radarrQueue - Radarr queue data
 * @param {Object} props.sonarrQueue - Sonarr queue data
 * @param {Object} props.tdarrQueue - Tdarr queue data
 * @param {Array} props.unsupportedQueues - List of unsupported integrations
 */
const QueueDashboard = ({ 
  sabnzbdQueue, 
  radarrQueue, 
  sonarrQueue, 
  tdarrQueue,
  unsupportedQueues = []
}) => {
  return (
    <section aria-labelledby="media-queues-heading">
      <h2 id="media-queues-heading" className="text-2xl font-bold mb-4 mt-8">Media Processing Queues</h2>
      
      {/* Show unsupported queues warning if any */}
      {unsupportedQueues.length > 0 && (
        <div className="mb-6 p-4 bg-yellow-100 border border-yellow-400 text-yellow-700 rounded">
          <h3 className="font-semibold">Unsupported Integrations:</h3>
          <ul className="list-disc list-inside">
            {[...new Set(unsupportedQueues)].map((queue) => (
              <li key={queue}>{queue} is not supported.</li>
            ))}
          </ul>
        </div>
      )}
      
      {/* Queue cards grid - adjusts based on screen size */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 mb-8">
        {/* SABNZBD Download Status */}
        {sabnzbdQueue && (
          <div className="col-span-1">
            <DashboardCard 
              title="Download Status" 
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              }
              status={sabnzbdQueue?.queue?.status}
            >
              <div id="sabnzbd-content">
                <DownloadStatus data={sabnzbdQueue.queue} />
              </div>
            </DashboardCard>
          </div>
        )}
        
        {/* Radarr Queue */}
        {radarrQueue && (
          <div className="col-span-1">
            <RadarrQueue data={radarrQueue} />
          </div>
        )}
        
        {/* Sonarr Queue */}
        {sonarrQueue && (
          <div className="col-span-1">
            <SonarrQueue data={sonarrQueue} />
          </div>
        )}
        
        {/* Tdarr Queue */}
        {tdarrQueue && (
          <div className="col-span-1 md:col-span-2 xl:col-span-1">
            <TdarrProgressBar data={tdarrQueue} />
          </div>
        )}
      </div>
    </section>
  );
};

export default QueueDashboard;