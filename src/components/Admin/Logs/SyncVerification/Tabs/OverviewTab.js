'use client'
import React from 'react';
import { formatNumber } from '../utils';
import { IssueCountBadge, PercentageBadge } from '../Components/UIComponents';
import { IssuePieChart, IssueBarChart } from '../Components/ChartComponents';
import { PieChartSkeleton, IssueCardSkeleton } from '../Components/LoadingStates';

const OverviewTab = ({ data, isLoading = false }) => {
  // If loading, show skeleton UI
  if (isLoading || !data) {
    return (
      <div>
        <h3 className="text-lg font-medium mb-4">Issue Type Summary</h3>
        
        {/* Skeleton chart for top issue types */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 mb-6">
          <h4 className="text-base font-medium mb-3">Issue Distribution</h4>
          <PieChartSkeleton />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <div className="bg-white border border-red-100 rounded-lg p-4 shadow-sm animate-pulse">
            <div className="text-sm font-medium text-gray-500">Missing Fields</div>
            <div className="mt-1 h-8 w-20 bg-gray-300 rounded"></div>
            <div className="text-xs text-gray-500 mt-1">Essential fields missing</div>
          </div>
          
          <div className="bg-white border border-yellow-100 rounded-lg p-4 shadow-sm animate-pulse">
            <div className="text-sm font-medium text-gray-500">Missing Metadata</div>
            <div className="mt-1 h-8 w-20 bg-gray-300 rounded"></div>
            <div className="text-xs text-gray-500 mt-1">Non-essential data missing</div>
          </div>
          
          <div className="bg-white border border-orange-100 rounded-lg p-4 shadow-sm animate-pulse">
            <div className="text-sm font-medium text-gray-500">Relationship Issues</div>
            <div className="mt-1 h-8 w-20 bg-gray-300 rounded"></div>
            <div className="text-xs text-gray-500 mt-1">Missing seasons or episodes</div>
          </div>
          
          <div className="bg-white border border-blue-100 rounded-lg p-4 shadow-sm animate-pulse">
            <div className="text-sm font-medium text-gray-500">Episode Gaps</div>
            <div className="mt-1 h-8 w-20 bg-gray-300 rounded"></div>
            <div className="text-xs text-gray-500 mt-1">Missing episodes in sequences</div>
          </div>
        </div>
        
        <h3 className="text-lg font-medium mb-4">Top Issues</h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <IssueCardSkeleton />
          <IssueCardSkeleton />
        </div>
      </div>
    );
  }

  const { overview, topIssues, issuePatterns, stats } = data;
  
  return (
    <div>
      <h3 className="text-lg font-medium mb-4">Issue Type Summary</h3>
      
      {/* Chart for top issue types */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 mb-6">
        <h4 className="text-base font-medium mb-3">Issue Distribution</h4>
        <IssuePieChart 
          data={topIssues} 
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-red-100 rounded-lg p-4 shadow-sm">
          <div className="text-sm font-medium text-gray-500">Missing Fields</div>
          <div className="mt-1 text-2xl font-semibold text-red-600">{formatNumber(topIssues.missingFields)}</div>
          <div className="text-xs text-gray-500 mt-1">Essential fields missing</div>
        </div>
        
        <div className="bg-white border border-yellow-100 rounded-lg p-4 shadow-sm">
          <div className="text-sm font-medium text-gray-500">Missing Metadata</div>
          <div className="mt-1 text-2xl font-semibold text-yellow-600">{formatNumber(topIssues.missingMetadata)}</div>
          <div className="text-xs text-gray-500 mt-1">Non-essential data missing</div>
        </div>
        
        <div className="bg-white border border-orange-100 rounded-lg p-4 shadow-sm">
          <div className="text-sm font-medium text-gray-500">Relationship Issues</div>
          <div className="mt-1 text-2xl font-semibold text-orange-600">{formatNumber(topIssues.relationshipIssues)}</div>
          <div className="text-xs text-gray-500 mt-1">Missing seasons or episodes</div>
        </div>
        
        <div className="bg-white border border-blue-100 rounded-lg p-4 shadow-sm">
          <div className="text-sm font-medium text-gray-500">Episode Gaps</div>
          <div className="mt-1 text-2xl font-semibold text-blue-600">{formatNumber(topIssues.gapIssues)}</div>
          <div className="text-xs text-gray-500 mt-1">Missing episodes in sequences</div>
        </div>
      </div>
      
      <h3 className="text-lg font-medium mb-4">Top Issues</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-sm font-medium">Most Common Missing Fields</h3>
          </div>
          <div className="p-4">
            <div className="flex flex-wrap gap-2 mb-4">
              {Object.entries(issuePatterns.missingFields)
                .slice(0, 6)
                .map(([issue, count]) => (
                  <IssueCountBadge 
                    key={issue}
                    count={count}
                    label={issue}
                    color="bg-red-100 text-red-800"
                  />
                ))}
            </div>
            
            {/* Bar chart for missing fields */}
            <div className="mt-6">
              <IssueBarChart 
                data={issuePatterns.missingFields}
                maxBars={8}
                colors={{
                  backgroundColor: 'rgba(255, 99, 132, 0.6)',
                  borderColor: 'rgb(255, 99, 132)'
                }}
              />
            </div>
          </div>
        </div>
        
        {Object.keys(issuePatterns.missingSeasons).length > 0 || Object.keys(issuePatterns.missingEpisodes).length > 0 ? (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-medium">Missing Seasons & Episodes</h3>
            </div>
            <div className="p-4">
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.entries({...issuePatterns.missingSeasons, ...issuePatterns.missingEpisodes})
                  .slice(0, 6)
                  .map(([issue, count]) => (
                    <IssueCountBadge 
                      key={issue}
                      count={count}
                      label={issue}
                      color="bg-orange-100 text-orange-800"
                    />
                  ))}
              </div>
              
              {/* Bar chart for missing episodes/seasons */}
              <div className="mt-6">
                <IssueBarChart 
                  data={{...issuePatterns.missingSeasons, ...issuePatterns.missingEpisodes}}
                  maxBars={8}
                  colors={{
                    backgroundColor: 'rgba(255, 159, 64, 0.6)',
                    borderColor: 'rgb(255, 159, 64)'
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-sm font-medium">Episode Gaps</h3>
            </div>
            <div className="p-4">
              {Object.keys(issuePatterns.episodeGaps).length > 0 ? (
                <>
                  <div className="flex flex-wrap gap-2 mb-4">
                    {Object.entries(issuePatterns.episodeGaps)
                      .slice(0, 6)
                      .map(([issue, count]) => (
                        <IssueCountBadge 
                          key={issue}
                          count={count}
                          label={issue}
                          color="bg-blue-100 text-blue-800"
                        />
                      ))}
                  </div>
                  
                  {/* Bar chart for episode gaps */}
                  <div className="mt-6">
                    <IssueBarChart 
                      data={issuePatterns.episodeGaps}
                      maxBars={8}
                      colors={{
                        backgroundColor: 'rgba(54, 162, 235, 0.6)',
                        borderColor: 'rgb(54, 162, 235)'
                      }}
                    />
                  </div>
                </>
              ) : (
                <div className="py-8 text-center text-gray-500">
                  No episode gaps detected
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      
    </div>
  );
};

export default OverviewTab;
