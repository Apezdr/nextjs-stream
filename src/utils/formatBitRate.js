export function formatBytesAsBitRate(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond < 0) return '—'
  const bitsPerSecond = bytesPerSecond * 8
  if (bitsPerSecond < 1_000_000) return `${formatValue(bitsPerSecond / 1_000)} Kbps`
  if (bitsPerSecond < 1_000_000_000) return `${formatValue(bitsPerSecond / 1_000_000)} Mbps`
  return `${formatValue(bitsPerSecond / 1_000_000_000)} Gbps`
}

function formatValue(value) {
  if (value === 0) return '0'
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1)
}