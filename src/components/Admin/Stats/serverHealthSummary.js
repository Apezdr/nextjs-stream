export function resolveServerHealthSummary(worstMetric, hasUnavailableMetric) {
  // Missing optional telemetry must be visible, but it must never downgrade a
  // real critical CPU/memory/disk/GPU alarm from red to an amber warning.
  if (worstMetric >= 100) return 'critical'
  if (worstMetric > 0) return 'moderate'
  if (hasUnavailableMetric) return 'unavailable'
  return 'optimal'
}