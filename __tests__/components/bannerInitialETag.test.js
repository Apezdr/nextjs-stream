/**
 * The server renders the /list banner and hands the client the ETag the
 * banner route gives that data. The client's first revalidation (SWR
 * revalidates on mount even with fallbackData) must send it, so an unchanged
 * banner comes back 304 instead of being downloaded a second time.
 */

jest.mock('@src/components/Landing/BannerWithVideo', () => ({
  __esModule: true,
  default: ({ mediaList }) => <div data-testid="banner">{mediaList.map((m) => m.title).join(',')}</div>,
}))

jest.mock('@src/app/loading', () => ({
  __esModule: true,
  default: () => <div>loading</div>,
}))

const reply = (status, { etag = null, body } = {}) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: (name) => (name.toLowerCase() === 'etag' ? etag : null) },
  json: async () => body,
})

// Each test gets a fresh copy of the shared ETag cache. Everything that uses
// React is loaded from the same fresh registry, so there is one React; the
// pure entry point registers no hooks, so this test cleans up itself.
let cleanup = () => {}
const renderBanner = (props) => {
  jest.resetModules()
  const testingLibrary = require('@testing-library/react/pure')
  const { SWRConfig } = require('swr')
  const BannerWithVideoContainer = require('@src/components/Landing/BannerWithVideoContainer').default
  cleanup = testingLibrary.cleanup
  testingLibrary.render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <BannerWithVideoContainer {...props} />
    </SWRConfig>
  )
  return { screen: testingLibrary.screen, waitFor: testingLibrary.waitFor }
}

beforeEach(() => {
  global.fetch = jest.fn()
})

afterEach(() => {
  cleanup()
})

it("revalidates with the server render's ETag and keeps its data on a 304", async () => {
  fetch.mockResolvedValue(reply(304))
  const { screen, waitFor } = renderBanner({
    initialData: [{ id: 'm1', title: 'First' }],
    initialETag: 'W/"server"',
  })

  await waitFor(() => expect(fetch).toHaveBeenCalled())
  const [url, init] = fetch.mock.calls[0]
  expect(url).toBe('/api/authenticated/banner')
  expect(init.headers.get('If-None-Match')).toBe('W/"server"')
  expect(screen.getByTestId('banner')).toHaveTextContent('First')
})

it('takes the new banner when the server says it changed', async () => {
  fetch.mockResolvedValue(reply(200, { etag: 'W/"new"', body: [{ id: 'm2', title: 'Second' }] }))
  const { screen, waitFor } = renderBanner({
    initialData: [{ id: 'm1', title: 'First' }],
    initialETag: 'W/"server"',
  })

  await waitFor(() => expect(screen.getByTestId('banner')).toHaveTextContent('Second'))
})

it('sends no validator when the server render had none', async () => {
  fetch.mockResolvedValue(reply(200, { etag: 'W/"new"', body: [{ id: 'm1', title: 'First' }] }))
  const { waitFor } = renderBanner({ initialData: [], initialETag: null })

  await waitFor(() => expect(fetch).toHaveBeenCalled())
  expect(fetch.mock.calls[0][1].headers.get('If-None-Match')).toBeNull()
})
