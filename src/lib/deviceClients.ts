/**
 * The apps that may sign in through the device-code flow (better-auth's
 * deviceAuthorization plugin), by the client_id each sends to /device/code.
 * auth.ts refuses any other id (validateClient), and the approval screens
 * name the app from here, from the client_id the server stored with the
 * request, never from anything the device displays: a user should approve
 * only a request they can see is their own app's (GHSA-q84f-53jg-9ppm).
 *
 * No server imports: the approval screens are client components.
 */
export const DEVICE_CLIENTS: Readonly<Record<string, string>> = Object.freeze({
  // nextjs-stream-tv-mobile, AuthProvider.tsx: client.device.code({ client_id: 'mobile-app' })
  'mobile-app': 'The TV and mobile app',
})

export function isKnownDeviceClient(clientId: unknown): boolean {
  return typeof clientId === 'string' && Object.hasOwn(DEVICE_CLIENTS, clientId)
}

/** The app's name for a stored client_id, or null for one this server doesn't know. */
export function deviceClientName(clientId: unknown): string | null {
  return isKnownDeviceClient(clientId) ? DEVICE_CLIENTS[clientId as string] : null
}
