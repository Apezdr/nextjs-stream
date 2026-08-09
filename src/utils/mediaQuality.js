export const QUALITY_OPTIONS = ['4K', '1440p', '1080p', '720p', 'SD', 'Unknown']

export function getQualityLabel(dimensions) {
  const match = String(dimensions || '').match(/^(\d+)x(\d+)$/i)
  if (!match) return 'Unknown'
  const width = Number(match[1])
  if (width >= 3000) return '4K'
  if (width >= 2500) return '1440p'
  if (width >= 1800) return '1080p'
  if (width >= 1200) return '720p'
  return width > 0 ? 'SD' : 'Unknown'
}

export function buildQualityFilter(quality, field = 'dimensions') {
  const regexByQuality = {
    '4K': /^(?:[3-9]\d{3}|\d{5,})x\d+$/i,
    '1440p': /^2[5-9]\d{2}x\d+$/i,
    '1080p': /^(?:1[89]\d{2}|2[0-4]\d{2})x\d+$/i,
    '720p': /^1[2-7]\d{2}x\d+$/i,
    SD: /^(?:[1-9]\d{0,2}|1[01]\d{2})x\d+$/i,
  }
  if (quality === 'Unknown') {
    return { $or: [{ [field]: { $exists: false } }, { [field]: null }, { [field]: '' }] }
  }
  return regexByQuality[quality] ? { [field]: regexByQuality[quality] } : {}
}