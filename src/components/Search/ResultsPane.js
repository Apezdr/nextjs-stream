import React, { useState, useMemo, Fragment } from 'react'
import { ComboboxOption } from '@headlessui/react'
import Link from 'next/link'
import { buildURL, classNames } from '@src/utils'
import RetryImage from '@components/RetryImage'

/**
 * ResultsPane - Tabs-only component for SearchModal left pane
 *
 * Renders pill-style tabs matching the mockup design.
 * Parent handles virtualization with ComboboxOptions.
 *
 * @param {Array} data - Items to derive counts from
 * @param {Function} onTabChange - Callback when tab changes
 * @param {string} activeTab - Controlled active tab state
 * @param {Object} counts - Optional { all, titles, people }
 */
const ResultsPane = ({
  data = [],
  onTabChange = () => {},
  activeTab = 'all',
  counts = null,
}) => {
  
  // Derive counts from data if not provided
  const tabCounts = useMemo(() => {
    if (counts) return counts
    
    const titleItems = data.filter(item =>
      item.type === 'movie' || item.type === 'tv' || item.matchType === 'title' || item.matchType === 'genre' || item.matchType === 'year' || item.matchType === 'hdr' || item.matchType === 'resolution'
    )
    const peopleItems = data.filter(item =>
      item.type === 'person' || item.matchType === 'person' || item.matchType === 'cast' || item.matchType === 'castName'
    )
    
    return {
      all: data.length,
      titles: titleItems.length,
      people: peopleItems.length,
    }
  }, [data, counts])
  
  return (
    /* Tabs Row Only */
    <div className="flex gap-2 px-3 py-2.5 border-b border-gray-200">
      <button
        type="button"
        className={classNames(
          'inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
          activeTab === 'all'
            ? 'bg-blue-100 border border-blue-200 text-gray-900'
            : 'bg-transparent border border-transparent text-gray-600 hover:bg-gray-50'
        )}
        onClick={() => onTabChange('all')}
        aria-pressed={activeTab === 'all'}
        aria-label="Show all results"
        tabIndex={0}
      >
        All
        <span className={classNames(
          'px-2 py-0.5 rounded-full text-xs font-semibold',
          activeTab === 'all' ? 'bg-gray-100 text-gray-700' : 'bg-gray-100 text-gray-600'
        )}>
          {tabCounts.all}
        </span>
      </button>
      
      {tabCounts.titles > 0 && (
        <button
          type="button"
          className={classNames(
            'inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
            activeTab === 'titles'
              ? 'bg-blue-100 border border-blue-200 text-gray-900'
              : 'bg-transparent border border-transparent text-gray-600 hover:bg-gray-50'
          )}
          onClick={() => onTabChange('titles')}
          aria-pressed={activeTab === 'titles'}
          aria-label="Show titles only"
          tabIndex={0}
        >
          Titles
          <span className={classNames(
            'px-2 py-0.5 rounded-full text-xs font-semibold',
            activeTab === 'titles' ? 'bg-gray-100 text-gray-700' : 'bg-gray-100 text-gray-600'
          )}>
            {tabCounts.titles}
          </span>
        </button>
      )}
      
      {tabCounts.people > 0 && (
        <button
          type="button"
          className={classNames(
            'inline-flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-1',
            activeTab === 'people'
              ? 'bg-blue-100 border border-blue-200 text-gray-900'
              : 'bg-transparent border border-transparent text-gray-600 hover:bg-gray-50'
          )}
          onClick={() => onTabChange('people')}
          aria-pressed={activeTab === 'people'}
          aria-label="Show people only"
          tabIndex={0}
        >
          People
          <span className={classNames(
            'px-2 py-0.5 rounded-full text-xs font-semibold',
            activeTab === 'people' ? 'bg-gray-100 text-gray-700' : 'bg-gray-100 text-gray-600'
          )}>
            {tabCounts.people}
          </span>
        </button>
      )}
    </div>
  )
}

/**
 * ResultsPane.Item - MUST wrap in ComboboxOption for virtualization
 * Fixed height h-[84px] for stable virtualization
 */
const ResultsPaneItem = ({ item, isActive = false, onCastClick = () => {}, onSelect = () => {}, asOption = true }) => {
  // Helper: Render matchType badge
  const renderMatchBadge = (matchType) => {
    if (!matchType) return null
    
    const labels = {
      title: 'Title',
      genre: 'Genre',
      cast: 'Cast',
      year: 'Year',
      hdr: 'HDR',
      resolution: 'Res',
    }
    
    return (
      <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-100 text-indigo-700">
        {labels[matchType] || matchType}
      </span>
    )
  }
  
  // Helper: Format duration
  const formatDuration = (runtime) => {
    if (!runtime) return null
    const hours = Math.floor(runtime / 60)
    const minutes = runtime % 60
    return `${hours}h ${minutes}m`
  }
  
  const isPerson = item.type === 'person' || item.matchType === 'person' || item.matchType === 'castName'
  
  if (isPerson) {
    // Person content
    const personContent = (
      <div className="flex items-center gap-3 w-full min-w-0">
        <div className="relative flex-shrink-0 w-11 h-11 rounded-full overflow-hidden bg-gray-200 border border-gray-300 shadow-md">
          {(item.profile_path || item.metadata?.profile_path) ? (
            <RetryImage
              src={item.profile_path || item.metadata?.profile_path}
              fill
              sizes="44px"
              alt={item.name || 'Person'}
              className="object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-gray-300 to-gray-100 flex items-center justify-center text-gray-500 font-semibold text-lg">
              {(item.name || '?').charAt(0).toUpperCase()}
            </div>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm truncate text-gray-900">{item.name || 'Unknown'}</span>
            {item.matchType && renderMatchBadge(item.matchType)}
          </div>
          <span className="text-xs text-gray-500 truncate block">
            {item.count ? `${item.count} ${item.count === 1 ? 'title' : 'titles'}` : 'Actor'}
          </span>
        </div>
      </div>
    )
    
    // CRITICAL: wrap in ComboboxOption for virtualization
    if (asOption) {
      return (
        <ComboboxOption
          value={item}
          className={({ focus }) =>
            classNames(
              'flex items-center p-2.5 rounded-xl cursor-pointer transition-colors border h-[84px]',
              focus || isActive ? 'bg-blue-50 border-blue-200' : 'bg-transparent border-transparent hover:bg-gray-50'
            )
          }
        >
          {personContent}
        </ComboboxOption>
      )
    }
    
    return <div className="flex items-center p-2.5 rounded-xl border h-[84px]">{personContent}</div>
  }
  
  // Media content
  const mediaContent = (
    <Link href={buildURL(item.url)} className="flex items-center gap-3 w-full min-w-0" onClick={() => onSelect(item)}>
      <div className="relative flex-shrink-0 rounded-lg overflow-hidden border border-gray-200 shadow-lg" style={{ width: '44px', height: '66px' }}>
        <div className="absolute inset-0 z-0" style={{ background: 'linear-gradient(135deg, rgba(11,18,32,0.25), rgba(11,18,32,0.05))' }} />
        {item.posterURL && (
          <RetryImage
            src={item.posterURL}
            fill
            sizes="44px"
            alt={item.title}
            className="object-cover relative z-10"
            placeholder="blur"
            blurDataURL={item.posterBlurhash ? `data:image/png;base64,${item.posterBlurhash}` : undefined}
          />
        )}
        <div className="absolute pointer-events-none z-20" style={{ inset: '-40% -40%', background: 'radial-gradient(circle at 30% 20%, rgba(255,255,255,0.35), transparent 55%)', transform: 'rotate(10deg)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="font-semibold text-sm truncate text-gray-900">{item.title}</span>
          {item.matchType && renderMatchBadge(item.matchType)}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 font-medium text-gray-800">
            {item.type === 'movie' ? 'Movie' : item.type === 'tv' ? 'TV Show' : 'Episode'}
          </span>
          {item.release_date && <span>{new Date(item.release_date).getFullYear()}</span>}
          {item.metadata?.runtime && (<><span>•</span><span>{formatDuration(item.metadata.runtime)}</span></>)}
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {item.hdr && (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(147,51,234,0.10)', borderColor: 'rgba(147,51,234,0.14)', color: 'rgb(147,51,234)', border: '1px solid' }}>
            {item.hdrFormat === 'Dolby Vision' ? 'DV' : 'HDR10'}
          </span>
        )}
        {item.dimensions && item.dimensions.startsWith('3840') && (
          <span className="px-2 py-0.5 rounded text-[10px] font-medium" style={{ background: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.14)', color: 'rgb(34,197,94)', border: '1px solid' }}>
            4K
          </span>
        )}
      </div>
    </Link>
  )
  
  // CRITICAL: wrap in ComboboxOption with fixed height
  if (asOption) {
    return (
      <ComboboxOption
        value={item}
        className={({ focus }) =>
          classNames(
            'flex items-center p-2.5 rounded-xl cursor-pointer transition-colors border h-[84px]',
            focus || isActive ? 'bg-blue-50 border-blue-200' : 'bg-transparent border-transparent hover:bg-gray-50'
          )
        }
      >
        {mediaContent}
      </ComboboxOption>
    )
  }
  
  return <div className="flex items-center p-2.5 rounded-xl border h-[84px]">{mediaContent}</div>
}

ResultsPaneItem.displayName = 'ResultsPaneItem'
ResultsPane.Item = ResultsPaneItem

export default ResultsPane
