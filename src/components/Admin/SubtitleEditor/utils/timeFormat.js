'use client'

// Small, fast zero-pad helpers (avoid padStart allocations)
const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
const pad3 = (n) => (n < 10 ? '00' + n : n < 100 ? '0' + n : '' + n);


export function secondsToTimeCached(seconds) {
  if (!Number.isFinite(seconds)) return '00:00:00.000';

  let totalMs = seconds * 1000;
  totalMs = totalMs < 0 ? Math.ceil(totalMs) : Math.floor(totalMs);
  if (totalMs <= 0) return '00:00:00.000';

  let rem = totalMs;
  const h = (rem / 3_600_000) | 0; rem -= h * 3_600_000;
  const m = (rem /   60_000) | 0; rem -= m *   60_000;
  const s = (rem /    1_000) | 0; rem -= s *    1_000;

  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(rem)}`;
}
