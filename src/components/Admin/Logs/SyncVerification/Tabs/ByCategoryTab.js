'use client'
import React from 'react';
import { formatNumber } from '../utils';
import { MediaTypeDistributionChart, IssueBarChart } from '../Components/ChartComponents';
import { StatCardSkeleton, PieChartSkeleton, BarChartSkeleton } from '../Components/LoadingStates';

const ByCategoryTab = ({ data, isLoading = false }) => {
  if (isLoading || !data) {
    return (
      <div>
        {/* Loading state for the media type distribution chart */}
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 mb-6">
          <PieChartSkeleton />
        </div>
        
        {/* Loading state for media type stats cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
          <StatCardSkeleton />
        </div>
        
        <div className="mt-8">
          <h3 className="text-lg font-medium mb-4">Issues by Media Type</h3>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Loading state for movie issues */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h4 className="font-medium mb-3">Movie Issues</h4>
              <div className="mb-4">
                <BarChartSkeleton />
              </div>
              
              <div className="animate-pulse">
                <div className="h-10 bg-gray-200 rounded mb-2"></div>
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-8 bg-gray-100 rounded"></div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Loading state for TV show issues */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h4 className="font-medium mb-3">TV Show Issues</h4>
              <div className="mb-4">
                <BarChartSkeleton />
              </div>
              
              <div className="animate-pulse">
                <div className="h-10 bg-gray-200 rounded mb-2"></div>
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-8 bg-gray-100 rounded"></div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Loading state for season issues */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h4 className="font-medium mb-3">Season Issues</h4>
              <div className="mb-4">
                <BarChartSkeleton />
              </div>
              
              <div className="animate-pulse">
                <div className="h-10 bg-gray-200 rounded mb-2"></div>
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-8 bg-gray-100 rounded"></div>
                  ))}
                </div>
              </div>
            </div>
            
            {/* Loading state for episode issues */}
            <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
              <h4 className="font-medium mb-3">Episode Issues</h4>
              <div className="mb-4">
                <BarChartSkeleton />
              </div>
              
              <div className="animate-pulse">
                <div className="h-10 bg-gray-200 rounded mb-2"></div>
                <div className="space-y-2">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="h-8 bg-gray-100 rounded"></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
  
  const { stats, issueSummary } = data;

  const totalIssues = stats.movies.withIssues + stats.tvShows.withIssues + 
                      stats.seasons.withIssues + stats.episodes.withIssues;

  return (
    <div>
      {/* Media Type Distribution Chart */}
      <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 mb-6">
        <MediaTypeDistributionChart stats={stats} />
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="text-sm font-medium text-gray-500">Movies</div>
          <div className="mt-1 text-2xl font-semibold">{formatNumber(stats.movies.total)}</div>
          <div className="mt-2 flex flex-col gap-1">
            <div className="flex gap-2 items-center text-sm">
              <span className="text-gray-500">With Issues:</span>
              <span className="font-medium">{formatNumber(stats.movies.withIssues)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Within category: {((stats.movies.withIssues / stats.movies.total) * 100).toFixed(1)}%</span>
              <span>Of all issues: {((stats.movies.withIssues / totalIssues) * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="text-sm font-medium text-gray-500">TV Shows</div>
          <div className="mt-1 text-2xl font-semibold">{formatNumber(stats.tvShows.total)}</div>
          <div className="mt-2 flex flex-col gap-1">
            <div className="flex gap-2 items-center text-sm">
              <span className="text-gray-500">With Issues:</span>
              <span className="font-medium">{formatNumber(stats.tvShows.withIssues)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Within category: {((stats.tvShows.withIssues / stats.tvShows.total) * 100).toFixed(1)}%</span>
              <span>Of all issues: {((stats.tvShows.withIssues / totalIssues) * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="text-sm font-medium text-gray-500">Seasons</div>
          <div className="mt-1 text-2xl font-semibold">{formatNumber(stats.seasons.total)}</div>
          <div className="mt-2 flex flex-col gap-1">
            <div className="flex gap-2 items-center text-sm">
              <span className="text-gray-500">With Issues:</span>
              <span className="font-medium">{formatNumber(stats.seasons.withIssues)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Within category: {((stats.seasons.withIssues / stats.seasons.total) * 100).toFixed(1)}%</span>
              <span>Of all issues: {((stats.seasons.withIssues / totalIssues) * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
        
        <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
          <div className="text-sm font-medium text-gray-500">Episodes</div>
          <div className="mt-1 text-2xl font-semibold">{formatNumber(stats.episodes.total)}</div>
          <div className="mt-2 flex flex-col gap-1">
            <div className="flex gap-2 items-center text-sm">
              <span className="text-gray-500">With Issues:</span>
              <span className="font-medium">{formatNumber(stats.episodes.withIssues)}</span>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span>Within category: {((stats.episodes.withIssues / stats.episodes.total) * 100).toFixed(1)}%</span>
              <span>Of all issues: {((stats.episodes.withIssues / totalIssues) * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      </div>
      
      <div className="mt-8">
        <h3 className="text-lg font-medium mb-4">Issues by Media Type</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h4 className="font-medium mb-3">Movie Issues</h4>
            <div className="mb-4">
              <IssueBarChart 
                data={issueSummary.byCategory.movies}
                title="Top Movie Issues"
                maxBars={6}
                colors={{
                  backgroundColor: 'rgba(255, 99, 132, 0.6)',
                  borderColor: 'rgb(255, 99, 132)'
                }}
              />
            </div>
            
            <div className='overflow-x-auto'>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Issue Type</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Count</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Object.entries(issueSummary.byCategory.movies).map(([issue, count]) => (
                    <tr key={issue} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{issue}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{formatNumber(count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h4 className="font-medium mb-3">TV Show Issues</h4>
            <div className="mb-4">
              <IssueBarChart 
                data={issueSummary.byCategory.tvShows}
                title="Top TV Show Issues"
                maxBars={6}
                colors={{
                  backgroundColor: 'rgba(54, 162, 235, 0.6)',
                  borderColor: 'rgb(54, 162, 235)'
                }}
              />
            </div>
            
            <div className='overflow-x-auto'>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Issue Type</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Count</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Object.entries(issueSummary.byCategory.tvShows).map(([issue, count]) => (
                    <tr key={issue} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{issue}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{formatNumber(count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h4 className="font-medium mb-3">Season Issues</h4>
            <div className="mb-4">
              <IssueBarChart 
                data={issueSummary.byCategory.seasons}
                title="Top Season Issues"
                maxBars={6}
                colors={{
                  backgroundColor: 'rgba(255, 159, 64, 0.6)',
                  borderColor: 'rgb(255, 159, 64)'
                }}
              />
            </div>
            <div className='overflow-x-auto'>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Issue Type</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Count</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Object.entries(issueSummary.byCategory.seasons).map(([issue, count]) => (
                    <tr key={issue} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{issue}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{formatNumber(count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          
          <div className="bg-white rounded-lg border border-gray-200 p-4 shadow-sm">
            <h4 className="font-medium mb-3">Episode Issues</h4>
            <div className="mb-4">
              <IssueBarChart 
                data={issueSummary.byCategory.episodes}
                title="Top Episode Issues"
                maxBars={6}
                colors={{
                  backgroundColor: 'rgba(75, 192, 192, 0.6)',
                  borderColor: 'rgb(75, 192, 192)'
                }}
              />
            </div>
            
            <div className='overflow-x-auto'>
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Issue Type</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Count</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {Object.entries(issueSummary.byCategory.episodes).map(([issue, count]) => (
                    <tr key={issue} className="hover:bg-gray-50">
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{issue}</td>
                      <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{formatNumber(count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ByCategoryTab;
