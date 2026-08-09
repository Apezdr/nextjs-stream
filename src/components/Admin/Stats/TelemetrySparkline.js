export function buildSparklinePoints(values, { width = 120, height = 32, maxValue = null } = {}) {
  const samples = values.filter(Number.isFinite)
  if (samples.length === 0) return ''
  const ceiling = Number.isFinite(maxValue) && maxValue > 0
    ? maxValue
    : Math.max(1, ...samples)
  const points = samples.length === 1 ? [samples[0], samples[0]] : samples
  return points.map((value, index) => {
    const x = points.length === 1 ? 0 : index * width / (points.length - 1)
    const y = height - Math.min(1, Math.max(0, value / ceiling)) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

export default function TelemetrySparkline({ values = [], maxValue = null, label, className = 'text-sky-500' }) {
  const points = buildSparklinePoints(values, { maxValue })
  if (!points) return null

  return (
    <div className={className}>
      <svg
        viewBox="0 0 120 32"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className="h-10 w-full"
      >
        <line x1="0" x2="120" y1="16" y2="16" stroke="currentColor" strokeOpacity="0.15" />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <p className="text-right text-[10px] text-gray-400">Last 60 seconds</p>
    </div>
  )
}