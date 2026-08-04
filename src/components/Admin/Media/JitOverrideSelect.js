'use client'

const HINTS = {
  '': 'Follows the global JIT Delivery setting (/admin/settings).',
  on: 'Always serve through the transcoder when available — even if the file plays directly.',
  off: 'Never serve through the transcoder — always direct play for this item.',
}

/**
 * Tri-state per-media JIT delivery override. Empty = follow global.
 * For TV, delivery resolves episode > season > show > global; the global
 * kill switch always wins.
 */
export default function JitOverrideSelect({ id, value = '', onChange, label = 'JIT Delivery', helpText = null }) {
  const normalized = value === 'on' || value === 'off' ? value : ''
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
      </label>
      <select
        id={id}
        value={normalized}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
      >
        <option value="">Default (follow global)</option>
        <option value="on">Always JIT</option>
        <option value="off">Never JIT (direct play)</option>
      </select>
      <p className="text-xs text-gray-500">{helpText || HINTS[normalized]}</p>
    </div>
  )
}
