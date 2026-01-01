'use client'
import React from 'react';

/**
 * Skeleton loader for stat cards
 */
export const StatCardSkeleton = () => (
  <div className="flex-1 min-w-[200px] bg-gray-50 rounded-lg p-4 animate-pulse">
    <div className="h-4 w-32 bg-gray-200 rounded mb-2"></div>
    <div className="h-8 w-20 bg-gray-300 rounded mt-1"></div>
  </div>
);

/**
 * Skeleton loader for the pie chart
 */
export const PieChartSkeleton = ({ height = "h-64" }) => (
  <div className={`${height} relative rounded-lg bg-gray-50 animate-pulse flex items-center justify-center`}>
    <div className="relative w-36 h-36 rounded-full bg-gray-200 overflow-hidden">
      <div className="absolute w-full h-full">
        <div className="absolute top-0 left-0 w-1/2 h-1/2 bg-gray-300"></div>
        <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-gray-250"></div>
        <div className="absolute bottom-0 left-0 w-1/2 h-1/2 bg-gray-350"></div>
        <div className="absolute bottom-0 right-0 w-1/2 h-1/2 bg-gray-300"></div>
      </div>
    </div>
    <div className="absolute right-4 top-4 space-y-2">
      <div className="h-3 w-20 bg-gray-300 rounded"></div>
      <div className="h-3 w-16 bg-gray-300 rounded"></div>
      <div className="h-3 w-24 bg-gray-300 rounded"></div>
      <div className="h-3 w-16 bg-gray-300 rounded"></div>
    </div>
  </div>
);

/**
 * Skeleton loader for the bar chart
 */
export const BarChartSkeleton = ({ height = "h-[300px]" }) => (
  <div className={`${height} relative rounded-lg bg-gray-50 animate-pulse flex flex-col justify-center p-4`}>
    <div className="space-y-4 w-full">
      <div className="flex items-center">
        <div className="h-4 w-32 bg-gray-300 rounded mr-4"></div>
        <div className="h-6 flex-grow bg-gray-200 rounded"></div>
      </div>
      <div className="flex items-center">
        <div className="h-4 w-24 bg-gray-300 rounded mr-4"></div>
        <div className="h-6 flex-grow bg-gray-200 rounded"></div>
      </div>
      <div className="flex items-center">
        <div className="h-4 w-36 bg-gray-300 rounded mr-4"></div>
        <div className="h-6 flex-grow bg-gray-200 rounded"></div>
      </div>
      <div className="flex items-center">
        <div className="h-4 w-20 bg-gray-300 rounded mr-4"></div>
        <div className="h-6 flex-grow bg-gray-200 rounded"></div>
      </div>
      <div className="flex items-center">
        <div className="h-4 w-28 bg-gray-300 rounded mr-4"></div>
        <div className="h-6 flex-grow bg-gray-200 rounded"></div>
      </div>
    </div>
  </div>
);

/**
 * Skeleton loader for issue count badges
 */
export const IssueBadgeSkeleton = () => (
  <div className="inline-flex items-center px-3 py-1 rounded-full bg-gray-200 animate-pulse">
    <div className="h-4 w-16 bg-gray-300 rounded"></div>
  </div>
);

/**
 * Skeleton loader for issue cards
 */
export const IssueCardSkeleton = () => (
  <div className="bg-white border border-gray-200 rounded-lg shadow-sm animate-pulse">
    <div className="px-4 py-3 border-b border-gray-200">
      <div className="h-4 w-40 bg-gray-300 rounded"></div>
    </div>
    <div className="p-4">
      <div className="flex flex-wrap gap-2 mb-4">
        <IssueBadgeSkeleton />
        <IssueBadgeSkeleton />
        <IssueBadgeSkeleton />
        <IssueBadgeSkeleton />
      </div>
      <BarChartSkeleton />
    </div>
  </div>
);

/**
 * Skeleton loader for detailed issues table
 */
export const DetailedIssuesTableSkeleton = () => (
  <div className="bg-white rounded-lg animate-pulse">
    <div className="overflow-hidden">
      <div className="p-4 border-b">
        <div className="h-4 w-1/2 bg-gray-300 rounded mb-2"></div>
        <div className="h-10 w-full bg-gray-200 rounded mt-1"></div>
      </div>
      <div className="p-4">
        <div className="space-y-4">
          {Array(5).fill().map((_, index) => (
            <div key={index} className="w-full flex py-3">
              <div className="w-1/3 h-6 bg-gray-200 rounded"></div>
              <div className="w-1/3 h-6 ml-4 bg-gray-200 rounded"></div>
              <div className="w-1/6 h-6 ml-4 bg-gray-200 rounded"></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);
