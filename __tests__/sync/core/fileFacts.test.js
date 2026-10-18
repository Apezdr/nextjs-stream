/**
 * @jest-environment node
 *
 * The rule a video's file facts follow, for movies and episodes alike. See the
 * module header; each case here is one step of it.
 */

const {
  VIDEO_FILE_FACTS,
  planVideoFileFacts,
  videoFileChanged,
  sizeInBytes,
} = require('@src/utils/sync/core/fileFacts')

const HDR_FILE = {
  duration: 8160000,
  dimensions: '3840x2160',
  size: 53687091200,
  hdr: 'HDR10',
  mediaQuality: { format: 'HDR10', isHDR: true },
  mediaLastModified: '2024-01-01T00:00:00.000Z',
}
/** What a file server publishes for a file it could not probe this scan. */
const UNPROBED = { duration: null, dimensions: null, size: undefined, hdr: null, mediaQuality: undefined }

describe('planVideoFileFacts', () => {
  it('writes every fact the owner reports', () => {
    const plan = planVideoFileFacts(HDR_FILE, false)

    expect(plan.set).toEqual({ ...HDR_FILE, mediaLastModified: new Date('2024-01-01T00:00:00.000Z') })
    expect(plan.unset).toEqual([])
    expect(plan.unreadableModified).toBe(false)
  })

  it('removes a fact a probed file does not have: hdr null on a file with a duration is SDR', () => {
    const plan = planVideoFileFacts({ ...HDR_FILE, hdr: null }, false)

    expect(plan.unset).toEqual(['hdr'])
    expect(plan.set).not.toHaveProperty('hdr')
  })

  it('leaves the stored facts alone when the file was not probed and is the same file', () => {
    expect(planVideoFileFacts(UNPROBED, false)).toEqual({ set: {}, unset: [], unreadableModified: false })
  })

  it('removes the facts of another file even when the new one has not been probed', () => {
    expect(planVideoFileFacts(UNPROBED, true).unset).toEqual(['duration', 'dimensions', 'size', 'hdr', 'mediaQuality'])
  })

  it('treats an empty string as no value', () => {
    expect(planVideoFileFacts({ ...HDR_FILE, dimensions: '' }, false).unset).toEqual(['dimensions'])
    expect(planVideoFileFacts({ ...UNPROBED, hdr: '' }, false).unset).toEqual([])
  })

  it('counts any duration that is not null as a probe, and still removes an empty one', () => {
    expect(planVideoFileFacts({ ...UNPROBED, duration: '' }, false).unset).toEqual(['duration', 'dimensions', 'size', 'hdr', 'mediaQuality'])
    expect(planVideoFileFacts({ ...UNPROBED, duration: 0 }, false)).toMatchObject({ set: { duration: 0 } })
  })

  it('writes the file\'s modified time when the payload has one, and never removes it', () => {
    const probedWithout = planVideoFileFacts({ ...HDR_FILE, mediaLastModified: undefined }, true)
    expect(probedWithout.set).not.toHaveProperty('mediaLastModified')
    expect(probedWithout.unset).not.toContain('mediaLastModified')

    const asDate = planVideoFileFacts({ mediaLastModified: new Date('2024-02-02T00:00:00.000Z') }, false)
    expect(asDate.set.mediaLastModified).toEqual(new Date('2024-02-02T00:00:00.000Z'))
  })

  it('keeps the stored modified time when the payload\'s is not a date, and says so', () => {
    const plan = planVideoFileFacts({ ...HDR_FILE, mediaLastModified: 'yesterday-ish' }, false)

    expect(plan.unreadableModified).toBe(true)
    expect(plan.set).not.toHaveProperty('mediaLastModified')
    expect(plan.unset).not.toContain('mediaLastModified')
  })

  it('lists the facts in one order for every caller', () => {
    expect(VIDEO_FILE_FACTS).toEqual(['duration', 'dimensions', 'size', 'hdr', 'mediaQuality', 'mediaLastModified'])
    expect(Object.keys(planVideoFileFacts(HDR_FILE, false).set)).toEqual([...VIDEO_FILE_FACTS])
  })
})

describe('videoFileChanged', () => {
  const A_FILE = 'https://A.example/movies/Film/Film.mkv'
  const B_FILE = 'https://B.example/movies/Film/Film.mkv'

  it('is true when the pass points the document at another file', () => {
    expect(videoFileChanged({ videoURL: A_FILE }, B_FILE, false)).toBe(true)
    expect(videoFileChanged({ videoURL: null }, B_FILE, false)).toBe(true)
    expect(videoFileChanged({}, B_FILE, false)).toBe(true)
  })

  it('is false for the same file, a new document, or a video URL an admin locked', () => {
    expect(videoFileChanged({ videoURL: A_FILE }, A_FILE, false)).toBe(false)
    expect(videoFileChanged(null, A_FILE, false)).toBe(false)
    expect(videoFileChanged({ videoURL: A_FILE }, B_FILE, true)).toBe(false)
  })
})

describe('sizeInBytes', () => {
  it('takes a number of bytes as it is', () => {
    expect(sizeInBytes(1234)).toBe(1234)
    expect(sizeInBytes(0)).toBe(0)
  })

  it('converts a { gb | mb | kb } object, the first one present winning', () => {
    expect(sizeInBytes({ gb: 2 })).toBe(2147483648)
    expect(sizeInBytes({ mb: 1.5 })).toBe(1572864)
    expect(sizeInBytes({ kb: 1 })).toBe(1024)
    expect(sizeInBytes({ kb: 1, mb: 1, gb: 50 })).toBe(53687091200)
  })

  it('is undefined for anything else', () => {
    for (const size of [undefined, null, '5 GB', {}, { gb: '2' }]) {
      expect(sizeInBytes(size)).toBeUndefined()
    }
  })
})
