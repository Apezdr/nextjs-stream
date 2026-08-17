import { CpuChipIcon } from '@heroicons/react/24/outline'
import { SiAmd, SiIntel, SiNvidia } from 'react-icons/si'

const VENDORS = {
  NVIDIA: { Icon: SiNvidia, color: 'text-[#76b900]', background: 'bg-[#76b900]/10' },
  AMD: { Icon: SiAmd, color: 'text-[#ed1c24]', background: 'bg-[#ed1c24]/10' },
  Intel: { Icon: SiIntel, color: 'text-[#0071c5]', background: 'bg-[#0071c5]/10' },
}

export default function GpuVendorIcon({ vendor }) {
  const config = VENDORS[vendor]
  const Icon = config?.Icon || CpuChipIcon
  return (
    <div
      title={vendor ? `${vendor} graphics` : 'Graphics device'}
      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${config?.background || 'bg-gray-100'} ${config?.color || 'text-gray-500'}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="sr-only">{vendor || 'Unknown'} graphics</span>
    </div>
  )
}