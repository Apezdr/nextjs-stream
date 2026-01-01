'use client'
import React from 'react';
import { Chart as ChartJS, ArcElement, Tooltip, Legend, CategoryScale, LinearScale, BarElement, Title } from 'chart.js';
import { Pie, Bar } from 'react-chartjs-2';
import { formatNumber } from '../utils';

// Register Chart.js components
ChartJS.register(
  ArcElement, 
  Tooltip, 
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  Title
);

/**
 * Pie chart component for displaying issue distribution
 */
export const IssuePieChart = ({ data, title }) => {
  const chartData = {
    labels: Object.keys(data),
    datasets: [
      {
        data: Object.values(data),
        backgroundColor: [
          'rgba(255, 99, 132, 0.6)',   // Red
          'rgba(255, 159, 64, 0.6)',   // Orange
          'rgba(255, 205, 86, 0.6)',   // Yellow
          'rgba(75, 192, 192, 0.6)',   // Green/Blue
          'rgba(54, 162, 235, 0.6)',   // Blue
          'rgba(153, 102, 255, 0.6)',  // Purple
          'rgba(201, 203, 207, 0.6)',  // Grey
        ],
        borderColor: [
          'rgb(255, 99, 132)',
          'rgb(255, 159, 64)',
          'rgb(255, 205, 86)',
          'rgb(75, 192, 192)',
          'rgb(54, 162, 235)',
          'rgb(153, 102, 255)',
          'rgb(201, 203, 207)',
        ],
        borderWidth: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          boxWidth: 12,
          font: {
            size: 11
          }
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = formatNumber(context.raw);
            const total = context.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = Math.round((context.raw / total) * 100);
            return `${label}: ${value} (${percentage}%)`;
          }
        }
      },
      title: {
        display: !!title,
        text: title,
        font: {
          size: 14
        }
      }
    }
  };

  return (
    <div className="h-64 relative">
      <Pie data={chartData} options={options} />
    </div>
  );
};

/**
 * Bar chart component for displaying issue counts
 */
export const IssueBarChart = ({ data, title, maxBars = 10, colors = {
  backgroundColor: 'rgba(54, 162, 235, 0.6)',
  borderColor: 'rgb(54, 162, 235)'
} }) => {
  // Sort data by count in descending order and take top N
  const sortedEntries = Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxBars);
  
  const labels = sortedEntries.map(entry => entry[0]);
  const values = sortedEntries.map(entry => entry[1]);
  
  const chartData = {
    labels,
    datasets: [
      {
        label: 'Count',
        data: values,
        backgroundColor: colors.backgroundColor,
        borderColor: colors.borderColor,
        borderWidth: 1,
      },
    ],
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',  // Makes the bar chart horizontal
    plugins: {
      legend: {
        display: false
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            return `Count: ${formatNumber(context.raw)}`;
          }
        }
      },
      title: {
        display: !!title,
        text: title,
        font: {
          size: 14
        }
      }
    },
    scales: {
      y: {
        ticks: {
          callback: function(value) {
            const label = this.getLabelForValue(value);
            // Truncate long labels
            if (label.length > 25) {
              return label.substring(0, 22) + '...';
            }
            return label;
          }
        }
      },
      x: {
        ticks: {
          callback: function(value) {
            return formatNumber(value);
          }
        }
      }
    }
  };

  return (
    <div className="h-[300px] relative">
      <Bar data={chartData} options={options} />
    </div>
  );
};

/**
 * Distribution chart showing the breakdown of issues by media type
 */
export const MediaTypeDistributionChart = ({ stats }) => {
  // Calculate total issues for percentage display
  const totalIssues = stats.movies.withIssues + stats.tvShows.withIssues + 
                     stats.seasons.withIssues + stats.episodes.withIssues;
                     
  const chartData = {
    labels: ['Movies', 'TV Shows', 'Seasons', 'Episodes'],
    datasets: [
      {
        label: 'Total Items',
        data: [
          stats.movies.total,
          stats.tvShows.total,
          stats.seasons.total,
          stats.episodes.total
        ],
        backgroundColor: 'rgba(54, 162, 235, 0.6)',
        borderColor: 'rgb(54, 162, 235)',
        borderWidth: 1
      },
      {
        label: 'Items with Issues',
        data: [
          stats.movies.withIssues,
          stats.tvShows.withIssues,
          stats.seasons.withIssues,
          stats.episodes.withIssues
        ],
        backgroundColor: 'rgba(255, 99, 132, 0.6)',
        borderColor: 'rgb(255, 99, 132)',
        borderWidth: 1
      }
    ]
  };

  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.dataset.label || '';
            const value = formatNumber(context.raw);
            
            // Add percentage for "Items with Issues" dataset
            if (context.dataset.label === 'Items with Issues') {
              // Calculate percentage of all issues
              const percentage = ((context.raw / totalIssues) * 100).toFixed(1);
              return `${label}: ${value} (${percentage}% of all issues)`;
            }
            
            return `${label}: ${value}`;
          }
        }
      },
      title: {
        display: true,
        text: 'Media Type Distribution',
        font: {
          size: 14
        }
      }
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: {
          callback: function(value) {
            return formatNumber(value);
          }
        }
      }
    }
  };

  // Create a second chart specifically showing the distribution of issues
  const issueDistributionData = {
    labels: ['Movies', 'TV Shows', 'Seasons', 'Episodes'],
    datasets: [
      {
        label: 'Distribution of Issues',
        data: [
          stats.movies.withIssues,
          stats.tvShows.withIssues,
          stats.seasons.withIssues,
          stats.episodes.withIssues
        ],
        backgroundColor: [
          'rgba(255, 99, 132, 0.6)',   // Red
          'rgba(54, 162, 235, 0.6)',   // Blue
          'rgba(255, 159, 64, 0.6)',   // Orange
          'rgba(75, 192, 192, 0.6)'    // Teal
        ],
        borderColor: [
          'rgb(255, 99, 132)',
          'rgb(54, 162, 235)',
          'rgb(255, 159, 64)',
          'rgb(75, 192, 192)'
        ],
        borderWidth: 1
      }
    ]
  };

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'right',
        labels: {
          boxWidth: 12,
          font: {
            size: 11
          }
        }
      },
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = formatNumber(context.raw);
            const percentage = ((context.raw / totalIssues) * 100).toFixed(1);
            return `${label}: ${value} (${percentage}%)`;
          }
        }
      },
      title: {
        display: true,
        text: 'Issue Distribution',
        font: {
          size: 14
        }
      }
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="h-80 relative">
        <Bar data={chartData} options={options} />
      </div>
      <div className="h-80 relative">
        <Pie data={issueDistributionData} options={pieOptions} />
      </div>
    </div>
  );
};
