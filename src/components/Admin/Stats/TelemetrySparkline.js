const WIDTH = 120
const HEIGHT = 32

/** SVG polyline points for a series, scaled to maxValue (or the series max). */
export function buildSparklinePoints(values, { width = WIDTH, height = HEIGHT, maxValue = null } = {}) {
  const samples = values.filter(Number.isFinite)
  if (samples.length === 0) return ''
  const ceiling = Number.isFinite(maxValue) && maxValue > 0 ? maxValue : Math.max(1, ...samples)
  // A single sample still draws a flat line rather than a dot.
  const points = samples.length === 1 ? [samples[0], samples[0]] : samples
  return points
    .map((value, index) => {
      const x = (index * width) / (points.length - 1)
      const y = height - Math.min(1, Math.max(0, value / ceiling)) * height
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

/** The last minute of a 0-100 metric, from the server-load history. */
export default function TelemetrySparkline({ values = [], maxValue = 100, label, className = 'text-sky-500' }) {
  const points = buildSparklinePoints(values, { maxValue })
  if (!points) return null

  return (
    <div className={className}>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        className="h-10 w-full"
      >
        <line x1="0" x2={WIDTH} y1={HEIGHT / 2} y2={HEIGHT / 2} stroke="currentColor" strokeOpacity="0.15" />
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
