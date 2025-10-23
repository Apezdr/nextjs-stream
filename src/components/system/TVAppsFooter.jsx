'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Check if current page is a media player page (like Nav.js does)
 */
const isMediaPageFunc = (pathname) => {
  const moviePattern = /^\/list\/movie\/[^/]+\/play$/;
  const tvPattern = /^\/list\/tv\/[^/]+\/\d+\/\d+\/play$/;
  return moviePattern.test(pathname) || tvPattern.test(pathname);
};

/**
 * Footer component with TV app links that hides on media player pages
 */
export default function TVAppsFooter() {
  const pathname = usePathname();
  const isMediaPage = isMediaPageFunc(pathname);
  const [showInstructions, setShowInstructions] = useState(false);

  // Hide footer on media player pages (same logic as Nav component)
  if (isMediaPage) {
    return null;
  }

  return (
    <footer className="bg-gray-900 text-white py-8">
      <div className="container mx-auto px-4">
        <div className="text-center">
          <h3 className="text-lg font-medium mb-4">Watch on Your TV</h3>
          <p className="text-gray-300 mb-4">
            Get the full streaming experience on your television with our dedicated TV apps
          </p>
          
          <div className="flex flex-col sm:flex-row justify-center items-center gap-6">
            <a
              href="https://play.google.com/store/apps/details?id=com.anonymous.nextjsstreamtvmobile"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-8 py-4 backdrop-blur-sm text-white font-medium rounded-lg transition-all duration-200 group"
            >
              <img
                src="/Google_Play_Store_logo.svg"
                alt="Google Play Store"
                className="h-6 group-hover:scale-105 transition-transform"
              />
            </a>
            <a
              href="https://www.amazon.com/dp/B0FMJ1MY4W"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-8 py-4 backdrop-blur-sm text-white font-medium rounded-lg transition-all duration-200 group"
            >
              <img
                src="/Amazon-appstore-logo.svg"
                alt="Amazon Appstore"
                className="h-6 group-hover:scale-105 transition-transform"
              />
            </a>
          </div>

          {/* Expandable Connection Instructions */}
          {typeof window !== 'undefined' && window.location.origin && (
            <div className="mt-6 mb-3 max-w-md mx-auto justify-items-center">
              <button
                onClick={() => setShowInstructions(!showInstructions)}
                className="text-blue-400 hover:text-blue-300 text-sm font-medium transition-colors duration-200 flex items-center gap-2"
              >
                📱 How to Connect
                <svg
                  className={`w-4 h-4 transition-transform duration-200 ${showInstructions ? 'rotate-180' : ''}`}
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
              
              {showInstructions && (
                <div className="mt-3 p-4 bg-white/10 rounded-lg backdrop-blur-sm border border-white/20 transition-all duration-300 ease-in-out">
                  <p className="text-gray-300 text-sm">
                    1. Install the TV app<br/>
                    2. Enter the site: <strong className="text-white">{window.location.origin.replace('http://', '').replace('https://', '')}</strong><br/>
                    3. Login with QR code
                  </p>
                </div>
              )}
            </div>
          )}
          <p className="text-gray-400 text-sm mt-4">
            Stream your favorite movies and TV shows directly on your TV with enhanced features
          </p>
        </div>
      </div>
    </footer>
  );
}