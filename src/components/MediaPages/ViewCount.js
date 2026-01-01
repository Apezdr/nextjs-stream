import { EyeIcon } from '@heroicons/react/20/solid'
import { countUniqueViewersByNormalizedId } from '@src/utils/flatDatabaseUtils'

export default async function ViewCount({ normalizedVideoId }) {
  // This is now an async Server Component that fetches its own data
  const uniqueWatches = await countUniqueViewersByNormalizedId(normalizedVideoId)
  
  if (!uniqueWatches) return null
  
  return (
    <span className="ml-auto text-sm text-gray-100">
      <EyeIcon className='w-[17px] inline' /> 
      Watched by {uniqueWatches} user{uniqueWatches > 1 ? "(s)" : ""}
    </span>
  )
}
