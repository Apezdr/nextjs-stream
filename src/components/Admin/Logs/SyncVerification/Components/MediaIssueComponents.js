'use client'
import React, { useState } from 'react';
import { formatNumber } from '../utils';

/**
 * Media item with issues component (expandable/collapsible)
 */
export const MediaItemWithIssues = ({ item, type }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  // Format title based on media type
  const getTitle = () => {
    if (type === 'movies') {
      return item.title || 'Unknown Movie';
    } else if (type === 'tvShows') {
      return item.title || 'Unknown TV Show';
    } else if (type === 'seasons') {
      return `${item.showTitle || 'Unknown Show'} - Season ${item.seasonNumber || '?'}`;
    } else if (type === 'episodes') {
      return `${item.showTitle || 'Unknown Show'} - S${item.seasonNumber || '?'}E${item.episodeNumber || '?'} - ${item.title || 'Unknown Episode'}`;
    }
    return 'Unknown Media';
  };
  
  const getIssueColor = () => {
    if (item.issues.some(issue => issue.includes('videoURL') || issue.includes('metadata'))) {
      return "bg-red-50 border-red-200 hover:bg-red-50/50"; // Critical issue
    } else if (item.issues.some(issue => issue.includes('posterURL'))) {
      return "bg-orange-50 border-orange-200 hover:bg-orange-50/50"; // Important issue
    } else if (item.issues.some(issue => issue.includes('overview') || issue.includes('title') || issue.includes('thumbnail'))) {
      return "bg-yellow-50 border-yellow-200 hover:bg-yellow-50/50"; // Medium issue
    }
    return "bg-blue-50 border-blue-200 hover:bg-blue-50/50"; // Minor issue
  };
  
  return (
    <div className={`mb-2 border rounded-lg overflow-hidden ${getIssueColor()}`}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex justify-between items-center w-full p-3 text-left"
      >
        <div className="flex items-center">
          <span className="font-medium">{getTitle()}</span>
          <span className="ml-3 text-xs px-2 py-1 bg-gray-200 text-gray-800 rounded">{item.issues.length} issues</span>
        </div>
        <svg 
          className={`w-5 h-5 transition-transform ${isOpen ? 'transform rotate-180' : ''}`} 
          xmlns="http://www.w3.org/2000/svg" 
          viewBox="0 0 20 20" 
          fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
        </svg>
      </button>
      
      {isOpen && (
        <div className="px-4 py-3 border-t">
          <div className="flex flex-wrap gap-2 mb-2">
            {item.issues.map((issue, idx) => (
              <span 
                key={idx} 
                className="text-xs px-2 py-1 bg-gray-100 text-gray-800 rounded"
              >
                {issue}
              </span>
            ))}
          </div>
          
          <div className="grid grid-cols-2 gap-2 text-sm">
            {type === 'movies' && (
              <>
                <div className="text-gray-500">Original Title:</div>
                <div>{item.originalTitle || 'N/A'}</div>
                {item.videoSource && (
                  <>
                    <div className="text-gray-500">Source Server:</div>
                    <div>{item.videoSource}</div>
                  </>
                )}
              </>
            )}
            
            {(type === 'seasons' || type === 'episodes') && (
              <>
                <div className="text-gray-500">Show:</div>
                <div>{item.showTitle || 'N/A'}</div>
                <div className="text-gray-500">Season:</div>
                <div>{item.seasonNumber || 'N/A'}</div>
                {type === 'episodes' && (
                  <>
                    <div className="text-gray-500">Episode:</div>
                    <div>{item.episodeNumber || 'N/A'}</div>
                    {item.videoSource && (
                      <>
                        <div className="text-gray-500">Source Server:</div>
                        <div>{item.videoSource}</div>
                      </>
                    )}
                  </>
                )}
              </>
            )}
            
            {item.id && (
              <>
                <div className="text-gray-500">ID:</div>
                <div className="text-xs">{item.id}</div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Media category component for detailed issues tab
 */
export const MediaCategoryIssues = ({ items, title, type }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  if (!items || items.length === 0) return null;
  
  return (
    <div className="mb-6 border border-gray-200 rounded-lg overflow-hidden">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex justify-between items-center w-full p-4 text-left font-medium bg-gray-50 hover:bg-gray-100"
      >
        <span className="text-lg">{title}</span>
        <div className="flex items-center">
          <span className="mr-4 text-gray-500 text-sm">{items.length} items</span>
          <svg 
            className={`w-5 h-5 transition-transform ${isOpen ? 'transform rotate-180' : ''}`} 
            xmlns="http://www.w3.org/2000/svg" 
            viewBox="0 0 20 20" 
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </button>
      
      {isOpen && (
        <div className="p-4">
          <div className="max-h-96 overflow-y-auto">
            {items.map((item, index) => (
              <MediaItemWithIssues key={item.id || index} item={item} type={type} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
