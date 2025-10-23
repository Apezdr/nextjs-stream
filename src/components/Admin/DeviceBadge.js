'use client'

import { memo } from 'react'
import {
  ComputerDesktopIcon,
  TvIcon,
  DeviceTabletIcon,
  DevicePhoneMobileIcon
} from '@heroicons/react/24/outline'
import {
  getBrowserIcon,
  getBrowserTypeLabel,
  detectBrowserType,
  detectTVManufacturer,
  getTVManufacturerIcon,
  getTVManufacturerLabel
} from '@src/utils/deviceDetection'

const deviceConfig = {
  tv: {
    label: 'TV',
    icon: TvIcon,
    bgColor: 'bg-purple-100',
    textColor: 'text-purple-800',
    borderColor: 'border-purple-200'
  },
  desktop: {
    label: 'Desktop',
    icon: ComputerDesktopIcon,
    bgColor: 'bg-blue-100',
    textColor: 'text-blue-800',
    borderColor: 'border-blue-200'
  },
  mobile: {
    label: 'Mobile',
    icon: DevicePhoneMobileIcon,
    bgColor: 'bg-green-100',
    textColor: 'text-green-800',
    borderColor: 'border-green-200'
  },
  tablet: {
    label: 'Tablet',
    icon: DeviceTabletIcon,
    bgColor: 'bg-orange-100',
    textColor: 'text-orange-800',
    borderColor: 'border-orange-200'
  }
}

const DeviceBadge = memo(function DeviceBadge({
  deviceType,
  userAgent,
  style = 'compact', // 'compact' for icon-only, 'badge' for colored background
  size = 'medium',
  showLabel = false,
  className = ''
}) {
  if (!deviceType || !deviceConfig[deviceType]) {
    return null
  }

  const config = deviceConfig[deviceType]
  const IconComponent = config.icon
  
  // Parse browser from userAgent on-demand (for all devices, but prioritize TV manufacturer for TV devices)
  const browserType = userAgent ? detectBrowserType(userAgent) : null
  const browserIconPath = browserType && browserType !== 'unknown' ? getBrowserIcon(browserType) : null
  const browserLabel = browserType && browserType !== 'unknown' ? getBrowserTypeLabel(browserType) : ''
  
  // Parse TV manufacturer from userAgent on-demand (for TV devices only)
  const tvManufacturer = userAgent && deviceType === 'tv' ? detectTVManufacturer(userAgent) : null
  const tvManufacturerIconPath = tvManufacturer && tvManufacturer !== 'unknown' ? getTVManufacturerIcon(tvManufacturer) : null
  const tvManufacturerLabel = tvManufacturer && tvManufacturer !== 'unknown' ? getTVManufacturerLabel(tvManufacturer) : ''

  // Create detailed tooltip text
  const getTooltipContent = () => {
    const baseText = `Last watched on ${config.label}`
    
    if (deviceType === 'tv' && tvManufacturerLabel) {
      return `${baseText} (${tvManufacturerLabel})`
    }
    
    if (browserLabel) {
      return `${baseText} using ${browserLabel}`
    }
    
    return baseText
  }

  // Compact style (icon-only with hover tooltips)
  if (style === 'compact') {
    return (
      <div
        className={`inline-flex items-center gap-0.5 opacity-60 hover:opacity-100 transition-opacity ${className}`}
        title={getTooltipContent()}
      >
        {/* Device Type Icon (Heroicon) - Always shown */}
        <IconComponent className="w-4 h-4 text-gray-500" />
        
        {/* Browser Icon (for non-TV devices) */}
        {browserIconPath && deviceType !== 'tv' && (
          <img
            src={`/devices/browsers/${browserIconPath}`}
            alt={browserLabel}
            className="w-4 h-4 opacity-80"
          />
        )}
        
        {/* TV Manufacturer Icon (for TV devices only) */}
        {tvManufacturerIconPath && deviceType === 'tv' && (
          <img
            src={`/devices/manufacturers/${tvManufacturerIconPath}`}
            alt={tvManufacturerLabel}
            className="w-4 h-4 opacity-80"
          />
        )}
      </div>
    )
  }

  // Badge style (colored background with icons and optional labels)
  const isSmall = size === 'small'
  const badgeClasses = [
    'inline-flex items-center font-medium rounded-full border',
    isSmall ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-xs',
    config.bgColor,
    config.textColor,
    config.borderColor,
    className
  ].filter(Boolean).join(' ')

  return (
    <span className={badgeClasses} title={getTooltipContent()}>
      {/* Device Type Icon (Heroicon) */}
      <IconComponent className={`${isSmall ? 'w-3 h-3' : 'w-4 h-4'}`} />
      
      {/* Browser Icon (for non-TV devices) */}
      {browserIconPath && deviceType !== 'tv' && (
        <img
          src={`/devices/browsers/${browserIconPath}`}
          alt={browserLabel}
          className={`${isSmall ? 'w-3 h-3 ml-1' : 'w-4 h-4 ml-1.5'}`}
        />
      )}
      
      {/* TV Manufacturer Icon (for TV devices only) */}
      {tvManufacturerIconPath && deviceType === 'tv' && (
        <img
          src={`/devices/manufacturers/${tvManufacturerIconPath}`}
          alt={tvManufacturerLabel}
          className={`${isSmall ? 'w-3 h-3 ml-1' : 'w-4 h-4 ml-1.5'}`}
        />
      )}
      
      {showLabel && (
        <span className={isSmall ? 'ml-1' : 'ml-1.5'}>
          {config.label}
          {deviceType === 'tv' && tvManufacturerLabel && ` (${tvManufacturerLabel})`}
          {deviceType !== 'tv' && browserLabel && ` (${browserLabel})`}
        </span>
      )}
    </span>
  )
})

export default DeviceBadge