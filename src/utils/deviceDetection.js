import { UAParser } from 'ua-parser-js'

/**
 * Device Detection Utility for Playback Tracking
 * 
 * Detects device types from User-Agent strings for basic device tracking.
 * Aligns with existing QR auth device types: 'tv' | 'mobile' | 'tablet' | 'desktop'
 */

/**
 * Device type as used throughout the application
 * @typedef {'tv' | 'mobile' | 'tablet' | 'desktop'} DeviceType
 */

/**
 * Browser type detected from User-Agent string
 * @typedef {'chrome' | 'firefox' | 'safari' | 'edge' | 'brave' | 'opera' | 'tor' | 'vivaldi' | 'unknown'} BrowserType
 */

/**
 * Basic device information for playback tracking
 * @typedef {Object} PlaybackDeviceInfo
 * @property {DeviceType} type - The device type
 * @property {Date} lastUsed - When this device was last used for playback
 * @property {string} [userAgent] - Optional: truncated User-Agent for debugging (first 100 chars)
 */

/**
 * Detects device type from User-Agent string
 * @param {string} userAgent - The User-Agent string from request headers
 * @returns {DeviceType} The detected device type
 */
export function detectDeviceType(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') {
    return null // Default fallback
  }

  const ua = userAgent.toLowerCase()

  // TV/Smart TV Detection (highest priority)
  // Custom NextJS Stream TV App detection (most reliable)
  if (ua.includes('nextjsstreamtvapp')) {
    return 'tv'
  }
  
  // Common TV User-Agent patterns
  if (
    ua.includes('smart-tv') ||
    ua.includes('smarttv') ||
    ua.includes('tv/') ||
    ua.includes('television') ||
    ua.includes('roku') ||
    ua.includes('appletv') ||
    ua.includes('chromecast') ||
    ua.includes('fire tv') ||
    ua.includes('firetv') ||
    ua.includes('android tv') ||
    ua.includes('webos') ||
    ua.includes('tizen') ||
    ua.includes('viera') ||
    ua.includes('bravia') ||
    ua.includes('hisense') ||
    ua.includes('lg netcast') ||
    ua.includes('samsung') && ua.includes('tv') ||
    ua.includes('philips') && ua.includes('tv')
  ) {
    return 'tv'
  }

  // Mobile Detection (second priority)
  // Mobile patterns - be careful not to catch tablets
  if (
    (ua.includes('mobile') && !ua.includes('tablet')) ||
    (ua.includes('android') && ua.includes('mobile')) ||
    ua.includes('iphone') ||
    ua.includes('ipod') ||
    ua.includes('blackberry') ||
    ua.includes('windows phone') ||
    ua.includes('palm') ||
    ua.includes('nokia') ||
    ua.includes('symbian')
  ) {
    return 'mobile'
  }

  // Tablet Detection (third priority)
  // Tablet patterns
  if (
    ua.includes('tablet') ||
    ua.includes('ipad') ||
    (ua.includes('android') && !ua.includes('mobile')) || // Android tablets don't include 'mobile'
    ua.includes('kindle') ||
    ua.includes('silk') ||
    ua.includes('playbook') ||
    ua.includes('nexus 7') ||
    ua.includes('nexus 9') ||
    ua.includes('nexus 10')
  ) {
    return 'tablet'
  }

  // Desktop fallback (everything else)
  return 'desktop'
}

/**
 * Detects browser type from User-Agent string using ua-parser-js
 * @param {string} userAgent - The User-Agent string from request headers
 * @returns {BrowserType} The detected browser type
 */
export function detectBrowserType(userAgent) {
  if (!userAgent || typeof userAgent !== 'string') {
    return 'unknown'
  }

  try {
    const parser = new UAParser(userAgent)
    const result = parser.getBrowser()
    const browserName = result.name?.toLowerCase()


    // Map UA Parser browser names to our BrowserType enum
    const browserMap = {
      'chrome': 'chrome',
      'mobile chrome': 'chrome', // Mobile Chrome should be treated as Chrome
      'chromium': 'chrome', // Treat Chromium as Chrome
      'firefox': 'firefox',
      'mobile firefox': 'firefox', // Mobile Firefox
      'safari': 'safari',
      'mobile safari': 'safari', // Mobile Safari
      'edge': 'edge',
      'mobile edge': 'edge', // Mobile Edge
      'brave': 'brave',
      'mobile brave': 'brave',
      'opera': 'opera',
      'mobile opera': 'opera',
      'opera next': 'opera',
      'opera gx': 'opera',
      'vivaldi': 'vivaldi',
      'tor browser': 'tor'
    }

    // Return mapped browser type or 'unknown'
    return browserMap[browserName] || 'unknown'
  } catch (error) {
    console.warn('Error parsing user agent:', error)
    return 'unknown'
  }
}

/**
 * Creates playback device info object for storage
 * @param {string} userAgent - The User-Agent string from request headers
 * @returns {PlaybackDeviceInfo} Device info object for playback tracking
 */
export function createPlaybackDeviceInfo(userAgent) {
  const deviceType = detectDeviceType(userAgent)
  
  return {
    type: deviceType,
    lastUsed: new Date(),
    // Store full User-Agent for proper browser/manufacturer detection
    userAgent: userAgent || null
  }
}

/**
 * Updates device info for existing playback entry
 * @param {PlaybackDeviceInfo|undefined} existingDeviceInfo - Current device info
 * @param {string} userAgent - New User-Agent string
 * @returns {PlaybackDeviceInfo} Updated device info
 */
export function updatePlaybackDeviceInfo(existingDeviceInfo, userAgent) {
  const newDeviceInfo = createPlaybackDeviceInfo(userAgent)
  
  // If device type is the same, just update the timestamp
  if (existingDeviceInfo && existingDeviceInfo.type === newDeviceInfo.type) {
    return {
      ...existingDeviceInfo,
      lastUsed: new Date(),
      userAgent: userAgent || null // Store full userAgent
    }
  }
  
  // Device type changed or no existing info, return new info
  return newDeviceInfo
}

/**
 * Gets a human-readable device type label for UI display
 * @param {DeviceType} deviceType - The device type
 * @returns {string} Human-readable label
 */
export function getDeviceTypeLabel(deviceType) {
  const labels = {
    'tv': 'TV',
    'mobile': 'Mobile',
    'tablet': 'Tablet',
    'desktop': 'Desktop'
  }
  
  return labels[deviceType] || 'Unknown'
}

/**
 * Gets a device icon class/name for UI display (Heroicons component names)
 * @param {DeviceType} deviceType - The device type
 * @returns {string} Heroicon component name
 */
export function getDeviceIcon(deviceType) {
  const icons = {
    'tv': 'TvIcon',
    'mobile': 'DevicePhoneMobileIcon',
    'tablet': 'DeviceTabletIcon',
    'desktop': 'ComputerDesktopIcon'
  }
  
  return icons[deviceType] || 'ComputerDesktopIcon'
}

/**
 * Gets browser icon filename for UI display
 * @param {BrowserType} browserType - The browser type
 * @returns {string} Browser icon filename
 */
export function getBrowserIcon(browserType) {
  const icons = {
    'chrome': 'Google_Chrome_icon.svg',
    'firefox': 'Firefox_logo.svg',
    'safari': 'Safari_logo.svg',
    'edge': 'Microsoft_Edge_logo.svg',
    'brave': 'Brave_icon.svg',
    'opera': 'Opera_icon.svg',
    'tor': 'Tor_Browser_icon.svg',
    'vivaldi': 'Vivaldi_logo.svg',
    'unknown': null
  }
  
  return icons[browserType] || null
}

/**
 * Gets a human-readable browser type label for UI display
 * @param {BrowserType} browserType - The browser type
 * @returns {string} Human-readable label
 */
export function getBrowserTypeLabel(browserType) {
  const labels = {
    'chrome': 'Chrome',
    'firefox': 'Firefox',
    'safari': 'Safari',
    'edge': 'Edge',
    'brave': 'Brave',
    'opera': 'Opera',
    'tor': 'Tor Browser',
    'vivaldi': 'Vivaldi',
    'unknown': 'Unknown Browser'
  }
  
  return labels[browserType] || 'Unknown Browser'
}

/**
 * Checks if a device type should be considered "mobile" for responsive purposes
 * @param {DeviceType} deviceType - The device type
 * @returns {boolean} True if device should use mobile-optimized features
 */
export function isMobileDevice(deviceType) {
  return deviceType === 'mobile' || deviceType === 'tablet'
}

/**
 * Validates device info object structure
 * @param {any} deviceInfo - Object to validate
 * @returns {boolean} True if valid device info structure
 */
export function isValidDeviceInfo(deviceInfo) {
  if (!deviceInfo || typeof deviceInfo !== 'object') {
    return false
  }
  
  const validTypes = ['tv', 'mobile', 'tablet', 'desktop']
  
  return (
    validTypes.includes(deviceInfo.type) &&
    deviceInfo.lastUsed instanceof Date &&
    (!deviceInfo.userAgent || typeof deviceInfo.userAgent === 'string')
  )
}

/**
 * Test function for validating User-Agent detection
 * Only available in development/debug mode
 * @param {Array<{userAgent: string, expected: DeviceType}>} testCases - Test cases to validate
 * @returns {Object} Test results
 */
export function testDeviceDetection(testCases) {
  if (process.env.NODE_ENV === 'production') {
    console.warn('Device detection testing should not be used in production')
    return { error: 'Testing disabled in production' }
  }
  
  const results = testCases.map(testCase => {
    const detected = detectDeviceType(testCase.userAgent)
    return {
      userAgent: testCase.userAgent,
      expected: testCase.expected,
      detected,
      passed: detected === testCase.expected
    }
  })
  
  const passed = results.filter(r => r.passed).length
  const total = results.length
  
  return {
    summary: `${passed}/${total} tests passed`,
    results,
    allPassed: passed === total
  }
}

/**
 * Pre-defined test cases for common User-Agent patterns
 * @returns {Array} Test cases for device detection
 */
export function getDefaultTestCases() {
  return [
    // NextJS Stream TV App (custom)
    {
      userAgent: 'NextJSStreamTVApp/1.0.0 (android; tv; Samsung UN65RU7100)',
      expected: 'tv'
    },
    {
      userAgent: 'NextJSStreamTVApp/1.0.0 (android; tv; LG OLED55C1PUB)',
      expected: 'tv'
    },
    // Legacy TV User-Agent
    {
      userAgent: 'okhttp/4.12.0',
      expected: 'desktop' // Falls back to desktop for generic HTTP clients
    },
    // Web browsers
    {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      expected: 'desktop'
    },
    {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      expected: 'desktop'
    },
    // Mobile devices
    {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      expected: 'mobile'
    },
    {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
      expected: 'mobile'
    },
    // Tablets
    {
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      expected: 'tablet'
    },
    {
      userAgent: 'Mozilla/5.0 (Linux; Android 13; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      expected: 'tablet'
    },
    // Smart TVs
    {
      userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.5 TV Safari/537.36',
      expected: 'tv'
    },
    {
      userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager',
      expected: 'tv'
    }
  ]
}

/**
 * Test cases for browser detection
 * @returns {Array} Test cases for browser detection
 */
export function getBrowserTestCases() {
  return [
    // Chrome
    {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      expected: 'chrome'
    },
    {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Sa', // Truncated
      expected: 'chrome'
    },
    // Firefox
    {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:91.0) Gecko/20100101 Firefox/91.0',
      expected: 'firefox'
    },
    // Safari
    {
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Safari/605.1.15',
      expected: 'safari'
    },
    // Edge
    {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Edg/91.0.864.59',
      expected: 'edge'
    },
    // Brave
    {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Brave/1.26.74',
      expected: 'brave'
    },
    // Opera
    {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 OPR/77.0.4054.277',
      expected: 'opera'
    },
    // Vivaldi
    {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36 Vivaldi/4.0.2312.87',
      expected: 'vivaldi'
    }
  ]
}

/**
 * TV/Streaming Device Manufacturer type detected from User-Agent string
 * @typedef {'nvidia' | 'apple' | 'roku' | 'amazon' | 'google' | 'samsung' | 'lg' | 'sony' | 'androidtv' | 'unknown'} TVManufacturerType
 */

/**
 * Detect TV/streaming device manufacturer from userAgent
 * @param {string} userAgent - The user agent string
 * @returns {TVManufacturerType} The manufacturer type (nvidia, apple, roku, etc.)
 */
export function detectTVManufacturer(userAgent) {
  if (!userAgent) return 'unknown'
  
  const ua = userAgent.toLowerCase()
  
  // NVIDIA SHIELD
  if (ua.includes('nvidia shield') || (ua.includes('nvidia') && ua.includes('android tv'))) {
    return 'nvidia'
  }
  
  // Apple TV
  if (ua.includes('apple tv') || ua.includes('tvos')) {
    return 'apple'
  }
  
  // Roku
  if (ua.includes('roku')) {
    return 'roku'
  }
  
  // Amazon Fire TV
  if (ua.includes('fire tv') || (ua.includes('amazon') && ua.includes('aft'))) {
    return 'amazon'
  }
  
  // Chromecast / Google TV
  if (ua.includes('chromecast') || ua.includes('google tv')) {
    return 'google'
  }
  
  // Samsung Smart TV
  if (ua.includes('samsung') && (ua.includes('smart tv') || ua.includes('tizen'))) {
    return 'samsung'
  }
  
  // LG Smart TV
  if (ua.includes('lg') && (ua.includes('smart tv') || ua.includes('webos'))) {
    return 'lg'
  }
  
  // Sony Android TV
  if (ua.includes('sony') && ua.includes('android tv')) {
    return 'sony'
  }
  
  // Generic Android TV (after specific manufacturers)
  if (ua.includes('android tv')) {
    return 'androidtv'
  }
  
  return 'unknown'
}

/**
 * Get TV manufacturer icon filename
 * @param {TVManufacturerType} manufacturer - The manufacturer type
 * @returns {string|null} The icon filename or null if not available
 */
export function getTVManufacturerIcon(manufacturer) {
  const icons = {
    nvidia: 'nvidia_shield.svg',
    apple: 'apple_tv.svg',
    roku: 'roku.svg',
    amazon: 'amazon_fire_tv.svg',
    google: 'google_tv.svg',
    samsung: 'samsung_tv.svg',
    lg: 'lg_tv.svg',
    sony: 'sony_tv.svg',
    androidtv: 'android_tv.svg'
  }
  return icons[manufacturer] || null
}

/**
 * Get TV manufacturer label
 * @param {TVManufacturerType} manufacturer - The manufacturer type
 * @returns {string} The human-readable manufacturer label
 */
export function getTVManufacturerLabel(manufacturer) {
  const labels = {
    nvidia: 'NVIDIA SHIELD',
    apple: 'Apple TV',
    roku: 'Roku',
    amazon: 'Fire TV',
    google: 'Google TV',
    samsung: 'Samsung TV',
    lg: 'LG TV',
    sony: 'Sony TV',
    androidtv: 'Android TV',
    unknown: ''
  }
  return labels[manufacturer] || ''
}

/**
 * Test cases for TV manufacturer detection
 * @returns {Array} Test cases for TV manufacturer detection
 */
export function getTVManufacturerTestCases() {
  return [
    // NVIDIA SHIELD
    {
      userAgent: 'NextJSStreamTVApp/1.0.0 (android; tv; NVIDIA SHIELD Android TV)',
      expected: 'nvidia'
    },
    {
      userAgent: 'Mozilla/5.0 (Linux; Android 9; NVIDIA SHIELD Android TV) AppleWebKit/537.36',
      expected: 'nvidia'
    },
    // Apple TV
    {
      userAgent: 'AppleTV/tvOS 15.0',
      expected: 'apple'
    },
    {
      userAgent: 'Mozilla/5.0 (Apple TV; OS 15_0 like Mac OS X) AppleWebKit/605.1.15',
      expected: 'apple'
    },
    // Roku
    {
      userAgent: 'Roku/DVP-9.10 (9.1.0.4111)',
      expected: 'roku'
    },
    // Amazon Fire TV
    {
      userAgent: 'Mozilla/5.0 (Linux; Android 7.1.2; AFTMM Build/NS6265) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/70.0.3538.110 Mobile Safari/537.36',
      expected: 'amazon'
    },
    {
      userAgent: 'NextJSStreamTVApp/1.0.0 (android; tv; Amazon AFTGAZL)',
      expected: 'amazon'
    },
    // Google TV / Chromecast
    {
      userAgent: 'Mozilla/5.0 (Linux; Android 10; Chromecast) AppleWebKit/537.36',
      expected: 'google'
    },
    // Samsung Smart TV
    {
      userAgent: 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.5) AppleWebKit/537.36 (KHTML, like Gecko) Version/6.5 TV Safari/537.36',
      expected: 'samsung'
    },
    // LG Smart TV
    {
      userAgent: 'Mozilla/5.0 (Web0S; Linux/SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/87.0.4280.88 Safari/537.36 WebAppManager',
      expected: 'lg'
    },
    // Sony Android TV
    {
      userAgent: 'Mozilla/5.0 (Linux; Android 9; Sony TV Android TV) AppleWebKit/537.36',
      expected: 'sony'
    },
    // Generic Android TV
    {
      userAgent: 'Mozilla/5.0 (Linux; Android 9; Android TV) AppleWebKit/537.36',
      expected: 'androidtv'
    }
  ]
}