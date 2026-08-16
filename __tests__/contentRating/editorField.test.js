import { renderToStaticMarkup } from 'react-dom/server'
import ContentRatingEditorField from '@components/Admin/Media/ContentRatingEditorField'

function renderField(props) {
  const container = document.createElement('div')
  container.innerHTML = renderToStaticMarkup(
    <ContentRatingEditorField
      value=""
      onChange={() => {}}
      onToggleLock={() => {}}
      {...props}
    />
  )
  return container
}

describe('ContentRatingEditorField', () => {
  test('shows movie ratings and automatic provider state while unlocked', () => {
    const container = renderField({
      mediaType: 'movie',
      locked: false,
      automaticRating: 'PG-13',
    })
    const select = container.querySelector('select')

    expect(select).toBeDisabled()
    expect(select).toHaveAccessibleName('Content Rating')
    expect(select.textContent).toContain('Automatic (PG-13)')
    expect(select.textContent).toContain('NC-17')
    expect(select.textContent).not.toContain('TV-MA')
    expect(container.querySelector('button')).toHaveAttribute('aria-pressed', 'false')
  })

  test('shows television ratings and an explicit no-rating choice while locked', () => {
    const container = renderField({
      mediaType: 'tv',
      value: 'TV-MA',
      locked: true,
      automaticRating: 'TV-14',
    })
    const select = container.querySelector('select')

    expect(select).not.toBeDisabled()
    expect(select.textContent).toContain('No rating (hide badge)')
    expect(select.textContent).toContain('TV-Y7-FV')
    expect(select.textContent).not.toContain('NC-17')
    expect(container.querySelector('button')).toHaveAttribute('aria-pressed', 'true')
  })

  test('shows an accessible descriptor textarea only for a locked selected rating', () => {
    const active = renderField({
      mediaType: 'movie',
      value: 'R',
      locked: true,
      descriptors: 'Nudity\nStrong Language',
      onDescriptorsChange: () => {},
    })
    const textarea = active.querySelector('textarea')

    expect(textarea).toHaveAccessibleName('Rating Descriptors')
    expect(textarea).toHaveValue('Nudity\nStrong Language')
    expect(active.textContent).toContain('One per line')

    expect(renderField({
      mediaType: 'movie',
      value: '',
      locked: true,
      onDescriptorsChange: () => {},
    }).querySelector('textarea')).toBeNull()
    expect(renderField({
      mediaType: 'movie',
      value: 'R',
      locked: false,
      onDescriptorsChange: () => {},
    }).querySelector('textarea')).toBeNull()
  })
})
