/**
 * @jest-environment node
 *
 * The AV1 gate when its module is evaluated on the server. Client components
 * are prerendered there, and Node has a `navigator` global of its own, so
 * "is there a navigator" is not the question that keeps the check off the
 * server.
 */

import { startAv1DecodeCheck, canOfferAv1Clips } from '@src/components/VideoPreview/av1Clip'

// The shared jest setup (__mocks__/client.js) gives even this environment a
// jsdom `window`; a server has none.
const setupWindow = globalThis.window
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator')

afterEach(() => {
  globalThis.window = setupWindow
  if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor)
  else delete globalThis.navigator
})

it('neither asks nor remembers an answer where there is no window', async () => {
  const decodingInfo = jest.fn().mockResolvedValue({ supported: true, smooth: true })
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    writable: true,
    value: { mediaCapabilities: { decodingInfo } },
  })

  delete globalThis.window
  expect(typeof window).toBe('undefined')
  await expect(startAv1DecodeCheck()).resolves.toBe(false)
  expect(decodingInfo).not.toHaveBeenCalled()
  expect(canOfferAv1Clips()).toBe(false)

  // Nothing was latched: with a window the same module asks for the first time
  globalThis.window = setupWindow
  await expect(startAv1DecodeCheck()).resolves.toBe(true)
  expect(decodingInfo).toHaveBeenCalledTimes(1)
  expect(canOfferAv1Clips()).toBe(true)
})
