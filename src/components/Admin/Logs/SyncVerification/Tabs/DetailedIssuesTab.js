'use client'
import React from 'react';
import { MediaCategoryIssues } from '../Components/MediaIssueComponents';
import { DetailedIssuesTableSkeleton } from '../Components/LoadingStates';

const DetailedIssuesTab = ({ data, isLoading = false }) => {
  if (isLoading || !data) {
    return (
      <div>
        <h3 className="text-lg font-medium mb-4">Detailed Media Issues</h3>
        <p className="mb-6 text-sm text-gray-500">
          Expand each category to see specific media items with issues. 
          Items are color-coded by severity: <span className="text-red-600">red</span> for critical issues, 
          <span className="text-orange-600"> orange</span> for important issues, and 
          <span className="text-blue-600"> blue</span> for minor issues.
        </p>
        
        {/* Loading states for each media category */}
        {[...Array(4)].map((_, i) => (
          <div key={i} className="mb-6 border border-gray-200 rounded-lg overflow-hidden animate-pulse">
            <div className="flex justify-between items-center w-full p-4 bg-gray-50">
              <div className="h-6 w-40 bg-gray-200 rounded"></div>
              <div className="flex items-center">
                <div className="h-4 w-20 bg-gray-200 rounded mr-4"></div>
                <div className="h-5 w-5 bg-gray-200 rounded-full"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const { issues } = data;
  
  if (!issues || (
    !issues.movies.length && 
    !issues.tvShows.length &&
    !issues.seasons.length &&
    !issues.episodes.length
  )) {
    return (
      <div className="p-6 text-center bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-gray-500">No detailed issues to display. Either there are no issues, or the issue detection level is set to summary only.</p>
        <p className="text-sm text-gray-400 mt-2">Try running a full sync verification to generate detailed issue reports.</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-lg font-medium mb-4">Detailed Media Issues</h3>
      <p className="mb-6 text-sm text-gray-500">
        Expand each category to see specific media items with issues. 
        Items are color-coded by severity: <span className="text-red-600">red</span> for critical issues, 
        <span className="text-orange-600"> orange</span> for important issues, and 
        <span className="text-blue-600"> blue</span> for minor issues.
      </p>
      
      <MediaCategoryIssues 
        items={issues.movies} 
        title={`Movies with Issues (${issues.movies.length})`}
        type="movies"
      />
      
      <MediaCategoryIssues 
        items={issues.tvShows} 
        title={`TV Shows with Issues (${issues.tvShows.length})`}
        type="tvShows"
      />
      
      <MediaCategoryIssues 
        items={issues.seasons} 
        title={`Seasons with Issues (${issues.seasons.length})`}
        type="seasons"
      />
      
      <MediaCategoryIssues 
        items={issues.episodes} 
        title={`Episodes with Issues (${issues.episodes.length})`}
        type="episodes"
      />
    </div>
  );
};

export default DetailedIssuesTab;
