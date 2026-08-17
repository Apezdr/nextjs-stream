import { CpuChipIcon } from '@heroicons/react/24/outline'
import { SiAmd, SiIntel } from 'react-icons/si'

const VENDORS = {
  Intel: { Icon: SiIntel, color: 'text-[#0071c5]', background: 'bg-[#0071c5]/10' },
  AMD: { Icon: SiAmd, color: 'text-[#ed1c24]', background: 'bg-[#ed1c24]/10' },
}

export default function CpuVendorIcon({ vendor }) {
  const config = VENDORS[vendor]
  const Icon = config?.Icon || CpuChipIcon
  return (
    <div title={vendor ? `${vendor} processor` : 'Processor'} className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${config?.background || 'bg-blue-100'} ${config?.color || 'text-blue-600'}`}>
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="sr-only">{vendor || 'Unknown'} processor</span>
    </div>
  )
}