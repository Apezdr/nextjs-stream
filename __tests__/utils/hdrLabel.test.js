import { isHdr10Label } from '@src/utils'

// The media processor writes "HDR10+" once it recognises MediaInfo's
// "SMPTE ST 2094 App 4"; until the posters accept it, fixing that label
// would swap the logo for plain text on every HDR10+ title.
describe('isHdr10Label', () => {
  it('accepts HDR10 and HDR10+', () => {
    expect(isHdr10Label('HDR10')).toBe(true)
    expect(isHdr10Label('HDR10+')).toBe(true)
  })

  it('leaves combined, other-HDR and SDR labels to the text path', () => {
    expect(isHdr10Label('Dolby Vision, HDR10')).toBe(false)
    expect(isHdr10Label('Dolby Vision')).toBe(false)
    expect(isHdr10Label('HLG')).toBe(false)
    expect(isHdr10Label('10-bit SDR (BT.709)')).toBe(false)
  })

  it('treats a missing label as no logo', () => {
    expect(isHdr10Label(false)).toBe(false)
    expect(isHdr10Label(null)).toBe(false)
    expect(isHdr10Label(undefined)).toBe(false)
  })
})
