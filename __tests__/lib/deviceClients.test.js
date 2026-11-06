/** @jest-environment node */

const { deviceClientName, isKnownDeviceClient } = require('@src/lib/deviceClients')

describe('device-code client registration', () => {
  it.each([
    ['mobile-app', 'The TV and mobile app'],
    ['nextjs-stream-windows', 'The Windows app'],
  ])('accepts and names %s', (clientId, name) => {
    expect(isKnownDeviceClient(clientId)).toBe(true)
    expect(deviceClientName(clientId)).toBe(name)
  })

  it.each([
    ['someone-elses-app'],
    ['nextjs-stream-windows-unregistered'],
    ['NEXTJS-STREAM-WINDOWS'],
    ['nextjs-stream-windows '],
    [''],
    ['constructor'],
    ['__proto__'],
    [null],
    [undefined],
    [123],
    [{}],
    [['nextjs-stream-windows']],
  ])('rejects unknown or invalid client ID %p', (clientId) => {
    expect(isKnownDeviceClient(clientId)).toBe(false)
    expect(deviceClientName(clientId)).toBeNull()
  })
})
