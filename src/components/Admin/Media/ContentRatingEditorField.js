'use client'

import LockableField from './LockableField'
import {
  MAX_CONTENT_DESCRIPTORS,
  MOVIE_CONTENT_RATINGS,
  TV_CONTENT_RATINGS,
} from '@src/utils/contentRatingSchema'

export default function ContentRatingEditorField({
  mediaType,
  value,
  onChange,
  locked,
  onToggleLock,
  automaticRating = null,
  descriptors = '',
  onDescriptorsChange = null,
}) {
  const ratings = mediaType === 'tv' ? TV_CONTENT_RATINGS : MOVIE_CONTENT_RATINGS
  const emptyLabel = locked
    ? 'No rating (hide badge)'
    : automaticRating
      ? `Automatic (${automaticRating})`
      : 'Automatic (no rating available)'
  const options = [
    { value: '', label: emptyLabel },
    ...ratings.map((rating) => ({ value: rating, label: rating })),
  ]
  const showDescriptors = Boolean(
    locked && String(value ?? '').trim() && onDescriptorsChange
  )

  return (
    <div className="space-y-4">
      <LockableField
        id={`${mediaType}-content-rating`}
        label="Content Rating"
        value={value}
        onChange={onChange}
        locked={locked}
        onToggleLock={onToggleLock}
        disabled={!locked}
        options={options}
        helpText={
          locked
            ? 'Locked ratings and explicit removal are preserved during scans.'
            : 'Unlocked ratings follow the latest available provider metadata.'
        }
      />
      {showDescriptors ? (
        <LockableField
          id={`${mediaType}-content-rating-descriptors`}
          label="Rating Descriptors"
          value={descriptors}
          onChange={onDescriptorsChange}
          textarea
          rows={3}
          placeholder={'Nudity\nStrong Language'}
          helpText={`One per line, up to ${MAX_CONTENT_DESCRIPTORS}. Leave blank to remove them.`}
        />
      ) : null}
    </div>
  )
}
