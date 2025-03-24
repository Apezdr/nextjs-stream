'use client'
import React from 'react';
import { formatNumber } from '../utils';
import { IssueSection } from '../Components/UIComponents';
import { IssuePieChart, IssueBarChart } from '../Components/ChartComponents';
import { PieChartSkeleton, BarChartSkeleton } from '../Components/LoadingStates';

const AnalyticsTab = ({ data, isLoading = false }) => {
  if (isLoading || !data) {
    return (
      <div>
        <h3 className="text-lg font-medium mb-4">All Issues By Type</h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h4 className="font-medium mb-3">Top Issues Distribution</h4>
            <PieChartSkeleton />
          </div>
          
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h4 className="font-medium mb-3">Issues Breakdown</h4>
            <BarChartSkeleton />
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm mb-6">
          <h4 className="font-medium mb-3">All Issue Types</h4>
          <div className="animate-pulse">
            <div className="h-10 bg-gray-200 rounded mb-2"></div>
            <div className="space-y-2">
              {[...Array(8)].map((_, i) => (
                <div key={i} className="h-8 bg-gray-100 rounded"></div>
              ))}
            </div>
          </div>
        </div>
        
        <h3 className="text-lg font-medium mt-8 mb-4">Issue Patterns</h3>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h4 className="font-medium mb-3">Missing Fields</h4>
            <BarChartSkeleton />
          </div>
          
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h4 className="font-medium mb-3">Episode Gaps</h4>
            <BarChartSkeleton />
          </div>
        </div>
        
        {/* Skeleton for Issue Sections */}
        {[...Array(4)].map((_, i) => (
          <div key={i} className="mt-4 border border-gray-200 rounded-lg overflow-hidden animate-pulse">
            <div className="p-4 flex justify-between items-center">
              <div className="h-6 w-40 bg-gray-200 rounded"></div>
              <div className="h-6 w-20 bg-gray-200 rounded"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }
  
  const { overview, issueSummary, issuePatterns } = data;

  // Get the top 5 issues for the pie chart
  const getTopIssues = (issueData, count = 5) => {
    const sortedEntries = Object.entries(issueData)
      .sort((a, b) => b[1] - a[1])
      .slice(0, count);
    
    // Convert back to an object
    return sortedEntries.reduce((obj, [key, value]) => {
      obj[key] = value;
      return obj;
    }, {});
  };

  const topOverallIssues = getTopIssues(issueSummary.total);

  return (
    <div>
      <h3 className="text-lg font-medium mb-4">All Issues By Type</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <h4 className="font-medium mb-3">Top Issues Distribution</h4>
          <IssuePieChart 
            data={topOverallIssues}
            title="Top 5 Issues"
          />
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <h4 className="font-medium mb-3">Issues Breakdown</h4>
          <IssueBarChart 
            data={issueSummary.total}
            maxBars={8}
            colors={{
              backgroundColor: 'rgba(153, 102, 255, 0.6)',
              borderColor: 'rgb(153, 102, 255)'
            }}
          />
        </div>
      </div>
      
      <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm mb-6">
        <h4 className="font-medium mb-3">All Issue Types</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Issue Type</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Count</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Percentage</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {Object.entries(issueSummary.total)
                .sort((a, b) => b[1] - a[1])
                .map(([issue, count]) => (
                <tr key={issue} className="hover:bg-gray-50">
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{issue}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{formatNumber(count)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">
                    {((count / overview.totalIssues) * 100).toFixed(3)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      
      <h3 className="text-lg font-medium mt-8 mb-4">Issue Patterns</h3>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <h4 className="font-medium mb-3">Missing Fields</h4>
          <IssueBarChart 
            data={issuePatterns.missingFields}
            maxBars={8}
            colors={{
              backgroundColor: 'rgba(255, 99, 132, 0.6)',
              borderColor: 'rgb(255, 99, 132)'
            }}
          />
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <h4 className="font-medium mb-3">Episode Gaps</h4>
          {Object.keys(issuePatterns.episodeGaps).length > 0 ? (
            <IssueBarChart 
              data={issuePatterns.episodeGaps}
              maxBars={8}
              colors={{
                backgroundColor: 'rgba(54, 162, 235, 0.6)',
                borderColor: 'rgb(54, 162, 235)'
              }}
            />
          ) : (
            <div className="py-16 text-center text-gray-500">
              No episode gaps detected
            </div>
          )}
        </div>
      </div>
      
      <IssueSection 
        title="Missing Fields" 
        issues={issuePatterns.missingFields}
        color="border-red-200"
      />
      
      <IssueSection 
        title="Missing Seasons" 
        issues={issuePatterns.missingSeasons}
        color="border-orange-200"
      />
      
      <IssueSection 
        title="Missing Episodes" 
        issues={issuePatterns.missingEpisodes}
        color="border-yellow-200"
      />
      
      <IssueSection 
        title="Episode Gaps" 
        issues={issuePatterns.episodeGaps}
        color="border-blue-200"
      />
    </div>
  );
};

export default AnalyticsTab;
