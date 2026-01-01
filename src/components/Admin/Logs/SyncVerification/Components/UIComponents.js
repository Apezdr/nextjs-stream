'use client'
import React, { useState } from 'react';
import { formatNumber } from '../utils';

/**
 * Component for displaying issue count with label
 */
export const IssueCountBadge = ({ count, label, color = "bg-red-100 text-red-800" }) => (
  <div className="flex items-center gap-2 px-3 py-1 rounded-full text-sm font-medium whitespace-nowrap">
    <span className={`${color} px-2 py-1 rounded-md`}>{formatNumber(count)}</span>
    <span>{label}</span>
  </div>
);

/**
 * Component to display percentage in colored badge based on value
 */
export const PercentageBadge = ({ value }) => {
  const numValue = parseFloat(value);
  let color = "bg-green-100 text-green-800";
  
  if (numValue > 10) color = "bg-yellow-100 text-yellow-800";
  if (numValue > 20) color = "bg-orange-100 text-orange-800";
  if (numValue > 30) color = "bg-red-100 text-red-800";
  
  return (
    <span className={`${color} px-2 py-1 rounded-md`}>
      {value}
    </span>
  );
};

/**
 * Issue detail component that can be expanded/collapsed
 */
export const IssueSection = ({ title, issues, color = "border-blue-200" }) => {
  const [isOpen, setIsOpen] = useState(false);
  
  if (!issues || Object.keys(issues).length === 0) return null;
  
  return (
    <div className={`mt-4 border ${color} rounded-lg overflow-hidden`}>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="flex justify-between items-center w-full p-4 text-left font-medium hover:bg-gray-50"
      >
        <span>{title}</span>
        <span className="text-gray-500">{Object.keys(issues).length} issue types</span>
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
        <div className="px-4 pb-4">
          <div className="max-h-64 overflow-y-auto overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Issue Type</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Count</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {Object.entries(issues).map(([issue, count]) => (
                  <tr key={issue} className="hover:bg-gray-50">
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-900">{issue}</td>
                    <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-500">{formatNumber(count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * Category breakdown component for displaying grouped data
 */
export const CategoryBreakdown = ({ data, title }) => {
  if (!data) return null;
  
  return (
    <div className="mt-4">
      <h3 className="text-lg font-medium">{title}</h3>
      <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(data).map(([category, count]) => (
          <div key={category} className="bg-white p-4 rounded-lg shadow-sm">
            <div className="font-medium">{category}</div>
            <div className="mt-1 text-2xl">{formatNumber(count)}</div>
          </div>
        ))}
      </div>
    </div>
  );
};
