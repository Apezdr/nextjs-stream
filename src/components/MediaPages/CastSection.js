import VirtualizedCastGrid from '@components/MediaScroll/VirtualizedCastGrid'

const CastSection = ({ cast, title = 'Cast' }) => {
  return (
    <div className="p-4 relative h-[31rem] bg-white bg-opacity-80 rounded-lg">
      <h4 className="text-2xl text-black font-semibold mb-4">{title}</h4>
      <VirtualizedCastGrid cast={cast} />
    </div>
  )
}

export default CastSection
