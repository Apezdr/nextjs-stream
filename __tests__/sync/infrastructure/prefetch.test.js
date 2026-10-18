/**
 * @jest-environment node
 *
 * The prefetch step (infrastructure/fileSystem/prefetch): the files a
 * builder names in its plan's needs are fetched one at a time, in order,
 * through the read each kind takes; a failure comes back as a failed
 * resource; and a builder is called until it needs nothing more.
 */

jest.mock('@src/lib/httpHelper', () => ({ httpGet: jest.fn() }))
jest.mock('@src/utils/sync/infrastructure/fileSystem/fetchFile', () => ({ fetchMetadataMultiServer: jest.fn() }))

const { httpGet } = require('@src/lib/httpHelper')
const { fetchMetadataMultiServer } = require('@src/utils/sync/infrastructure/fileSystem/fetchFile')
const { fetchResources, buildWithResources } = require('@src/utils/sync/infrastructure/fileSystem/prefetch')
const { emptyWritePlan } = require('@src/utils/sync/core/writePlan')

const context = { mediaType: 'tv', title: 'Show (2020)' }
const metadata = { kind: 'metadata', serverId: 'A', path: '/tv/Show/metadata.json' }
const blurhash = { kind: 'blurhash', serverId: 'A', path: 'https://A.example/tv/Show/poster.jpg.blurhash' }
const direct = { kind: 'blurhash', serverId: 'A', path: 'https://A.example/movies/F/poster.jpg.blurhash', direct: true }

beforeAll(() => {
  for (const method of ['log', 'warn', 'info', 'debug', 'error']) jest.spyOn(console, method).mockImplementation(() => {})
})
beforeEach(() => {
  httpGet.mockReset()
  fetchMetadataMultiServer.mockReset()
})

describe('fetchResources', () => {
  it('fetches each need once, one at a time, in order, through the read its kind takes', async () => {
    const order = []
    fetchMetadataMultiServer.mockImplementation(async (serverId, path, type, mediaType, title) => {
      order.push(['fmms', serverId, path, type, mediaType, title])
      return type === 'file' ? { name: 'n' } : 'bh'
    })
    const throttled = []
    httpGet.mockImplementation(async (url) => {
      order.push(['http', url])
      return { data: ' dbh ', headers: { 'content-type': 'text/plain' } }
    })
    const throttle = { throttleHttp: (fn) => { throttled.push(true); return fn() } }

    const fetched = await fetchResources([metadata, direct, blurhash], { ...context, throttle })

    expect(order).toEqual([
      ['fmms', 'A', metadata.path, 'file', 'tv', 'Show (2020)'],
      ['http', direct.path],
      ['fmms', 'A', blurhash.path, 'blurhash', 'tv', 'Show (2020)'],
    ])
    expect(throttled).toEqual([true])
    expect(fetched).toEqual([
      { ...metadata, ok: true, data: { name: 'n' } },
      { ...direct, ok: true, data: 'dbh' },
      { ...blurhash, ok: true, data: 'bh' },
    ])
  })

  it('turns a throw, an empty metadata file and an empty blurhash into failed resources', async () => {
    fetchMetadataMultiServer
      .mockRejectedValueOnce(new Error('file server timed out'))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('')
    httpGet.mockRejectedValueOnce(new Error('404'))

    const fetched = await fetchResources([metadata, metadata, blurhash, direct], context)

    expect(fetched.map(({ ok, error }) => [ok, error])).toEqual([
      [false, 'file server timed out'],
      [false, 'no metadata file came back'],
      [false, 'no blurhash came back'],
      [false, '404'],
    ])
    expect(fetched.every((resource) => !('data' in resource))).toBe(true)
    // What a fetch threw goes with it, for the builder to log; an empty answer threw nothing.
    expect(fetched.map((resource) => resource.thrown?.value?.message ?? null)).toEqual(['file server timed out', null, null, '404'])
  })

  it('throws, from the plain read, an HTML error page as an HtmlPageError, and reads an empty file as none', async () => {
    const { HtmlPageError } = require('@src/utils/sync/core/resources')
    httpGet
      .mockResolvedValueOnce({ data: '<html></html>', headers: { 'content-type': 'text/html; charset=utf-8' } })
      .mockResolvedValueOnce({ data: '   ', headers: {} })
    const [html, blank] = await fetchResources([direct, direct], context)
    expect(html).toMatchObject({ ok: false, error: 'Blurhash URL returned HTML (error page), Content-Type: text/html; charset=utf-8' })
    expect(html.thrown.value).toBeInstanceOf(HtmlPageError)
    expect(html.thrown.value.contentType).toBe('text/html; charset=utf-8')
    expect(blank).toEqual({ ...direct, ok: false, error: 'no blurhash came back' })
  })
})

describe('buildWithResources', () => {
  // A builder that reads the files it is given, and says what it found.
  const reader = (requests) => {
    const calls = []
    const build = (resources) => {
      const read = requests.map((request) => resources.data(request))
      calls.push(read)
      return { plan: { ...emptyWritePlan(), needs: resources.needs }, read }
    }
    return { build, calls }
  }

  it('calls a builder that needs nothing once, and fetches nothing', async () => {
    const { build, calls } = reader([])
    await buildWithResources(build, context)
    expect(calls).toHaveLength(1)
    expect(fetchMetadataMultiServer).not.toHaveBeenCalled()
  })

  it('fetches every need of the first call, and returns the second call, which has them all', async () => {
    fetchMetadataMultiServer.mockImplementation(async (serverId, path, type) => (type === 'file' ? { path } : `bh:${path}`))
    const { build, calls } = reader([metadata, blurhash])

    const outcome = await buildWithResources(build, context)

    expect(calls).toEqual([[null, null], [{ path: metadata.path }, `bh:${blurhash.path}`]])
    expect(outcome.read).toEqual(calls[1])
    expect(fetchMetadataMultiServer).toHaveBeenCalledTimes(2)
  })

  it('hands a failed fetch to the builder as a failed resource, without a throw', async () => {
    fetchMetadataMultiServer.mockRejectedValue(new Error('down'))
    const { build, calls } = reader([metadata])

    const outcome = await buildWithResources(build, context)

    expect(calls).toEqual([[null], [null]])
    expect(outcome.plan.needs).toEqual([])
  })

  it('fetches what a throwing call read before it threw, and calls again', async () => {
    fetchMetadataMultiServer.mockResolvedValue({ seasons: [] })
    let calls = 0
    const build = (resources) => {
      calls++
      const fetched = resources.data(metadata)
      if (!fetched) throw new Error('the fallback needs an array')
      return { plan: { ...emptyWritePlan(), needs: resources.needs } }
    }

    await buildWithResources(build, context)

    expect(calls).toBe(2)
    expect(fetchMetadataMultiServer).toHaveBeenCalledTimes(1)
  })

  it('rethrows a call that throws with everything it read handed', async () => {
    fetchMetadataMultiServer.mockResolvedValue(null)
    const build = (resources) => {
      resources.data(metadata)
      throw new Error('builder failed')
    }
    await expect(buildWithResources(build, context)).rejects.toThrow('builder failed')
    expect(fetchMetadataMultiServer).toHaveBeenCalledTimes(1)
  })

  it('fails a builder that asks again for a file it was handed', async () => {
    fetchMetadataMultiServer.mockResolvedValue({ name: 'n' })
    const build = () => ({ plan: { ...emptyWritePlan(), needs: [metadata] } })
    await expect(buildWithResources(build, context)).rejects.toThrow('asked again for files it was handed')
  })
})
