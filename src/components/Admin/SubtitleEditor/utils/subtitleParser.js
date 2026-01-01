'use client'

import { secondsToTimeCached } from './timeFormat'

/**
 * Parse WebVTT format subtitles into an array of subtitle objects
 * @param {string} vttContent - The content of a WebVTT file
 * @returns {Array} Array of subtitle objects with id, startTime, endTime, and text properties
 */
export function parseVTT(vttContent) {
  // Ensure we have content
  if (!vttContent || typeof vttContent !== 'string') {
    return []
  }

  // Split by double newline to get cue blocks
  const lines = vttContent.trim().split(/\r?\n/)
  
  // Check if this is a valid WebVTT file
  if (!lines[0].includes('WEBVTT')) {
    // Try to convert if it might be SRT
    if (lines[0].match(/^\d+$/) && lines[1].includes('-->')) {
      return parseSRT(vttContent)
    }
    return []
  }

  const subtitles = []
  let currentSubtitle = null
  let textLines = []
  let isReadingCue = false
  let cueId = ''

  // Process the file line by line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()

    // Skip the WEBVTT header and empty lines at the beginning
    if (i === 0 && line.includes('WEBVTT')) {
      continue
    }

    // Empty line means end of a subtitle block or separating header from content
    if (line === '') {
      if (currentSubtitle) {
        currentSubtitle.text = textLines.join('\n').trim()
        subtitles.push(currentSubtitle)
        currentSubtitle = null
        textLines = []
        isReadingCue = false
      }
      continue
    }

    // Line with time codes (e.g., "00:00:01.000 --> 00:00:04.000")
    if (line.includes('-->')) {
      const times = line.split('-->').map(t => t.trim())
      const startTime = timeToSeconds(times[0])
      const endTime = timeToSeconds(times[1])

      currentSubtitle = {
        id: cueId || `sub-${subtitles.length + 1}`,
        startTime,
        endTime,
        text: ''
      }
      isReadingCue = true
      continue
    }

    // If we're not reading a cue yet, and the line is a number, it's likely a cue identifier
    if (!isReadingCue && !currentSubtitle && line.match(/^\d+$/)) {
      cueId = `sub-${line}`
      continue
    }

    // If we're processing a subtitle block, add this line to the text
    if (isReadingCue && currentSubtitle) {
      textLines.push(line)
    }
  }

  // Add the last subtitle if there is one
  if (currentSubtitle) {
    currentSubtitle.text = textLines.join('\n').trim()
    subtitles.push(currentSubtitle)
  }

  return subtitles
}

/**
 * Parse SRT format subtitles into an array of subtitle objects
 * @param {string} srtContent - The content of an SRT file
 * @returns {Array} Array of subtitle objects with id, startTime, endTime, and text properties
 */
export function parseSRT(srtContent) {
  // Ensure we have content
  if (!srtContent || typeof srtContent !== 'string') {
    return []
  }

  // Split by double newline to get subtitle blocks
  const blocks = srtContent.trim().split(/\r?\n\r?\n/)
  const subtitles = []

  blocks.forEach(block => {
    const lines = block.split(/\r?\n/)
    
    // Skip if we don't have enough lines
    if (lines.length < 2) return
    
    // First line might be the subtitle number
    const timeLineIndex = lines[0].includes('-->') ? 0 : 1
    
    // Check if we have a time line
    if (timeLineIndex >= lines.length || !lines[timeLineIndex].includes('-->')) return
    
    const timeLine = lines[timeLineIndex]
    const times = timeLine.split('-->').map(t => t.trim())
    
    if (times.length !== 2) return
    
    const startTime = srtTimeToSeconds(times[0])
    const endTime = srtTimeToSeconds(times[1])
    
    // Get the subtitle text (all lines after the time line)
    const text = lines.slice(timeLineIndex + 1).join(' ').trim()
    
    subtitles.push({
      id: `sub-${lines[0].trim()}`, // Use the original subtitle number as ID
      startTime,
      endTime,
      text
    })
  })

  return subtitles
}

/**
 * Convert WebVTT time format (00:00:00.000) to seconds
 * @param {string} timeString - Time string in format HH:MM:SS.mmm
 * @returns {number} Time in seconds (float)
 */
export function timeToSeconds(timeString) {
  // Handle simple seconds format (e.g., 12.345s)
  if (timeString.endsWith('s')) {
    return parseFloat(timeString.slice(0, -1))
  }

  const parts = timeString.split(':')
  let seconds = 0

  if (parts.length === 3) {
    // Handle HH:MM:SS.mmm
    const [hours, minutes, secondsAndMs] = parts
    const [secs, ms] = secondsAndMs.split('.').map(parseFloat)
    seconds = parseInt(hours) * 3600 + parseInt(minutes) * 60 + secs + (ms || 0) / 1000
  } else if (parts.length === 2) {
    // Handle MM:SS.mmm
    const [minutes, secondsAndMs] = parts
    const [secs, ms] = secondsAndMs.split('.').map(parseFloat)
    seconds = parseInt(minutes) * 60 + secs + (ms || 0) / 1000
  }

  return seconds
}

/**
 * Convert SRT time format (00:00:00,000) to seconds
 * @param {string} timeString - Time string in format HH:MM:SS,mmm
 * @returns {number} Time in seconds (float)
 */
function srtTimeToSeconds(timeString) {
  // SRT uses comma for milliseconds while WebVTT uses dot
  return timeToSeconds(timeString.replace(',', '.'))
}

/**
 * Convert seconds -> WebVTT time "HH:MM:SS.mmm"
 * Truncates toward zero (e.g., 1.999 → 1.999, -1.2 → -1.000 then formatted as 00:00:00.000 for UI safety).
 * 
 * NOTE: For performance-critical UI rendering, use secondsToTimeCached from timeFormat.js instead
 */
export function secondsToTime(seconds) {
  // Delegate to the cached version for better performance
  return secondsToTimeCached(seconds);
}

/**
 * Export subtitles as WebVTT format
 * @param {Array} subtitles - Array of subtitle objects
 * @returns {string} WebVTT formatted subtitle content
 */
export function exportToVTT(subtitles) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) {
    return 'WEBVTT\n\n'
  }

  let content = 'WEBVTT\n\n'

  subtitles.forEach((subtitle, index) => {
    // Extract cue number from id if possible, otherwise use index+1
    let cueNumber = index + 1
    if (subtitle.id && subtitle.id.startsWith('sub-')) {
      const extractedNumber = subtitle.id.replace('sub-', '')
      if (!isNaN(parseInt(extractedNumber))) {
        cueNumber = extractedNumber
      }
    }
    
    content += `${cueNumber}\n`
    content += `${secondsToTimeCached(subtitle.startTime)} --> ${secondsToTimeCached(subtitle.endTime)}\n`
    content += `${subtitle.text}\n\n`
  })

  return content
}

/**
 * Export subtitles as SRT format
 * @param {Array} subtitles - Array of subtitle objects
 * @returns {string} SRT formatted subtitle content
 */
export function exportToSRT(subtitles) {
  if (!Array.isArray(subtitles) || subtitles.length === 0) {
    return ''
  }

  let content = ''

  subtitles.forEach((subtitle, index) => {
    content += `${index + 1}\n`
    // SRT uses comma for milliseconds
    content += `${secondsToTimeCached(subtitle.startTime).replace('.', ',')} --> ${secondsToTimeCached(subtitle.endTime).replace('.', ',')}\n`
    content += `${subtitle.text}\n\n`
  })

  return content
}
